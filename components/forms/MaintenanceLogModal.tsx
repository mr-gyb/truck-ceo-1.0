import React, { useState } from 'react';
import { Modal } from '../Modal';
import { MaintenanceRecord } from '../../types';

interface MaintenanceLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (record: MaintenanceRecord) => Promise<void>;
  truckPlate: string;
}

export const MaintenanceLogModal: React.FC<MaintenanceLogModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  truckPlate
}) => {
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    service: '',
    cost: 0,
    provider: ''
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [submitting, setSubmitting] = useState(false);

  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!formData.service.trim()) {
      newErrors.service = 'Service description is required';
    }

    if (formData.cost < 0) {
      newErrors.cost = 'Cost must be 0 or greater';
    }

    if (!formData.provider.trim()) {
      newErrors.provider = 'Service provider is required';
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
      // Reset form
      setFormData({
        date: new Date().toISOString().split('T')[0],
        service: '',
        cost: 0,
        provider: ''
      });
      onClose();
    } catch (error) {
      console.error('Error submitting maintenance log:', error);
      setErrors({ submit: 'Failed to add maintenance log. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Add Service Log - ${truckPlate}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Service Date */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Service Date *
          </label>
          <input
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
          />
        </div>

        {/* Service Description */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Service Description *
          </label>
          <textarea
            value={formData.service}
            onChange={(e) => setFormData({ ...formData, service: e.target.value })}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold resize-none"
            rows={3}
            placeholder="e.g., Oil change, tire rotation, brake inspection..."
          />
          {errors.service && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.service}</p>
          )}
        </div>

        {/* Cost & Provider */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Cost ($) *
            </label>
            <input
              type="number"
              value={formData.cost}
              onChange={(e) => setFormData({ ...formData, cost: parseFloat(e.target.value) || 0 })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
              min="0"
              step="0.01"
            />
            {errors.cost && (
              <p className="text-red-600 text-xs font-bold mt-2">{errors.cost}</p>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Service Provider *
            </label>
            <input
              type="text"
              value={formData.provider}
              onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
              placeholder="e.g., Jiffy Lube"
            />
            {errors.provider && (
              <p className="text-red-600 text-xs font-bold mt-2">{errors.provider}</p>
            )}
          </div>
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
                <i className="fas fa-wrench"></i>
                Add Service Log
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
