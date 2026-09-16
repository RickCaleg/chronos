import { useEffect, useState } from "react";
import { durationBetween, nowIso } from "../lib/time";

/** Ticks once a second while `startTime` is set, returning elapsed seconds since then. */
export function useLiveElapsed(startTime: string | null | undefined): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startTime) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(durationBetween(startTime, nowIso()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);

  return elapsed;
}
