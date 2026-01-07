import React, { useState } from 'react';
import { RouteTerritory, Store } from '../types';
import { useData } from '../contexts/DataContext';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from './ToastContainer';
import { RouteFormModal } from './forms/RouteFormModal';
import { StoreFormModal } from './forms/StoreFormModal';
import { ConfirmDialog } from './ConfirmDialog';

export const RoutesManagement: React.FC = () => {
  const { routes, addRoute, updateRoute, deleteRoute } = useData();
  const { toasts, showToast, removeToast } = useToast();

  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);

  // Route modal state
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [editingRoute, setEditingRoute] = useState<RouteTerritory | undefined>(undefined);

  // Store modal state
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [storeRouteId, setStoreRouteId] = useState<string | undefined>(undefined);
  const [editingStore, setEditingStore] = useState<(Store & { routeId: string }) | undefined>(undefined);

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'route' | 'store', data: any } | null>(null);

  // Handle add route
  const handleAddRoute = () => {
    setEditingRoute(undefined);
    setShowRouteModal(true);
  };

  // Handle edit route
  const handleEditRoute = (route: RouteTerritory) => {
    setEditingRoute(route);
    setShowRouteModal(true);
  };

  // Handle delete route
  const handleDeleteRouteClick = (route: RouteTerritory) => {
    setDeleteTarget({ type: 'route', data: route });
    setShowDeleteConfirm(true);
  };

  // Handle add store
  const handleAddStore = (routeId: string) => {
    setStoreRouteId(routeId);
    setEditingStore(undefined);
    setShowStoreModal(true);
  };

  // Handle edit store
  const handleEditStore = (routeId: string, store: Store) => {
    setEditingStore({ ...store, routeId });
    setShowStoreModal(true);
  };

  // Handle delete store
  const handleDeleteStoreClick = (routeId: string, store: Store) => {
    setDeleteTarget({ type: 'store', data: { routeId, store } });
    setShowDeleteConfirm(true);
  };

  // Confirm delete
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;

    try {
      if (deleteTarget.type === 'route') {
        await deleteRoute(deleteTarget.data.id);
        showToast(`Route "${deleteTarget.data.name}" deleted`, 'success');
        if (expandedRouteId === deleteTarget.data.id) {
          setExpandedRouteId(null);
        }
      } else {
        const { routeId, store } = deleteTarget.data;
        const route = routes.find(r => r.id === routeId);
        if (route) {
          const updatedStores = route.stores.filter(s => s.id !== store.id);
          await updateRoute(routeId, { stores: updatedStores });
          showToast(`Store "${store.name}" removed`, 'success');
        }
      }
      setDeleteTarget(null);
    } catch (error) {
      console.error('Error deleting:', error);
      showToast('Failed to delete', 'error');
    }
  };

  // Handle route form submit
  const handleRouteSubmit = async (data: Omit<RouteTerritory, 'id'>) => {
    try {
      if (editingRoute) {
        await updateRoute(editingRoute.id, data);
        showToast('Route updated successfully', 'success');
      } else {
        await addRoute(data);
        showToast('Route added successfully', 'success');
      }
    } catch (error) {
      console.error('Error saving route:', error);
      showToast('Failed to save route', 'error');
      throw error;
    }
  };

  // Handle store form submit
  const handleStoreSubmit = async (routeId: string, storeData: Omit<Store, 'id'>) => {
    try {
      const route = routes.find(r => r.id === routeId);
      if (!route) throw new Error('Route not found');

      if (editingStore) {
        // Update existing store
        const updatedStores = route.stores.map(s =>
          s.id === editingStore.id ? { ...s, ...storeData } : s
        );
        await updateRoute(routeId, { stores: updatedStores });
        showToast('Store updated successfully', 'success');
      } else {
        // Add new store
        const newStore: Store = {
          id: `store-${Date.now()}`,
          ...storeData
        };
        const updatedStores = [...route.stores, newStore];
        await updateRoute(routeId, { stores: updatedStores });
        showToast('Store added successfully', 'success');
      }
    } catch (error) {
      console.error('Error saving store:', error);
      showToast('Failed to save store', 'error');
      throw error;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Header */}
      <div className="bg-black text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
        <div className="absolute bottom-0 right-0 w-32 h-32 bg-[#FFD700]/10 rounded-full -mr-16 -mb-16 blur-3xl"></div>
        <div className="relative z-10">
          <h2 className="text-2xl font-black uppercase tracking-tighter mb-1">Routes & Stores</h2>
          <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.3em]">
            Manage Your Territories
          </p>
        </div>
      </div>

      {/* Add Route Button */}
      <button
        onClick={handleAddRoute}
        className="w-full py-6 bg-black text-[#FFD700] rounded-[2.5rem] font-black uppercase tracking-widest text-[11px] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3"
      >
        <i className="fas fa-route text-lg"></i>
        Add New Route
      </button>

      {/* Routes List */}
      {routes.length === 0 ? (
        <div className="bg-white rounded-[2.5rem] p-12 text-center border-2 border-dashed border-gray-200">
          <i className="fas fa-map text-4xl text-gray-300 mb-4"></i>
          <p className="text-gray-400 font-black uppercase tracking-widest text-sm">
            No routes yet. Add your first route to get started!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {routes.map((route) => (
            <div
              key={route.id}
              className={`bg-white rounded-[2.5rem] shadow-sm border transition-all duration-300 overflow-hidden ${
                expandedRouteId === route.id ? 'border-black' : 'border-gray-100 hover:border-gray-300'
              }`}
            >
              {/* Route Header */}
              <div
                onClick={() => setExpandedRouteId(expandedRouteId === route.id ? null : route.id)}
                className="p-7 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-black rounded-2xl flex items-center justify-center text-[#FFD700] text-xl shadow-xl">
                      <i className="fas fa-route"></i>
                    </div>
                    <div>
                      <h3 className="text-xl font-black uppercase tracking-tight">{route.name}</h3>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">
                        {route.stores.length} Store{route.stores.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <i className={`fas fa-chevron-${expandedRouteId === route.id ? 'up' : 'down'} text-gray-400`}></i>
                </div>
              </div>

              {/* Expanded Content */}
              {expandedRouteId === route.id && (
                <div className="px-7 pb-7 space-y-4 animate-in slide-in-from-top-4 duration-300">
                  <div className="h-px bg-gray-100" />

                  {/* Route Actions */}
                  <div className="flex gap-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditRoute(route);
                      }}
                      className="flex-1 py-3 bg-black text-[#FFD700] rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <i className="fas fa-edit"></i>
                      Edit Route
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteRouteClick(route);
                      }}
                      className="flex-1 py-3 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <i className="fas fa-trash"></i>
                      Delete Route
                    </button>
                  </div>

                  {/* Stores Section */}
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Stores</h4>
                      <button
                        onClick={() => handleAddStore(route.id)}
                        className="px-4 py-2 bg-gray-50 text-black rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-gray-100 transition-all active:scale-95 flex items-center gap-2"
                      >
                        <i className="fas fa-plus"></i>
                        Add Store
                      </button>
                    </div>

                    {route.stores.length === 0 ? (
                      <div className="bg-gray-50 rounded-2xl p-6 text-center">
                        <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">
                          No stores in this route yet
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {route.stores.map((store) => (
                          <div
                            key={store.id}
                            className="bg-gray-50 p-4 rounded-2xl flex items-center justify-between group hover:bg-gray-100 transition-all"
                          >
                            <div>
                              <div className="text-sm font-black uppercase">{store.name}</div>
                              <div className="text-[9px] font-bold text-gray-500 mt-1">{store.address}</div>
                            </div>
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleEditStore(route.id, store)}
                                className="w-8 h-8 bg-black text-[#FFD700] rounded-lg flex items-center justify-center hover:bg-gray-900 transition-all active:scale-95"
                              >
                                <i className="fas fa-edit text-xs"></i>
                              </button>
                              <button
                                onClick={() => handleDeleteStoreClick(route.id, store)}
                                className="w-8 h-8 bg-red-600 text-white rounded-lg flex items-center justify-center hover:bg-red-700 transition-all active:scale-95"
                              >
                                <i className="fas fa-trash text-xs"></i>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Route Form Modal */}
      <RouteFormModal
        isOpen={showRouteModal}
        onClose={() => setShowRouteModal(false)}
        onSubmit={handleRouteSubmit}
        route={editingRoute}
      />

      {/* Store Form Modal */}
      <StoreFormModal
        isOpen={showStoreModal}
        onClose={() => setShowStoreModal(false)}
        onSubmit={handleStoreSubmit}
        routes={routes}
        selectedRouteId={storeRouteId}
        store={editingStore}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleConfirmDelete}
        title={deleteTarget?.type === 'route' ? 'Delete Route' : 'Remove Store'}
        message={
          deleteTarget?.type === 'route'
            ? `Are you sure you want to delete "${deleteTarget.data.name}" and all its stores? This action cannot be undone.`
            : `Are you sure you want to remove "${deleteTarget?.data.store.name}" from this route?`
        }
        confirmText="Delete"
        danger={true}
      />
    </div>
  );
};
