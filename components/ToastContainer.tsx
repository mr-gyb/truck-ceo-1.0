import React from 'react';
import { Toast } from '../hooks/useToast';

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: number) => void;
}

const ToastItem: React.FC<{ toast: Toast; onRemove: (id: number) => void }> = React.memo(({ toast, onRemove }) => (
  <div
    role="alert"
    aria-live="polite"
    className={`p-4 rounded-2xl shadow-2xl flex items-center justify-between gap-3 animate-in slide-in-from-top-2 fade-in duration-300 ${
      toast.type === 'success'
        ? 'bg-black text-[#FFD700] border-2 border-[#FFD700]'
        : 'bg-red-600 text-white'
    }`}
  >
    <div className="flex items-center gap-3">
      <i
        className={`fas ${toast.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'} text-xl`}
        aria-hidden="true"
      ></i>
      <span className="font-bold text-sm">{toast.message}</span>
    </div>
    <button
      onClick={() => onRemove(toast.id)}
      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors active:scale-95"
      aria-label="Dismiss notification"
    >
      <i className="fas fa-times" aria-hidden="true"></i>
    </button>
  </div>
));

ToastItem.displayName = 'ToastItem';

export const ToastContainer: React.FC<ToastContainerProps> = React.memo(({ toasts, onRemove }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-24 right-4 z-[110] space-y-3 max-w-sm"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
});

ToastContainer.displayName = 'ToastContainer';
