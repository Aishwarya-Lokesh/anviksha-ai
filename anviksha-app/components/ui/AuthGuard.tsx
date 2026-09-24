"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated, getRole } from "@/lib/api";

/**
 * Wrap any role's layout with this. If there's no active login token, or the
 * logged-in role doesn't match this portal, it redirects to /login instead of
 * silently letting the dashboard fall through to mock data.
 */
export function AuthGuard({ requiredRole, children }: { requiredRole: string; children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isAuthenticated() || getRole() !== requiredRole) {
      router.replace("/login");
      return;
    }
    setChecked(true);
  }, [requiredRole, router]);

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
