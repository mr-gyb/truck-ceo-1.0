import React from 'react';
import { RouteTerritory, Store } from '../types';
import { RouteSwitcher } from './RouteSwitcher';
import { useRouteWeather, weatherCodeToCondition, WeatherCondition } from '../services/useRouteWeather';
import { getRouteCoordinates } from '../services/routeCoordinates';

interface WeatherForecastProps {
  currentRoute: RouteTerritory | null;
  currentStore: Store | null;
  onRouteChange: (route: RouteTerritory | null) => void;
  onStoreChange: (store: Store | null) => void;
}

// Parse "YYYY-MM-DD" as a local date (avoids UTC-midnight day-shift bugs).
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function conditionIcon(condition: WeatherCondition): string {
  switch (condition) {
    case 'Sunny':
      return 'fa-sun text-[#FFD700]';
    case 'Cloudy':
      return 'fa-cloud text-gray-300';
    case 'Rainy':
      return 'fa-cloud-rain text-blue-400';
    case 'Snow':
      return 'fa-snowflake text-blue-200';
  }
}

// Demand impact computed from REAL forecast data only.
function demandImpact(tempMax: number, precipProb: number): string {
  if (tempMax >= 88) return 'High (Buns Surging)';
  if (precipProb >= 60) return 'Low (Stales Risk)';
  return 'Normal';
}

export const WeatherForecast: React.FC<WeatherForecastProps> = ({
  currentRoute,
  currentStore,
  onRouteChange,
  onStoreChange
}) => {
  const { days, loading, error } = useRouteWeather(currentRoute?.name ?? null);
  const territoryLabel = currentRoute ? getRouteCoordinates(currentRoute.name).label : null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="bg-black text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#FFD700]/10 rounded-full blur-3xl"></div>
        <h2 className="text-2xl font-black uppercase tracking-tighter mb-1">Weather Intelligence</h2>
        <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.3em]">
          {currentRoute ? `Forecast for ${currentRoute.name}${territoryLabel ? ` — ${territoryLabel}` : ''}` : 'Select a Territory below'}
        </p>
        <span className="inline-block mt-3 bg-[#FFD700]/10 border border-[#FFD700]/30 px-3 py-1 rounded-full text-[8px] font-black text-[#FFD700] uppercase tracking-widest">
          <i className="fas fa-satellite-dish mr-1"></i>Live · Open-Meteo
        </span>
      </div>

      <RouteSwitcher 
        currentRoute={currentRoute} 
        currentStore={currentStore} 
        onRouteChange={onRouteChange} 
        onStoreChange={onStoreChange} 
      />

      {!currentRoute && (
        <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm text-center">
          <i className="fas fa-map-location-dot text-3xl text-gray-200 mb-3"></i>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">
            Select a route above to load its live territory forecast
          </p>
        </div>
      )}

      {currentRoute && loading && (
        <div className="grid grid-cols-2 gap-3 pb-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white p-5 rounded-3xl border border-gray-100 flex flex-col items-center animate-pulse">
              <div className="h-3 w-16 bg-gray-100 rounded-full"></div>
              <div className="my-3 h-8 w-8 bg-gray-100 rounded-full"></div>
              <div className="h-6 w-14 bg-gray-100 rounded-full"></div>
            </div>
          ))}
        </div>
      )}

      {currentRoute && !loading && error && (
        <div className="bg-white p-8 rounded-[2rem] border border-red-100 shadow-sm text-center">
          <i className="fas fa-cloud-bolt text-3xl text-red-300 mb-3"></i>
          <p className="font-black text-black text-xs uppercase tracking-widest mb-1">Live forecast unavailable</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight mb-4">
            {error} — check your connection and retry.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-black text-[#FFD700] px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform"
          >
            <i className="fas fa-rotate-right mr-2"></i>Retry
          </button>
        </div>
      )}

      {currentRoute && !loading && !error && days.length > 0 && (
        <div className="grid grid-cols-2 gap-3 pb-4">
          {days.map((day) => {
            const date = parseLocalDate(day.date);
            const condition = weatherCodeToCondition(day.weatherCode);
            const impact = demandImpact(day.tempMax, day.precipProb);
            const isHot = impact.startsWith('High');
            return (
              <div key={day.date} className="bg-white p-5 rounded-3xl border border-gray-100 flex flex-col items-center group hover:border-black transition-all">
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                  {date.toLocaleDateString('en-US', { weekday: 'short' })}{' '}
                  {date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                </span>
                <div className="my-3 text-2xl">
                  <i className={`fas ${conditionIcon(condition)}`}></i>
                </div>
                <div className="text-xl font-black text-black">{day.tempMax}°</div>
                {day.precipProb > 0 && (
                  <div className="text-[8px] font-black text-blue-400 uppercase tracking-widest mt-1">
                    <i className="fas fa-droplet mr-1"></i>{day.precipProb}% rain
                  </div>
                )}
                <div className={`mt-2 text-[8px] text-center font-black uppercase tracking-widest px-2 py-1 rounded-full ${
                  isHot ? 'bg-black text-[#FFD700]' : 'bg-gray-50 text-gray-400'
                }`}>
                  {impact}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
