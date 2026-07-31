"use client";

import { useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { BottomNav } from "@/components/mobile/bottom-nav";
import { RoleProvider, type AdminRole } from "@/components/role-context";

export function DashboardShell({
  userEmail,
  userName,
  role,
  children,
}: {
  userEmail: string;
  userName?: string;
  role: AdminRole;
  children: React.ReactNode;
}) {
  // Default CLOSED. On mobile the drawer starts hidden (collapsed=true →
  // -translate-x-full); on desktop the sidebar's `lg:translate-x-0` overrides
  // that so it's always visible. Deriving this from CSS (not a viewport read)
  // keeps SSR and first client paint identical — no hydration mismatch.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <RoleProvider role={role}>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <Sidebar
          userEmail={userEmail}
          userName={userName}
          collapsed={!sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className="lg:ml-[260px] transition-all duration-300">
          <Header
            userEmail={userEmail}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          />
          {/* pb-24 on mobile clears the fixed bottom-nav; desktop unchanged. */}
          <main className="p-6 pb-24 lg:pb-6">{children}</main>
          <BottomNav />
        </div>
      </div>
    </RoleProvider>
  );
}
