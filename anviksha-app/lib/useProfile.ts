"use client";

import { useEffect, useState } from "react";
import { api, isAuthenticated } from "@/lib/api";

export type Profile = {
  id: number;
  email: string;
  role: string;
  role_label: string;
  name: string;
  subtitle: string;
  photo_url: string | null;
  details: Record<string, any>;
  editable: string[];
};

// One copy for the whole app, so the sidebar, the top bar and the profile page
// always show the same name and photo, and a change shows up everywhere at once.
let cached: Profile | null = null;
let inFlight: Promise<Profile> | null = null;
const listeners = new Set<(p: Profile | null) => void>();

function publish(p: Profile | null) {
  cached = p;
  listeners.forEach((l) => l(p));
}

export function refreshProfile(): Promise<Profile | null> {
  if (!isAuthenticated()) return Promise.resolve(null);
  if (!inFlight) {
    inFlight = api.accountProfile().finally(() => { inFlight = null; });
  }
  return inFlight.then((p) => { publish(p); return p; }).catch(() => cached);
}

/** Call after signing out, so the next person never sees the last one's name. */
export function clearProfile() {
  publish(null);
}

export function useProfile(): Profile | null {
  const [profile, setProfile] = useState<Profile | null>(cached);
  useEffect(() => {
    listeners.add(setProfile);
    if (!cached) refreshProfile();
    else setProfile(cached);
    return () => { listeners.delete(setProfile); };
  }, []);
  return profile;
}
