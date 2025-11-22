
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState } from '../types';
import { AudioEngine } from './audioEngine';

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
  private session: any = null;
  private isConnected: boolean = false;
  private audioEngine: AudioEngine;
  
  private currentInputDevice: string = 'default';
  private currentOutputDevice: string = 'default';

  constructor(config: ServiceConfig) {
    this.config = config;
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    
    this.audioEngine = new AudioEngine({
      onInputVolume: config.onInputVolumeChange,
      onOutputVolume: config.onOutputVolumeChange,
      onError: (msg) => {
        console.error("AudioEngine Error:", msg);
        this.disconnect();
        config.onError(msg);
      }
    });
  }

  public async setInputDevice(deviceId: string) {
    this.currentInputDevice = deviceId;
    if (this.isConnected) {
      await this.audioEngine.startInput(deviceId, (b64) => this.sendAudio(b64));
    }
  }

  public async setOutputDevice(deviceId: string) {
    this.currentOutputDevice = deviceId;
    await this.audioEngine.setOutputDevice(deviceId);
  }

  public async connect(options?: { systemInstruction?: string }) {
    if (this.isConnected) return;
    this.config.onConnectionStateChange(ConnectionState.CONNECTING);

    try {
      // Init Audio Contexts
      await this.audioEngine.initOutput(this.currentOutputDevice);

      const sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: options?.systemInstruction || this.config.systemInstruction,
          inputAudioTranscription: {}, // Request transcription for user
          outputAudioTranscription: {}, // Request transcription for model
        },
        callbacks: {
          onopen: async () => {
            this.isConnected = true;
            this.config.onConnectionStateChange(ConnectionState.CONNECTED);
            // Start Mic
            await this.audioEngine.startInput(this.currentInputDevice, (b64) => this.sendAudio(b64));
          },
          onmessage: (msg: LiveServerMessage) => this.handleMessage(msg),
          onclose: () => this.disconnect(),
          onerror: (e) => {
             this.config.onError(e.message);
             this.disconnect();
          }
        }
      });

      this.session = await sessionPromise;

    } catch (e: any) {
      this.config.onError(e.message);
      this.disconnect();
    }
  }

  private sendAudio(base64: string) {
    if (!this.session) return;
    this.session.sendRealtimeInput({
      media: { mimeType: 'audio/pcm;rate=16000', data: base64 }
    });
  }

  private handleMessage(message: LiveServerMessage) {
    // Audio
    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData) {
      this.audioEngine.queueAudioOutput(audioData);
    }

    // Transcripts
    const outText = message.serverContent?.outputTranscription?.text;
    if (outText) this.config.onTranscript(outText, false);

    const inText = message.serverContent?.inputTranscription?.text;
    if (inText) this.config.onTranscript(inText, true);
  }

  public async disconnect() {
    this.isConnected = false;
    await this.audioEngine.close();
    if (this.session) {
       try { this.session.close(); } catch(e) {}
       this.session = null;
    }
    this.config.onConnectionStateChange(ConnectionState.DISCONNECTED);
  }
}
