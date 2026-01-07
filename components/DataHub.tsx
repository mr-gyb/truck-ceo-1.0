
import React, { useState } from 'react';
import { CSVUploader } from './CSVUploader';
import { View } from '../types';

interface Integration {
  id: string;
  name: string;
  icon: string;
  status: 'connected' | 'disconnected';
  color: string;
}

interface DataHubProps {
  onNavigate?: (view: View) => void;
}

export const DataHub: React.FC<DataHubProps> = ({ onNavigate }) => {
  const [integrations, setIntegrations] = useState<Integration[]>([
    { id: 'qbo', name: 'QuickBooks', icon: 'fa-file-invoice-dollar', status: 'connected', color: '#2CA01C' },
    { id: 'discord', name: 'Discord', icon: 'fa-discord', status: 'disconnected', color: '#5865F2' },
    { id: 'gdrive', name: 'Google Drive', icon: 'fa-google-drive', status: 'disconnected', color: '#34A853' },
  ]);

  const [uploadCategory, setUploadCategory] = useState('gas');
  const [isUploading, setIsUploading] = useState(false);

  const toggleConnection = (id: string) => {
    setIntegrations(prev => prev.map(item => 
      item.id === id ? { ...item, status: item.status === 'connected' ? 'disconnected' : 'connected' } : item
    ));
  };

  const handleMockUpload = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      alert('Content successfully added to resource hub.');
    }, 1500);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header Section */}
      <div className="bg-black text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
        <div className="absolute bottom-0 right-0 w-32 h-32 bg-[#FFD700]/10 rounded-full -mr-16 -mb-16 blur-3xl"></div>
        <div className="relative z-10">
          <h2 className="text-2xl font-black uppercase tracking-tighter mb-1">Data Resource Hub</h2>
          <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.3em]">Sync. Store. Analyze.</p>
        </div>
      </div>

      {/* Data Management Section */}
      <section className="space-y-4">
        <div className="flex justify-between items-center px-2">
          <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">Data Management</h3>
          <span className="text-[9px] font-black text-[#FFD700] uppercase tracking-widest">Quick Access</span>
        </div>

        <button
          onClick={() => onNavigate?.('routes_management')}
          className="w-full bg-white p-6 rounded-3xl border border-gray-100 flex items-center justify-between group hover:border-black transition-all active:scale-95"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl bg-black text-[#FFD700] shadow-xl transition-colors">
              <i className="fas fa-route font-black"></i>
            </div>
            <div className="text-left">
              <h4 className="font-black text-sm uppercase tracking-tight">Routes & Stores</h4>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Manage territories & locations
              </p>
            </div>
          </div>
          <i className="fas fa-chevron-right text-gray-400 group-hover:text-black transition-colors"></i>
        </button>
      </section>

      {/* API Integrations */}
      <section className="space-y-4">
        <div className="flex justify-between items-center px-2">
          <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">Cloud Sync</h3>
          <span className="text-[9px] font-black text-[#FFD700] uppercase tracking-widest">3 Platforms</span>
        </div>
        
        <div className="grid grid-cols-1 gap-3">
          {integrations.map((app) => (
            <div key={app.id} className="bg-white p-5 rounded-3xl border border-gray-100 flex items-center justify-between group hover:border-black transition-all">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl bg-gray-50 text-black group-hover:bg-black group-hover:text-[#FFD700] transition-colors">
                  <i className={`fab ${app.icon} font-black`}></i>
                </div>
                <div>
                  <h4 className="font-black text-sm uppercase tracking-tight">{app.name}</h4>
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${app.status === 'connected' ? 'text-[#FFD700]' : 'text-gray-300'}`}>
                    {app.status}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => toggleConnection(app.id)}
                className={`px-6 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                  app.status === 'connected' 
                  ? 'bg-gray-50 text-gray-400 hover:bg-gray-100' 
                  : 'bg-black text-[#FFD700] shadow-lg shadow-black/10 active:scale-95'
                }`}
              >
                {app.status === 'connected' ? 'Disconnect' : 'Connect'}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* CSV Upload Section - Business Owners Only */}
      <section className="space-y-4">
        <div className="flex justify-between items-center px-2">
          <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">Data Import</h3>
          <span className="text-[9px] font-black text-[#FFD700] uppercase tracking-widest">CSV Upload</span>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <CSVUploader
            type="products"
            title="Import Products"
            description="Upload product catalog from CSV"
            icon="fa-boxes-stacked"
          />
          <CSVUploader
            type="routes"
            title="Import Routes"
            description="Upload route territories from CSV"
            icon="fa-route"
          />
          <CSVUploader
            type="stores"
            title="Import Stores"
            description="Upload store locations from CSV"
            icon="fa-store"
          />
        </div>
      </section>

      {/* Manual Resource Upload */}
      <section className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#FFD700] flex items-center justify-center text-black shadow-lg">
            <i className="fas fa-file-arrow-up text-sm"></i>
          </div>
          <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">Manual Upload</h3>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">Resource Category</label>
            <select 
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value)}
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-xs uppercase tracking-widest focus:ring-2 focus:ring-[#FFD700] outline-none"
            >
              <option value="gas">Gas Receipts</option>
              <option value="stale">Stale Products Report</option>
              <option value="sales">Sales Invoice</option>
              <option value="maintenance">Fleet Maintenance Receipt</option>
              <option value="other">General Business Doc</option>
            </select>
          </div>

          <div 
            className="border-2 border-dashed border-gray-100 rounded-[2rem] p-8 text-center hover:border-[#FFD700] hover:bg-gray-50 transition-all cursor-pointer group"
            onClick={handleMockUpload}
          >
            {isUploading ? (
              <div className="space-y-3">
                <i className="fas fa-spinner fa-spin text-2xl text-[#FFD700]"></i>
                <p className="text-[9px] font-black text-black uppercase tracking-widest">Processing...</p>
              </div>
            ) : (
              <div className="space-y-3">
                <i className="fas fa-cloud-arrow-up text-2xl text-gray-200 group-hover:text-[#FFD700] transition-colors"></i>
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Tap to Upload Receipt or Photo</p>
                <p className="text-[8px] font-bold text-gray-300 uppercase">PDF, JPG, PNG (Max 10MB)</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Recent Resources */}
      <section className="space-y-3 pb-6">
        <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em] px-2">Recent Archives</h3>
        <div className="space-y-3">
          <ActivityItem icon="fa-gas-pump" title="Shell Gas Receipt" date="Today, 9:41 AM" category="Expense" />
          <ActivityItem icon="fa-bread-slice" title="Stale Return Log" date="Yesterday, 4:20 PM" category="Inventory" />
          <ActivityItem icon="fa-file-invoice" title="Walmart #120 Invoice" date="June 22, 2024" category="Sales" />
        </div>
      </section>
    </div>
  );
};

const ActivityItem: React.FC<{ icon: string, title: string, date: string, category: string }> = ({ icon, title, date, category }) => (
  <div className="bg-white p-5 rounded-3xl border border-gray-50 flex items-center justify-between group hover:border-black transition-all">
    <div className="flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-black group-hover:bg-[#FFD700]">
        <i className={`fas ${icon} text-sm`}></i>
      </div>
      <div>
        <h4 className="font-black text-xs uppercase tracking-tight">{title}</h4>
        <p className="text-[9px] font-bold text-gray-400 mt-0.5">{date}</p>
      </div>
    </div>
    <span className="text-[8px] font-black bg-gray-100 px-3 py-1 rounded-full uppercase tracking-widest text-gray-500">{category}</span>
  </div>
);
