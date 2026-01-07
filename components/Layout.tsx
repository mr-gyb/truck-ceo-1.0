
import React, { useState } from 'react';
import { View } from '../types';
import { BUSINESS_NAME } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { ProtectedFeature } from './ProtectedFeature';

interface LayoutProps {
  children: React.ReactNode;
  activeView: View;
  onViewChange: (view: View) => void;
  floating?: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children, activeView, onViewChange, floating }) => {
  const { logout, userProfile } = useAuth();
  const [isBottomMenuOpen, setIsBottomMenuOpen] = useState(false);

  const handleBottomMenuClick = (view: View) => {
    onViewChange(view);
    setIsBottomMenuOpen(false);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] max-w-md mx-auto bg-white shadow-2xl overflow-hidden relative border-x border-gray-100">
      {/* Header */}
      <header className="bg-black text-white p-5 flex justify-between items-center shrink-0 shadow-xl z-[70]">
        <div className="flex items-center gap-2">
          <i className="fas fa-truck-fast text-[#FFD700] text-2xl"></i>
          <h1 className="text-lg font-black tracking-tighter uppercase leading-none">{BUSINESS_NAME}</h1>
        </div>
        <div className="flex items-center gap-5">
          <button className="text-white hover:text-[#FFD700] transition-colors relative">
            <i className="fas fa-bell"></i>
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#FFD700] rounded-full border-2 border-black"></span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto no-scrollbar p-5 pb-32 bg-white relative">
        {children}
      </main>

      {/* Bottom Menu Submenu */}
      {isBottomMenuOpen && (
        <div className="absolute bottom-20 right-0 left-0 bg-white z-[55] mx-4 mb-4 rounded-[2rem] shadow-2xl border border-gray-100 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="p-4 space-y-2">
            <h3 className="text-[10px] font-black text-gray-300 uppercase tracking-[0.4em] mb-3 px-3">More Options</h3>

            <MenuButton
              label="Truck GPS"
              icon="fa-location-arrow"
              active={activeView === 'navigation'}
              onClick={() => handleBottomMenuClick('navigation')}
            />
            <MenuButton
              label="Weather Insights"
              icon="fa-cloud-sun"
              active={activeView === 'weather'}
              onClick={() => handleBottomMenuClick('weather')}
            />
            <MenuButton
              label="Team Analytics"
              icon="fa-user-group"
              active={activeView === 'team'}
              onClick={() => handleBottomMenuClick('team')}
            />
            <MenuButton
              label="Marketing Promos"
              icon="fa-certificate"
              active={activeView === 'promos'}
              onClick={() => handleBottomMenuClick('promos')}
            />
            <MenuButton
              label="Data Resource Hub"
              icon="fa-database"
              active={activeView === 'data_hub'}
              onClick={() => handleBottomMenuClick('data_hub')}
            />

            <div className="h-px bg-gray-100 my-2" />

            <MenuButton
              label="Account Settings"
              icon="fa-user-circle"
              active={activeView === 'settings'}
              onClick={() => handleBottomMenuClick('settings')}
            />
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <nav className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex justify-around items-center py-6 px-4 z-50 shadow-[0_-15px_40px_rgba(0,0,0,0.06)]">
        <NavItem
          icon="fa-house"
          label="Home"
          active={activeView === 'dashboard'}
          onClick={() => onViewChange('dashboard')}
        />
        <NavItem
          icon="fa-cart-shopping"
          label="Order"
          active={activeView === 'ordering'}
          onClick={() => onViewChange('ordering')}
        />
        <NavItem
          icon="fa-truck-wrench"
          label="Fleet"
          active={activeView === 'fleet'}
          onClick={() => onViewChange('fleet')}
        />
        <NavItem
          icon="fa-bars"
          label="Menu"
          active={isBottomMenuOpen}
          onClick={() => setIsBottomMenuOpen(!isBottomMenuOpen)}
        />
      </nav>

      {/* Floating Elements (AI Agent, etc) relative to mobile frame */}
      {floating}
    </div>
  );
};

interface MenuButtonProps {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}

const MenuButton: React.FC<MenuButtonProps> = ({ label, icon, active, onClick }) => (
  <button 
    onClick={onClick}
    className={`flex items-center gap-5 p-5 rounded-[1.5rem] transition-all border shrink-0 ${
      active 
        ? 'bg-black text-[#FFD700] border-black shadow-lg scale-[1.02]' 
        : 'text-black border-transparent hover:bg-gray-50 hover:border-gray-100'
    }`}
  >
    <i className={`fas ${icon} w-6 text-xl ${active ? 'text-[#FFD700]' : 'text-gray-300'}`}></i>
    <span className="font-black uppercase tracking-widest text-[13px] text-left">{label}</span>
  </button>
);

interface NavItemProps {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, onClick }) => (
  <button 
    onClick={onClick}
    className={`flex flex-col items-center gap-1.5 transition-all duration-300 relative ${active ? 'text-black scale-110' : 'text-gray-300 hover:text-black'}`}
  >
    <i className={`fas ${icon} ${active ? 'text-[#FFD700]' : ''} text-xl`}></i>
    <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${active ? 'opacity-100' : 'opacity-60'}`}>{label}</span>
    {active && <span className="absolute -bottom-2 w-1.5 h-1.5 bg-black rounded-full"></span>}
  </button>
);
