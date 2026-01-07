import React, { useEffect } from 'react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false
}) => {
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  // Add Enter key handler for quick confirm
  useEffect(() => {
    const handleEnter = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && isOpen && !e.repeat) {
        handleConfirm();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEnter);
    }

    return () => {
      document.removeEventListener('keydown', handleEnter);
    };
  }, [isOpen, onConfirm]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="sm">
      <div className="space-y-6">
        <p className="text-sm font-bold text-gray-700 leading-relaxed" role="alert">
          {message}
        </p>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-4 bg-gray-50 text-black font-black uppercase tracking-widest text-xs rounded-2xl border border-gray-200 hover:bg-gray-100 transition-all active:scale-95"
            aria-label={`Cancel ${title.toLowerCase()}`}
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            className={`flex-1 py-4 font-black uppercase tracking-widest text-xs rounded-2xl transition-all shadow-xl active:scale-95 ${
              danger
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-black hover:bg-gray-900 text-[#FFD700]'
            }`}
            aria-label={`${confirmText} ${title.toLowerCase()}`}
          >
            {confirmText}
          </button>
        </div>

        {/* Keyboard hint */}
        <p className="text-[9px] text-gray-400 text-center uppercase tracking-widest font-black">
          Press Enter to confirm • ESC to cancel
        </p>
      </div>
    </Modal>
  );
};
