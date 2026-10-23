import React from 'react';

/**
 * Live transfer speed derived from successive `received` values (the store
 * pushes a snapshot roughly every 250 ms). Smoothed with an exponential
 * moving average; resets when `resetKey` (the transfer id) changes.
 */
export function useByteRate(received: number, resetKey: string | undefined): number {
  const sample = React.useRef<{ key: string | undefined; bytes: number; at: number } | null>(null);
  const [rate, setRate] = React.useState(0);

  React.useEffect(() => {
    const now = Date.now();
    const previous = sample.current;

    if (!previous || previous.key !== resetKey || received < previous.bytes) {
      sample.current = { key: resetKey, bytes: received, at: now };
      setRate(0);
      return;
    }

    const elapsed = (now - previous.at) / 1000;

    if (elapsed < 0.2) {
      return;
    }

    const instant = (received - previous.bytes) / elapsed;
    sample.current = { key: resetKey, bytes: received, at: now };
    setRate(current => (current > 0 ? current * 0.7 + instant * 0.3 : instant));
  }, [received, resetKey]);

  // A stalled peer sends no new bytes, so the effect above stops running:
  // decay the rate to zero instead of showing the last speed forever.
  React.useEffect(() => {
    const timer = setInterval(() => {
      const last = sample.current;

      if (last && Date.now() - last.at > 1500) {
        setRate(current => (current === 0 ? current : 0));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return rate;
}
