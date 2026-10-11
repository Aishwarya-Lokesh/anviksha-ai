"use client";

import { Sidebar, NavItem } from "@/components/layout/Sidebar";
import { AuthGuard } from "@/components/ui/AuthGuard";

/**
 * The one frame every role's portal renders inside: auth check, navigation
 * (sidebar on desktop, bottom bar + drawer below `lg`) and the content column.
 * The bottom padding keeps page content clear of the mobile bottom bar.
 */
export function AppShell({
  role,
  roleLabel,
  navItems,
  userName,
  userMeta,
  children,
}: {
  role: string;
  roleLabel: string;
  navItems: NavItem[];
  userName: string;
  userMeta: string;
  children: React.ReactNode;
}) {
  return (
    <AuthGuard requiredRole={role}>
      <div className="flex bg-surface min-h-screen">
        <Sidebar navItems={navItems} userName={userName} userMeta={userMeta} roleLabel={roleLabel} />
        <div className="flex-1 min-w-0 pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0">{children}</div>
      </div>
    </AuthGuard>
  );
}
