"use client";

import { Sidebar, NavItem } from "@/components/layout/Sidebar";
import { CommandPalette, QuickAction } from "@/components/layout/CommandPalette";
import { AuthGuard } from "@/components/ui/AuthGuard";
import { API_BASE } from "@/lib/api";
import { useProfile } from "@/lib/useProfile";

/**
 * The one frame every role's portal renders inside: auth check, navigation
 * (sidebar on desktop, bottom bar + drawer below `lg`), the search palette and
 * the content column. The bottom padding keeps page content clear of the
 * mobile bottom bar.
 */
export function AppShell({
  role,
  roleLabel,
  navItems,
  quickActions = [],
  children,
}: {
  role: string;
  roleLabel: string;
  navItems: NavItem[];
  quickActions?: QuickAction[];
  children: React.ReactNode;
}) {
  return (
    <AuthGuard requiredRole={role}>
      <Frame role={role} roleLabel={roleLabel} navItems={navItems} quickActions={quickActions}>{children}</Frame>
    </AuthGuard>
  );
}

// Separate component so the profile is only requested once the visitor is
// known to be signed in with the right role.
function Frame({ role, roleLabel, navItems, quickActions, children }: {
  role: string; roleLabel: string; navItems: NavItem[]; quickActions: QuickAction[]; children: React.ReactNode;
}) {
  const profile = useProfile();
  return (
    <div className="flex bg-surface min-h-screen">
      <Sidebar
        navItems={navItems}
        userName={profile?.name || roleLabel}
        userMeta={profile?.subtitle || ""}
        photoUrl={profile?.photo_url ? `${API_BASE}${profile.photo_url}` : null}
        roleLabel={roleLabel}
      />
      <div className="flex-1 min-w-0 pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0">{children}</div>
      <CommandPalette role={role} navItems={navItems} quickActions={quickActions} />
    </div>
  );
}
