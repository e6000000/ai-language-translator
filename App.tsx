import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ConnectionState, Transcript, LanguageMode } from './types';
import { GeminiLiveService } from './services/geminiLiveService';
import DeviceSelector from './components/DeviceSelector';
import AudioVisualizer from './components/AudioVisualizer';

const SUPPORTED_LANGUAGES = [
  'English', 'German', 'French', 'Spanish', 'Italian', 
  'Portuguese', 'Dutch', 'Polish', 'Russian', 'Japanese', 
  'Korean', 'Chinese', 'Arabic', 'Hindi', 'Turkish', 'Thai', 'Romanian'
];

const getSystemInstruction = (mode: LanguageMode, srcLang: string, tgtLang: string) => {
  const baseInstruction = `
    SYSTEM: You are a high-speed simultaneous interpreter. 
    LATENCY PRIORITY: MAXIMUM. 
    PROTOCOL:
    1. Translate audio chunks IMMEDIATELY as they arrive.
    2. Do NOT wait for full sentences.
    3. Do NOT summarize.
    4. If the user is speaking, keep translating. Do not stop.
    5. If silence, wait.
  `;

  switch (mode) {
    case LanguageMode.DE_TO_EN:
      return `${baseInstruction} DIRECTION: German Input -> English Output.`;
    case LanguageMode.EN_TO_DE:
      return `${baseInstruction} DIRECTION: English Input -> German Output.`;
    case LanguageMode.CUSTOM:
      return `${baseInstruction} DIRECTION: ${srcLang} Input -> ${tgtLang} Output.`;
    case LanguageMode.AUTO:
    default:
      return `${baseInstruction} DIRECTION: Auto-detect (German<->English). Translate to the OTHER language.`;
  }
};

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  
  // UI State
  const [showSettings, setShowSettings] = useState<boolean>(false);
  
  // Configuration
  const [languageMode, setLanguageMode] = useState<LanguageMode>(LanguageMode.AUTO);
  const [sourceLanguage, setSourceLanguage] = useState<string>('English');
  const [targetLanguage, setTargetLanguage] = useState<string>('German');

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
      systemInstruction: getSystemInstruction(LanguageMode.AUTO, 'English', 'German'),
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
      if (last && last.isUser === isUser && last.text.length < 600) {
        const updated = { ...last, text: last.text + text };
        
        if (!isUser) setLatestTranslation(updated.text);
        return [...prev.slice(0, -1), updated];
      }
      
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
      const instruction = getSystemInstruction(languageMode, sourceLanguage, targetLanguage);
      liveServiceRef.current.connect({ systemInstruction: instruction });
    }
  }, [connectionState, languageMode, sourceLanguage, targetLanguage]);

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
    <div className="h-screen w-full bg-[#0b1120] text-slate-200 font-sans flex flex-col overflow-hidden relative">
      
      {/* HEADER with AUDIO METERS */}
      <header className="shrink-0 h-20 px-4 md:px-6 flex items-center justify-between bg-slate-900/50 backdrop-blur-md border-b border-white/5 z-20 gap-4">
        
        {/* Logo Area */}
        <div className="flex items-center gap-2 shrink-0 w-[140px]">
           <div className="w-6 h-6 bg-gradient-to-tr from-cyan-500 to-blue-600 rounded flex items-center justify-center">
             <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2.5-1.25L12 8.5l-2.5 1.25L12 11zm0 2.5l-5-2.5-5 2.5L12 22l10-8.5-5-2.5-5 2.5z"/></svg>
           </div>
           <span className="font-bold text-sm tracking-tight text-slate-200 hidden sm:block">Gemini Live</span>
        </div>

        {/* CENTRAL METER DISPLAY (Top of screen) */}
        <div className="flex-1 max-w-2xl flex items-center justify-center gap-4 md:gap-8">
            
            {/* INPUT METER */}
            <div className="flex flex-col w-full max-w-[240px]">
               <div className="flex justify-between items-baseline mb-1 px-1">
                 <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-wider">Input Microphone</span>
               </div>
               <AudioVisualizer 
                 volume={inputVolume} 
                 isActive={true} 
                 className="h-2 md:h-3" 
                 barCount={30}
               />
            </div>

            {/* OUTPUT METER */}
            <div className="flex flex-col w-full max-w-[240px]">
               <div className="flex justify-between items-baseline mb-1 px-1">
                 <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-wider">Output Speaker</span>
               </div>
               <AudioVisualizer 
                 volume={outputVolume} 
                 isActive={true} 
                 className="h-2 md:h-3"
                 barCount={30}
               />
            </div>
        </div>

        {/* Settings Button */}
        <div className="shrink-0 w-[140px] flex justify-end">
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="Settings"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      {/* MAIN HERO SECTION */}
      <div className="shrink-0 flex flex-col items-center pt-6 pb-4 bg-gradient-to-b from-[#0b1120] to-[#0f172a] relative z-10 shadow-xl shadow-black/20">
         
         {/* MICROPHONE BUTTON */}
         <div className="relative group mb-6">
            {/* Glow Ring */}
            <div className={`absolute -inset-4 rounded-full blur-xl transition-all duration-500 ${isConnected ? 'bg-red-500/30 opacity-100 scale-100' : 'bg-blue-500/20 opacity-0 scale-50'}`} />
            
            <button
              onClick={toggleConnection}
              disabled={!hasPermissions || isConnecting}
              className={`
                relative w-24 h-24 md:w-28 md:h-28 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300
                ${isConnected 
                  ? 'bg-slate-900 border-4 border-red-500 text-red-500 hover:scale-105' 
                  : 'bg-blue-600 hover:bg-blue-500 border-4 border-blue-400/30 text-white hover:scale-105'
                }
                ${(!hasPermissions || isConnecting) ? 'opacity-50 grayscale cursor-not-allowed' : ''}
              `}
            >
              {isConnecting ? (
                 <svg className="animate-spin h-10 w-10" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : isConnected ? (
                <div className="w-8 h-8 bg-red-500 rounded animate-pulse" />
              ) : (
                <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              )}
            </button>
         </div>

         {/* LIVE TRANSLATION DISPLAY */}
         <div className="w-full max-w-3xl px-6 text-center min-h-[80px] flex items-center justify-center">
            {latestTranslation ? (
              <p className="text-2xl md:text-3xl font-medium text-slate-100 leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-300">
                "{latestTranslation}"
              </p>
            ) : (
              <p className="text-slate-600 text-lg font-light italic">
                {isConnected ? "Listening for speech..." : "Tap the microphone to start"}
              </p>
            )}
         </div>
      </div>

      {/* TRANSCRIPT LIST */}
      <main className="flex-1 overflow-y-auto p-4 bg-slate-950 scroll-smooth">
         <div className="max-w-3xl mx-auto space-y-4 pb-12">
            {transcripts.map((t) => (
              <div key={t.id} className={`flex flex-col ${t.isUser ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2`}>
                 <div className={`max-w-[85%] p-3 rounded-2xl text-sm md:text-base leading-relaxed ${
                   t.isUser 
                     ? 'bg-slate-800 text-slate-300 rounded-br-none border border-slate-700/50' 
                     : 'bg-[#1e293b] text-blue-100 rounded-bl-none border border-blue-900/30'
                 }`}>
                    {t.text}
                 </div>
                 <span className="text-[9px] text-slate-600 mt-1 uppercase tracking-wider font-bold px-1 opacity-60">
                   {t.isUser ? 'Original' : 'Translation'}
                 </span>
              </div>
            ))}
            <div ref={transcriptEndRef} className="h-4" />
         </div>
      </main>

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
           <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              
              <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                 <h2 className="font-bold text-slate-200 flex items-center gap-2">
                   <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                   Settings
                 </h2>
                 <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                    <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
              </div>

              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                 
                 {/* Language Settings */}
                 <section className="space-y-3">
                    <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Language Configuration</h3>
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/50">
                      <label className="text-xs text-slate-400 block mb-2">Translation Mode</label>
                      <select
                        value={languageMode}
                        onChange={(e) => setLanguageMode(e.target.value as LanguageMode)}
                        disabled={isConnected}
                        className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded p-2.5 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      >
                        <option value={LanguageMode.AUTO}>Auto (Bi-directional)</option>
                        <option value={LanguageMode.DE_TO_EN}>German → English</option>
                        <option value={LanguageMode.EN_TO_DE}>English → German</option>
                        <option value={LanguageMode.CUSTOM}>Custom</option>
                      </select>

                      {languageMode === LanguageMode.CUSTOM && (
                        <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-800">
                          <div>
                             <label className="text-[10px] text-slate-500 mb-1 block">Source</label>
                             <select value={sourceLanguage} onChange={e => setSourceLanguage(e.target.value)} className="w-full bg-slate-800 text-xs p-2 rounded border border-slate-700">
                                {SUPPORTED_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                             </select>
                          </div>
                          <div>
                             <label className="text-[10px] text-slate-500 mb-1 block">Target</label>
                             <select value={targetLanguage} onChange={e => setTargetLanguage(e.target.value)} className="w-full bg-slate-800 text-xs p-2 rounded border border-slate-700">
                                {SUPPORTED_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                             </select>
                          </div>
                        </div>
                      )}
                    </div>
                 </section>

                 {/* Audio Settings */}
                 <section className="space-y-3">
                    <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Audio Devices</h3>
                    
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/50 space-y-4">
                       <div>
                          <DeviceSelector 
                            type="input" 
                            label="Input Microphone" 
                            selectedDeviceId={inputDeviceId} 
                            onDeviceChange={handleInputChange}
                            disabled={isConnected} 
                          />
                          <div className="mt-2">
                             <AudioVisualizer volume={inputVolume} isActive={isConnected} label="" />
                          </div>
                       </div>

                       <div className="w-full h-px bg-slate-800" />

                       <div>
                          <DeviceSelector 
                            type="output" 
                            label="Output Speaker" 
                            selectedDeviceId={outputDeviceId} 
                            onDeviceChange={handleOutputChange}
                            disabled={false} 
                          />
                          <div className="mt-2">
                             <AudioVisualizer volume={outputVolume} isActive={isConnected} label="" />
                          </div>
                       </div>
                    </div>
                 </section>

              </div>
              
              <div className="p-4 bg-slate-900 border-t border-slate-800 text-center">
                 <p className="text-[10px] text-slate-600 font-mono">v2.1.0 • Low Latency Audio Engine</p>
              </div>
           </div>
        </div>
      )}

      {/* Error Toast */}
      {error && (
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-40 bg-red-500/90 text-white text-xs px-4 py-2 rounded-full shadow-lg animate-in fade-in slide-in-from-bottom-4">
          {error}
        </div>
      )}

    </div>
  );
};

export default App;