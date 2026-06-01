import { useEffect, useRef } from 'react';

// A visually-hidden text input that a Bluetooth (HID) barcode scanner types
// into. This mirrors the one mechanism that reliably receives hardware-keyboard
// input in the Android WebView: a focused, editable element. A document-level
// keydown listener is NOT reliable there — keys are only delivered to a focused
// input — which is why earlier listener-based attempts dropped/truncated scans.
//
// `inputMode="none"` keeps Android's on-screen keyboard hidden while the
// physical scanner's keystrokes still land in the field. We read the value when
// the scanner sends its Enter terminator (default CR&LF), then clear it.
//
// While mounted the input keeps itself focused so no scan is missed, but it
// never steals focus from a real input/textarea the user is actually using.
export function HardwareScanInput({ onScan }) {
  const ref = useRef(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const focusSelf = () => {
      const ae = document.activeElement;
      const tag = ae?.tagName;
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || ae?.isContentEditable;
      // Don't grab focus away from a field the user is typing in.
      if (!editable || ae === el) el.focus({ preventScroll: true });
    };

    focusSelf();
    // Re-assert focus if it drifts (e.g. after a tap on a button or row).
    const onFocusOut = () => setTimeout(focusSelf, 0);
    document.addEventListener('focusout', onFocusOut);
    return () => document.removeEventListener('focusout', onFocusOut);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = (ref.current?.value || '').trim();
      if (ref.current) ref.current.value = '';
      if (code) onScanRef.current(code);
    }
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="none"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      aria-hidden="true"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      // Offscreen but focusable (display:none can't hold focus).
      style={{
        position: 'absolute',
        left: -9999,
        top: 0,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
