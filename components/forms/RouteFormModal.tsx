import React, { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { RouteTerritory } from '../../types';

interface RouteFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<RouteTerritory, 'id'>) => Promise<void>;
  route?: RouteTerritory; // If editing existing route
}

export const RouteFormModal: React.FC<RouteFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  route
}) => {
  const [formData, setFormData] = useState({
    name: '',
    stores: []
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (route) {
      setFormData({
        name: route.name,
        stores: route.stores || []
      });
    } else {
      setFormData({
        name: '',
        stores: []
      });
    }
    setErrors({});
  }, [route, isOpen]);

  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Route name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setSubmitting(true);
    try {
      await onSubmit(formData);
      onClose();
    } catch (error) {
      console.error('Error submitting route:', error);
      setErrors({ submit: 'Failed to save route. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={route ? 'Edit Route' : 'Add New Route'}
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Route Name */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Route Name *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            placeholder="e.g., NY Yonkers"
          />
          {errors.name && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.name}</p>
          )}
        </div>

        <div className="bg-blue-50 border-2 border-blue-100 rounded-2xl p-4">
          <p className="text-xs font-bold text-blue-700">
            <i className="fas fa-info-circle mr-2"></i>
            After creating the route, you can add stores to it from the routes management page.
          </p>
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
            disabled={submitting}
            className="flex-1 py-4 bg-black text-[#FFD700] font-black uppercase tracking-widest text-xs rounded-2xl transition-all shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                Saving...
              </>
            ) : (
              <>
                <i className="fas fa-route"></i>
                {route ? 'Update Route' : 'Add Route'}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
