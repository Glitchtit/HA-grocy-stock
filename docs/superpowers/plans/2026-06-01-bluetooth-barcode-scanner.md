# Bluetooth (HID) Barcode Scanner Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Bluetooth HID barcode scanner is in use, HA-stock bypasses the camera and shows a full-screen list-only scan overlay; idle scans (no overlay open) auto-open the shopping overlay and record the item.

**Architecture:** A pure keystroke state-machine (`scanDetector.js`) recognises the scanner's fast-burst-then-Enter signature. A React hook (`useBarcodeKeyListener`) wires `document` keydown to it and fires a routing callback in `App`. A persisted `hardwareScannerEnabled` toggle (auto-enabled on first detected scan) makes the three scan flows render `BarcodeScanner` in a new camera-less `listOnly` mode. The existing decode→lookup→add→discover pipeline is reused unchanged.

**Tech Stack:** React 18 + Vite, `html5-qrcode` (camera path, untouched), Node's built-in test runner (`node --test`) for the pure detector. All app code lives in `stock/frontend/src/`.

**Working directory for all commands:** `/home/glitch/GIT/HA-apps/HA-stock/stock/frontend`

---

### Task 1: Pure scan-detector state machine

A side-effect-free module that turns a stream of `keydown` events into decoded barcodes. No React, no DOM — fully unit-testable.

**Files:**
- Create: `src/lib/scanDetector.js`
- Test: `src/lib/scanDetector.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/scanDetector.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScanState, feedKey, flushIdle } from './scanDetector.js';

// Helper: feed a string as a fast scanner burst, return the scan (or null) at Enter.
function scanBurst(text, { gap = 5, startTime = 1000 } = {}) {
  const state = createScanState();
  let t = startTime;
  for (const ch of text) {
    feedKey(state, { key: ch, time: t });
    t += gap;
  }
  return feedKey(state, { key: 'Enter', time: t });
}

test('fast burst followed by Enter decodes the full barcode', () => {
  assert.equal(scanBurst('6411401234567'), '6411401234567');
});

test('slow human typing is not treated as a scan', () => {
  const state = createScanState();
  let t = 0;
  for (const ch of 'hello') {
    feedKey(state, { key: ch, time: t });
    t += 250; // 250ms gaps — human speed
  }
  assert.equal(feedKey(state, { key: 'Enter', time: t }), null);
});

test('a slow prefix char is discarded; only the fast burst after the gap counts', () => {
  const state = createScanState();
  feedKey(state, { key: 'a', time: 0 }); // lone slow char, then a 500ms gap
  let t = 500;
  for (const ch of '123456') {
    feedKey(state, { key: ch, time: t });
    t += 5;
  }
  assert.equal(feedKey(state, { key: 'Enter', time: t }), '123456');
});

test('a burst shorter than minLen is rejected', () => {
  assert.equal(scanBurst('12'), null);
});

test('a non-character key breaks the burst', () => {
  const state = createScanState();
  let t = 0;
  for (const ch of '123') { feedKey(state, { key: ch, time: t }); t += 5; }
  feedKey(state, { key: 'Shift', time: t }); // resets
  t += 5;
  for (const ch of '45') { feedKey(state, { key: ch, time: t }); t += 5; }
  assert.equal(feedKey(state, { key: 'Enter', time: t }), null); // only '45' left
});

test('flushIdle decodes a completed fast burst that never sent a terminator', () => {
  const state = createScanState();
  let t = 0;
  for (const ch of '6411401') { feedKey(state, { key: ch, time: t }); t += 5; }
  assert.equal(flushIdle(state), '6411401');
});

test('flushIdle returns null when the buffer is too short', () => {
  const state = createScanState();
  feedKey(state, { key: '1', time: 0 });
  assert.equal(flushIdle(state), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/scanDetector.test.js`
Expected: FAIL — `Cannot find module './scanDetector.js'` (module not created yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/scanDetector.js`:

```js
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
    // First char, or too slow → (re)start the burst with just this char.
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/scanDetector.test.js`
Expected: PASS — `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scanDetector.js src/lib/scanDetector.test.js
git commit -m "Add pure barcode-scan keystroke detector"
```

---

### Task 2: `useBarcodeKeyListener` hook

Wires `document` keydown to the detector, with an idle-flush fallback and burst suppression so scanner keystrokes don't leak into a focused field. No DOM test runner is configured (per repo CLAUDE.md), so this task is verified manually in Task 8.

**Files:**
- Create: `src/hooks/useBarcodeKeyListener.js`

- [ ] **Step 1: Write the hook**

Create `src/hooks/useBarcodeKeyListener.js`:

```js
import { useEffect, useRef } from 'react';
import { createScanState, feedKey, flushIdle, DEFAULTS } from '../lib/scanDetector';

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

      // Suppress keys that are part of a confirmed scanner burst so they don't
      // land in (or submit) a focused field: once two fast chars have
      // accumulated, and the terminating Enter when it completed a scan.
      if (scan != null || stateRef.current.buffer.length >= 2) e.preventDefault();

      clearIdle();
      if (scan) {
        onScanRef.current(scan);
        return;
      }
      // No-terminator fallback: flush a complete-looking burst after a pause.
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
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds with no errors referencing `useBarcodeKeyListener` or `scanDetector`. (The hook isn't wired in yet; this just confirms the module compiles.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBarcodeKeyListener.js
git commit -m "Add useBarcodeKeyListener hook (document keydown -> scan detector)"
```

---

### Task 3: Persisted `hardwareScannerEnabled` toggle state

The source of truth for "skip camera → list-only", persisted to localStorage and auto-enabled on first detection.

**Files:**
- Modify: `src/App.jsx` (state block, ~2891–2897)

- [ ] **Step 1: Add the state and a persisting setter**

In `src/App.jsx`, immediately after the `const [showRecentsSheet, setShowRecentsSheet] = useState(false);` line (~2897), add:

```jsx
  // Hardware (Bluetooth HID) barcode scanner. When true, the three scan flows
  // open camera-less list-only overlays and a document-level key listener
  // captures scans. Persisted; auto-enabled the first time a scan burst is
  // detected (see useBarcodeKeyListener wiring below).
  const [hardwareScannerEnabled, setHardwareScannerEnabledState] = useState(() => {
    try {
      return localStorage.getItem('stock.hardwareScanner') === '1';
    } catch {
      return false;
    }
  });
  const setHardwareScannerEnabled = useCallback((on) => {
    setHardwareScannerEnabledState(on);
    try {
      localStorage.setItem('stock.hardwareScanner', on ? '1' : '0');
    } catch {
      // private mode / quota — toggle just won't persist
    }
  }, []);
  // Per-session recents for the list-only "Add to shopping list" flow.
  const [shoppingListRecents, setShoppingListRecents] = useState([]);
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "Add persisted hardwareScannerEnabled toggle + shoppingListRecents state"
```

---

### Task 4: `listOnly` render mode for `BarcodeScanner`

When `listOnly` is true the component never initialises the camera and renders the full-screen scanned-items list instead, keeping Finish/Cancel.

**Files:**
- Modify: `src/App.jsx` — `BarcodeScanner` (~1072–1268)

- [ ] **Step 1: Add `listOnly` + `onAdjustRecent` props and guard the camera effect**

Change the `BarcodeScanner` signature (line ~1072) from:

```jsx
function BarcodeScanner({
  onScan,
  onClose,
  discoverQueueLength = 0,
  mode = 'single',
  title = 'Scan a barcode',
  recents = [],
  onShowAllRecents,
}) {
  const continuous = mode === 'continuous';
```

to:

```jsx
function BarcodeScanner({
  onScan,
  onClose,
  discoverQueueLength = 0,
  mode = 'single',
  title = 'Scan a barcode',
  recents = [],
  onShowAllRecents,
  listOnly = false,
  onAdjustRecent = null,
}) {
  const continuous = mode === 'continuous';
```

Then guard the camera `useEffect` — change its first line (line ~1097) from:

```jsx
  useEffect(() => {
    const container = document.getElementById('barcode-reader');
```

to:

```jsx
  useEffect(() => {
    if (listOnly) return undefined; // hardware scanner — no camera to start
    const container = document.getElementById('barcode-reader');
```

and change that effect's dependency array (line ~1161) from `}, [continuous]);` to `}, [continuous, listOnly]);`.

- [ ] **Step 2: Render the list-only layout**

Replace the contiguous region from the existing `const visibleRecents = recents.slice(0, 3);` line (~1177) through the end of the component's `return (...)` block (its closing `);` at ~1266) with the following. (This includes and replaces the old `const visibleRecents` declaration — do not leave a second copy.)

```jsx
  const visibleRecents = recents.slice(0, 3);

  // Total units scanned this session, derived from the recents prop (the
  // list-only flow has no internal scan callback to count).
  const listScanCount = recents.reduce((n, r) => n + (r.count ?? 1), 0);

  if (listOnly) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
        <div className="flex flex-col h-full w-full max-w-md mx-auto px-4 pt-4">
          <p className="text-center text-lg font-semibold text-white">
            {title}{listScanCount > 0 ? ` (${listScanCount} scanned)` : ''}
          </p>
          <p className="text-center text-xs text-gray-400 mt-1 mb-1">
            📟 Hardware scanner — pull the trigger to scan
          </p>
          {discoverQueueLength > 0 && (
            <p className="text-center text-sm text-amber-400 mb-1">
              🔍 {discoverQueueLength} queued for lookup
            </p>
          )}
          <div className="flex-1 overflow-y-auto mt-2">
            {recents.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-12">
                Nothing scanned yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {recents.map((r) => (
                  <li key={r.id ?? r.key}>
                    <SwipeableRecentRow
                      recent={r}
                      onAdjust={onAdjustRecent ? (delta) => onAdjustRecent(r, delta) : null}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div
            className="py-3 flex flex-col gap-2"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <button
              onClick={() => onCloseRef.current({ scanned: 0 })}
              className="w-full py-2 px-5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-base font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onCloseRef.current({ scanned: listScanCount })}
              className="w-full py-3 bg-brand-cobalt hover:bg-brand-cobalt-400 text-white rounded-lg text-lg font-semibold transition-colors"
            >
              Finish{listScanCount > 0 ? ` (${listScanCount} scanned)` : ''}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90">
      <div className="w-full max-w-sm px-4">
        <p className="text-center text-lg font-semibold mb-4 text-white">
          {continuous ? `${title} (${scanCount} scanned)` : title}
        </p>
        {continuous && discoverQueueLength > 0 && (
          <p className="text-center text-sm text-amber-400 mb-2">
            🔍 {discoverQueueLength} queued for lookup
          </p>
        )}
        <div id="barcode-reader" className="w-full rounded-lg overflow-hidden" />

        {continuous && visibleRecents.length > 0 && (
          <button
            type="button"
            onClick={() => onShowAllRecents?.()}
            className="w-full mt-3 px-3 py-2 bg-gray-800/80 hover:bg-gray-700 rounded-xl flex items-center gap-2 text-left transition-colors"
            aria-label="Show all scanned products this session"
          >
            <div className="flex -space-x-2 flex-shrink-0">
              {visibleRecents.map((r) => (
                <RecentChipThumb key={r.key} recent={r} />
              ))}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-semibold truncate">
                {visibleRecents[0].name}
                {visibleRecents[0].count > 1 ? ` × ${visibleRecents[0].count}` : ''}
              </p>
              <p className="text-gray-400 text-xs truncate">
                {recents.length > 1
                  ? `+${recents.length - 1} more — tap to view all`
                  : 'tap to view all'}
              </p>
            </div>
            <span className="text-gray-400 text-lg" aria-hidden="true">›</span>
          </button>
        )}

        {cameraError && (
          <>
            <p className="text-red-400 text-sm text-center mt-3">{cameraError}</p>
            <form onSubmit={handleManualSubmit} className="mt-4 flex gap-2">
              <input
                type="text"
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                placeholder="Enter barcode number"
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-brand-cobalt"
                autoFocus
              />
              <button
                type="submit"
                disabled={!manualBarcode.trim()}
                className="px-4 py-2 bg-brand-cobalt hover:bg-brand-cobalt-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
              >
                Submit
              </button>
            </form>
          </>
        )}

        {continuous ? (
          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={() => onCloseRef.current({ scanned: 0 })}
              className="w-full py-2 px-5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-base font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onCloseRef.current({ scanned: scanCount })}
              className="w-full py-3 bg-brand-cobalt hover:bg-brand-cobalt-400 text-white rounded-lg text-lg font-semibold transition-colors"
            >
              Finish{scanCount > 0 ? ` (${scanCount} scanned)` : ''}
            </button>
          </div>
        ) : (
          <button
            onClick={() => onCloseRef.current({ scanned: 0 })}
            className="mt-4 w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-lg font-semibold transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
```

Note: this moves the existing `const visibleRecents = recents.slice(0, 3);` line up to the top of the block (it previously sat just before `return`). Make sure the old standalone `const visibleRecents = ...` line (was line ~1177) is removed so it isn't declared twice.

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: build succeeds. (`SwipeableRecentRow` is a hoisted function declaration later in the file, so referencing it here is valid.)

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "Add list-only (camera-less) render mode to BarcodeScanner"
```

---

### Task 5: Make the "Add to shopping list" flow accumulate in list-only mode

In camera mode it stays single-fire; in list-only mode it becomes continuous, pushing each known product into `shoppingListRecents` and staying open.

**Files:**
- Modify: `src/App.jsx` — `handleShoppingListBarcodeScan` (~3959), `handleShoppingListClose` (~4033)

- [ ] **Step 1: Add a `continuous` branch to the handler**

Change the start of `handleShoppingListBarcodeScan` (line ~3959–3961) from:

```jsx
  const handleShoppingListBarcodeScan = useCallback(
    async (barcode) => {
      setShowShoppingListScanner(false);
```

to:

```jsx
  const handleShoppingListBarcodeScan = useCallback(
    async (barcode, { continuous = false } = {}) => {
      if (!continuous) setShowShoppingListScanner(false);
```

Then, inside the `if (productKnown && foundProduct) {` success branch, change (line ~3989–3992):

```jsx
          addToast(
            `🛒 ${foundProduct.name ?? barcode} added to shopping list`,
            'success',
          );
```

to:

```jsx
          addToast(
            `🛒 ${foundProduct.name ?? barcode} added to shopping list`,
            'success',
          );
          if (continuous) pushRecent(setShoppingListRecents, foundProduct);
```

Finally, update the dependency array (line ~4030) from:

```jsx
    [addToast, scraperAvailable, processDiscoverQueue],
```

to:

```jsx
    [addToast, scraperAvailable, processDiscoverQueue, pushRecent],
```

- [ ] **Step 2: Clear recents on close**

Change `handleShoppingListClose` (lines ~4033–4035) from:

```jsx
  const handleShoppingListClose = useCallback(() => {
    setShowShoppingListScanner(false);
  }, []);
```

to:

```jsx
  const handleShoppingListClose = useCallback(() => {
    setShowShoppingListScanner(false);
    setShoppingListRecents([]);
  }, []);
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "Accumulate Add-to-shopping-list scans into a session list (list-only)"
```

---

### Task 6: Wire the overlays to `listOnly` and route hardware scans

Choose camera vs list-only at render time from the toggle, mount the key listener, route scans by current overlay, and auto-enable the toggle on first detection.

**Files:**
- Modify: `src/App.jsx` — import (top), `handleScanPick` (~4093), hook wiring (near other hooks), overlay renders (~5490–5539)

- [ ] **Step 1: Import the hook**

At the top of `src/App.jsx`, just after the existing `import { Html5Qrcode } from 'html5-qrcode';` line (line ~3), add:

```jsx
import { useBarcodeKeyListener } from './hooks/useBarcodeKeyListener';
```

- [ ] **Step 2: Add the routing callback and mount the hook**

Immediately after `handleScanPick` (after line ~4099, the closing `}, []);` of `handleScanPick`), add:

```jsx
  // A camera scanner is "in charge" of keyboard input only when an overlay is
  // open in camera mode (i.e. hardware scanner is OFF). In that case the
  // document-level listener stands down so it can't double-process.
  const cameraScannerOpen =
    (showScanner || showInventoryScanner || showShoppingListScanner) &&
    !hardwareScannerEnabled;

  // Route a hardware-scanner barcode to the right flow based on what's open.
  const handleHardwareScan = useCallback(
    (barcode) => {
      if (!hardwareScannerEnabled) setHardwareScannerEnabled(true);
      if (showInventoryScanner) {
        handleInventoryBarcodeScan(barcode, { continuous: true });
      } else if (showShoppingListScanner) {
        handleShoppingListBarcodeScan(barcode, { continuous: true });
      } else if (showScanner) {
        handleBarcodeScan(barcode, { continuous: true });
      } else {
        // Idle (or a non-scan overlay is open): assume shopping.
        setShowScanner(true);
        handleBarcodeScan(barcode, { continuous: true });
      }
    },
    [
      hardwareScannerEnabled,
      setHardwareScannerEnabled,
      showInventoryScanner,
      showShoppingListScanner,
      showScanner,
      handleInventoryBarcodeScan,
      handleShoppingListBarcodeScan,
      handleBarcodeScan,
    ],
  );

  useBarcodeKeyListener(handleHardwareScan, { enabled: !cameraScannerOpen });
```

- [ ] **Step 3: Pass `listOnly` (and recents/adjust) to the three overlays**

Replace the three overlay render blocks (lines ~5490–5525) with:

```jsx
      {/* ── Barcode scanner overlay (Scan shopping — continuous) ───── */}
      {showScanner && (
        <BarcodeScanner
          onScan={handleBarcodeScan}
          onClose={handleScannerClose}
          discoverQueueLength={discoverQueue.length}
          mode="continuous"
          title="Scan shopping"
          recents={shoppingRecents}
          onShowAllRecents={() => setShowRecentsSheet(true)}
          listOnly={hardwareScannerEnabled}
          onAdjustRecent={handleAdjustShoppingRecent}
        />
      )}

      {/* ── Inventory scanner overlay (continuous) ─────────────────── */}
      {showInventoryScanner && (
        <BarcodeScanner
          onScan={handleInventoryBarcodeScan}
          onClose={handleInventoryClose}
          discoverQueueLength={discoverQueue.length}
          mode="continuous"
          title="Inventory"
          recents={inventoryRecents}
          onShowAllRecents={() => setShowRecentsSheet(true)}
          listOnly={hardwareScannerEnabled}
          onAdjustRecent={handleAdjustInventoryRecent}
        />
      )}

      {/* ── Add-to-shopping-list scanner overlay ───────────────────── */}
      {showShoppingListScanner && (
        <BarcodeScanner
          onScan={handleShoppingListBarcodeScan}
          onClose={handleShoppingListClose}
          discoverQueueLength={discoverQueue.length}
          mode={hardwareScannerEnabled ? 'continuous' : 'single'}
          title="Add to shopping list"
          recents={shoppingListRecents}
          onShowAllRecents={() => setShowRecentsSheet(true)}
          listOnly={hardwareScannerEnabled}
          onAdjustRecent={null}
        />
      )}
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: build succeeds with no "used before defined" errors. (`handleAdjustShoppingRecent` and `handleAdjustInventoryRecent` are defined earlier in the component; `handleHardwareScan` is added after `handleScanPick`, which is after all three flow handlers it references.)

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "Route hardware scans and render scan overlays list-only when enabled"
```

---

### Task 7: Hardware-scanner toggle in the ScanPicker sheet

A switch in the existing scan menu so the user can force list-only mode on or off.

**Files:**
- Modify: `src/App.jsx` — `ScanPicker` (~1298), its render site (~5486)

- [ ] **Step 1: Add toggle props + a switch row to `ScanPicker`**

Change the `ScanPicker` signature (line ~1298) from:

```jsx
function ScanPicker({ onPick, onClose }) {
```

to:

```jsx
function ScanPicker({ onPick, onClose, hardwareScannerEnabled, onToggleHardwareScanner }) {
```

Then, inside `ScanPicker`, add a toggle row at the end of the options `<div className="p-3 flex flex-col gap-2">` — immediately after the `Scan receipt` `<ScanPickerButton .../>` block (after line ~1343) and before that `</div>`:

```jsx
          <button
            type="button"
            onClick={() => onToggleHardwareScanner(!hardwareScannerEnabled)}
            className="w-full px-4 py-3 mt-1 bg-gray-700 hover:bg-gray-600 rounded-xl flex items-center gap-3 text-left transition-colors"
            role="switch"
            aria-checked={hardwareScannerEnabled}
          >
            <div className="w-12 h-12 rounded-xl bg-gray-800 flex items-center justify-center text-2xl flex-shrink-0">
              📟
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-base font-semibold leading-tight">Hardware scanner</p>
              <p className="text-gray-400 text-xs mt-0.5">
                {hardwareScannerEnabled
                  ? 'On — camera off, scans go straight to the list'
                  : 'Off — use the phone camera'}
              </p>
            </div>
            <span
              className={`w-11 h-6 rounded-full flex items-center px-0.5 flex-shrink-0 transition-colors ${
                hardwareScannerEnabled ? 'bg-brand-cobalt justify-end' : 'bg-gray-600 justify-start'
              }`}
              aria-hidden="true"
            >
              <span className="w-5 h-5 rounded-full bg-white" />
            </span>
          </button>
```

- [ ] **Step 2: Pass the props at the render site**

Change the `ScanPicker` render (lines ~5486–5488) from:

```jsx
      {showScanPicker && (
        <ScanPicker onPick={handleScanPick} onClose={() => setShowScanPicker(false)} />
      )}
```

to:

```jsx
      {showScanPicker && (
        <ScanPicker
          onPick={handleScanPick}
          onClose={() => setShowScanPicker(false)}
          hardwareScannerEnabled={hardwareScannerEnabled}
          onToggleHardwareScanner={setHardwareScannerEnabled}
        />
      )}
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "Add hardware-scanner toggle switch to the ScanPicker sheet"
```

---

### Task 8: Version bump, changelog, and manual verification

**Files:**
- Modify: `stock/config.json` (version), `stock/CHANGELOG.md`
- Note: these are at the submodule root, **not** under `frontend/`.

- [ ] **Step 1: Bump the add-on version**

In `stock/config.json`, change `"version": "2.2.3"` to `"version": "2.3.0"`.

- [ ] **Step 2: Add a changelog entry**

At the top of `stock/CHANGELOG.md`, add (plain `## X.Y.Z` header — no date, no brackets):

```markdown
## 2.3.0

- Bluetooth (HID) barcode scanner support. When a hardware scanner is detected (or the new "Hardware scanner" toggle in the Scan menu is on), the shopping / inventory / add-to-shopping-list flows open a full-screen, camera-less list of scanned items instead of the camera view.
- Scanning a barcode with HA-stock open and no overlay now opens the shopping list and records the item automatically.
```

- [ ] **Step 3: Run the detector unit tests and a production build**

```bash
cd stock/frontend
node --test src/lib/scanDetector.test.js
npm run build
```

Expected: `# pass 7 / # fail 0`, and a clean Vite build.

- [ ] **Step 4: Manual verification matrix**

Serve the built app (or `npm run dev`) and confirm, with the L8BL paired to the device (terminator on default CR&LF):

1. **Toggle on → each flow is list-only.** Open Scan → turn Hardware scanner on → pick Scan shopping / Inventory / Add to shopping list. Each opens with **no camera**, a full-screen scanned-items list, and Finish/Cancel. Scans land in the list; Finish commits exactly as the camera flow does.
2. **Toggle off → camera unchanged.** Each flow shows the camera viewport as before.
3. **Idle auto-detect.** With the toggle off and no overlay open, pull the trigger once: the toggle flips on, the **shopping** list-only overlay opens, and the item is recorded. Further scans accumulate.
4. **Typing is unaffected.** Type in the product search box at human speed — input is not intercepted or cleared.
5. **No-terminator fallback (optional).** If you reconfigure the scanner to "No Terminator", a scan still registers after a brief pause.

- [ ] **Step 5: Commit**

```bash
cd /home/glitch/GIT/HA-apps/HA-stock
git add stock/config.json stock/CHANGELOG.md
git commit -m "Bump HA-stock to 2.3.0: Bluetooth HID barcode scanner support"
```

- [ ] **Step 6: Push the submodule, then bump the root pointer**

Per repo convention (submodule first, then pointer):

```bash
cd /home/glitch/GIT/HA-apps/HA-stock && git push
cd /home/glitch/GIT/HA-apps && git add HA-stock && \
  git commit -m "Bump HA-stock pointer to 2.3.0: Bluetooth HID barcode scanner" && git push
```

---

## Notes / known limitations (v1, by design)

- **Discovered products in list-only Add-to-shopping-list** are added to the shopping list via the existing discover queue but do **not** appear in the on-screen session list (the discover-landing path doesn't push to `shoppingListRecents`). Known products appear immediately. Out of scope for v1.
- **First-character leak:** the listener suppresses burst keys once two fast chars have arrived, so at most the first character of a scan could reach a focused field before suppression kicks in. Negligible in the primary (nothing-focused) scenario.
- **No WebHID / device-name detection** — detection is purely behavioural (timing + Enter), per the approved spec.
