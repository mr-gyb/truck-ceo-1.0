import React, { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { Truck } from '../../types';

interface TruckFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<Truck, 'id'>) => Promise<void>;
  truck?: Truck; // If editing existing truck
}

export const TruckFormModal: React.FC<TruckFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  truck
}) => {
  const [formData, setFormData] = useState<Omit<Truck, 'id'>>({
    plate: '',
    type: '',
    mileage: 0,
    lastService: '',
    healthStatus: 'good',
    issues: [],
    maintenanceHistory: [],
    registrationExpiry: '',
    insuranceExpiry: '',
    dimensions: {
      height: 0,
      length: 0,
      weight: 0
    },
    upkeep: {
      tires: 100,
      oil: 100,
      brakes: 100
    }
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (truck) {
      setFormData({
        plate: truck.plate,
        type: truck.type,
        mileage: truck.mileage,
        lastService: truck.lastService,
        healthStatus: truck.healthStatus,
        issues: truck.issues || [],
        maintenanceHistory: truck.maintenanceHistory || [],
        registrationExpiry: truck.registrationExpiry,
        insuranceExpiry: truck.insuranceExpiry,
        dimensions: truck.dimensions,
        upkeep: truck.upkeep
      });
    } else {
      setFormData({
        plate: '',
        type: 'GMC 2006 Box Truck',
        mileage: 0,
        lastService: new Date().toISOString().split('T')[0],
        healthStatus: 'good',
        issues: [],
        maintenanceHistory: [],
        registrationExpiry: '',
        insuranceExpiry: '',
        dimensions: {
          height: 13,
          length: 16,
          weight: 12500
        },
        upkeep: {
          tires: 100,
          oil: 100,
          brakes: 100
        }
      });
    }
    setErrors({});
  }, [truck, isOpen]);

  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!formData.plate.trim()) {
      newErrors.plate = 'Plate number is required';
    }

    if (!formData.type.trim()) {
      newErrors.type = 'Truck type is required';
    }

    if (formData.mileage < 0) {
      newErrors.mileage = 'Mileage must be 0 or greater';
    }

    if (formData.dimensions.height <= 0) {
      newErrors.height = 'Height must be greater than 0';
    }

    if (formData.dimensions.length <= 0) {
      newErrors.length = 'Length must be greater than 0';
    }

    if (formData.dimensions.weight <= 0) {
      newErrors.weight = 'Weight must be greater than 0';
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
      console.error('Error submitting truck:', error);
      setErrors({ submit: 'Failed to save truck. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={truck ? 'Edit Truck' : 'Register New Truck'}
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Plate & Type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Plate Number *
            </label>
            <input
              type="text"
              value={formData.plate}
              onChange={(e) => setFormData({ ...formData, plate: e.target.value.toUpperCase() })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold uppercase"
              placeholder="e.g., GMC-06-01"
            />
            {errors.plate && (
              <p className="text-red-600 text-xs font-bold mt-2">{errors.plate}</p>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Truck Type *
            </label>
            <input
              type="text"
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
              placeholder="e.g., GMC 2006 Box Truck"
            />
            {errors.type && (
              <p className="text-red-600 text-xs font-bold mt-2">{errors.type}</p>
            )}
          </div>
        </div>

        {/* Mileage & Last Service */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Mileage
            </label>
            <input
              type="number"
              value={formData.mileage}
              onChange={(e) => setFormData({ ...formData, mileage: parseInt(e.target.value) || 0 })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
              min="0"
            />
            {errors.mileage && (
              <p className="text-red-600 text-xs font-bold mt-2">{errors.mileage}</p>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Last Service Date
            </label>
            <input
              type="date"
              value={formData.lastService}
              onChange={(e) => setFormData({ ...formData, lastService: e.target.value })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            />
          </div>
        </div>

        {/* Health Status */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
            Health Status *
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex items-center gap-2 p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl cursor-pointer hover:border-[#FFD700] transition-all">
              <input
                type="radio"
                value="good"
                checked={formData.healthStatus === 'good'}
                onChange={(e) => setFormData({ ...formData, healthStatus: e.target.value as 'good' | 'warning' | 'critical' })}
                className="w-4 h-4 text-[#FFD700] focus:ring-[#FFD700]"
              />
              <span className="font-black text-sm uppercase">Good</span>
            </label>
            <label className="flex items-center gap-2 p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl cursor-pointer hover:border-[#FFD700] transition-all">
              <input
                type="radio"
                value="warning"
                checked={formData.healthStatus === 'warning'}
                onChange={(e) => setFormData({ ...formData, healthStatus: e.target.value as 'good' | 'warning' | 'critical' })}
                className="w-4 h-4 text-[#FFD700] focus:ring-[#FFD700]"
              />
              <span className="font-black text-sm uppercase">Warning</span>
            </label>
            <label className="flex items-center gap-2 p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl cursor-pointer hover:border-[#FFD700] transition-all">
              <input
                type="radio"
                value="critical"
                checked={formData.healthStatus === 'critical'}
                onChange={(e) => setFormData({ ...formData, healthStatus: e.target.value as 'good' | 'warning' | 'critical' })}
                className="w-4 h-4 text-[#FFD700] focus:ring-[#FFD700]"
              />
              <span className="font-black text-sm uppercase">Critical</span>
            </label>
          </div>
        </div>

        {/* Dimensions */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
            Dimensions
          </label>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[9px] font-bold text-gray-500 mb-1">Height (ft)</label>
              <input
                type="number"
                value={formData.dimensions.height}
                onChange={(e) => setFormData({ ...formData, dimensions: { ...formData.dimensions, height: parseFloat(e.target.value) || 0 } })}
                className="w-full p-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
                min="0"
                step="0.1"
              />
              {errors.height && (
                <p className="text-red-600 text-xs font-bold mt-1">{errors.height}</p>
              )}
            </div>
            <div>
              <label className="block text-[9px] font-bold text-gray-500 mb-1">Length (ft)</label>
              <input
                type="number"
                value={formData.dimensions.length}
                onChange={(e) => setFormData({ ...formData, dimensions: { ...formData.dimensions, length: parseFloat(e.target.value) || 0 } })}
                className="w-full p-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
                min="0"
                step="0.1"
              />
              {errors.length && (
                <p className="text-red-600 text-xs font-bold mt-1">{errors.length}</p>
              )}
            </div>
            <div>
              <label className="block text-[9px] font-bold text-gray-500 mb-1">Weight (lbs)</label>
              <input
                type="number"
                value={formData.dimensions.weight}
                onChange={(e) => setFormData({ ...formData, dimensions: { ...formData.dimensions, weight: parseInt(e.target.value) || 0 } })}
                className="w-full p-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
                min="0"
              />
              {errors.weight && (
                <p className="text-red-600 text-xs font-bold mt-1">{errors.weight}</p>
              )}
            </div>
          </div>
        </div>

        {/* Upkeep Sliders */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
            Component Health
          </label>
          <div className="space-y-3">
            <div>
              <label className="block text-[9px] font-bold text-gray-500 mb-2">Tire Tread: {formData.upkeep.tires}%</label>
              <input
                type="range"
                min="0"
                max="100"
                value={formData.upkeep.tires}
                onChange={(e) => setFormData({ ...formData, upkeep: { ...formData.upkeep, tires: parseInt(e.target.value) } })}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FFD700]"
              />
            </div>
            <div>
              <label className="block text-[9px] font-bold text-gray-500 mb-2">Oil Life: {formData.upkeep.oil}%</label>
              <input
                type="range"
                min="0"
                max="100"
                value={formData.upkeep.oil}
                onChange={(e) => setFormData({ ...formData, upkeep: { ...formData.upkeep, oil: parseInt(e.target.value) } })}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FFD700]"
              />
            </div>
            <div>
              <label className="block text-[9px] font-bold text-gray-500 mb-2">Brake Pads: {formData.upkeep.brakes}%</label>
              <input
                type="range"
                min="0"
                max="100"
                value={formData.upkeep.brakes}
                onChange={(e) => setFormData({ ...formData, upkeep: { ...formData.upkeep, brakes: parseInt(e.target.value) } })}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FFD700]"
              />
            </div>
          </div>
        </div>

        {/* Registration & Insurance Expiry */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Registration Expiry
            </label>
            <input
              type="date"
              value={formData.registrationExpiry}
              onChange={(e) => setFormData({ ...formData, registrationExpiry: e.target.value })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Insurance Expiry
            </label>
            <input
              type="date"
              value={formData.insuranceExpiry}
              onChange={(e) => setFormData({ ...formData, insuranceExpiry: e.target.value })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            />
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
                <i className="fas fa-truck"></i>
                {truck ? 'Update Truck' : 'Register Truck'}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
