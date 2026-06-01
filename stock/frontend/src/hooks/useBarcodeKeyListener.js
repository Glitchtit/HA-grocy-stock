import { useEffect, useRef } from 'react';
import { createScanState, feedKey, flushIdle, looksLikeScan, DEFAULTS } from '../lib/scanDetector';

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

      // Suppress keys that belong to a burst that already looks like a scan
      // (enough fast keystrokes by average speed) so they don't land in — or
      // submit — a focused field. Ordinary typing stays below the average-speed
      // bar and is left untouched. The terminating Enter is suppressed only when
      // it actually completed a scan.
      if (scan != null || looksLikeScan(stateRef.current)) {
        e.preventDefault();
      }

      clearIdle();
      if (scan) {
        onScanRef.current(scan);
        return;
      }
      // No-terminator fallback: flush a complete-looking burst after a pause.
      // flushIdleMs is >= the detector's session gap, so this timer never fires
      // mid-barcode, even when a Bluetooth link stalls between characters.
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        const late = flushIdle(stateRef.current);
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
