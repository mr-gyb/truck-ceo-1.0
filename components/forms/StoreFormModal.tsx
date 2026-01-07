import React, { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { Store, RouteTerritory } from '../../types';

interface StoreFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (routeId: string, store: Omit<Store, 'id'>) => Promise<void>;
  routes: RouteTerritory[];
  selectedRouteId?: string; // Pre-selected route if adding from route view
  store?: Store & { routeId: string }; // If editing existing store
}

export const StoreFormModal: React.FC<StoreFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  routes,
  selectedRouteId,
  store
}) => {
  const [formData, setFormData] = useState({
    routeId: selectedRouteId || '',
    name: '',
    address: ''
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (store) {
      setFormData({
        routeId: store.routeId,
        name: store.name,
        address: store.address
      });
    } else if (selectedRouteId) {
      setFormData({
        routeId: selectedRouteId,
        name: '',
        address: ''
      });
    } else {
      setFormData({
        routeId: routes.length > 0 ? routes[0].id : '',
        name: '',
        address: ''
      });
    }
    setErrors({});
  }, [store, selectedRouteId, routes, isOpen]);

  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!formData.routeId) {
      newErrors.routeId = 'Please select a route';
    }

    if (!formData.name.trim()) {
      newErrors.name = 'Store name is required';
    }

    if (!formData.address.trim()) {
      newErrors.address = 'Store address is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setSubmitting(true);
    try {
      await onSubmit(formData.routeId, {
        name: formData.name,
        address: formData.address
      });
      onClose();
    } catch (error) {
      console.error('Error submitting store:', error);
      setErrors({ submit: 'Failed to save store. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={store ? 'Edit Store' : 'Add New Store'}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Route Selection */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Route *
          </label>
          <select
            value={formData.routeId}
            onChange={(e) => setFormData({ ...formData, routeId: e.target.value })}
            disabled={!!selectedRouteId || !!store}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold disabled:opacity-50"
          >
            {routes.length === 0 ? (
              <option value="">No routes available</option>
            ) : (
              routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name}
                </option>
              ))
            )}
          </select>
          {errors.routeId && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.routeId}</p>
          )}
        </div>

        {/* Store Name */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Store Name *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            placeholder="e.g., Stop & Shop Yonkers"
          />
          {errors.name && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.name}</p>
          )}
        </div>

        {/* Store Address */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Store Address *
          </label>
          <input
            type="text"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            placeholder="e.g., 123 Main St, Yonkers, NY"
          />
          {errors.address && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.address}</p>
          )}
        </div>

        {/* Submit Error */}
        {errors.submit && (
          <div className="p-4 bg-red-50 border-2 border-red-200 rounded-2xl">
            <p className="text-red-600 text-sm font-bold">{errors.submit}</p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-4 bg-gray-50 text-black font-black uppercase tracking-widest text-xs rounded-2xl border border-gray-200 hover:bg-gray-100 transition-all active:scale-95 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || routes.length === 0}
            className="flex-1 py-4 bg-black text-[#FFD700] font-black uppercase tracking-widest text-xs rounded-2xl transition-all shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                Saving...
              </>
            ) : (
              <>
                <i className="fas fa-store"></i>
                {store ? 'Update Store' : 'Add Store'}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
