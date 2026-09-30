import React from 'react';

interface SetupCompleteModalProps {
  isOpen: boolean;
  routeCount: number;
  truckCount: number;
  teamCount: number;
  businessName?: string;
  onClose: () => void;
}

/**
 * Confirmation shown when the AI-guided setup interview finishes.
 * The owner asked for an explicit "thank you / your data was saved"
 * moment — previously setup just ended silently and dropped them back
 * at the start with no confirmation.
 */
export const SetupCompleteModal: React.FC<SetupCompleteModalProps> = ({
  isOpen,
  routeCount,
  truckCount,
  teamCount,
  businessName,
  onClose,
}) => {
  if (!isOpen) return null;

  const stats = [
    { n: routeCount, label: routeCount === 1 ? 'Route' : 'Routes' },
    { n: truckCount, label: truckCount === 1 ? 'Truck' : 'Trucks' },
    { n: teamCount, label: teamCount === 1 ? 'Team member' : 'Team members' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-[2rem] shadow-2xl max-w-md w-full p-8 text-center space-y-5 animate-in">
        <div className="w-20 h-20 bg-green-500 rounded-[1.8rem] flex items-center justify-center mx-auto shadow-xl">
          <i className="fas fa-check text-white text-3xl"></i>
        </div>
        <div>
          <h3 className="text-2xl font-black uppercase tracking-tight">
            You&apos;re all set!
          </h3>
          <p className="text-sm text-gray-500 font-bold leading-relaxed mt-2">
            Thank you — your information has been saved
            {businessName ? ` for ${businessName}` : ''}.
          </p>
        </div>
        <div className="flex justify-center gap-8 py-2">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-black text-black">{s.n}</div>
              <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                {s.label}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 font-bold leading-relaxed">
          You can change anything later by just chatting with the assistant,
          or use MENU → Setup guide for the step-by-step wizard.
        </p>
        <button
          onClick={onClose}
          className="w-full py-4 bg-[#FFD700] text-black font-black uppercase tracking-widest text-xs rounded-2xl shadow-xl active:scale-95 transition-all"
        >
          Start using TruckCEO <i className="fas fa-check ml-1"></i>
        </button>
      </div>
    </div>
  );
};
