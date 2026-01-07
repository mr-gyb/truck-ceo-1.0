import React from 'react';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedFeatureProps {
  requiredRole: 'business_owner' | 'team_member';
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const ProtectedFeature: React.FC<ProtectedFeatureProps> = ({
  requiredRole,
  children,
  fallback = null
}) => {
  const { userProfile } = useAuth();

  if (userProfile?.role !== requiredRole) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
