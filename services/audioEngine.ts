
import { AudioEngineConfig, ExtendedAudioContext } from '../types';

export class AudioEngine {
  private inputCtx: AudioContext | null = null;
  private outputCtx: ExtendedAudioContext | null = null;
  
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;

  // Gain Nodes for Volume Control
  private inputGainNode: GainNode | null = null;
  private outputGainNode: GainNode | null = null;
  
  // Store current gain levels (0.0 to 2.0, default 1.0)
  private currentInputGain: number = 1.0;
  private currentOutputGain: number = 1.0;
  
  private nextStartTime: number = 0;
  private config: AudioEngineConfig;
  private volumeInterval: any = null;

  // Logic for Silence Injection
  private lastSilenceInjectionTime: number = 0;
  private silenceThreshold: number = 0.015; // Slightly lower threshold to be sensitive
  private minSilenceInterval: number = 2500; // Check every ~2.5s (fits "2 to 5 sec" req)
  private isSilenceDetected: boolean = false;

  constructor(config: AudioEngineConfig) {
    this.config = config;
  }

  public setInputGain(value: number) {
    this.currentInputGain = value;
    if (this.inputGainNode) {
      this.inputGainNode.gain.value = value;
    }
  }

  public setOutputGain(value: number) {
    this.currentOutputGain = value;
    if (this.outputGainNode) {
      this.outputGainNode.gain.value = value;
    }
  }

  async initOutput(deviceId: string = 'default') {
    if (this.outputCtx) return;

    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;

    this.outputCtx = new AC({ sampleRate: 24000, latencyHint: 'interactive' }) as ExtendedAudioContext;
    
    if (deviceId !== 'default' && typeof this.outputCtx.setSinkId === 'function') {
      try { await this.outputCtx.setSinkId(deviceId); } catch (e) { console.warn(e); }
    }

    // Create Output Graph: Source -> Gain -> Analyser -> Destination
    this.outputGainNode = this.outputCtx.createGain();
    this.outputGainNode.gain.value = this.currentOutputGain;

    this.outputAnalyser = this.outputCtx.createAnalyser();
    this.outputAnalyser.fftSize = 32;
    
    // Connect permanent part of graph
    this.outputGainNode.connect(this.outputAnalyser);
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
    await this.stopInput();

    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    
    try {
      this.inputCtx = new AC({ sampleRate: 16000, latencyHint: 'interactive' });
    } catch (e) {
      this.inputCtx = new AC(); 
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      if (!this.inputCtx) {
          this.stream.getTracks().forEach(t => t.stop());
          this.stream = null;
          return;
      }

      this.source = this.inputCtx.createMediaStreamSource(this.stream);
      
      // Create Input Graph: Source -> Gain -> Analyser -> Processor -> Destination
      this.inputGainNode = this.inputCtx.createGain();
      this.inputGainNode.gain.value = this.currentInputGain;

      this.inputAnalyser = this.inputCtx.createAnalyser();
      this.inputAnalyser.fftSize = 32;

      this.processor = this.inputCtx.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        if (!this.inputCtx) return;

        // --- SILENCE INJECTION LOGIC ---
        // Calculate RMS (Root Mean Square) for volume level
        let sum = 0;
        const sampleCount = 100; // Check first 100 samples for efficiency
        for (let i = 0; i < sampleCount && i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / sampleCount);
        const now = Date.now();

        // Check if silence detected
        if (rms < this.silenceThreshold) {
           // Only inject if enough time has passed since last injection (2-5s rule)
           if (!this.isSilenceDetected && (now - this.lastSilenceInjectionTime > this.minSilenceInterval)) {
             
             // Inject 0.7s of silence (16000Hz * 0.7 = 11200 samples)
             const silenceLen = 11200; 
             const silenceBuffer = new Int16Array(silenceLen); // Zeros
             const base64Silence = this.arrayBufferToBase64(silenceBuffer.buffer);
             
             // Send silence packet
             onData(base64Silence);
             
             this.lastSilenceInjectionTime = now;
             this.isSilenceDetected = true;
             // console.debug("AudioEngine: Injected 0.7s silence separator");
           }
        } else {
           // Reset flag if noise returns significantly above threshold
           if (rms > this.silenceThreshold * 1.5) {
             this.isSilenceDetected = false;
           }
        }
        // --------------------------------

        const currentRate = this.inputCtx.sampleRate || 48000;
        let finalData = inputData;

        if (currentRate !== 16000) {
           finalData = this.downsample(inputData, currentRate, 16000);
        }

        const pcm16 = new Int16Array(finalData.length);
        for (let i = 0; i < finalData.length; i++) {
           const s = Math.max(-1, Math.min(1, finalData[i]));
           pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const base64 = this.arrayBufferToBase64(pcm16.buffer);
        onData(base64);
      };

      // Connect Graph
      this.source.connect(this.inputGainNode);
      this.inputGainNode.connect(this.inputAnalyser);
      this.inputAnalyser.connect(this.processor);
      this.processor.connect(this.inputCtx.destination);

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
    if (this.inputGainNode) {
      this.inputGainNode.disconnect();
      this.inputGainNode = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.inputCtx) {
      if (this.inputCtx.state !== 'closed') {
        try { await this.inputCtx.close(); } catch(e) { console.warn(e); }
      }
      this.inputCtx = null;
    }
  }

  async close() {
    await this.stopInput();
    if (this.volumeInterval) clearInterval(this.volumeInterval);
    if (this.outputCtx) {
      try { await this.outputCtx.close(); } catch(e) {}
      this.outputCtx = null;
    }
  }

  async queueAudioOutput(base64: string) {
    if (!this.outputCtx || !this.outputGainNode) return;
    
    try {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        const int16 = new Int16Array(bytes.buffer);
        const buffer = this.outputCtx.createBuffer(1, int16.length, 24000); 
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < int16.length; i++) {
            channelData[i] = int16[i] / 32768.0;
        }

        const source = this.outputCtx.createBufferSource();
        source.buffer = buffer;
        
        // REMOVED manual playbackRate calculation as requested.
        // Speed control is now handled via Prompt Engineering in App.tsx
        
        source.connect(this.outputGainNode);

        const currentTime = this.outputCtx.currentTime;
        
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
    // 512ms interval for low CPU usage
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
    }, 512);
  }
  
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
