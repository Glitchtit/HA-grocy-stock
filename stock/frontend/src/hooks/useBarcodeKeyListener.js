import { useEffect, useRef } from 'react';
import { createScanState, feedKey, flushIdle, DEFAULTS } from '../lib/scanDetector';

// Without a terminator we can't be sure a burst is complete, so require a
// longer run before flushing — a Bluetooth latency spike mid-scan must not
// flush a truncated (wrong) barcode. Most real barcodes are >= 8 digits.
const NO_TERMINATOR_MIN_LEN = 8;

// Listens at the document level for a HID barcode scanner's keystroke burst and
// calls `onScan(barcode)` when one completes. Pass `enabled: false` to detach
// (e.g. while the camera scanner owns input). The listener is capture-phase so
// it can suppress burst keys before they reach a focused input.
export function useBarcodeKeyListener(onScan, { enabled = true } = {}) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const stateRef = useRef(createScanState());
  const idleTimerRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;

    const clearIdle = () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };

    const handler = (e) => {
      // Chorded keys (Ctrl/Meta/Alt + key) are never scanner output.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const scan = feedKey(stateRef.current, { key: e.key, time: e.timeStamp });

      // Suppress keys that are part of a CONFIRMED scanner burst so they don't
      // land in (or submit) a focused field. The buffer only holds a contiguous
      // run of fast (<= maxInterKeyMs) keystrokes — feedKey resets it on any
      // human-speed gap — so requiring minLen of them avoids eating characters
      // from ordinary fast typing. The terminating Enter is suppressed only when
      // it actually completed a scan.
      if (scan != null || stateRef.current.buffer.length >= DEFAULTS.minLen) {
        e.preventDefault();
      }

      clearIdle();
      if (scan) {
        onScanRef.current(scan);
        return;
      }
      // No-terminator fallback: flush a complete-looking burst after a pause.
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        const late = flushIdle(stateRef.current, { minLen: NO_TERMINATOR_MIN_LEN });
        if (late) onScanRef.current(late);
      }, DEFAULTS.flushIdleMs);
    };

    document.addEventListener('keydown', handler, true);
    return () => {
      document.removeEventListener('keydown', handler, true);
      clearIdle();
    };
  }, [enabled]);
}
