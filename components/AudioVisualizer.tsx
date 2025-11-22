
import React from 'react';

interface AudioVisualizerProps {
  volume: number; // 0 to 1
  isActive: boolean;
  label?: string;
  barCount?: number;
  className?: string; // For height/width overrides
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ 
  volume, 
  isActive, 
  label,
  barCount = 16,
  className = "h-4"
}) => {
  const activeSegments = Math.floor(volume * barCount);
  
  // Pre-calculate thresholds using integer math (approx 60% and 85%)
  const thresholdYellow = Math.floor(barCount * 0.6);
  const thresholdRed = Math.floor(barCount * 0.85);

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
      <div className={`${className} bg-slate-950 rounded border border-slate-800 p-[1px] md:p-[2px] relative overflow-hidden shadow-inner`}>
        <div className="flex h-full gap-[1px]">
            {Array.from({ length: barCount }).map((_, i) => {
                // Simplified color logic without float division in loop
                let bgColor = "bg-emerald-500";
                if (i >= thresholdYellow) bgColor = "bg-yellow-400";
                if (i >= thresholdRed) bgColor = "bg-red-500";

                const isOn = isActive && i < activeSegments;
                
                return (
                  <div 
                    key={i} 
                    className={`flex-1 rounded-[1px] transition-opacity duration-75 ${isOn ? `${bgColor} opacity-100` : 'bg-slate-800 opacity-20'}`} 
                  />
                );
            })}
        </div>
      </div>
    </div>
  );
};

export default AudioVisualizer;
