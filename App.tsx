
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ConnectionState, Transcript, LanguageMode } from './types';
import { GeminiLiveService } from './services/geminiLiveService';
import DeviceSelector from './components/DeviceSelector';
import AudioVisualizer from './components/AudioVisualizer';

const getSystemInstruction = (mode: LanguageMode) => {
  const baseInstruction = `
You are a professional simultaneous interpreter.
Your goal is to translate spoken audio with ABSOLUTE MINIMAL LATENCY.

RULES:
1. STREAMING: Do not wait for a full sentence. Translate phrase-by-phrase immediately.
2. OVERLAP: Do not stop speaking when the user speaks. Continue translating what you heard previously.
3. CONCISENESS: Do not add pleasantries. JUST TRANSLATE.
`;

  switch (mode) {
    case LanguageMode.DE_TO_EN:
      return `${baseInstruction}
4. DIRECTION: The input language is GERMAN. You must translate it to ENGLISH. If you hear English, just repeat it or ignore it.`;
    case LanguageMode.EN_TO_DE:
      return `${baseInstruction}
4. DIRECTION: The input language is ENGLISH. You must translate it to GERMAN. If you hear German, just repeat it or ignore it.`;
    case LanguageMode.AUTO:
    default:
      return `${baseInstruction}
4. DIRECTION: Detect language automatically (German or English) and translate to the other language instantly.`;
  }
};

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  
  // Configuration
  const [languageMode, setLanguageMode] = useState<LanguageMode>(LanguageMode.AUTO);
  const [inputVolume, setInputVolume] = useState<number>(0);
  const [outputVolume, setOutputVolume] = useState<number>(0);
  const [inputDeviceId, setInputDeviceId] = useState<string>('default');
  const [outputDeviceId, setOutputDeviceId] = useState<string>('default');
  const [hasPermissions, setHasPermissions] = useState<boolean>(false);

  // Transcripts
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [latestTranslation, setLatestTranslation] = useState<string>("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const liveServiceRef = useRef<GeminiLiveService | null>(null);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts, latestTranslation]);

  // Initialize Service
  useEffect(() => {
    if (!process.env.API_KEY) {
      setError("API_KEY is missing in environment variables.");
      return;
    }

    liveServiceRef.current = new GeminiLiveService({
      apiKey: process.env.API_KEY,
      onConnectionStateChange: setConnectionState,
      onInputVolumeChange: setInputVolume,
      onOutputVolumeChange: setOutputVolume,
      onTranscript: (text, isUser) => {
         handleTranscriptIncoming(text, isUser);
      },
      onError: (msg) => {
        setError(msg);
        setConnectionState(ConnectionState.ERROR);
      },
      systemInstruction: getSystemInstruction(LanguageMode.AUTO), // Default
    });

    return () => {
      liveServiceRef.current?.disconnect();
    };
  }, []);

  // Permission Check
  useEffect(() => {
    const checkPermissions = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        setHasPermissions(true);
      } catch (e) {
        console.error("Permission denied", e);
        setError("Microphone access required.");
      }
    };
    checkPermissions();
  }, []);

  // --- Logic for Aggregating Text Blocks ---
  const handleTranscriptIncoming = (text: string, isUser: boolean) => {
    setTranscripts(prev => {
      const last = prev[prev.length - 1];
      // If same speaker and last block is not too huge, append.
      // This prevents the "one word per bubble" issue.
      if (last && last.isUser === isUser && last.text.length < 600) {
        const updated = { ...last, text: last.text + text };
        
        // If it's the model speaking, update the big display
        if (!isUser) {
           setLatestTranslation(updated.text);
        }
        
        return [...prev.slice(0, -1), updated];
      }
      
      // New Block
      if (!isUser) setLatestTranslation(text);
      
      return [...prev, { 
        id: Date.now().toString(), 
        text, 
        isUser, 
        timestamp: new Date() 
      }];
    });
  };

  const toggleConnection = useCallback(() => {
    if (!liveServiceRef.current) return;

    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      liveServiceRef.current.disconnect();
    } else {
      setError(null);
      setTranscripts([]);
      setLatestTranslation("");
      
      // Generate instruction based on current mode selection
      const instruction = getSystemInstruction(languageMode);
      liveServiceRef.current.connect({ systemInstruction: instruction });
    }
  }, [connectionState, languageMode]);

  const handleInputChange = (deviceId: string) => {
    setInputDeviceId(deviceId);
    liveServiceRef.current?.setInputDevice(deviceId);
  };

  const handleOutputChange = (deviceId: string) => {
    setOutputDeviceId(deviceId);
    liveServiceRef.current?.setOutputDevice(deviceId);
  };

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;

  return (
    <div className="h-screen w-full bg-slate-950 text-slate-200 font-sans flex overflow-hidden">
      
      {/* LEFT SIDEBAR - CONTROLS */}
      <aside className="w-80 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 z-20 shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3 mb-1">
             <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-600/20">
               <span className="font-bold text-white text-lg">V2</span>
             </div>
             <h1 className="font-bold text-lg tracking-tight text-white">Gemini Live Engine</h1>
          </div>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-medium ml-11">Low Latency Audio Core</p>
        </div>

        {/* Main Controls */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {/* Status / Action */}
          <div className="space-y-3">
             <button
              onClick={toggleConnection}
              disabled={!hasPermissions || isConnecting}
              className={`w-full py-4 px-4 rounded-lg font-bold text-xs uppercase tracking-wider transition-all transform active:scale-95 shadow-lg
                ${isConnected 
                  ? 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/50 shadow-red-900/10' 
                  : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-blue-900/20 border border-transparent'
                }
                ${(!hasPermissions || isConnecting) ? 'opacity-50 grayscale cursor-not-allowed' : ''}
              `}
            >
              {isConnecting ? 'Initializing...' : isConnected ? 'Stop Engine' : 'Start Engine'}
            </button>
            {error && (
              <div className="text-xs text-red-400 bg-red-950/30 p-2 rounded border border-red-900/50 leading-tight">
                {error}
              </div>
            )}
          </div>

          {/* Device Config Card */}
          <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800 space-y-5">
             
             {/* Language Selection */}
             <div className="flex flex-col gap-1 w-full">
                <label className="text-xs text-slate-400 font-medium uppercase tracking-wider">Translation Mode</label>
                <div className="relative">
                  <select
                    value={languageMode}
                    onChange={(e) => setLanguageMode(e.target.value as LanguageMode)}
                    disabled={isConnected}
                    className="w-full appearance-none bg-slate-800 border border-slate-700 hover:border-slate-600 text-slate-200 text-sm rounded-lg p-2.5 focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value={LanguageMode.AUTO}>Automatic (Bi-directional)</option>
                    <option value={LanguageMode.DE_TO_EN}>German → English</option>
                    <option value={LanguageMode.EN_TO_DE}>English → German</option>
                  </select>
                  <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-slate-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                    </svg>
                  </div>
                </div>
             </div>

             <div className="w-full h-px bg-slate-800/80" />

             <div className="space-y-3">
                <DeviceSelector 
                  type="input" 
                  label="Input Source" 
                  selectedDeviceId={inputDeviceId} 
                  onDeviceChange={handleInputChange}
                  disabled={isConnected} 
                />
                <AudioVisualizer volume={inputVolume} isActive={isConnected} label="Input Gain" />
             </div>

             <div className="w-full h-px bg-slate-800/80" />

             <div className="space-y-3">
                <DeviceSelector 
                  type="output" 
                  label="Output Destination" 
                  selectedDeviceId={outputDeviceId} 
                  onDeviceChange={handleOutputChange}
                  disabled={false} 
                />
                <AudioVisualizer volume={outputVolume} isActive={isConnected} label="Output Gain" />
             </div>
          </div>

        </div>

        {/* Footer Info */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/30 text-[10px] font-mono text-slate-500 flex justify-between">
           <span>Audio Engine v2.02</span>
           <span>16kHz PCM</span>
        </div>
      </aside>

      {/* RIGHT MAIN AREA - CHAT */}
      <main className="flex-1 flex flex-col relative bg-slate-950">
        
        {/* Large Display Area */}
        <div className="h-1/3 min-h-[200px] p-8 flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-950 border-b border-slate-900 relative">
          <div className="absolute top-6 left-6 flex items-center gap-2">
             <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-slate-700'}`} />
             <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-500">Live Stream Feed</span>
          </div>
          
          <div className="max-w-4xl text-center">
             {latestTranslation ? (
               <p className="text-3xl md:text-4xl font-medium text-slate-100 leading-relaxed animate-in fade-in slide-in-from-bottom-2">
                 "{latestTranslation}"
               </p>
             ) : (
               <p className="text-slate-700 text-xl font-light italic">
                 {isConnected ? "Waiting for speech input..." : "Engine Ready. Press Start."}
               </p>
             )}
          </div>
        </div>

        {/* Scrolling Transcript History */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#0b1120]">
           {transcripts.map((t) => (
             <div key={t.id} className={`flex flex-col ${t.isUser ? 'items-end' : 'items-start'} animate-in fade-in duration-300`}>
                <div className={`max-w-[85%] p-4 rounded-lg text-base leading-relaxed shadow-md ${
                  t.isUser 
                    ? 'bg-slate-800 text-slate-300 border border-slate-700 rounded-br-none' 
                    : 'bg-cyan-900/20 text-cyan-100 border border-cyan-900/30 rounded-bl-none'
                }`}>
                   {t.text}
                </div>
                <span className="text-[9px] text-slate-600 mt-1 uppercase tracking-wider font-semibold px-1">
                  {t.isUser ? 'German / Input' : 'English / Translation'}
                </span>
             </div>
           ))}
           <div ref={transcriptEndRef} className="h-2" />
        </div>

        {/* Bottom Status Bar */}
        <div className="h-8 bg-slate-900 border-t border-slate-800 flex items-center justify-end px-4 text-[10px] font-mono text-green-500/80">
           {isConnected && <span>LINK ACTIVE</span>}
        </div>
      </main>
    </div>
  );
};

export default App;
