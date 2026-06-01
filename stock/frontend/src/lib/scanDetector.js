// Pure state machine that recognises a HID barcode scanner's signature in a
// stream of keydown events: a contiguous run of printable characters arriving
// faster than a human can type, terminated by Enter (CR/LF/CR&LF all surface
// as a single 'Enter' keydown in the browser). No DOM, no React — testable.

export const DEFAULTS = {
  maxInterKeyMs: 50, // gaps larger than this break the burst (human typing)
  minLen: 4,         // shortest accepted barcode
  flushIdleMs: 80,   // idle-flush fallback when the scanner sends no terminator
};

export function createScanState() {
  return { buffer: '', lastTime: null };
}

function reset(state) {
  state.buffer = '';
  state.lastTime = null;
}

// Feed one keydown. Returns the decoded barcode string when Enter completes a
// valid burst, otherwise null. Mutates `state` in place (cheap; held in a ref).
export function feedKey(state, { key, time }, opts = {}) {
  const { maxInterKeyMs, minLen } = { ...DEFAULTS, ...opts };

  if (key === 'Enter') {
    const scan = state.buffer.length >= minLen ? state.buffer : null;
    reset(state);
    return scan;
  }

  // Only single printable characters extend a burst; anything else (Shift,
  // Tab, Arrow…) breaks it.
  if (key.length !== 1) {
    reset(state);
    return null;
  }

  const gap = state.lastTime == null ? Infinity : time - state.lastTime;
  if (gap <= maxInterKeyMs && state.buffer.length > 0) {
    state.buffer += key;
  } else {
    // First char, or arrived too slowly → (re)start the burst with this char.
    // A scan's first digit always follows an idle gap, so it must be able to
    // begin a fresh burst rather than be discarded.
    state.buffer = key;
  }
  state.lastTime = time;
  return null;
}

// Called from an idle timer: if a complete-looking burst is sitting in the
// buffer with no terminator, decode it. Returns the barcode or null.
export function flushIdle(state, opts = {}) {
  const { minLen } = { ...DEFAULTS, ...opts };
  const scan = state.buffer.length >= minLen ? state.buffer : null;
  reset(state);
  return scan;
}
