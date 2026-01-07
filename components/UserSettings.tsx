import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';

export const UserSettings: React.FC = () => {
  const { currentUser, userProfile, logout } = useAuth();
  const { employees } = useData();
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(userProfile?.displayName || '');

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleSaveProfile = () => {
    // TODO: Implement profile update in AuthContext
    console.log('Save profile:', displayName);
    setIsEditing(false);
  };

  const currentEmployee = employees.find(emp => (emp as any).userId === currentUser?.uid);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div className="bg-black text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
        <div className="absolute bottom-0 right-0 w-32 h-32 bg-[#FFD700]/10 rounded-full -mr-16 -mb-16 blur-3xl"></div>
        <div className="relative z-10">
          <h2 className="text-2xl font-black uppercase tracking-tighter mb-1">Account Settings</h2>
          <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.3em]">
            Manage Your Profile
          </p>
        </div>
      </div>

      {/* Profile Card */}
      <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-black to-gray-700 rounded-2xl flex items-center justify-center text-[#FFD700] text-2xl font-black shadow-lg">
              {userProfile?.displayName?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div>
              <h3 className="text-xl font-black uppercase tracking-tight">{userProfile?.displayName}</h3>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                {userProfile?.role === 'business_owner' ? '👑 Business Owner' : '👤 Team Member'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="px-4 py-2 bg-gray-50 hover:bg-gray-100 text-black font-black uppercase tracking-widest text-[10px] rounded-xl transition-all border border-gray-200"
          >
            <i className="fas fa-edit mr-2"></i>
            {isEditing ? 'Cancel' : 'Edit'}
          </button>
        </div>

        {/* Edit Form */}
        {isEditing ? (
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <div>
              <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
              />
            </div>
            <button
              onClick={handleSaveProfile}
              className="w-full py-4 bg-black text-[#FFD700] font-black uppercase tracking-widest text-sm rounded-2xl hover:bg-gray-900 transition-all shadow-xl active:scale-95"
            >
              <i className="fas fa-save mr-2"></i>
              Save Changes
            </button>
          </div>
        ) : (
          <div className="space-y-3 pt-4 border-t border-gray-100">
            <InfoRow label="Email" value={currentUser?.email || 'N/A'} icon="fa-envelope" />
            <InfoRow label="User ID" value={currentUser?.uid.slice(0, 16) + '...'} icon="fa-id-card" />
            <InfoRow
              label="Member Since"
              value={currentUser?.metadata.creationTime ? new Date(currentUser.metadata.creationTime).toLocaleDateString() : 'N/A'}
              icon="fa-calendar"
            />
          </div>
        )}
      </section>

      {/* Account Type Info */}
      <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100">
        <h3 className="font-black text-sm uppercase tracking-tight mb-4 flex items-center gap-2">
          <i className="fas fa-user-shield text-[#FFD700]"></i>
          Account Type
        </h3>
        <div className="space-y-3">
          {userProfile?.role === 'business_owner' ? (
            <>
              <div className="p-4 bg-gray-50 rounded-2xl">
                <p className="text-xs font-bold text-gray-600 mb-2">Business Owner Access</p>
                <ul className="space-y-1 text-[10px] font-bold text-gray-500">
                  <li className="flex items-center gap-2">
                    <i className="fas fa-check text-green-500"></i> Full dashboard access
                  </li>
                  <li className="flex items-center gap-2">
                    <i className="fas fa-check text-green-500"></i> Manage all routes & employees
                  </li>
                  <li className="flex items-center gap-2">
                    <i className="fas fa-check text-green-500"></i> View revenue & analytics
                  </li>
                  <li className="flex items-center gap-2">
                    <i className="fas fa-check text-green-500"></i> CSV data import/export
                  </li>
                  <li className="flex items-center gap-2">
                    <i className="fas fa-check text-green-500"></i> Fleet management
                  </li>
                </ul>
              </div>
            </>
          ) : (
            <>
              <div className="p-4 bg-gray-50 rounded-2xl">
                <p className="text-xs font-bold text-gray-600 mb-2">Team Member Access</p>
                <ul className="space-y-1 text-[10px] font-bold text-gray-500">
                  <li className="flex items-center gap-2">
                    <i className="fas fa-check text-green-500"></i> View assigned routes
                  </li>
                  <li className="flex items-center gap-2">
                    <i className="fas fa-check text-green-500"></i> Place orders for your routes
                  </li>
                  <li className="flex items-center gap-2">
                    <i className="fas fa-check text-green-500"></i> View product catalog
                  </li>
                  <li className="flex items-center gap-2">
                    <i className="fas fa-times text-gray-300"></i> Limited analytics access
                  </li>
                </ul>
              </div>
              {currentEmployee && (
                <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                  <p className="text-xs font-bold text-blue-600 mb-2">Your Role</p>
                  <p className="text-[10px] font-bold text-blue-500 uppercase">
                    {currentEmployee.role === 'driver' ? '🚛 Route Driver' : '📊 Executive'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Danger Zone - Logout */}
      <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border-2 border-red-100">
        <h3 className="font-black text-sm uppercase tracking-tight mb-4 flex items-center gap-2 text-red-600">
          <i className="fas fa-exclamation-triangle"></i>
          Danger Zone
        </h3>
        <button
          onClick={handleLogout}
          className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-black uppercase tracking-widest text-sm rounded-2xl transition-all shadow-xl active:scale-95 flex items-center justify-center gap-2"
        >
          <i className="fas fa-right-from-bracket"></i>
          Logout {userProfile?.role === 'business_owner' ? 'Business Account' : 'Team Account'}
        </button>
        <p className="text-[9px] text-gray-400 text-center mt-3 font-bold uppercase tracking-wider">
          You'll need to sign in again to access your account
        </p>
      </section>

      {/* App Info */}
      <section className="bg-gray-50 rounded-[2.5rem] p-6 text-center">
        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">
          TruckCEO v1.0.0
        </p>
        <p className="text-[8px] font-bold text-gray-300 uppercase tracking-wider">
          Powered by Firebase & Google AI
        </p>
      </section>
    </div>
  );
};

const InfoRow: React.FC<{ label: string; value: string; icon: string }> = ({ label, value, icon }) => (
  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
    <div className="flex items-center gap-3">
      <i className={`fas ${icon} text-gray-400 text-sm w-4`}></i>
      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{label}</span>
    </div>
    <span className="text-xs font-bold text-gray-700">{value}</span>
  </div>
);
