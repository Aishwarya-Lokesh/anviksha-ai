"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One shared refresh strategy (Part D5) for every new HOD Department
 * Intelligence live section: polls on an interval, refetches when the tab
 * regains focus, pauses polling while the tab is hidden, and never does a
 * full page reload. Every consumer gets its own poller (each card polls its
 * own endpoint), but they all go through this one hook so the *behavior*
 * (interval, focus/visibility handling, "last updated" tracking) is defined
 * exactly once.
 */
export function useLiveRefresh<T>(fetcher: () => Promise<T>, intervalMs: number = 45000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, intervalMs);
    const onFocus = () => load();
    const onVisibility = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  return { data, error, loading, lastUpdated, refresh: load };
}

/** "Last updated Xs ago" — recomputed every tick, no extra fetch. */
export function useAgoLabel(lastUpdated: Date | null): string {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (!lastUpdated) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
  if (seconds < 5) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `Updated ${minutes}m ago`;
}
