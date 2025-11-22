
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
    
    // Initialize the separated Audio Engine
    this.audioEngine = new AudioEngine({
      onInputVolume: config.onInputVolumeChange,
      onOutputVolume: config.onOutputVolumeChange,
      onError: (msg) => {
        console.error("Audio Engine Error:", msg);
        config.onError(msg);
        this.disconnect();
      }
    });
  }

  public async setInputDevice(deviceId: string) {
    this.currentInputDevice = deviceId;
    if (this.isConnected) {
      // Restart input stream with new device
      await this.audioEngine.startInput(deviceId, (base64) => this.sendAudioChunk(base64));
    }
  }

  public async setOutputDevice(deviceId: string) {
    this.currentOutputDevice = deviceId;
    await this.audioEngine.setOutputDevice(deviceId);
  }

  public async connect() {
    if (this.isConnected) return;

    this.config.onConnectionStateChange(ConnectionState.CONNECTING);

    try {
      // 1. Initialize Audio Output Context (requires user gesture chain, handled by calling this from button click)
      await this.audioEngine.initOutput(this.currentOutputDevice);

      // 2. Connect to Gemini Live Websocket
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
            
            // 3. Start Microphone only after connection is established
            await this.audioEngine.startInput(this.currentInputDevice, (base64) => {
               this.sendAudioChunk(base64);
            });
          },
          onmessage: (message: LiveServerMessage) => {
            this.handleServerMessage(message);
          },
          onclose: () => {
            console.log("Session closed remotely");
            if (this.isConnected) this.disconnect();
          },
          onerror: (err) => {
            console.error("Session error:", err);
            this.config.onError(err.message);
            this.disconnect();
          }
        }
      });
      
      this.session = await sessionPromise;

    } catch (error: any) {
      this.config.onError(error.message);
      this.disconnect();
    }
  }

  private sendAudioChunk(base64: string) {
    if (this.session) {
      this.session.sendRealtimeInput({
        media: {
          mimeType: 'audio/pcm;rate=16000',
          data: base64
        }
      });
    }
  }

  private handleServerMessage(message: LiveServerMessage) {
    // 1. Handle Transcripts (Visuals)
    const outputText = message.serverContent?.outputTranscription?.text;
    if (outputText) this.config.onTranscript(outputText, false);
    
    const inputText = message.serverContent?.inputTranscription?.text;
    if (inputText) this.config.onTranscript(inputText, true);

    // 2. Handle Audio Output (Sound)
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      this.audioEngine.queueAudioOutput(base64Audio);
    }
    
    // Note: We deliberately ignore 'interrupted' signals to enforce simultaneous mode
  }

  public async disconnect() {
    this.isConnected = false;
    
    // Close Audio Engine
    await this.audioEngine.close();

    // Close Session
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
