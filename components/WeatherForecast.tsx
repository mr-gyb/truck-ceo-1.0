
import React from 'react';
import { RouteTerritory, Store } from '../types';
import { RouteSwitcher } from './RouteSwitcher';

interface WeatherForecastProps {
  currentRoute: RouteTerritory | null;
  currentStore: Store | null;
  onRouteChange: (route: RouteTerritory | null) => void;
  onStoreChange: (store: Store | null) => void;
}

export const WeatherForecast: React.FC<WeatherForecastProps> = ({
  currentRoute,
  currentStore,
  onRouteChange,
  onStoreChange
}) => {
  // Mock data for 14-day forecast
  const forecast = Array.from({ length: 14 }).map((_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i);
    // Slight variation based on NY vs CT
    const baseTemp = currentRoute?.name.includes('NY') ? 72 : 75;
    const temp = baseTemp + Math.floor(Math.random() * 15);
    const conditions = i % 3 === 0 ? 'Cloudy' : i % 5 === 0 ? 'Rainy' : 'Sunny';
    const demandImpact = temp > 85 ? 'High (Buns Surging)' : conditions === 'Rainy' ? 'Low (Stales Risk)' : 'Normal';
    
    return {
      day: date.toLocaleDateString('en-US', { weekday: 'short' }),
      date: date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      temp,
      conditions,
      demandImpact,
    };
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="bg-black text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#FFD700]/10 rounded-full blur-3xl"></div>
        <h2 className="text-2xl font-black uppercase tracking-tighter mb-1">Weather Intelligence</h2>
        <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.3em]">
          {currentRoute ? `Forecast for ${currentRoute.name}` : 'Select a Territory below'}
        </p>
      </div>

      <RouteSwitcher 
        currentRoute={currentRoute} 
        currentStore={currentStore} 
        onRouteChange={onRouteChange} 
        onStoreChange={onStoreChange} 
      />

      <div className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm">
        <div className="flex items-center gap-3 mb-4 px-2">
          <i className="fas fa-tower-broadcast text-[#FFD700]"></i>
          <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">Aggregated Data Sources</h3>
        </div>
        <div className="flex gap-2 px-2 overflow-x-auto no-scrollbar">
          {['NOAA', 'AccuWeather', 'Weather Channel', 'Local Met'].map(s => (
            <span key={s} className="bg-gray-50 border border-gray-100 px-3 py-1 rounded-full text-[8px] font-black text-gray-400 uppercase tracking-widest whitespace-nowrap">
              {s} SYNCED
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 pb-4">
        {forecast.map((day, idx) => (
          <div key={idx} className="bg-white p-5 rounded-3xl border border-gray-100 flex flex-col items-center group hover:border-black transition-all">
            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{day.day} {day.date}</span>
            <div className="my-3 text-2xl">
              <i className={`fas ${day.conditions === 'Sunny' ? 'fa-sun text-[#FFD700]' : day.conditions === 'Cloudy' ? 'fa-cloud text-gray-300' : 'fa-cloud-rain text-blue-400'}`}></i>
            </div>
            <div className="text-xl font-black text-black">{day.temp}°</div>
            <div className={`mt-2 text-[8px] text-center font-black uppercase tracking-widest px-2 py-1 rounded-full ${
              day.demandImpact.includes('High') ? 'bg-black text-[#FFD700]' : 'bg-gray-50 text-gray-400'
            }`}>
              {day.demandImpact}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
