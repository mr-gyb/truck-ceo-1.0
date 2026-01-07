
import React, { useState } from 'react';
import { Truck, MaintenanceRecord } from '../types';
import { useData } from '../contexts/DataContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from './ToastContainer';
import { TruckFormModal } from './forms/TruckFormModal';
import { MaintenanceLogModal } from './forms/MaintenanceLogModal';
import { ConfirmDialog } from './ConfirmDialog';
import { ProtectedFeature } from './ProtectedFeature';

interface TruckMaintenanceProps {
  fleet: Truck[];
  onNavigate?: (truckId: string) => void;
}

export const TruckMaintenance: React.FC<TruckMaintenanceProps> = ({ fleet, onNavigate }) => {
  const { addTruck, updateTruck, deleteTruck } = useData();
  const { userProfile } = useAuth();
  const { toasts, showToast, removeToast } = useToast();

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Modal state
  const [showTruckModal, setShowTruckModal] = useState(false);
  const [editingTruck, setEditingTruck] = useState<Truck | undefined>(undefined);

  // Maintenance log modal state
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [maintenanceTruck, setMaintenanceTruck] = useState<Truck | null>(null);

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingTruck, setDeletingTruck] = useState<Truck | null>(null);

  // Handle add truck
  const handleAddTruck = () => {
    setEditingTruck(undefined);
    setShowTruckModal(true);
  };

  // Handle edit truck
  const handleEditTruck = (truck: Truck) => {
    setEditingTruck(truck);
    setShowTruckModal(true);
  };

  // Handle delete truck
  const handleDeleteClick = (truck: Truck) => {
    setDeletingTruck(truck);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingTruck) return;

    try {
      await deleteTruck(deletingTruck.id);
      showToast(`${deletingTruck.plate} removed from fleet`, 'success');
      setDeletingTruck(null);
      if (expandedId === deletingTruck.id) {
        setExpandedId(null);
      }
    } catch (error) {
      console.error('Error deleting truck:', error);
      showToast('Failed to remove truck', 'error');
    }
  };

  // Handle truck form submit
  const handleTruckSubmit = async (data: Omit<Truck, 'id'>) => {
    try {
      if (editingTruck) {
        await updateTruck(editingTruck.id, data);
        showToast('Truck updated successfully', 'success');
      } else {
        await addTruck(data);
        showToast('Truck registered successfully', 'success');
      }
    } catch (error) {
      console.error('Error saving truck:', error);
      showToast('Failed to save truck', 'error');
      throw error; // Re-throw to let modal handle it
    }
  };

  // Handle maintenance log
  const handleAddMaintenanceLog = (truck: Truck) => {
    setMaintenanceTruck(truck);
    setShowMaintenanceModal(true);
  };

  const handleMaintenanceSubmit = async (record: MaintenanceRecord) => {
    if (!maintenanceTruck) return;

    try {
      const updatedHistory = [...(maintenanceTruck.maintenanceHistory || []), record];
      await updateTruck(maintenanceTruck.id, {
        maintenanceHistory: updatedHistory,
        lastService: record.date
      });
      showToast('Service log added successfully', 'success');
      setMaintenanceTruck(null);
    } catch (error) {
      console.error('Error adding maintenance log:', error);
      showToast('Failed to add service log', 'error');
      throw error;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Add Truck Button (Business Owner Only) */}
      <ProtectedFeature requiredRole="business_owner">
        <button
          onClick={handleAddTruck}
          className="w-full py-6 bg-black text-[#FFD700] rounded-[2.5rem] font-black uppercase tracking-widest text-[11px] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3"
        >
          <i className="fas fa-truck text-lg"></i>
          Register New Truck
        </button>
      </ProtectedFeature>

      <div className="grid grid-cols-2 gap-5">
        <div className="bg-black p-7 rounded-[2.5rem] border border-gray-900 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-16 h-16 bg-[#FFD700]/10 rounded-full blur-2xl"></div>
          <div className="text-[#FFD700] text-4xl font-black relative z-10">{fleet.filter(t => t.healthStatus === 'good').length}</div>
          <div className="text-[10px] text-gray-500 font-black uppercase tracking-[0.3em] mt-2 relative z-10">Healthy</div>
        </div>
        <div className="bg-gray-50 p-7 rounded-[2.5rem] border border-gray-100 shadow-sm">
          <div className="text-black text-4xl font-black">{fleet.filter(t => t.healthStatus !== 'good').length}</div>
          <div className="text-[10px] text-gray-400 font-black uppercase tracking-[0.3em] mt-2">Attention</div>
        </div>
      </div>

      <div className="space-y-5">
        {fleet.map((truck) => (
          <div 
            key={truck.id} 
            onClick={() => setExpandedId(expandedId === truck.id ? null : truck.id)}
            className={`bg-white rounded-[2.5rem] shadow-sm border border-gray-100 transition-all duration-300 cursor-pointer overflow-hidden ${expandedId === truck.id ? 'border-black' : 'hover:border-gray-300'}`}
          >
            <div className="p-7">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-5">
                  <div className={`w-14 h-14 rounded-3xl flex items-center justify-center text-2xl shadow-xl transition-colors ${
                    truck.healthStatus === 'good' ? 'bg-black text-[#FFD700]' : 'bg-[#FFD700] text-black'
                  }`}>
                    <i className="fas fa-truck-pickup"></i>
                  </div>
                  <div>
                    <h4 className="font-black text-black text-xl tracking-tighter uppercase">{truck.plate}</h4>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">{truck.type} • {truck.mileage.toLocaleString()} mi</p>
                  </div>
                </div>
                <div className={`px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-widest ${
                  truck.healthStatus === 'good' ? 'bg-black text-[#FFD700]' : 'bg-gray-100 text-black'
                }`}>
                  {truck.healthStatus}
                </div>
              </div>

              {/* Physical Profile Brief */}
              <div className="flex gap-4 mb-4 px-1">
                 <div className="flex items-center gap-2">
                    <i className="fas fa-up-down text-[10px] text-gray-300"></i>
                    <span className="text-[10px] font-black uppercase tracking-tight">{truck.dimensions.height} ft Height</span>
                 </div>
                 <div className="flex items-center gap-2">
                    <i className="fas fa-weight-hanging text-[10px] text-gray-300"></i>
                    <span className="text-[10px] font-black uppercase tracking-tight">{truck.dimensions.weight} lbs</span>
                 </div>
              </div>

              {truck.issues.length > 0 && (
                <div className="bg-red-50/50 rounded-[1.5rem] p-5 space-y-2">
                  <div className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-1">Alerts</div>
                  {truck.issues.map((issue, idx) => (
                    <div key={idx} className="flex gap-3 items-center text-[11px] text-red-900 font-black uppercase tracking-tight">
                      <i className="fas fa-triangle-exclamation text-red-400"></i>
                      {issue}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {expandedId === truck.id && (
              <div className="px-7 pb-7 space-y-6 animate-in slide-in-from-top-4 duration-300">
                <div className="h-px bg-gray-100" />

                {/* Edit/Delete buttons (business owner only) */}
                <ProtectedFeature requiredRole="business_owner">
                  <div className="flex gap-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditTruck(truck);
                      }}
                      className="flex-1 py-3 bg-black text-[#FFD700] rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <i className="fas fa-edit"></i>
                      Edit Truck
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteClick(truck);
                      }}
                      className="flex-1 py-3 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <i className="fas fa-trash"></i>
                      Remove
                    </button>
                  </div>
                </ProtectedFeature>

                <div className="flex gap-3">
                   <button
                     onClick={(e) => { e.stopPropagation(); onNavigate?.(truck.id); }}
                     className="flex-1 py-4 bg-[#FFD700] text-black rounded-2xl text-[9px] font-black uppercase tracking-[0.2em] shadow-xl shadow-[#FFD700]/10 active:scale-95 transition-all flex items-center justify-center gap-2"
                   >
                     <i className="fas fa-location-arrow"></i> Start Smart Nav
                   </button>
                </div>

                {/* Documents Status */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <div className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Registration</div>
                    <div className="text-[11px] font-black text-black uppercase">{new Date(truck.registrationExpiry).toLocaleDateString()}</div>
                    <div className="mt-2 w-full bg-gray-200 h-1 rounded-full overflow-hidden">
                      <div className="bg-black h-full w-[80%]"></div>
                    </div>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <div className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Insurance</div>
                    <div className="text-[11px] font-black text-black uppercase">{new Date(truck.insuranceExpiry).toLocaleDateString()}</div>
                    <div className="mt-2 w-full bg-gray-200 h-1 rounded-full overflow-hidden">
                      <div className="bg-[#FFD700] h-full w-[45%]"></div>
                    </div>
                  </div>
                </div>

                {/* Maintenance History */}
                <div className="space-y-3">
                  <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Service History</h5>
                  <div className="space-y-2">
                    {truck.maintenanceHistory.map((rec, i) => (
                      <div key={i} className="bg-gray-50 p-4 rounded-2xl flex justify-between items-center">
                        <div>
                          <div className="text-[11px] font-black text-black uppercase">{rec.service}</div>
                          <div className="text-[9px] font-bold text-gray-400 uppercase tracking-tight">{rec.date} • {rec.provider}</div>
                        </div>
                        <div className="text-xs font-black text-black">${rec.cost}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Basic Upkeep Status */}
                <div className="space-y-3">
                  <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Vital Components</h5>
                  <div className="bg-black p-6 rounded-3xl space-y-4">
                    <UpkeepBar label="Tire Tread" value={truck.upkeep.tires} />
                    <UpkeepBar label="Oil Life" value={truck.upkeep.oil} />
                    <UpkeepBar label="Brake Life" value={truck.upkeep.brakes} />
                  </div>
                </div>

                <ProtectedFeature requiredRole="business_owner">
                  <div className="flex gap-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddMaintenanceLog(truck);
                      }}
                      className="flex-1 py-4 bg-black text-[#FFD700] rounded-2xl text-[9px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-black/10 active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <i className="fas fa-wrench"></i>
                      Update Service Log
                    </button>
                  </div>
                </ProtectedFeature>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Truck Form Modal */}
      <TruckFormModal
        isOpen={showTruckModal}
        onClose={() => setShowTruckModal(false)}
        onSubmit={handleTruckSubmit}
        truck={editingTruck}
      />

      {/* Maintenance Log Modal */}
      <MaintenanceLogModal
        isOpen={showMaintenanceModal}
        onClose={() => setShowMaintenanceModal(false)}
        onSubmit={handleMaintenanceSubmit}
        truckPlate={maintenanceTruck?.plate || ''}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleConfirmDelete}
        title="Remove Truck from Fleet"
        message={`Are you sure you want to remove "${deletingTruck?.plate}" from the fleet? This action cannot be undone.`}
        confirmText="Remove"
        danger={true}
      />
    </div>
  );
};

const UpkeepBar: React.FC<{ label: string, value: number }> = ({ label, value }) => (
  <div className="space-y-1.5">
    <div className="flex justify-between items-center">
      <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">{label}</span>
      <span className="text-[9px] font-black text-[#FFD700] uppercase tracking-widest">{value}%</span>
    </div>
    <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
      <div 
        className={`h-full rounded-full transition-all duration-1000 ${value > 70 ? 'bg-[#FFD700]' : value > 30 ? 'bg-orange-400' : 'bg-red-500'}`}
        style={{ width: `${value}%` }}
      />
    </div>
  </div>
);
