import React from 'react';

interface LoadingSkeletonProps {
  variant?: 'card' | 'list' | 'table' | 'text';
  count?: number;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({ variant = 'card', count = 3 }) => {
  const renderSkeleton = () => {
    switch (variant) {
      case 'card':
        return (
          <div className="space-y-5 animate-pulse">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="bg-white rounded-[2.5rem] p-7 shadow-sm border border-gray-100">
                <div className="flex items-center gap-5 mb-5">
                  <div className="w-14 h-14 bg-gray-200 rounded-2xl"></div>
                  <div className="flex-1">
                    <div className="h-5 bg-gray-200 rounded-xl w-1/3 mb-2"></div>
                    <div className="h-3 bg-gray-100 rounded-lg w-1/2"></div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-3 bg-gray-100 rounded-lg w-full"></div>
                  <div className="h-3 bg-gray-100 rounded-lg w-5/6"></div>
                </div>
              </div>
            ))}
          </div>
        );

      case 'list':
        return (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="bg-white rounded-3xl p-5 border border-gray-100 flex items-center gap-4">
                <div className="w-10 h-10 bg-gray-200 rounded-xl"></div>
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded-lg w-1/4 mb-2"></div>
                  <div className="h-3 bg-gray-100 rounded-lg w-1/3"></div>
                </div>
                <div className="w-16 h-8 bg-gray-200 rounded-lg"></div>
              </div>
            ))}
          </div>
        );

      case 'table':
        return (
          <div className="space-y-2 animate-pulse">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="bg-gray-50 rounded-2xl p-4 flex justify-between items-center">
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded-lg w-1/3 mb-2"></div>
                  <div className="h-3 bg-gray-100 rounded-lg w-1/2"></div>
                </div>
                <div className="w-12 h-8 bg-gray-200 rounded-lg"></div>
              </div>
            ))}
          </div>
        );

      case 'text':
        return (
          <div className="space-y-2 animate-pulse">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="h-4 bg-gray-200 rounded-lg w-full"></div>
            ))}
          </div>
        );

      default:
        return null;
    }
  };

  return <div className="animate-in fade-in duration-300">{renderSkeleton()}</div>;
};

// Specific skeleton variants for different components
export const ProductCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-[2.5rem] p-7 shadow-sm border border-gray-100 animate-pulse">
    <div className="flex justify-between items-start mb-6">
      <div className="flex items-center gap-5">
        <div className="w-16 h-16 bg-gray-200 rounded-3xl"></div>
        <div>
          <div className="h-6 bg-gray-200 rounded-xl w-32 mb-2"></div>
          <div className="h-3 bg-gray-100 rounded-lg w-24"></div>
        </div>
      </div>
      <div className="w-20 h-8 bg-gray-200 rounded-full"></div>
    </div>
    <div className="grid grid-cols-2 gap-4">
      <div className="h-12 bg-gray-100 rounded-2xl"></div>
      <div className="h-12 bg-gray-100 rounded-2xl"></div>
    </div>
  </div>
);

export const EmployeeCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-[2.5rem] p-7 shadow-sm border border-gray-100 animate-pulse">
    <div className="flex justify-between items-center mb-5">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 bg-gray-200 rounded-2xl"></div>
        <div>
          <div className="h-5 bg-gray-200 rounded-xl w-32 mb-2"></div>
          <div className="h-3 bg-gray-100 rounded-lg w-20"></div>
        </div>
      </div>
      <div className="w-16 h-6 bg-gray-200 rounded-full"></div>
    </div>
    <div className="space-y-3">
      <div className="h-2 bg-gray-100 rounded-full w-full"></div>
      <div className="grid grid-cols-3 gap-3">
        <div className="h-8 bg-gray-100 rounded-xl"></div>
        <div className="h-8 bg-gray-100 rounded-xl"></div>
        <div className="h-8 bg-gray-100 rounded-xl"></div>
      </div>
    </div>
  </div>
);

export const TruckCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-[2.5rem] p-7 shadow-sm border border-gray-100 animate-pulse">
    <div className="flex justify-between items-center mb-6">
      <div className="flex items-center gap-5">
        <div className="w-14 h-14 bg-gray-200 rounded-3xl"></div>
        <div>
          <div className="h-6 bg-gray-200 rounded-xl w-28 mb-2"></div>
          <div className="h-3 bg-gray-100 rounded-lg w-36"></div>
        </div>
      </div>
      <div className="w-16 h-7 bg-gray-200 rounded-full"></div>
    </div>
    <div className="flex gap-4 mb-4">
      <div className="h-4 bg-gray-100 rounded-lg w-20"></div>
      <div className="h-4 bg-gray-100 rounded-lg w-20"></div>
    </div>
  </div>
);
