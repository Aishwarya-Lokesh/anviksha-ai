"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Filters kept in the address bar, so a filtered view can be bookmarked,
 * shared, or returned to with the browser's back button.
 * `set({ batch: "2023", page: null })` writes one value and clears another.
 */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = (changes: Record<string, string | null | undefined>) => {
    // Read the address as it is right now: two changes made close together must
    // not undo each other by starting from an older copy.
    const next = new URLSearchParams(typeof window === "undefined" ? params.toString() : window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return [params, set] as const;
}
