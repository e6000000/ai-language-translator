import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ConnectionState, Transcript } from './types';
import { GeminiLiveService } from './services/geminiLiveService';
import DeviceSelector from './components/DeviceSelector';
import AudioVisualizer from './components/AudioVisualizer';

const SYSTEM_INSTRUCTION = `
You are a highly skilled simultaneous interpreter. 
Your mission is to translate spoken audio bidirectionally between German and English in real-time.
- If you hear German, translate it to English immediately.
- If you hear English, translate it to German immediately.
- Maintain the original tone and emotion.
- Do NOT summarize. Translate sentence by sentence or phrase by phrase.
- Do NOT respond to the content of the conversation (e.g., do not answer questions). ONLY TRANSLATE.
- Keep latency to the absolute minimum. Output audio as soon as you have a translatable chunk.
`;

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  
  // Audio Levels
  const [inputVolume, setInputVolume] = useState<number>(0);
  const [outputVolume, setOutputVolume] = useState<number>(0);
  
  // Device Settings
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
  }, [transcripts]);

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
         if (!isUser) {
             setLatestTranslation(text);
         }
         setTranscripts(prev => {
           // Simple append for live view
           return [...prev, { id: Date.now().toString(), text, isUser, timestamp: new Date() }];
         });
      },
      onError: (msg) => {
        setError(msg);
        setConnectionState(ConnectionState.ERROR);
      },
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    // Cleanup on unmount
    return () => {
      if (liveServiceRef.current) {
        liveServiceRef.current.disconnect();
      }
    };
  }, []);

  // Initial Permission Check
  useEffect(() => {
    const checkPermissions = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        setHasPermissions(true);
      } catch (e) {
        console.error("Permission denied", e);
        setError("Microphone access is required. Please allow access in your browser.");
      }
    };
    checkPermissions();
  }, []);

  const toggleConnection = useCallback(() => {
    if (!liveServiceRef.current) return;

    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      liveServiceRef.current.disconnect();
      setLatestTranslation("");
    } else {
      setError(null);
      setTranscripts([]);
      setLatestTranslation("");
      liveServiceRef.current.connect();
    }
  }, [connectionState]);

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
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center p-2 sm:p-6 font-sans">
      
      {/* Main Container */}
      <div className="w-full max-w-6xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col md:flex-row h-[850px] md:h-[700px]">
        
        {/* Left Panel: Controls & Hardware */}
        <div className="w-full md:w-80 bg-slate-900 p-5 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col gap-5 z-10 shrink-0">
          
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 bg-gradient-to-tr from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-cyan-500/20">
                G
              </div>
              <h1 className="text-lg font-bold text-white tracking-tight">Gemini Live</h1>
            </div>
            <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Simultaneous Translator</p>
          </div>

          {/* Main Toggle */}
          <button
            onClick={toggleConnection}
            disabled={!hasPermissions || isConnecting}
            className={`w-full py-4 px-4 rounded-xl font-bold text-sm uppercase tracking-wider transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-xl flex items-center justify-center gap-3
              ${isConnected 
                ? 'bg-red-500/10 text-red-400 border border-red-500/50 hover:bg-red-500/20' 
                : 'bg-cyan-600 text-white hover:bg-cyan-500 border-t border-cyan-400 shadow-cyan-900/50'
              }
              ${(!hasPermissions || isConnecting) ? 'opacity-50 cursor-not-allowed grayscale' : ''}
            `}
          >
             {isConnecting && <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
            {isConnecting ? 'Connecting...' : isConnected ? 'Stop Session' : 'Start Live'}
          </button>

          <div className="h-px bg-slate-800/50" />

          {/* Hardware Controls */}
          <div className="flex flex-col gap-6">
            
            {/* Input Section */}
            <div className="space-y-3 bg-slate-800/30 p-3 rounded-lg border border-slate-800/50">
              <DeviceSelector 
                type="input" 
                label="Input (Microphone)" 
                selectedDeviceId={inputDeviceId} 
                onDeviceChange={handleInputChange}
                disabled={isConnected} 
              />
              <div className="mt-2">
                <AudioVisualizer 
                  volume={inputVolume} 
                  isActive={isConnected} 
                  label="Mic Level (Pegel)" 
                />
              </div>
            </div>

            {/* Output Section */}
            <div className="space-y-3 bg-slate-800/30 p-3 rounded-lg border border-slate-800/50">
              <DeviceSelector 
                type="output" 
                label="Output (Speaker)" 
                selectedDeviceId={outputDeviceId} 
                onDeviceChange={handleOutputChange}
                disabled={false} 
              />
              <div className="mt-2">
                <AudioVisualizer 
                  volume={outputVolume} 
                  isActive={isConnected} 
                  label="Speaker Level (Pegel)" 
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-auto text-[11px] font-medium text-red-300 bg-red-950/50 p-3 rounded-lg border border-red-900/50 leading-tight">
              Error: {error}
              <button onClick={() => setError(null)} className="block mt-2 text-red-400 underline decoration-red-400/30 hover:text-red-200">Dismiss</button>
            </div>
          )}
        </div>

        {/* Right Panel: Content */}
        <div className="flex-1 bg-slate-950 flex flex-col relative">
          
          {/* Latest Output Box - New Requirement */}
          <div className="p-6 bg-slate-900 border-b border-slate-800 shadow-xl z-10">
            <h2 className="text-xs font-bold text-cyan-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse"></span>
              Latest Translation
            </h2>
            <div className="min-h-[120px] flex items-center justify-center p-4 bg-slate-950 rounded-xl border border-slate-800/60">
               {latestTranslation ? (
                 <p className="text-xl md:text-2xl font-medium text-slate-100 text-center leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-300">
                   "{latestTranslation}"
                 </p>
               ) : (
                 <p className="text-slate-700 text-sm italic">Waiting for speech...</p>
               )}
            </div>
          </div>

          {/* Transcript History */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-950/50">
            {transcripts.length === 0 && !latestTranslation && (
              <div className="h-full flex flex-col items-center justify-center text-slate-700 gap-4 opacity-30 select-none">
                <svg className="w-20 h-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>
                </svg>
                <p className="text-sm font-medium">Start speaking in German or English</p>
              </div>
            )}
            
            {transcripts.map((t, i) => (
              <div key={i} className={`flex ${t.isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] md:max-w-[75%] flex flex-col ${t.isUser ? 'items-end' : 'items-start'}`}>
                   <span className="text-[10px] text-slate-500 mb-1 px-1 font-medium uppercase tracking-wide">
                    {t.isUser ? 'You (Input)' : 'Gemini (Output)'}
                  </span>
                  <div className={`px-5 py-3.5 text-sm md:text-base leading-relaxed shadow-sm ${
                    t.isUser 
                      ? 'bg-slate-800 text-slate-200 rounded-2xl rounded-tr-none border border-slate-700/50' 
                      : 'bg-cyan-950/30 text-cyan-100 rounded-2xl rounded-tl-none border border-cyan-900/30'
                  }`}>
                    {t.text}
                  </div>
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
          
          {/* Footer Info */}
           <div className="px-4 py-2 bg-slate-900 border-t border-slate-800 flex justify-between items-center text-[10px] text-slate-600">
              <span>Low Latency Mode Active (&lt;500ms)</span>
              <span className="font-mono">v1.0.2</span>
           </div>

        </div>
      </div>
    </div>
  );
};

export default App;