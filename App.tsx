
import React, { useState } from 'react';
import { View, SaleAlert, RouteTerritory, Store } from './types';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataProvider, useData } from './contexts/DataContext';
import { AuthScreen } from './components/AuthScreen';
import { Layout } from './components/Layout';
import { SmartOrdering } from './components/SmartOrdering';
import { EmployeeEngagement } from './components/EmployeeEngagement';
import { TruckMaintenance } from './components/TruckMaintenance';
import { DataHub } from './components/DataHub';
import { WeatherForecast } from './components/WeatherForecast';
import { RouteSwitcher } from './components/RouteSwitcher';
import { TruckCeoAgent } from './components/TruckCeoAgent';
import { TruckNavigation } from './components/TruckNavigation';
import { UserSettings } from './components/UserSettings';
import { RoutesManagement } from './components/RoutesManagement';
import { SaleAlertFormModal } from './components/forms/SaleAlertFormModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ToastContainer } from './components/ToastContainer';
import { useToast } from './hooks/useToast';
import { BUSINESS_NAME } from './constants';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const AppContent: React.FC = () => {
  const { currentUser, userProfile, loading: authLoading } = useAuth();
  const { products, employees, trucks, saleAlerts, routes, loading: dataLoading } = useData();
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [currentRoute, setCurrentRoute] = useState<RouteTerritory | null>(null);
  const [currentStore, setCurrentStore] = useState<Store | null>(null);
  const [navTruckId, setNavTruckId] = useState<string | null>(null);

  const startNavigation = (truckId: string) => {
    setNavTruckId(truckId);
    setActiveView('navigation');
  };

  // Show loading screen while auth is loading
  if (authLoading) {
    return <LoadingScreen message="Loading TruckCEO..." />;
  }

  // Show auth screen if not logged in
  if (!currentUser || !userProfile) {
    return <AuthScreen />;
  }

  // Show loading screen while data is loading
  if (dataLoading) {
    return <LoadingScreen message="Loading your data..." />;
  }

  const renderContent = () => {
    switch (activeView) {
      case 'dashboard':
        return (
          <MainDashboard
            onWeatherClick={() => setActiveView('weather')}
            currentRoute={currentRoute}
            currentStore={currentStore}
            onRouteChange={setCurrentRoute}
            onStoreChange={setCurrentStore}
            fleetCount={trucks.length}
          />
        );
      case 'ordering':
        return (
          <SmartOrdering
            products={products}
            currentStore={currentStore}
            currentRoute={currentRoute}
            onRouteChange={setCurrentRoute}
            onStoreChange={setCurrentStore}
          />
        );
      case 'team':
        return <EmployeeEngagement employees={employees} />;
      case 'fleet':
        return <TruckMaintenance fleet={trucks} onNavigate={startNavigation} />;
      case 'navigation':
        return <TruckNavigation fleet={trucks} initialTruckId={navTruckId} />;
      case 'promos':
        return (
          <PromoRequestManager
            alerts={saleAlerts}
            currentRoute={currentRoute}
            currentStore={currentStore}
            onRouteChange={setCurrentRoute}
            onStoreChange={setCurrentStore}
          />
        );
      case 'data_hub':
        return <DataHub onNavigate={setActiveView} />;
      case 'weather':
        return (
          <WeatherForecast
            currentRoute={currentRoute}
            currentStore={currentStore}
            onRouteChange={setCurrentRoute}
            onStoreChange={setCurrentStore}
          />
        );
      case 'settings':
        return <UserSettings />;
      case 'routes_management':
        return <RoutesManagement />;
      default:
        return <MainDashboard onWeatherClick={() => setActiveView('weather')} currentRoute={currentRoute} currentStore={currentStore} onRouteChange={setCurrentRoute} onStoreChange={setCurrentStore} fleetCount={trucks.length} />;
    }
  };

  return (
    <Layout
      activeView={activeView}
      onViewChange={setActiveView}
      floating={activeView === 'dashboard' ? <TruckCeoAgent /> : null}
    >
      {renderContent()}
    </Layout>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <DataProvider>
        <AppContent />
      </DataProvider>
    </AuthProvider>
  );
};

interface DashboardProps {
  onWeatherClick: () => void;
  currentRoute: RouteTerritory | null;
  currentStore: Store | null;
  onRouteChange: (r: RouteTerritory | null) => void;
  onStoreChange: (s: Store | null) => void;
  fleetCount: number;
}

const MainDashboard: React.FC<DashboardProps> = ({ onWeatherClick, currentRoute, currentStore, onRouteChange, onStoreChange, fleetCount }) => {
  const chartData = [
    { name: 'M', revenue: 4200 },
    { name: 'T', revenue: 3800 },
    { name: 'W', revenue: 5100 },
    { name: 'T', revenue: 4600 },
    { name: 'F', revenue: 5900 },
    { name: 'S', revenue: 6200 },
    { name: 'S', revenue: 3100 },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Route Switcher Integrated at Top */}
      <RouteSwitcher 
        currentRoute={currentRoute} 
        currentStore={currentStore} 
        onRouteChange={onRouteChange} 
        onStoreChange={onStoreChange} 
      />

      {/* Welcome & Stats */}
      <section className="bg-black rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#FFD700]/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
        <div className="flex justify-between items-start mb-10 relative z-10">
          <div>
            <h2 className="text-2xl font-black mb-1 uppercase tracking-tighter leading-tight">{BUSINESS_NAME}</h2>
            <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.25em]">
              {currentRoute ? `${currentRoute.name} Territory` : 'Fleet Hub: Global'}
            </p>
          </div>
          <button 
            onClick={onWeatherClick}
            className="text-right hover:scale-105 active:scale-95 transition-transform bg-white/5 p-3 rounded-2xl border border-white/10"
          >
            <div className="text-[#FFD700] text-3xl font-black leading-none tracking-tighter flex items-center gap-2 justify-end">
              <i className="fas fa-sun text-xl"></i>
              <span>78°F</span>
            </div>
            <span className="text-[8px] text-gray-500 font-black uppercase tracking-widest mt-1 block">Click for 14-Day Forecast</span>
          </button>
        </div>
        
        <div className="grid grid-cols-2 gap-4 relative z-10">
          <div className="bg-white/5 border border-white/10 rounded-[1.5rem] p-5">
            <div className="text-2xl font-black text-[#FFD700]">$45.2k</div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-500 mt-1">Weekly Net</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-[1.5rem] p-5">
            <div className="text-2xl font-black text-white">{fleetCount}</div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-500 mt-1">Fleet Active</div>
          </div>
        </div>
      </section>

      {/* Analytics Brief */}
      <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-6 px-1">
          <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">Revenue Velocity</h3>
          <i className="fas fa-chart-line text-[#FFD700]"></i>
        </div>
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f8fafc" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#cbd5e1' }} />
              <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 40px rgba(0,0,0,0.1)', fontWeight: 'bold', fontSize: '12px' }} />
              <Bar dataKey="revenue" radius={[12, 12, 12, 12]} barSize={18}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === 5 ? '#000000' : '#f1f5f9'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Task List */}
      <section className="space-y-3 pb-4">
        <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em] px-2">Market Watch</h3>
        
        <div onClick={onWeatherClick} className="bg-black p-5 rounded-3xl flex items-center justify-between border-l-4 border-l-[#FFD700] shadow-2xl group active:scale-95 transition-transform cursor-pointer overflow-hidden relative">
          <div className="absolute top-0 right-0 w-16 h-16 bg-[#FFD700]/5 rounded-full blur-xl"></div>
          <div className="flex items-center gap-4 relative z-10">
            <div className="w-12 h-12 bg-[#FFD700] rounded-2xl flex items-center justify-center text-black font-black text-lg">
              <i className="fas fa-temperature-arrow-up"></i>
            </div>
            <div>
              <h4 className="font-black text-xs text-white uppercase tracking-widest">Heatwave Prediction</h4>
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight mt-1">Buns demand predicted +45% next week.</p>
            </div>
          </div>
          <button className="text-[#FFD700] p-2">
            <i className="fas fa-chevron-right"></i>
          </button>
        </div>
      </section>
    </div>
  );
};

const PromoRequestManager: React.FC<{
  alerts: SaleAlert[];
  currentRoute: RouteTerritory | null;
  currentStore: Store | null;
  onRouteChange: (r: RouteTerritory | null) => void;
  onStoreChange: (s: Store | null) => void;
}> = ({ alerts, currentRoute, currentStore, onRouteChange, onStoreChange }) => {
  const { addSaleAlert, updateSaleAlert, deleteSaleAlert, routes } = useData();
  const { userProfile } = useAuth();
  const [sentAlerts, setSentAlerts] = useState<string[]>([]);

  // Import toast and modal utilities
  const { toasts, showToast, removeToast } = useToast();
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [editingAlert, setEditingAlert] = useState<SaleAlert | undefined>(undefined);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAlert, setDeletingAlert] = useState<SaleAlert | null>(null);

  const handleSendPromo = (alertId: string) => {
    setSentAlerts([...sentAlerts, alertId]);
  };

  // Handle add alert
  const handleAddAlert = () => {
    setEditingAlert(undefined);
    setShowAlertModal(true);
  };

  // Handle edit alert
  const handleEditAlert = (alert: SaleAlert) => {
    setEditingAlert(alert);
    setShowAlertModal(true);
  };

  // Handle delete alert
  const handleDeleteClick = (alert: SaleAlert) => {
    setDeletingAlert(alert);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingAlert) return;

    try {
      await deleteSaleAlert(deletingAlert.id);
      showToast(`Promo alert for "${deletingAlert.storeName}" deleted`, 'success');
      setDeletingAlert(null);
      // Remove from sent alerts if it was marked as sent
      setSentAlerts(prev => prev.filter(id => id !== deletingAlert.id));
    } catch (error) {
      console.error('Error deleting alert:', error);
      showToast('Failed to delete promo alert', 'error');
    }
  };

  // Handle alert form submit
  const handleAlertSubmit = async (data: Omit<SaleAlert, 'id'>) => {
    try {
      if (editingAlert) {
        await updateSaleAlert(editingAlert.id, data);
        showToast('Promo alert updated successfully', 'success');
      } else {
        await addSaleAlert(data);
        showToast('Promo alert added successfully', 'success');
      }
    } catch (error) {
      console.error('Error saving alert:', error);
      showToast('Failed to save promo alert', 'error');
      throw error;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Route Switcher Integrated at Top */}
      <RouteSwitcher
        currentRoute={currentRoute}
        currentStore={currentStore}
        onRouteChange={onRouteChange}
        onStoreChange={onStoreChange}
      />

      {/* Header */}
      <div className="bg-black text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
        <div className="absolute bottom-0 right-0 w-32 h-32 bg-[#FFD700]/10 rounded-full -mr-16 -mb-16 blur-3xl"></div>
        <div className="relative z-10">
          <h2 className="text-2xl font-black uppercase tracking-tighter mb-1">Promo Requests</h2>
          <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.3em]">Secure End Caps & Displays</p>
        </div>
      </div>

      {/* Add Alert Button (Business Owner Only) */}
      {userProfile?.role === 'business_owner' && (
        <button
          onClick={handleAddAlert}
          className="w-full py-6 bg-black text-[#FFD700] rounded-[2.5rem] font-black uppercase tracking-widest text-[11px] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3"
        >
          <i className="fas fa-bullhorn text-lg"></i>
          Add New Promo Alert
        </button>
      )}

      {/* Alerts List */}
      {alerts.length === 0 ? (
        <div className="bg-white rounded-[2.5rem] p-12 text-center border-2 border-dashed border-gray-200">
          <i className="fas fa-bullhorn text-4xl text-gray-300 mb-4"></i>
          <p className="text-gray-400 font-black uppercase tracking-widest text-sm">
            No promo alerts yet. Add your first alert to get started!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div key={alert.id} className="bg-white p-7 rounded-[2.5rem] shadow-sm border border-gray-100 flex flex-col gap-5 relative overflow-hidden group transition-all hover:border-black">
              {/* Edit/Delete buttons (business owner only) */}
              {userProfile?.role === 'business_owner' && (
                <div className="absolute top-6 right-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <button
                    onClick={() => handleEditAlert(alert)}
                    className="w-9 h-9 bg-black text-[#FFD700] rounded-xl flex items-center justify-center hover:bg-gray-900 transition-all active:scale-95 shadow-xl"
                  >
                    <i className="fas fa-edit text-sm"></i>
                  </button>
                  <button
                    onClick={() => handleDeleteClick(alert)}
                    className="w-9 h-9 bg-red-600 text-white rounded-xl flex items-center justify-center hover:bg-red-700 transition-all active:scale-95 shadow-xl"
                  >
                    <i className="fas fa-trash text-sm"></i>
                  </button>
                </div>
              )}

              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="text-[9px] font-black text-[#FFD700] uppercase tracking-widest mb-1.5 bg-black w-fit px-3 py-1 rounded-full">{alert.promoType}</div>
                  <h4 className="font-black text-xl text-black leading-tight uppercase tracking-tight">{alert.storeName}</h4>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Starts {alert.date}</span>
                    <span className="text-[10px] text-gray-300">•</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Mgr: {alert.contactName}</span>
                  </div>
                </div>
              </div>

              <button
                disabled={sentAlerts.includes(alert.id)}
                onClick={() => handleSendPromo(alert.id)}
                className={`w-full py-4 rounded-[1.5rem] font-black uppercase tracking-[0.2em] text-[10px] transition-all flex items-center justify-center gap-2 shadow-2xl ${
                  sentAlerts.includes(alert.id)
                  ? 'bg-gray-50 text-green-600 cursor-default border border-gray-100 shadow-none'
                  : 'bg-black text-[#FFD700] hover:bg-gray-900 shadow-[#FFD700]/10 active:scale-95'
                }`}
              >
                {sentAlerts.includes(alert.id) ? (
                  <><i className="fas fa-check"></i> Request Sent</>
                ) : (
                  <><i className="fas fa-paper-plane"></i> Request End Cap Display</>
                )}
              </button>
              <p className="text-[9px] text-gray-300 text-center uppercase tracking-[0.15em] font-black">1-Click Manager Text Approval System</p>
            </div>
          ))}
        </div>
      )}

      {/* Alert Form Modal */}
      {showAlertModal && (
        <SaleAlertFormModal
          isOpen={showAlertModal}
          onClose={() => setShowAlertModal(false)}
          onSubmit={handleAlertSubmit}
          routes={routes}
          alert={editingAlert}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleConfirmDelete}
          title="Delete Promo Alert"
          message={`Are you sure you want to delete the promo alert for "${deletingAlert?.storeName}"? This action cannot be undone.`}
          confirmText="Delete"
          danger={true}
        />
      )}
    </div>
  );
};

const LoadingScreen: React.FC<{ message: string }> = ({ message }) => (
  <div className="min-h-screen flex items-center justify-center bg-black">
    <div className="text-center">
      <i className="fas fa-truck-fast text-[#FFD700] text-6xl mb-4 animate-pulse"></i>
      <p className="text-white font-black uppercase tracking-widest text-sm">{message}</p>
    </div>
  </div>
);

export default App;
