
import React, { useState } from 'react';
import { Employee } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, Tooltip } from 'recharts';
import { useData } from '../contexts/DataContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from './ToastContainer';
import { EmployeeFormModal } from './forms/EmployeeFormModal';
import { ConfirmDialog } from './ConfirmDialog';
import { ProtectedFeature } from './ProtectedFeature';

interface EmployeeEngagementProps {
  employees: Employee[];
}

export const EmployeeEngagement: React.FC<EmployeeEngagementProps> = ({ employees }) => {
  const { addEmployee, updateEmployee, deleteEmployee } = useData();
  const { userProfile } = useAuth();
  const { toasts, showToast, removeToast } = useToast();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const avgEngagement = employees.reduce((acc, curr) => acc + curr.engagementScore, 0) / employees.length;

  // Modal state
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | undefined>(undefined);

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null);

  // Handle add employee
  const handleAddEmployee = () => {
    setEditingEmployee(undefined);
    setShowEmployeeModal(true);
  };

  // Handle edit employee
  const handleEditEmployee = (employee: Employee) => {
    setEditingEmployee(employee);
    setShowEmployeeModal(true);
  };

  // Handle delete employee
  const handleDeleteClick = (employee: Employee) => {
    setDeletingEmployee(employee);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingEmployee) return;

    try {
      await deleteEmployee(deletingEmployee.id);
      showToast(`${deletingEmployee.name} removed from team`, 'success');
      setDeletingEmployee(null);
      if (expandedId === deletingEmployee.id) {
        setExpandedId(null);
      }
    } catch (error) {
      console.error('Error deleting employee:', error);
      showToast('Failed to remove team member', 'error');
    }
  };

  // Handle employee form submit
  const handleEmployeeSubmit = async (data: Omit<Employee, 'id'>) => {
    try {
      if (editingEmployee) {
        await updateEmployee(editingEmployee.id, data);
        showToast('Team member updated successfully', 'success');
      } else {
        await addEmployee(data);
        showToast('Team member added successfully', 'success');
      }
    } catch (error) {
      console.error('Error saving employee:', error);
      showToast('Failed to save team member', 'error');
      throw error; // Re-throw to let modal handle it
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <div className="bg-black text-white p-10 rounded-[3rem] shadow-2xl text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-32 h-32 bg-[#FFD700]/5 rounded-full blur-3xl"></div>
        <h2 className="text-gray-500 text-[10px] font-black mb-3 uppercase tracking-[0.35em] relative z-10">Team Engagement Index</h2>
        <div className="text-6xl font-black text-white mb-8 relative z-10">{avgEngagement.toFixed(0)}<span className="text-[#FFD700]">%</span></div>
        
        <div className="h-36 w-full relative z-10">
           <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[
                  { name: 'Engaged', value: avgEngagement },
                  { name: 'Gap', value: 100 - avgEngagement }
                ]}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={65}
                startAngle={180}
                endAngle={0}
                paddingAngle={8}
                dataKey="value"
                stroke="none"
              >
                <Cell fill="#FFD700" />
                <Cell fill="#1a1a1a" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[9px] text-gray-500 font-black uppercase tracking-[0.25em] relative z-10 mt-2">Driver feedback loop synchronized</p>
      </div>

      <div className="space-y-4">
        {employees.map((emp) => (
          <div 
            key={emp.id} 
            onClick={() => setExpandedId(expandedId === emp.id ? null : emp.id)}
            className={`bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden transition-all duration-300 cursor-pointer ${expandedId === emp.id ? 'border-black' : 'hover:border-gray-300'}`}
          >
            <div className="p-6 flex items-center gap-5">
              <div className="relative">
                <div className="w-16 h-16 bg-black rounded-3xl flex items-center justify-center text-[#FFD700] font-black text-2xl border-2 border-[#FFD700]/20 shadow-xl">
                  {emp.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-4 border-white ${emp.status === 'active' ? 'bg-[#FFD700]' : 'bg-gray-200'}`}></div>
              </div>
              
              <div className="flex-1">
                <h4 className="font-black text-black uppercase tracking-tighter text-base leading-tight">{emp.name}</h4>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1.5">{emp.hoursThisWeek} hrs logged • {emp.status}</p>
              </div>

              <div className="text-right">
                <div className={`text-xl font-black ${emp.engagementScore > 80 ? 'text-black' : 'text-gray-400'}`}>
                  {emp.engagementScore}%
                </div>
                <p className="text-[8px] text-gray-300 font-black uppercase tracking-[0.25em] mt-1">Score</p>
              </div>
            </div>

            {expandedId === emp.id && (
              <div className="px-6 pb-6 pt-2 space-y-6 animate-in slide-in-from-top-4 duration-300">
                <div className="h-px bg-gray-100" />

                {/* Edit/Delete buttons (business owner only) */}
                <ProtectedFeature requiredRole="business_owner">
                  <div className="flex gap-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditEmployee(emp);
                      }}
                      className="flex-1 py-3 bg-black text-[#FFD700] rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <i className="fas fa-edit"></i>
                      Edit Member
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteClick(emp);
                      }}
                      className="flex-1 py-3 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <i className="fas fa-trash"></i>
                      Remove
                    </button>
                  </div>
                </ProtectedFeature>
                
                {/* Sales Performance */}
                <div className="space-y-3">
                  <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Monthly Sales Performance</h5>
                  <div className="h-32 w-full bg-gray-50 rounded-2xl p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={emp.salesHistory}>
                        <XAxis dataKey="month" hide />
                        <Tooltip />
                        <Bar dataKey="amount" fill="#000000" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Attendance & Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 p-4 rounded-2xl">
                    <div className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Attendance</div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-black text-black">
                        {emp.attendance.filter(a => a.lateStart).length} Late Starts
                      </div>
                    </div>
                    <div className="text-[9px] font-bold text-gray-400 mt-1">
                      {emp.attendance.filter(a => a.lateFinish).length} Late Finishes
                    </div>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-2xl">
                    <div className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Leave Balance</div>
                    <div className="text-sm font-black text-black">{emp.vacationDaysUsed} Vacation Days</div>
                    <div className="text-[9px] font-bold text-gray-400 mt-1">{emp.sickDaysUsed} Sick Days Used</div>
                  </div>
                </div>

                <button className="w-full py-3 bg-black text-[#FFD700] rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all">
                  Generate Performance Review
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <ProtectedFeature requiredRole="business_owner">
        <button
          onClick={handleAddEmployee}
          className="w-full py-7 bg-white border-2 border-dashed border-gray-100 rounded-[2.5rem] text-gray-400 font-black uppercase tracking-[0.3em] text-[10px] hover:bg-gray-50 transition-all hover:text-black mt-4"
        >
          <i className="fas fa-user-plus mr-3 text-[#FFD700]"></i> Onboard New Member
        </button>
      </ProtectedFeature>

      {/* Employee Form Modal */}
      <EmployeeFormModal
        isOpen={showEmployeeModal}
        onClose={() => setShowEmployeeModal(false)}
        onSubmit={handleEmployeeSubmit}
        employee={editingEmployee}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleConfirmDelete}
        title="Remove Team Member"
        message={`Are you sure you want to remove "${deletingEmployee?.name}" from the team? This action cannot be undone.`}
        confirmText="Remove"
        danger={true}
      />
    </div>
  );
};
