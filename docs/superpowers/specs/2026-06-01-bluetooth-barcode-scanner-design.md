# Bluetooth (HID) Barcode Scanner Support — HA-stock

**Date:** 2026-06-01
**App:** HA-stock (`stock/frontend`, React SPA)
**Status:** Approved design, pending implementation plan

## Problem

A 2D barcode scanner (Tera/L8BL Pro) is paired over Bluetooth to the phone
running Home Assistant with HA-stock open. The scanner behaves as a **HID
keyboard**: it types the decoded barcode digits and emits a terminator key.

We want HA-stock to:

1. **Detect** that a hardware scanner is in use and, when so, **bypass the
   camera scanner** entirely. The three scan flows (shopping, inventory,
   add-to-cart) should open an overlay that is **just the running list of
   scanned items, full-screen** — no camera viewport.
2. **Capture idle scans:** if the user scans while HA-stock is simply open (no
   overlay), assume **shopping mode** — open the list-only shopping overlay and
   record the item, with subsequent scans accumulating into it.

## Constraints & key facts

- **No web API can query "is a HID keyboard/scanner paired."** HID *keyboards*
  are deliberately excluded from WebHID (`navigator.hid`), and WebHID needs an
  explicit pairing gesture. So detection must be inferred from input behaviour.
- A HID scanner types into whatever is focused (or to `document` when nothing
  is focused). On a **phone**, focusing a hidden `<input>` would summon the soft
  keyboard — so we must **not** rely on a focused input. We listen at
  `document` level instead.
- **Terminator:** the scanner's terminator card offers `No Terminator` / `CR` /
  `CR&LF` (default, marked `*`) / `TAB`. CR, LF, and CR&LF all surface in the
  browser as a single **`Enter` keydown**. The design keys off `Enter`. Keep the
  scanner on its **default CR&LF** — no reconfiguration required. (TAB collides
  with focus navigation; No-Terminator removes our end-of-scan signal.)
- There is **no prefix option** on the scanner, so we cannot tag input as
  "from the scanner" deterministically. We disambiguate scanner input from human
  typing using a **timing heuristic** (characters arriving far faster than a
  human can type) plus the `Enter` terminator.

## Current implementation (baseline, do not break)

All in `stock/frontend/src/App.jsx`:

- **`BarcodeScanner`** (≈1072–1268) — wraps `html5-qrcode` (`Html5Qrcode`).
  Modes `continuous` / `single`; renders camera `#barcode-reader`, a recents
  strip, a manual-entry `<input>` fallback, and Finish/Cancel controls.
- **`ScanPicker`** (≈1298–1348) — bottom sheet that picks the flow:
  `shopping` / `inventory` / `shopping-list` / `receipt`.
- **`SessionRecentsSheet`** (≈1374–1421) + **`SwipeableRecentRow`**
  (≈1429–1515) — swipeable list of scanned items (swipe = ±1).
- Handlers: `handleBarcodeScan` (≈3707–3810, shopping), `handleInventoryBarcodeScan`
  (≈3835–3890), `handleShoppingListBarcodeScan` (≈3959–4031),
  `handleScanPick` (≈4093–4099). Decode → `GET /api/storage/products/by-barcode/{code}`
  → known: `POST /api/storage/stock/add`; unknown + scraper: discover queue;
  else `POST /api/storage/barcode-queue`.
- State: `showScanner` / `showInventoryScanner` / `showShoppingListScanner`,
  `shoppingRecents`, `inventoryRecents`, `inventoryCounts`.

**These handlers and the decode→lookup→add→discover pipeline are reused
unchanged.** This feature adds an input source and a render mode; it does not
touch the data pipeline.

## Design

### 1. State: toggle + auto-detect

- New state `hardwareScannerEnabled: boolean`, **persisted in `localStorage`**
  (key e.g. `ha-stock.hardwareScanner`). This is the **source of truth** for
  "skip camera → list-only."
- Default `false` on first run.
- The detection hook (below) **auto-flips it to `true`** the first time it sees
  a scanner-signature burst. Once on, it stays on until the user turns it off.

### 2. Detection hook: `useBarcodeKeyListener`

A small hook attached once at `App` level, always mounted.

**Behaviour:**

- Attaches a `keydown` listener on `document` (capture phase, so it can suppress
  keys before they reach a focused field when needed).
- Maintains a buffer of printable characters with timestamps.
- **Burst rule:** if the gap since the previous key exceeds a threshold
  (`MAX_INTERKEY_MS`, ~50 ms) the buffer resets (treated as human typing).
- **Completion:** on `Enter`, if the buffer length ≥ `MIN_LEN` (~4) and the
  buffer was filled at scanner speed, emit it as a decoded barcode.
- **No-terminator fallback:** if no terminator arrives, flush the buffer after
  an idle timeout (`FLUSH_IDLE_MS`, ~80 ms) when length ≥ `MIN_LEN`. (Covers a
  scanner accidentally set to "No Terminator".)
- **Focus policy:**
  - If a normal text input / textarea / `contenteditable` is focused **and no
    list-only scan overlay is open**, the hook stays out of the way (lets the
    user type normally; e.g. search, manual entry). The timing heuristic still
    means a genuine fast burst is recognised, but to avoid polluting a focused
    field we only `preventDefault` once a burst is confirmed at scanner speed.
  - When a **list-only overlay is open** there is no competing input, so capture
    is unconditional.
- On a confirmed scan, the hook **sets `hardwareScannerEnabled = true`** (and
  persists it) and calls the routing callback.

**Tunables** (constants, easy to adjust): `MAX_INTERKEY_MS=50`, `MIN_LEN=4`,
`FLUSH_IDLE_MS=80`.

### 3. Routing scanned barcodes

The hook's callback routes by current UI state:

- **A list-only scan overlay is open** → call that overlay's existing handler:
  - shopping → `handleBarcodeScan`
  - inventory → `handleInventoryBarcodeScan`
  - add-to-cart → `handleShoppingListBarcodeScan`
- **No scan overlay open (idle)** → open the **shopping** list-only overlay
  (`setShowScanner(true)`) and feed the barcode to `handleBarcodeScan`, so the
  item appears immediately and further scans accumulate. This "idle" branch also
  covers the case where a **non-scan** overlay is open (product detail, shopping
  list view, etc.): the shopping list-only overlay opens on top — "assume
  shopping" wins regardless of what else is on screen.
- **The camera `BarcodeScanner` is open** (toggle off / not yet detected) → the
  hook **ignores** keystrokes; the camera path owns decoding. (Prevents
  double-processing.)

### 4. List-only render mode: `BarcodeScanner` gains a `listOnly` prop

When `hardwareScannerEnabled` is true, `handleScanPick` opens `BarcodeScanner`
with `listOnly`. In that mode the component:

- **Does not** initialise `Html5Qrcode` and **does not** render the
  `#barcode-reader` camera div.
- Renders the **full-screen scanned-items list** — reuse the
  `SessionRecentsSheet` / `SwipeableRecentRow` row UI inline at full height
  (swipe ±1 retained where the flow already supports it).
- Keeps the existing **Finish / Cancel** controls and the "X scanned" count and
  "queued for lookup" indicator.
- Drops the manual-entry `<input>` (the scanner *is* the input; avoids soft-
  keyboard popups on mobile). A small "type a code" affordance MAY be retained
  behind a tap, but is not required for v1 (YAGNI).

When `hardwareScannerEnabled` is false, `BarcodeScanner` renders exactly as
today (camera path untouched).

### 5. Toggle UI

A switch labelled **"Hardware scanner"** (with a 🔫/⌨ glyph) in the **`ScanPicker`**
bottom sheet, bound to `hardwareScannerEnabled`. Lets the user force it on ahead
of the first scan, or turn it off to return to the camera.

## Data flow (summary)

```
HID scanner types "6411401234567" + Enter
        │  (document keydown, capture phase)
        ▼
useBarcodeKeyListener  ──► sets hardwareScannerEnabled = true (persist)
        │
        ├─ list-only overlay open? ─► handler for that flow
        ├─ idle (no overlay)?       ─► open shopping list-only + handleBarcodeScan
        └─ camera overlay open?     ─► ignore (camera owns it)
                                         │
                          (existing pipeline, unchanged)
                          GET /products/by-barcode → add stock / discover / queue
```

## Error handling & edge cases

- **Human typing in search / forms** is unaffected: burst-speed + Enter is the
  gate, and the hook defers to focused inputs unless a list-only overlay is open.
- **Partial first scan before detection:** if `hardwareScannerEnabled` starts
  `false`, the very first idle burst is still captured by the hook (it auto-
  enables and opens the shopping overlay). Button-presses before any scan use
  whatever the persisted toggle says.
- **Double-processing guard:** hook ignores input while the camera overlay is
  open; list-only and camera are mutually exclusive per the toggle.
- **Storage/scraper unavailable:** unchanged — existing handlers already queue
  to `/api/storage/barcode-queue` and toast.
- **Rapid duplicate scans:** existing per-handler dedup/recents-merge logic
  (`pushRecent`) is reused.

## Testing

No test runner is configured for the Stock frontend (per repo CLAUDE.md), so
verification is manual:

- **Unit-ish:** factor the burst-detection logic into a pure helper
  (`detectScan(buffer, timings)` or a reducer) so it *could* be unit-tested in
  isolation, even if no runner is wired up. Keep it side-effect-free.
- **Manual matrix:**
  1. Toggle on → press each flow (shopping/inventory/add-to-cart) → overlay is
     list-only, no camera, scans land in the list, Finish commits as today.
  2. Toggle off → camera scanner renders as before.
  3. Idle scan (no overlay), toggle off → first burst auto-enables, opens
     shopping list-only, item recorded; subsequent scans accumulate.
  4. Type normally in the product search field → not intercepted.
  5. Scanner set to default CR&LF terminator → recognised; (optional) No-
     Terminator → recognised via idle flush.

## Scope guardrails (YAGNI — explicitly out)

- No WebHID, no device-name / vendor detection.
- No per-flow toggle; one global switch.
- No new settings page — the switch lives in the existing ScanPicker sheet.
- No prefix-based tagging (scanner offers no prefix).
- No changes to the storage/scraper API pipeline.

## Shipping checklist (repo convention)

- Bump `stock/config.json` version (current `2.2.3`) and add a plain
  `## X.Y.Z` entry to `stock/CHANGELOG.md` (no dates/brackets — Supervisor
  parsing depends on it).
- Commit inside the `HA-stock` submodule first, then bump the pointer in the
  `HA-apps` root repo.
