
import React from 'react';
import { RouteTerritory, Store } from '../types';
import { ROUTES } from '../constants';

interface RouteSwitcherProps {
  currentRoute: RouteTerritory | null;
  currentStore: Store | null;
  onRouteChange: (route: RouteTerritory | null) => void;
  onStoreChange: (store: Store | null) => void;
}

export const RouteSwitcher: React.FC<RouteSwitcherProps> = ({
  currentRoute,
  currentStore,
  onRouteChange,
  onStoreChange
}) => {
  return (
    <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-5">
      <div className="flex items-center gap-3 px-1">
        <i className="fas fa-map-location-dot text-[#FFD700]"></i>
        <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">Territory Filter</h3>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="space-y-2">
          <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest ml-1">Select Route</label>
          <select 
            className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-xs uppercase tracking-widest focus:ring-2 focus:ring-[#FFD700] outline-none"
            value={currentRoute?.id || 'all'}
            onChange={(e) => {
              const route = ROUTES.find(r => r.id === e.target.value) || null;
              onRouteChange(route);
              onStoreChange(null);
            }}
          >
            <option value="all">All Routes (Global View)</option>
            {ROUTES.map(route => (
              <option key={route.id} value={route.id}>{route.name}</option>
            ))}
          </select>
        </div>

        {currentRoute && (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-300">
            <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest ml-1">Fine-tune Store</label>
            <select 
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-xs uppercase tracking-widest focus:ring-2 focus:ring-[#FFD700] outline-none"
              value={currentStore?.id || 'all'}
              onChange={(e) => {
                const store = currentRoute.stores.find(s => s.id === e.target.value) || null;
                onStoreChange(store);
              }}
            >
              <option value="all">All Stores in {currentRoute.name}</option>
              {currentRoute.stores.map(store => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      
      {currentRoute && (
        <div className="bg-black p-4 rounded-2xl flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[#FFD700] text-[10px] font-black uppercase tracking-widest">Active Focus</span>
            <span className="text-white text-[11px] font-black uppercase truncate max-w-[180px]">
              {currentStore ? currentStore.name : currentRoute.name}
            </span>
          </div>
          <button 
            onClick={() => { onRouteChange(null); onStoreChange(null); }}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <i className="fas fa-rotate-left"></i>
          </button>
        </div>
      )}
    </div>
  );
};
