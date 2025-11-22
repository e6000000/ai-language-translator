
import React, { useEffect, useRef } from 'react';
import { Transcript } from '../types';

interface LiveDisplayProps {
  transcripts: Transcript[];
  isConnected: boolean;
  isPaused?: boolean; // New prop to stop rendering updates
}

const LiveDisplay: React.FC<LiveDisplayProps> = React.memo(({ transcripts, isConnected, isPaused }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Filter only AI translations (output)
  const outputTranscripts = transcripts.filter(t => !t.isUser);
  
  // Keep the last ~10 blocks
  const recentTranscripts = outputTranscripts.slice(-10);

  useEffect(() => {
    if (isPaused) return; // Do not auto-scroll if paused
    
    if (containerRef.current) {
        // Smooth scroll to bottom when new content arrives
        containerRef.current.scrollTo({
            top: containerRef.current.scrollHeight,
            behavior: 'smooth'
        });
    }
  }, [transcripts, isPaused]);

  return (
    <div className="w-full max-w-4xl px-4">
        <div 
            ref={containerRef}
            className="h-[320px] overflow-y-auto flex flex-col items-start justify-start gap-3 text-left no-scrollbar py-8 pl-2"
            style={{
                maskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)'
            }}
        >
            {recentTranscripts.length === 0 ? (
                 <div className="w-full h-full flex items-center justify-center opacity-50">
                    <p className="text-slate-500 text-lg font-light italic">
                        {isConnected ? "Ready for translation..." : "Tap microphone to start"}
                    </p>
                 </div>
            ) : (
                recentTranscripts.map((t, i) => {
                    const isLast = i === recentTranscripts.length - 1;
                    return (
                        <p 
                            key={t.id} 
                            className={`
                                font-medium leading-tight max-w-3xl transition-all duration-500 ease-out origin-left
                                ${isLast 
                                    ? 'text-xl md:text-3xl text-white opacity-100 drop-shadow-md' 
                                    : 'text-lg md:text-xl text-slate-400 opacity-60'
                                }
                            `}
                        >
                            {t.text}
                        </p>
                    );
                })
            )}
        </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for React.memo
  // If currently paused (settings open), do NOT re-render even if transcripts change
  if (nextProps.isPaused) return true;
  
  // Otherwise, standard comparison
  return prevProps.transcripts === nextProps.transcripts && prevProps.isConnected === nextProps.isConnected;
});

export default LiveDisplay;
