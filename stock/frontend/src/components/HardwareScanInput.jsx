import { useEffect, useRef } from 'react';

// Captures input from a Bluetooth (HID) barcode scanner without ever raising
// Android's on-screen keyboard.
//
// The scanner is a HID keyboard, and Android WebViews only deliver hardware-key
// events reliably to a FOCUSED element — a document-level listener drops them.
// But a normal focused text input pops the soft keyboard. The fix: a focused
// `readOnly` input. readOnly suppresses the on-screen keyboard, yet the focused
// element still receives `keydown` for every physical key, so we assemble the
// barcode ourselves and emit it on the scanner's Enter terminator (CR&LF).
//
// While mounted it keeps itself focused so no scan is missed, but never steals
// focus from a real input/textarea the user is typing in.
export function HardwareScanInput({ onScan }) {
  const ref = useRef(null);
  const bufferRef = useRef('');
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const focusSelf = () => {
      const ae = document.activeElement;
      const tag = ae?.tagName;
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || ae?.isContentEditable;
      // Refocus self, but don't grab focus from a field the user is editing.
      if (ae === el || !editable) el.focus({ preventScroll: true });
    };

    focusSelf();
    const onFocusOut = () => setTimeout(focusSelf, 0);
    document.addEventListener('focusout', onFocusOut);
    return () => document.removeEventListener('focusout', onFocusOut);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = bufferRef.current.trim();
      bufferRef.current = '';
      if (code) onScanRef.current(code);
    } else if (e.key === 'Backspace') {
      bufferRef.current = bufferRef.current.slice(0, -1);
    } else if (e.key.length === 1) {
      // A single printable character — part of the barcode.
      bufferRef.current += e.key;
    }
    // Ignore everything else (Shift, Tab, arrows, …).
  };

  return (
    <input
      ref={ref}
      type="text"
      readOnly
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
