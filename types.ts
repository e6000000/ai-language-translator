
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

export enum LanguageMode {
  AUTO = 'AUTO',
  DE_TO_EN = 'DE_TO_EN',
  EN_TO_DE = 'EN_TO_DE',
  CUSTOM = 'CUSTOM',
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
  isFinal?: boolean; // To track if block is "done"
}

export interface AudioEngineConfig {
  onInputVolume: (volume: number) => void;
  onOutputVolume: (volume: number) => void;
  onError: (message: string) => void;
}

// Extended AudioContext interface for setSinkId (experimental feature)
export interface ExtendedAudioContext extends AudioContext {
  setSinkId(deviceId: string): Promise<void>;
  sinkId: string;
}