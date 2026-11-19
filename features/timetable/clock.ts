"use client";

import { useEffect, useState } from "react";

/** The current time, null until the browser has mounted (so server and first client render agree), then refreshed every 30 seconds. */
export function useClock(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
