
import { AudioEngineConfig, ExtendedAudioContext } from '../types';

export class AudioEngine {
  private inputCtx: AudioContext | null = null;
  private outputCtx: ExtendedAudioContext | null = null;
  
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  
  private nextStartTime: number = 0;
  private config: AudioEngineConfig;
  private volumeInterval: any = null;

  constructor(config: AudioEngineConfig) {
    this.config = config;
  }

  async initOutput(deviceId: string = 'default') {
    if (this.outputCtx) return;

    const AC = window.AudioContext || (window as any).webkitAudioContext;
    // 24kHz is the native rate for Gemini's "Puck/Kore" voices usually. 
    // Matching it prevents browser resampling artifacts.
    this.outputCtx = new AC({ sampleRate: 24000, latencyHint: 'interactive' }) as ExtendedAudioContext;
    
    if (deviceId !== 'default' && typeof this.outputCtx.setSinkId === 'function') {
      try { await this.outputCtx.setSinkId(deviceId); } catch (e) { console.warn(e); }
    }

    this.outputAnalyser = this.outputCtx.createAnalyser();
    this.outputAnalyser.fftSize = 32;
    this.outputAnalyser.connect(this.outputCtx.destination);

    this.nextStartTime = this.outputCtx.currentTime;
    this.startVolumeMonitor();
  }

  async setOutputDevice(deviceId: string) {
    if (this.outputCtx && typeof this.outputCtx.setSinkId === 'function') {
      await this.outputCtx.setSinkId(deviceId);
    }
  }

  async startInput(deviceId: string, onData: (base64: string) => void) {
    // cleanup previous
    await this.stopInput();

    const AC = window.AudioContext || (window as any).webkitAudioContext;
    
    // ATTEMPT 1: Create 16kHz Context (Native support = Fastest performance)
    try {
      this.inputCtx = new AC({ sampleRate: 16000, latencyHint: 'interactive' });
    } catch (e) {
      this.inputCtx = new AC(); // Fallback to default (usually 48k)
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
          channelCount: 1,
          sampleRate: 16000, // Request 16k from HW
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      this.source = this.inputCtx.createMediaStreamSource(this.stream);
      this.inputAnalyser = this.inputCtx.createAnalyser();
      this.inputAnalyser.fftSize = 32;

      // 4096 is the sweet spot for the Google GenAI API.
      // 2048 is faster but can be jittery. 4096 ensures clean chunks.
      this.processor = this.inputCtx.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const currentRate = this.inputCtx?.sampleRate || 48000;

        let finalData = inputData;

        // Downsample if we couldn't get a native 16k context
        if (currentRate !== 16000) {
           finalData = this.downsample(inputData, currentRate, 16000);
        }

        // Convert to Int16 directly
        const pcm16 = new Int16Array(finalData.length);
        for (let i = 0; i < finalData.length; i++) {
           const s = Math.max(-1, Math.min(1, finalData[i]));
           pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Send to API
        const base64 = this.arrayBufferToBase64(pcm16.buffer);
        onData(base64);
      };

      this.source.connect(this.inputAnalyser);
      this.inputAnalyser.connect(this.processor);
      this.processor.connect(this.inputCtx.destination); // Keep alive

    } catch (e: any) {
      this.config.onError("Mic Error: " + e.message);
    }
  }

  async stopInput() {
    if (this.stream) {
       this.stream.getTracks().forEach(t => t.stop());
       this.stream = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.inputCtx) {
      await this.inputCtx.close();
      this.inputCtx = null;
    }
  }

  async close() {
    await this.stopInput();
    if (this.volumeInterval) clearInterval(this.volumeInterval);
    if (this.outputCtx) {
      await this.outputCtx.close();
      this.outputCtx = null;
    }
  }

  /**
   * Play Audio Chunk with low latency logic
   */
  async queueAudioOutput(base64: string) {
    if (!this.outputCtx) return;
    
    try {
        // 1. Decode
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        const int16 = new Int16Array(bytes.buffer);
        // Gemini Output is 24kHz
        const buffer = this.outputCtx.createBuffer(1, int16.length, 24000); 
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < int16.length; i++) {
            channelData[i] = int16[i] / 32768.0;
        }

        // 2. Schedule
        const source = this.outputCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.outputAnalyser!); // visualizer
        this.outputAnalyser!.connect(this.outputCtx.destination); // speakers

        const currentTime = this.outputCtx.currentTime;
        
        // DRIFT CORRECTION:
        // If we are behind, play IMMEDIATELY.
        // If we are slightly ahead, schedule it.
        // If we are way behind, reset the timeline.
        
        if (this.nextStartTime < currentTime) {
            this.nextStartTime = currentTime;
        }
        
        source.start(this.nextStartTime);
        this.nextStartTime += buffer.duration;

    } catch (e) {
        console.error("Audio decode error", e);
    }
  }

  private startVolumeMonitor() {
    if (this.volumeInterval) clearInterval(this.volumeInterval);
    this.volumeInterval = setInterval(() => {
       if (this.inputAnalyser) {
         const d = new Uint8Array(this.inputAnalyser.frequencyBinCount);
         this.inputAnalyser.getByteFrequencyData(d);
         this.config.onInputVolume(d[0] / 255);
       }
       if (this.outputAnalyser) {
         const d = new Uint8Array(this.outputAnalyser.frequencyBinCount);
         this.outputAnalyser.getByteFrequencyData(d);
         this.config.onOutputVolume(d[0] / 255);
       }
    }, 100);
  }

  // --- Utils ---
  
  private downsample(input: Float32Array, inputRate: number, targetRate: number): Float32Array {
    if (inputRate === targetRate) return input;
    const ratio = inputRate / targetRate;
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

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
