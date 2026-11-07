import React, { useState } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
import { useAuth } from '../contexts/AuthContext';
import { storage } from '../services/firebaseConfig';

/**
 * Flowers IDP settlement upload (owner-only).
 *
 * Drops portal PDFs (Master / Distributor Statements, Customer Margin
 * Detail, SBT Shrink reports) into
 *   businesses/{bid}/settlement-uploads/{fileName}
 * where the onSettlementUpload backend function picks them up: extract ->
 * parse -> reconcile -> settlement/shrink/margin records + ingestion
 * registry. Parsing is server-side and asynchronous — this component only
 * confirms the upload landed; validated results appear in the route's
 * records, and anything that fails reconciliation is queued for review
 * (it never silently disappears).
 */
export const SettlementUploader: React.FC = () => {
  const { userProfile } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = event.target.files ? Array.from(event.target.files) : [];
    if (!files.length || !userProfile?.businessId) return;

    setUploading(true);
    setMessage('');

    try {
      let uploaded = 0;
      for (const file of files) {
        if (!/\.pdf$/i.test(file.name)) continue;
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storageRef = ref(
          storage,
          `businesses/${userProfile.businessId}/settlement-uploads/${safeName}`
        );
        await uploadBytes(storageRef, file);
        uploaded++;
      }
      if (uploaded === 0) {
        setMessage('No PDF files were selected — settlement uploads must be PDFs.');
        setMessageType('error');
      } else {
        setMessage(
          `${uploaded} PDF${uploaded === 1 ? '' : 's'} uploaded. Parsing runs automatically — ` +
            'validated statements populate each route\u2019s settlement records; anything that ' +
            'doesn\u2019t reconcile is queued for review.'
        );
        setMessageType('success');
      }
    } catch (error) {
      console.error('Settlement upload error:', error);
      setMessage('Upload failed — check your connection and try again.');
      setMessageType('error');
    }

    setUploading(false);
    // Clear the input so the same files can be uploaded again
    event.target.value = '';
  };

  if (userProfile?.role !== 'business_owner') {
    return null; // Only business owners can upload settlements
  }

  return (
    <div className="bg-white p-6 rounded-3xl border-2 border-gray-100 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-black rounded-2xl flex items-center justify-center text-[#FFD700]">
          <i className="fas fa-file-invoice-dollar text-lg"></i>
        </div>
        <div>
          <h3 className="font-black text-sm uppercase tracking-tight">Flowers Settlements</h3>
          <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">
            Upload IDP statement PDFs — parsed automatically
          </p>
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
            accept=".pdf"
            multiple
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
                {uploading ? 'Uploading...' : 'Click to Upload PDFs'}
              </p>
              <p className="text-[9px] text-gray-400 font-bold mt-1">
                Master &amp; route statements, margin detail, shrink reports
              </p>
            </div>
          </div>
        </div>
      </label>

      {uploading && (
        <div className="mt-4 flex items-center gap-3 p-3 bg-gray-50 rounded-2xl">
          <i className="fas fa-spinner fa-spin text-[#FFD700]"></i>
          <div>
            <p className="text-xs font-black uppercase tracking-tight text-gray-700">Uploading...</p>
            <p className="text-[9px] text-gray-400 font-bold">Parsing continues in the background</p>
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
    </div>
  );
};
