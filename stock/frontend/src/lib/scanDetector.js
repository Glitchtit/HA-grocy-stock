// Pure state machine that recognises a HID barcode scanner's signature in a
// stream of keydown events. No DOM, no React — testable.
//
// A scanner types a barcode far faster than a human and (with the default
// CR&LF terminator) ends with a single 'Enter' keydown. We classify a buffered
// run as a scan by its AVERAGE inter-key interval, NOT by resetting on any one
// gap — Bluetooth HID links jitter and can stall >50ms mid-barcode, so a
// per-gap reset would split one scan into pieces (e.g. 5711953182419 captured
// as its tail 53182419). The terminator delimits; timing only classifies.

export const DEFAULTS = {
  maxAvgIntervalMs: 80,   // average gap must be <= this to count as a scan
  minLen: 4,              // shortest accepted barcode (terminated path)
  noTerminatorMinLen: 8,  // shortest accepted barcode for the idle-flush path
  sessionGapMs: 500,      // a single gap > this starts a fresh input session
  flushIdleMs: 500,       // hook idle-flush delay; >= sessionGapMs so it cannot
                          // fire mid-barcode even on a jittery BT link
};

export function createScanState() {
  return { buffer: '', firstTime: null, lastTime: null };
}

function reset(state) {
  state.buffer = '';
  state.firstTime = null;
  state.lastTime = null;
}

// Average interval between the buffered keystrokes (Infinity for < 2 chars).
function avgInterval(state) {
  if (state.buffer.length < 2) return Infinity;
  return (state.lastTime - state.firstTime) / (state.buffer.length - 1);
}

// Feed one keydown. Returns the decoded barcode when Enter completes a valid
// scan, otherwise null. Mutates `state` in place (cheap; held in a ref).
export function feedKey(state, { key, time }, opts = {}) {
  const { maxAvgIntervalMs, minLen, sessionGapMs } = { ...DEFAULTS, ...opts };

  if (key === 'Enter') {
    const isScan =
      state.buffer.length >= minLen && avgInterval(state) <= maxAvgIntervalMs;
    const scan = isScan ? state.buffer : null;
    reset(state);
    return scan;
  }

  // Only single printable characters extend a burst; anything else (Shift,
  // Tab, Arrow…) breaks it.
  if (key.length !== 1) {
    reset(state);
    return null;
  }

  const gap = state.lastTime == null ? null : time - state.lastTime;
  if (gap != null && gap > sessionGapMs) {
    // Too long to be the same scan — this starts a fresh input session.
    state.buffer = key;
    state.firstTime = time;
    state.lastTime = time;
  } else {
    if (state.buffer.length === 0) state.firstTime = time;
    state.buffer += key;
    state.lastTime = time;
  }
  return null;
}

// Called from an idle timer when no terminator arrived: decode a complete-
// looking, fast-enough burst. Requires a longer run than the terminated path
// so a stalled BT link can't flush a truncated (wrong) barcode.
export function flushIdle(state, opts = {}) {
  const { maxAvgIntervalMs, noTerminatorMinLen } = { ...DEFAULTS, ...opts };
  const isScan =
    state.buffer.length >= noTerminatorMinLen &&
    avgInterval(state) <= maxAvgIntervalMs;
  const scan = isScan ? state.buffer : null;
  reset(state);
  return scan;
}

// Real-time check used for keystroke suppression: does the run so far look like
// a scanner burst (enough fast chars)? Does not mutate state.
export function looksLikeScan(state, opts = {}) {
  const { maxAvgIntervalMs, minLen } = { ...DEFAULTS, ...opts };
  return state.buffer.length >= minLen && avgInterval(state) <= maxAvgIntervalMs;
}
