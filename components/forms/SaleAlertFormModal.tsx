import React, { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { SaleAlert, RouteTerritory } from '../../types';

interface SaleAlertFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<SaleAlert, 'id'>) => Promise<void>;
  routes: RouteTerritory[];
  alert?: SaleAlert; // If editing existing alert
}

export const SaleAlertFormModal: React.FC<SaleAlertFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  routes,
  alert
}) => {
  const [formData, setFormData] = useState({
    storeName: '',
    promoType: '',
    date: '',
    contactName: ''
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [submitting, setSubmitting] = useState(false);

  // Get all stores from all routes
  const allStores = routes.flatMap(route =>
    route.stores.map(store => ({ name: store.name, routeName: route.name }))
  );

  useEffect(() => {
    if (alert) {
      setFormData({
        storeName: alert.storeName,
        promoType: alert.promoType,
        date: alert.date,
        contactName: alert.contactName
      });
    } else {
      setFormData({
        storeName: '',
        promoType: '',
        date: '',
        contactName: ''
      });
    }
    setErrors({});
  }, [alert, isOpen]);

  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!formData.storeName.trim()) {
      newErrors.storeName = 'Store name is required';
    }

    if (!formData.promoType.trim()) {
      newErrors.promoType = 'Promo type is required';
    }

    if (!formData.date.trim()) {
      newErrors.date = 'Date is required';
    }

    if (!formData.contactName.trim()) {
      newErrors.contactName = 'Contact name is required';
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
      console.error('Error submitting sale alert:', error);
      setErrors({ submit: 'Failed to save promo alert. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={alert ? 'Edit Promo Alert' : 'Add New Promo Alert'}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Store Name */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Store Name *
          </label>
          {allStores.length > 0 ? (
            <select
              value={formData.storeName}
              onChange={(e) => setFormData({ ...formData, storeName: e.target.value })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            >
              <option value="">Select a store</option>
              {allStores.map((store, idx) => (
                <option key={idx} value={store.name}>
                  {store.name} ({store.routeName})
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={formData.storeName}
              onChange={(e) => setFormData({ ...formData, storeName: e.target.value })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
              placeholder="e.g., Stop & Shop Yonkers"
            />
          )}
          {errors.storeName && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.storeName}</p>
          )}
        </div>

        {/* Promo Type */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Promo Type *
          </label>
          <select
            value={formData.promoType}
            onChange={(e) => setFormData({ ...formData, promoType: e.target.value })}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
          >
            <option value="">Select promo type</option>
            <option value="End Cap Display">End Cap Display</option>
            <option value="Shelf Promo">Shelf Promo</option>
            <option value="BOGO Sale">BOGO Sale</option>
            <option value="Manager's Special">Manager's Special</option>
            <option value="Holiday Display">Holiday Display</option>
            <option value="New Product Launch">New Product Launch</option>
          </select>
          {errors.promoType && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.promoType}</p>
          )}
        </div>

        {/* Date */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Start Date *
          </label>
          <input
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
          />
          {errors.date && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.date}</p>
          )}
        </div>

        {/* Contact Name */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Contact Name *
          </label>
          <input
            type="text"
            value={formData.contactName}
            onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            placeholder="e.g., John Smith (Store Manager)"
          />
          {errors.contactName && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.contactName}</p>
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
                <i className="fas fa-bullhorn"></i>
                {alert ? 'Update Alert' : 'Add Alert'}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
