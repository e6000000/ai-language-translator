export interface AudioDevice {
  deviceId: string;
  label: string;
  groupId?: string;
}

export interface VisualizerData {
  volume: number; // 0 to 1
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface TranslationConfig {
  sourceLanguage: string;
  targetLanguage: string;
}

export interface Transcript {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

// Extended AudioContext interface for setSinkId (experimental feature)
export interface ExtendedAudioContext extends AudioContext {
  setSinkId(deviceId: string): Promise<void>;
  sinkId: string;
}