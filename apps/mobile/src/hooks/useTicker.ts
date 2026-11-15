import { useEffect, useState } from 'react';

/** Re-renders every `ms` so relative times ("3 min ago") stay fresh. */
export function useTicker(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
