"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Compass, ArrowLeft } from "lucide-react";
import { getRole, isAuthenticated } from "@/lib/api";

const ROLES = ["student", "teacher", "hod", "admin"];

export default function NotFound() {
  // Signed-in users go back to their own dashboard; everyone else to the start page.
  const [home, setHome] = useState("/");

  useEffect(() => {
    const role = getRole();
    if (isAuthenticated() && role && ROLES.includes(role)) setHome(`/${role}`);
  }, []);

  return (
    <main className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-card p-8 w-full max-w-md text-center">
        <div className="w-14 h-14 rounded-2xl bg-brand-light flex items-center justify-center mx-auto mb-4">
          <Compass size={26} className="text-brand" />
        </div>
        <p className="text-xs font-semibold text-brand tracking-widest mb-1">404</p>
        <h1 className="text-xl font-display font-bold text-ink mb-2">This page doesn't exist</h1>
        <p className="text-sm text-muted mb-6">
          The link may be out of date, or the page may have moved.
        </p>
        <Link
          href={home}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-dark transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
        >
          <ArrowLeft size={15} /> {home === "/" ? "Back to start" : "Back to dashboard"}
        </Link>
      </div>
    </main>
  );
}
