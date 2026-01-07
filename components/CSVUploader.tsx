import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { CSVService, CSVType } from '../services/csvService';

interface CSVUploaderProps {
  type: CSVType;
  title: string;
  description?: string;
  icon?: string;
}

export const CSVUploader: React.FC<CSVUploaderProps> = ({ type, title, description, icon = 'fa-file-csv' }) => {
  const { userProfile } = useAuth();
  const { firestoreService, refetchAll } = useData();
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !userProfile?.businessId || !firestoreService) return;

    setUploading(true);
    setMessage('');

    const csvService = new CSVService(userProfile.businessId, firestoreService);
    const result = await csvService.uploadCSV(file, type);

    setMessage(result.message);
    setMessageType(result.success ? 'success' : 'error');
    setUploading(false);

    if (result.success) {
      // Refetch data to show new imports
      await refetchAll();
    }

    // Clear the input so the same file can be uploaded again
    event.target.value = '';
  };

  if (userProfile?.role !== 'business_owner') {
    return null; // Only business owners can upload CSV
  }

  return (
    <div className="bg-white p-6 rounded-3xl border-2 border-gray-100 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-black rounded-2xl flex items-center justify-center text-[#FFD700]">
          <i className={`fas ${icon} text-lg`}></i>
        </div>
        <div>
          <h3 className="font-black text-sm uppercase tracking-tight">{title}</h3>
          {description && (
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">
              {description}
            </p>
          )}
        </div>
      </div>

      <label className="block w-full cursor-pointer group">
        <div className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
          uploading
            ? 'border-gray-200 bg-gray-50'
            : 'border-gray-300 hover:border-[#FFD700] hover:bg-gray-50'
        }`}>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            disabled={uploading}
            className="hidden"
          />
          <div className="flex flex-col items-center gap-2">
            <i className={`fas fa-cloud-upload-alt text-2xl ${
              uploading ? 'text-gray-300' : 'text-gray-400 group-hover:text-[#FFD700]'
            } transition-colors`}></i>
            <div>
              <p className="text-xs font-black text-gray-700 uppercase tracking-tight">
                {uploading ? 'Uploading...' : 'Click to Upload CSV'}
              </p>
              <p className="text-[9px] text-gray-400 font-bold mt-1">
                CSV files only
              </p>
            </div>
          </div>
        </div>
      </label>

      {uploading && (
        <div className="mt-4 flex items-center gap-3 p-3 bg-gray-50 rounded-2xl">
          <i className="fas fa-spinner fa-spin text-[#FFD700]"></i>
          <div>
            <p className="text-xs font-black uppercase tracking-tight text-gray-700">Processing...</p>
            <p className="text-[9px] text-gray-400 font-bold">Parsing and importing data</p>
          </div>
        </div>
      )}

      {message && !uploading && (
        <div className={`mt-4 p-4 rounded-2xl ${
          messageType === 'success'
            ? 'bg-green-50 border-2 border-green-200'
            : 'bg-red-50 border-2 border-red-200'
        }`}>
          <div className="flex items-start gap-2">
            <i className={`fas ${
              messageType === 'success' ? 'fa-check-circle text-green-600' : 'fa-exclamation-circle text-red-600'
            } text-sm mt-0.5`}></i>
            <p className={`text-xs font-bold ${
              messageType === 'success' ? 'text-green-700' : 'text-red-700'
            }`}>
              {message}
            </p>
          </div>
        </div>
      )}

      {/* Format Guide */}
      <div className="mt-4 p-4 bg-gray-50 rounded-2xl">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">
          CSV Format Guide
        </p>
        <div className="text-[9px] font-mono text-gray-600">
          {type === 'products' && (
            <p>name, category, inventory, last_order</p>
          )}
          {type === 'routes' && (
            <p>route_name</p>
          )}
          {type === 'stores' && (
            <p>route_name, store_name, address</p>
          )}
        </div>
      </div>
    </div>
  );
};
