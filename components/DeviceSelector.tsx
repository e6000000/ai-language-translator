import React, { useEffect, useState } from 'react';
import { AudioDevice } from '../types';

interface DeviceSelectorProps {
  label: string;
  type: 'input' | 'output';
  selectedDeviceId: string;
  onDeviceChange: (deviceId: string) => void;
  disabled?: boolean;
}

const DeviceSelector: React.FC<DeviceSelectorProps> = ({ 
  label, 
  type, 
  selectedDeviceId, 
  onDeviceChange,
  disabled 
}) => {
  const [devices, setDevices] = useState<AudioDevice[]>([]);

  useEffect(() => {
    const getDevices = async () => {
      try {
        // Request permission first to get labels
        if (!navigator.mediaDevices?.enumerateDevices) return;
        
        // We might need to request generic access to get labels if not already granted
        // But usually the main app flow handles getUserMedia first or we accept empty labels initially
        
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const filtered = allDevices
          .filter(d => d.kind === (type === 'input' ? 'audioinput' : 'audiooutput'))
          .map(d => ({
            deviceId: d.deviceId,
            label: d.label || `${type === 'input' ? 'Microphone' : 'Speaker'} (${d.deviceId.slice(0, 5)}...)`,
            groupId: d.groupId
          }));
        
        setDevices(filtered);
      } catch (e) {
        console.error("Error listing devices", e);
      }
    };

    getDevices();
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getDevices);
    };
  }, [type]);

  return (
    <div className="flex flex-col gap-1 w-full">
      <label className="text-xs text-slate-400 font-medium uppercase tracking-wider">
        {label}
      </label>
      <div className="relative">
        <select
          value={selectedDeviceId}
          onChange={(e) => onDeviceChange(e.target.value)}
          disabled={disabled}
          className="w-full appearance-none bg-slate-800 border border-slate-700 hover:border-slate-600 text-slate-200 text-sm rounded-lg p-2.5 focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {devices.length === 0 && <option value="default">Default Device</option>}
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-slate-400">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
          </svg>
        </div>
      </div>
    </div>
  );
};

export default DeviceSelector;