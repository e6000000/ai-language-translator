import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState, ExtendedAudioContext } from '../types';
import { base64ToUint8Array, decodeAudioData, float32ToInt16, uint8ArrayToBase64, downsampleTo16k } from './audioUtils';

interface ServiceConfig {
  apiKey: string;
  onConnectionStateChange: (state: ConnectionState) => void;
  onInputVolumeChange: (volume: number) => void;
  onOutputVolumeChange: (volume: number) => void;
  onTranscript: (text: string, isUser: boolean) => void;
  onError: (error: string) => void;
  systemInstruction: string;
}

export class GeminiLiveService {
  private ai: GoogleGenAI;
  private config: ServiceConfig;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: ExtendedAudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private volumeInterval: any = null;
  
  private nextStartTime: number = 0;
  private session: any = null;
  private isConnected: boolean = false;
  
  // Audio Settings
  private inputDeviceId: string = 'default';
  private outputDeviceId: string = 'default';

  constructor(config: ServiceConfig) {
    this.config = config;
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
  }

  public setInputDevice(deviceId: string) {
    this.inputDeviceId = deviceId;
    if (this.isConnected) {
      this.restartAudioInput();
    }
  }

  public async setOutputDevice(deviceId: string) {
    this.outputDeviceId = deviceId;
    if (this.outputAudioContext && typeof this.outputAudioContext.setSinkId === 'function') {
      try {
        await this.outputAudioContext.setSinkId(deviceId);
        console.log(`Output device set to ${deviceId}`);
      } catch (e) {
        console.warn('Failed to set output device', e);
      }
    }
  }

  private startVolumePolling() {
    if (this.volumeInterval) clearInterval(this.volumeInterval);
    
    this.volumeInterval = setInterval(() => {
      // Poll Input Volume
      if (this.inputAnalyser) {
        const array = new Uint8Array(this.inputAnalyser.frequencyBinCount);
        this.inputAnalyser.getByteFrequencyData(array);
        let sum = 0;
        for (let i = 0; i < array.length; i++) {
          sum += array[i];
        }
        const avg = sum / array.length;
        // Scale for better visualization (0-255 -> 0-1)
        this.config.onInputVolumeChange(Math.min(1, (avg / 128))); 
      } else {
        this.config.onInputVolumeChange(0);
      }

      // Poll Output Volume
      if (this.outputAnalyser) {
        const array = new Uint8Array(this.outputAnalyser.frequencyBinCount);
        this.outputAnalyser.getByteFrequencyData(array);
        let sum = 0;
        for (let i = 0; i < array.length; i++) {
          sum += array[i];
        }
        const avg = sum / array.length;
        this.config.onOutputVolumeChange(Math.min(1, (avg / 128)));
      } else {
        this.config.onOutputVolumeChange(0);
      }
    }, 50); // 20fps updates
  }

  private async restartAudioInput() {
    await this.stopAudioInput();
    if (this.isConnected && this.session) {
      await this.startAudioInput();
    }
  }

  private async stopAudioInput() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.inputAnalyser) {
      this.inputAnalyser.disconnect();
      this.inputAnalyser = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.inputAudioContext) {
      try {
        await this.inputAudioContext.close();
      } catch (e) {
        console.warn("Error closing input audio context", e);
      }
      this.inputAudioContext = null;
    }
  }

  private async startAudioInput() {
    try {
      // 1. Get Media Stream FIRST with robust constraints
      const constraints: MediaTrackConstraints = {
        channelCount: 1,
        echoCancellation: true,
        autoGainControl: true,
        noiseSuppression: true,
      };

      // Only apply deviceId if it's a specific ID, otherwise let browser choose default
      if (this.inputDeviceId && this.inputDeviceId !== 'default') {
         constraints.deviceId = { exact: this.inputDeviceId };
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: constraints });

      // 2. Create Audio Context
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      
      try {
        // Try to force 16kHz to match model requirement without resampling
        this.inputAudioContext = new AudioContextClass({ sampleRate: 16000 });
      } catch (e) {
        console.warn("16kHz sample rate not supported by browser, falling back to system rate.");
        this.inputAudioContext = new AudioContextClass();
      }

      // 3. Setup Graph
      this.source = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
      this.inputAnalyser = this.inputAudioContext.createAnalyser();
      this.inputAnalyser.fftSize = 256;
      
      // Smaller buffer size = Lower latency
      // 2048 samples @ 16k is ~128ms
      this.processor = this.inputAudioContext.createScriptProcessor(2048, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.session) return;

        const inputData = e.inputBuffer.getChannelData(0);
        
        // Handle resampling if native context is not 16000Hz
        let pcmData: Int16Array;
        
        if (this.inputAudioContext && this.inputAudioContext.sampleRate !== 16000) {
           const resampled = downsampleTo16k(inputData, this.inputAudioContext.sampleRate);
           pcmData = float32ToInt16(resampled);
        } else {
           pcmData = float32ToInt16(inputData);
        }

        const uint8 = new Uint8Array(pcmData.buffer);
        const base64 = uint8ArrayToBase64(uint8);

        // CRITICAL: Solely rely on sessionPromise resolves and then call `session.sendRealtimeInput`
        // In this implementation, `this.session` is established before startAudioInput is called
        // or we check if session exists.
        if (this.session) {
           this.session.sendRealtimeInput({
              media: {
                  mimeType: 'audio/pcm;rate=16000',
                  data: base64
              }
          });
        }
      };

      // Connect graph: Source -> Analyser -> Processor -> Destination
      this.source.connect(this.inputAnalyser);
      this.inputAnalyser.connect(this.processor);
      this.processor.connect(this.inputAudioContext.destination);

    } catch (error: any) {
      console.error("Error starting audio input:", error);
      this.config.onError(`Microphone Error: ${error.message || 'Check privacy settings'}`);
    }
  }

  public async connect() {
    if (this.isConnected) return;

    this.config.onConnectionStateChange(ConnectionState.CONNECTING);

    try {
      // Initialize Output Context
      this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)() as ExtendedAudioContext;
      
      // Ensure it's running
      if (this.outputAudioContext.state === 'suspended') {
        await this.outputAudioContext.resume();
      }

      // Setup Output Analyser
      this.outputAnalyser = this.outputAudioContext.createAnalyser();
      this.outputAnalyser.fftSize = 256;
      // Connect Analyser to Destination ONCE to avoid graph errors or redundancy
      this.outputAnalyser.connect(this.outputAudioContext.destination);

      // Try to set output device immediately
      if (this.outputDeviceId !== 'default') {
          await this.setOutputDevice(this.outputDeviceId);
      }

      this.nextStartTime = this.outputAudioContext.currentTime;
      this.startVolumePolling();

      const sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }, 
          },
          systemInstruction: this.config.systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: async () => {
            console.log("Gemini Live Session Opened");
            this.isConnected = true;
            this.config.onConnectionStateChange(ConnectionState.CONNECTED);
            await this.startAudioInput();
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Transcriptions
            const outputText = message.serverContent?.outputTranscription?.text;
            if (outputText) {
              this.config.onTranscript(outputText, false);
            }
            
            const inputText = message.serverContent?.inputTranscription?.text;
            if (inputText) {
               this.config.onTranscript(inputText, true);
            }

            // Handle Audio
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            
            if (base64Audio && this.outputAudioContext) {
              try {
                const audioData = base64ToUint8Array(base64Audio);
                // Model returns 24000Hz audio
                const audioBuffer = await decodeAudioData(audioData, this.outputAudioContext, 24000, 1);
                
                const source = this.outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                
                const gainNode = this.outputAudioContext.createGain();
                gainNode.gain.value = 1.0; 

                // Graph: Source -> Gain -> Analyser
                source.connect(gainNode);
                if (this.outputAnalyser) {
                    gainNode.connect(this.outputAnalyser);
                } else {
                    // Fallback if analyser is missing (shouldn't happen)
                    gainNode.connect(this.outputAudioContext.destination);
                }

                // Low latency scheduling
                const now = this.outputAudioContext.currentTime;
                // If we fell behind or it's the first chunk, play immediately
                if (this.nextStartTime < now) {
                  this.nextStartTime = now;
                }
                
                source.start(this.nextStartTime);
                this.nextStartTime += audioBuffer.duration;

              } catch (e) {
                console.error("Error processing audio message:", e);
              }
            }

            if (message.serverContent?.interrupted) {
                // Reset timing on interruption
                if (this.outputAudioContext) {
                  this.nextStartTime = this.outputAudioContext.currentTime;
                }
            }
          },
          onclose: () => {
            console.log("Session Closed");
            // Only handle disconnect if we haven't already initiated a deliberate disconnect
            if (this.isConnected) {
               this.handleDisconnect();
            }
          },
          onerror: (err) => {
            console.error("Session Error", err);
            this.config.onError("Connection error occurred: Request contains an invalid argument.");
            this.handleDisconnect();
          }
        }
      });
      
      this.session = await sessionPromise;

    } catch (error: any) {
      console.error("Connection failed:", error);
      this.config.onError(error.message || "Failed to connect to Gemini.");
      this.handleDisconnect();
    }
  }

  public async disconnect() {
    await this.handleDisconnect();
  }

  private async handleDisconnect() {
    this.isConnected = false;
    await this.stopAudioInput();
    
    if (this.volumeInterval) {
      clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }
    
    if (this.outputAudioContext) {
      try {
        await this.outputAudioContext.close();
      } catch (e) { console.warn("Error closing output context", e); }
      this.outputAudioContext = null;
    }
    
    if (this.outputAnalyser) {
      try {
        this.outputAnalyser.disconnect();
      } catch (e) {}
      this.outputAnalyser = null;
    }

    if (this.session) {
        try {
            this.session.close();
        } catch (e) {
            console.warn("Error closing session", e);
        }
        this.session = null;
    }
    
    this.config.onConnectionStateChange(ConnectionState.DISCONNECTED);
  }
}
