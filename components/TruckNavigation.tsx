
import React, { useState, useEffect } from 'react';
import { Truck } from '../types';
import { getTruckSafeRoute } from '../services/geminiService';

interface TruckNavigationProps {
  fleet: Truck[];
  initialTruckId?: string | null;
}

export const TruckNavigation: React.FC<TruckNavigationProps> = ({ fleet, initialTruckId }) => {
  const [selectedTruckId, setSelectedTruckId] = useState<string>(initialTruckId || fleet[0].id);
  const [destination, setDestination] = useState('');
  const [origin, setOrigin] = useState('Current Location (Milford Hub)');
  const [loading, setLoading] = useState(false);
  const [routeData, setRouteData] = useState<any>(null);

  const selectedTruck = fleet.find(t => t.id === selectedTruckId) || fleet[0];

  const handleCalculateRoute = async () => {
    if (!destination) return;
    setLoading(true);
    const result = await getTruckSafeRoute(origin, destination, selectedTruck);
    setRouteData(result);
    setLoading(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Selection Header */}
      <div className="bg-black text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#FFD700]/10 rounded-full blur-3xl"></div>
        <h2 className="text-2xl font-black uppercase tracking-tighter mb-2">Truck GPS Hub</h2>
        <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em]">Commercial Height-Safe Routing</p>
      </div>

      {/* Truck Selection & Stats */}
      <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm space-y-4">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Active Fleet Vehicle</label>
          <select 
            value={selectedTruckId}
            onChange={(e) => setSelectedTruckId(e.target.value)}
            className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-xs uppercase tracking-widest focus:ring-2 focus:ring-[#FFD700] outline-none"
          >
            {fleet.map(t => (
              <option key={t.id} value={t.id}>{t.plate} - {t.type}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <DimensionCard label="Height" value={`${selectedTruck.dimensions.height} ft`} icon="fa-arrows-up-down" />
          <DimensionCard label="Weight" value={`${selectedTruck.dimensions.weight} lbs`} icon="fa-weight-hanging" />
          <DimensionCard label="Length" value={`${selectedTruck.dimensions.length} ft`} icon="fa-arrows-left-right" />
        </div>
      </div>

      {/* Destination Input */}
      <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-5">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Start Point</label>
          <input 
            type="text" 
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-xs uppercase tracking-widest"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Destination Store / Hub</label>
          <div className="relative">
            <input 
              type="text" 
              placeholder="Enter Store Address..."
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-xs uppercase tracking-widest focus:ring-2 focus:ring-[#FFD700] outline-none"
            />
            <button 
              onClick={handleCalculateRoute}
              disabled={loading || !destination}
              className="absolute right-2 top-2 h-10 w-10 bg-black text-[#FFD700] rounded-xl flex items-center justify-center shadow-lg active:scale-90 transition-all disabled:opacity-20"
            >
              {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-route"></i>}
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Directions */}
      {routeData && (
        <div className="bg-white rounded-[2.5rem] overflow-hidden border border-gray-100 shadow-xl animate-in slide-in-from-top-4 duration-500">
          <div className="bg-[#FFD700] p-6 flex justify-between items-center">
            <h3 className="font-black text-black uppercase tracking-widest text-[11px]">Commercial Navigation Active</h3>
            <div className="bg-black text-white text-[9px] px-3 py-1 rounded-full font-black uppercase tracking-widest">
              Safe Path: {selectedTruck.dimensions.height}ft Clear
            </div>
          </div>
          
          <div className="p-8 space-y-6">
            <div className="bg-red-50 p-4 rounded-2xl border border-red-100 flex items-start gap-4">
              <i className="fas fa-triangle-exclamation text-red-500 mt-1"></i>
              <div className="text-[11px] font-black text-red-900 uppercase tracking-tight leading-tight">
                Restriction Bypass: Route modified to avoid Merritt Parkway & 11'4" bridge on Main St.
              </div>
            </div>

            <div className="space-y-4">
              <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.25em] px-1">Step-By-Step Guidance</div>
              <div className="space-y-3">
                <div className="prose prose-sm font-bold text-gray-700 whitespace-pre-wrap uppercase tracking-tight text-xs leading-relaxed">
                  {routeData.text}
                </div>
              </div>
            </div>

            {routeData.grounding && (
              <div className="space-y-3 pt-4 border-t border-gray-50">
                <div className="text-[9px] font-black text-gray-300 uppercase tracking-widest px-1">Map Sources</div>
                <div className="flex flex-wrap gap-2">
                  {routeData.grounding.map((chunk: any, i: number) => (
                    chunk.maps && (
                      <a 
                        key={i} 
                        href={chunk.maps.uri} 
                        target="_blank" 
                        rel="noreferrer"
                        className="bg-gray-50 border border-gray-100 px-4 py-2 rounded-xl text-[9px] font-black text-black uppercase tracking-widest flex items-center gap-2 hover:bg-black hover:text-[#FFD700] transition-all"
                      >
                        <i className="fas fa-map-pin text-[#FFD700]"></i>
                        Google Maps
                      </a>
                    )
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer Info */}
      <div className="bg-gray-50 p-6 rounded-[2rem] flex items-center gap-4 text-center">
        <i className="fas fa-circle-info text-gray-300"></i>
        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest leading-relaxed">
          TruckCEO Navigation uses commercial vehicle databases. Driver is responsible for obeying all road signs.
        </p>
      </div>
    </div>
  );
};

const DimensionCard: React.FC<{ label: string, value: string, icon: string }> = ({ label, value, icon }) => (
  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 text-center flex flex-col items-center">
    <i className={`fas ${icon} text-[#FFD700] mb-2`}></i>
    <div className="text-[11px] font-black text-black uppercase tracking-tight">{value}</div>
    <div className="text-[8px] font-black text-gray-400 uppercase tracking-widest mt-0.5">{label}</div>
  </div>
);
