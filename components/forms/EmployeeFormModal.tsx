import React, { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { Employee, RouteTerritory } from '../../types';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';

interface EmployeeFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<Employee, 'id'>) => Promise<void>;
  employee?: Employee; // If editing existing employee
}

export const EmployeeFormModal: React.FC<EmployeeFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  employee
}) => {
  const { routes } = useData();
  const { userProfile } = useAuth();
  const isBusinessOwner = userProfile?.role === 'business_owner';

  const [formData, setFormData] = useState<Omit<Employee, 'id'>>({
    name: '',
    role: 'driver',
    hoursThisWeek: 0,
    engagementScore: 80,
    status: 'active',
    salesHistory: [],
    attendance: [],
    vacationDaysUsed: 0,
    sickDaysUsed: 0
  });

  const [assignedRoutes, setAssignedRoutes] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (employee) {
      setFormData({
        name: employee.name,
        role: employee.role,
        hoursThisWeek: employee.hoursThisWeek,
        engagementScore: employee.engagementScore,
        status: employee.status,
        salesHistory: employee.salesHistory || [],
        attendance: employee.attendance || [],
        vacationDaysUsed: employee.vacationDaysUsed,
        sickDaysUsed: employee.sickDaysUsed
      });
      setAssignedRoutes((employee as any).assignedRoutes || []);
    } else {
      setFormData({
        name: '',
        role: 'driver',
        hoursThisWeek: 0,
        engagementScore: 80,
        status: 'active',
        salesHistory: [],
        attendance: [],
        vacationDaysUsed: 0,
        sickDaysUsed: 0
      });
      setAssignedRoutes([]);
    }
    setErrors({});
  }, [employee, isOpen]);

  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (formData.hoursThisWeek < 0) {
      newErrors.hoursThisWeek = 'Hours must be 0 or greater';
    }

    if (formData.engagementScore < 0 || formData.engagementScore > 100) {
      newErrors.engagementScore = 'Engagement score must be between 0-100';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setSubmitting(true);
    try {
      const employeeData: any = { ...formData };
      if (isBusinessOwner) {
        employeeData.assignedRoutes = assignedRoutes;
      }
      await onSubmit(employeeData);
      onClose();
    } catch (error) {
      console.error('Error submitting employee:', error);
      setErrors({ submit: 'Failed to save employee. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRouteAssignment = (routeId: string) => {
    if (assignedRoutes.includes(routeId)) {
      setAssignedRoutes(assignedRoutes.filter(id => id !== routeId));
    } else {
      setAssignedRoutes([...assignedRoutes, routeId]);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={employee ? 'Edit Team Member' : 'Onboard New Team Member'}
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Name */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Full Name *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            placeholder="e.g., John Doe"
          />
          {errors.name && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.name}</p>
          )}
        </div>

        {/* Role */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
            Role *
          </label>
          <div className="flex gap-4">
            <label className="flex-1 flex items-center gap-3 p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl cursor-pointer hover:border-[#FFD700] transition-all">
              <input
                type="radio"
                value="driver"
                checked={formData.role === 'driver'}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as 'driver' | 'executive' })}
                className="w-5 h-5 text-[#FFD700] focus:ring-[#FFD700]"
              />
              <div>
                <div className="font-black text-sm uppercase">Driver</div>
                <div className="text-[9px] text-gray-500 font-bold">Route Operations</div>
              </div>
            </label>
            <label className="flex-1 flex items-center gap-3 p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl cursor-pointer hover:border-[#FFD700] transition-all">
              <input
                type="radio"
                value="executive"
                checked={formData.role === 'executive'}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as 'driver' | 'executive' })}
                className="w-5 h-5 text-[#FFD700] focus:ring-[#FFD700]"
              />
              <div>
                <div className="font-black text-sm uppercase">Executive</div>
                <div className="text-[9px] text-gray-500 font-bold">Management</div>
              </div>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Hours This Week */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Hours This Week
            </label>
            <input
              type="number"
              value={formData.hoursThisWeek}
              onChange={(e) => setFormData({ ...formData, hoursThisWeek: parseInt(e.target.value) || 0 })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
              min="0"
            />
            {errors.hoursThisWeek && (
              <p className="text-red-600 text-xs font-bold mt-2">{errors.hoursThisWeek}</p>
            )}
          </div>

          {/* Status */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Status
            </label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'break' | 'off' })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            >
              <option value="active">Active</option>
              <option value="break">On Break</option>
              <option value="off">Off Duty</option>
            </select>
          </div>
        </div>

        {/* Engagement Score */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Engagement Score: {formData.engagementScore}%
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={formData.engagementScore}
            onChange={(e) => setFormData({ ...formData, engagementScore: parseInt(e.target.value) })}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FFD700]"
          />
          {errors.engagementScore && (
            <p className="text-red-600 text-xs font-bold mt-2">{errors.engagementScore}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Vacation Days Used */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Vacation Days Used
            </label>
            <input
              type="number"
              value={formData.vacationDaysUsed}
              onChange={(e) => setFormData({ ...formData, vacationDaysUsed: parseInt(e.target.value) || 0 })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
              min="0"
            />
          </div>

          {/* Sick Days Used */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Sick Days Used
            </label>
            <input
              type="number"
              value={formData.sickDaysUsed}
              onChange={(e) => setFormData({ ...formData, sickDaysUsed: parseInt(e.target.value) || 0 })}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
              min="0"
            />
          </div>
        </div>

        {/* Assigned Routes (Business Owner Only) */}
        {isBusinessOwner && (
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
              Assigned Routes
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto p-1">
              {routes.map((route) => (
                <label
                  key={route.id}
                  className="flex items-center gap-3 p-3 bg-gray-50 border-2 border-gray-200 rounded-xl cursor-pointer hover:border-[#FFD700] transition-all"
                >
                  <input
                    type="checkbox"
                    checked={assignedRoutes.includes(route.id)}
                    onChange={() => toggleRouteAssignment(route.id)}
                    className="w-5 h-5 text-[#FFD700] focus:ring-[#FFD700] rounded"
                  />
                  <span className="font-bold text-sm">{route.name}</span>
                </label>
              ))}
            </div>
            {routes.length === 0 && (
              <p className="text-gray-400 text-xs font-bold text-center py-4">No routes available</p>
            )}
          </div>
        )}

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
                <i className="fas fa-user-plus"></i>
                {employee ? 'Update Member' : 'Add Member'}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
