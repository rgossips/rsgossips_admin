"use client";

import { createContext, useContext } from "react";

export type AdminRole = "super_admin" | "admin" | "viewer" | null;

interface RoleContextValue {
  role: AdminRole;
  isViewer: boolean;
  isAdmin: boolean;       // admin OR super_admin (covers day-to-day writes)
  isSuperAdmin: boolean;  // only super_admin
}

const RoleContext = createContext<RoleContextValue>({
  role: null,
  isViewer: false,
  isAdmin: false,
  isSuperAdmin: false,
});

export function RoleProvider({
  role,
  children,
}: {
  role: AdminRole;
  children: React.ReactNode;
}) {
  const value: RoleContextValue = {
    role,
    isViewer: role === "viewer",
    isAdmin: role === "admin" || role === "super_admin",
    isSuperAdmin: role === "super_admin",
  };
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

// Read the current admin's role and convenient booleans from any client
// component nested under the dashboard layout. Use to gate buttons and
// other write-affordances away from viewer-only users.
export function useRole() {
  return useContext(RoleContext);
}

// Wraps children that should only render for admin / super_admin users.
// Viewers see nothing — server actions also gate, this just trims the UI.
export function AdminOnly({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const { isAdmin } = useRole();
  if (!isAdmin) return fallback ? <>{fallback}</> : null;
  return <>{children}</>;
}

export function SuperAdminOnly({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const { isSuperAdmin } = useRole();
  if (!isSuperAdmin) return fallback ? <>{fallback}</> : null;
  return <>{children}</>;
}
