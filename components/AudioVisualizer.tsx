import React from 'react';

interface AudioVisualizerProps {
  volume: number; // 0 to 1
  isActive: boolean;
  label?: string;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ 
  volume, 
  isActive, 
  label 
}) => {
  const segments = 24;
  const activeSegments = Math.floor(volume * segments);

  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <div className="flex justify-between items-end mb-1">
           <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">{label}</span>
           <span className="text-[10px] font-mono text-slate-500 bg-slate-900 px-1 rounded">
             {isActive ? `${Math.round(volume * 100)}%` : '--'}
           </span>
        </div>
      )}
      
      {/* Meter Container */}
      <div className="h-4 bg-slate-950 rounded border border-slate-800 p-[2px] relative overflow-hidden shadow-inner">
        <div className="flex h-full gap-[1px]">
            {Array.from({ length: segments }).map((_, i) => {
                // Calculate color based on position (Green -> Yellow -> Red)
                const percentage = i / segments;
                let bgColor = "bg-emerald-500";
                if (percentage > 0.6) bgColor = "bg-yellow-400";
                if (percentage > 0.85) bgColor = "bg-red-500";

                const isOn = isActive && i < activeSegments;
                
                return (
                  <div 
                    key={i} 
                    className={`flex-1 rounded-[1px] transition-opacity duration-75 ${isOn ? `${bgColor} opacity-100` : 'bg-slate-800 opacity-20'}`} 
                  />
                );
            })}
        </div>
        {/* Peak indicator line could go here */}
      </div>
    </div>
  );
};

export default AudioVisualizer;