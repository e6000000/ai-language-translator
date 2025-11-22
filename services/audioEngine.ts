
import { ExtendedAudioContext } from '../types';

export interface AudioEngineConfig {
  onInputVolume: (vol: number) => void;
  onOutputVolume: (vol: number) => void;
  onError: (msg: string) => void;
}

/**
 * AudioEngine v2.00
 * Handles all Web Audio API interactions with a focus on low-latency streaming.
 * Includes "Catch-up" logic to prevent audio drift.
 */
export class AudioEngine {
  private inputCtx: AudioContext | null = null;
  private outputCtx: ExtendedAudioContext | null = null;
  
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private inputProcessor: ScriptProcessorNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  
  private outputAnalyser: AnalyserNode | null = null;
  private outputGain: GainNode | null = null;
  
  private volumeInterval: any = null;
  private nextStartTime: number = 0;
  
  // Callbacks
  private onAudioDataCallback: ((base64: string) => void) | null = null;
  private config: AudioEngineConfig;

  constructor(config: AudioEngineConfig) {
    this.config = config;
  }

  /**
   * Initialize Output Context (Speaker)
   * Must be called after user interaction to unlock audio.
   */
  public async initOutput(deviceId: string = 'default') {
    if (this.outputCtx) {
      if (this.outputCtx.state === 'suspended') await this.outputCtx.resume();
      return;
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.outputCtx = new AudioContextClass({ latencyHint: 'interactive', sampleRate: 24000 }) as ExtendedAudioContext;
    
    this.outputGain = this.outputCtx.createGain();
    this.outputAnalyser = this.outputCtx.createAnalyser();
    this.outputAnalyser.fftSize = 128; // Small FFT for fast UI updates

    this.outputGain.connect(this.outputAnalyser);
    this.outputAnalyser.connect(this.outputCtx.destination);
    
    await this.setOutputDevice(deviceId);
    
    // Reset timing cursor
    this.nextStartTime = this.outputCtx.currentTime;
    this.startVolumeMonitoring();
  }

  /**
   * Initialize Input Context (Microphone)
   * Starts recording immediately.
   */
  public async startInput(deviceId: string, onAudioData: (base64: string) => void) {
    this.onAudioDataCallback = onAudioData;
    
    try {
      // Stop previous if exists
      await this.stopInput();

      const constraints = {
        audio: {
          deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
          sampleRate: 16000 // Try to request native 16k, but browser might ignore
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.inputCtx = new AudioContextClass(); // Let browser decide rate (usually 44.1/48k)
      
      this.inputSource = this.inputCtx.createMediaStreamSource(stream);
      this.inputAnalyser = this.inputCtx.createAnalyser();
      this.inputAnalyser.fftSize = 128;

      // Use 1024 buffer size: Good balance. 
      // 512 is faster (~11ms) but prone to "crackle" if main thread is busy. 
      // 1024 (~23ms) is safe and still very fast.
      this.inputProcessor = this.inputCtx.createScriptProcessor(1024, 1, 1);

      this.inputProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        this.processInputBuffer(inputData, e.inputBuffer.sampleRate);
      };

      this.inputSource.connect(this.inputAnalyser);
      this.inputAnalyser.connect(this.inputProcessor);
      this.inputProcessor.connect(this.inputCtx.destination); // Essential for Chrome to fire process

    } catch (e: any) {
      this.config.onError(`Microphone start failed: ${e.message}`);
    }
  }

  public async stopInput() {
    if (this.inputSource) {
      this.inputSource.disconnect();
      this.inputSource.mediaStream.getTracks().forEach(t => t.stop());
      this.inputSource = null;
    }
    if (this.inputProcessor) {
      this.inputProcessor.disconnect();
      this.inputProcessor = null;
    }
    if (this.inputCtx) {
      await this.inputCtx.close();
      this.inputCtx = null;
    }
  }

  public async close() {
    await this.stopInput();
    if (this.volumeInterval) clearInterval(this.volumeInterval);
    if (this.outputCtx) {
      await this.outputCtx.close();
      this.outputCtx = null;
    }
  }

  /**
   * Sets the audio output device (Sink ID)
   */
  public async setOutputDevice(deviceId: string) {
    if (!this.outputCtx || typeof this.outputCtx.setSinkId !== 'function') return;
    try {
      await this.outputCtx.setSinkId(deviceId);
    } catch (e: any) {
      console.warn("Could not set output device:", e);
    }
  }

  /**
   * Queues audio data for playback.
   * CRITICAL: Handles Drift Correction to keep latency under control.
   */
  public async queueAudioOutput(base64Data: string) {
    if (!this.outputCtx || !this.outputGain) return;

    try {
      const audioBuffer = await this.decodeAudioData(base64Data);
      
      const source = this.outputCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputGain);

      const currentTime = this.outputCtx.currentTime;

      // === DRIFT CORRECTION STRATEGY ===
      // If nextStartTime is in the past (we are lagging), jump to now.
      // If nextStartTime is too far in the future (unlikely but possible), play normally.
      // We add a tiny offset (0.01s) to prevent immediate cut-off jitter.
      if (this.nextStartTime < currentTime) {
         this.nextStartTime = currentTime + 0.01;
      }

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;

    } catch (e) {
      console.error("Error queuing audio:", e);
    }
  }

  // --- Internal Helpers ---

  /**
   * Resamples input to 16kHz and converts to PCM16 Base64
   */
  private processInputBuffer(inputFloat32: Float32Array, originalSampleRate: number) {
    if (!this.onAudioDataCallback) return;

    let finalData = inputFloat32;
    
    // Downsample if needed (Browser 48k -> Gemini 16k)
    if (originalSampleRate !== 16000) {
      finalData = this.downsampleTo16k(inputFloat32, originalSampleRate);
    }

    const int16 = this.float32ToInt16(finalData);
    const base64 = this.arrayBufferToBase64(int16.buffer);
    
    this.onAudioDataCallback(base64);
  }

  private downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
    if (inputRate === 16000) return input;
    const ratio = inputRate / 16000;
    const newLength = Math.ceil(input.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetInput = 0;

    while (offsetResult < newLength) {
      const nextOffsetInput = Math.round((offsetResult + 1) * ratio);
      let accum = 0, count = 0;
      for (let i = offsetInput; i < nextOffsetInput && i < input.length; i++) {
        accum += input[i];
        count++;
      }
      result[offsetResult] = count ? accum / count : 0;
      offsetResult++;
      offsetInput = nextOffsetInput;
    }
    return result;
  }

  private float32ToInt16(float32: Float32Array): Int16Array {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  private async decodeAudioData(base64: string): Promise<AudioBuffer> {
    if (!this.outputCtx) throw new Error("No output context");
    
    // Gemini sends 24kHz audio usually, or 16kHz. 
    // Since raw PCM has no header, we must know the rate.
    // Gemini Live output is typically 24000Hz.
    const targetRate = 24000; 

    const rawBytes = this.base64ToArrayBuffer(base64);
    const dataInt16 = new Int16Array(rawBytes.buffer);
    
    const buffer = this.outputCtx.createBuffer(1, dataInt16.length, targetRate);
    const channelData = buffer.getChannelData(0);
    
    for (let i = 0; i < dataInt16.length; i++) {
      channelData[i] = dataInt16[i] / 32768.0;
    }
    
    return buffer;
  }

  // --- Volume Monitoring ---
  
  private startVolumeMonitoring() {
    if (this.volumeInterval) clearInterval(this.volumeInterval);
    this.volumeInterval = setInterval(() => {
      // Input Volume
      if (this.inputAnalyser) {
        const data = new Uint8Array(this.inputAnalyser.frequencyBinCount);
        this.inputAnalyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        this.config.onInputVolume(avg / 128);
      }
      // Output Volume
      if (this.outputAnalyser) {
         const data = new Uint8Array(this.outputAnalyser.frequencyBinCount);
         this.outputAnalyser.getByteFrequencyData(data);
         const avg = data.reduce((a, b) => a + b, 0) / data.length;
         this.config.onOutputVolume(avg / 128);
      }
    }, 50);
  }
}
