## 1.16.7
- Inventory scanner: Cancel button above Finish button (stacked vertically with gap)

## 1.16.6
- Inventory scanner: continuous mode is always on by default (no toggle shown); Finish and Cancel buttons always visible side by side

## 1.16.5
- New Inventory mode: blue 📋 button in header opens continuous barcode scanner that accumulates per-product counts instead of immediately adding stock — press Finish to commit deltas (adds or consumes stock to match physical count); products in stock but not scanned trigger incremental optimize via the scraper; same 5 s cooldown and discover-queue safeguards as normal scanning

## 1.16.4
- Persistent service health monitoring: background loop never stops; re-detects Storage/Scraper if they go down, reloads nginx only when URL changes

# Changelog

## 1.16.3
- Persistent service probing: if Storage or Scraper addon is not found at startup, retry every 30 s in background; reload nginx automatically when found

## 1.16.2
- Scanning a multi-pack barcode (e.g. a 6-pack) now adds the correct number of
  individual units to stock (uses `matched_pack_size` returned by Storage API)

## 1.16.1

- Fix product images not loading (nginx static asset regex was intercepting API image requests)

## 1.16.0

- Auto-detect Storage URL from container hostname and Supervisor API
- storage_url config now optional (auto-detected when not set)

## 1.15.1

- Add Storage health check with retry on startup (waits for Storage to be ready)
- Add proxy timeouts for Storage upstream in nginx
- Renamed addon display name to "Stock"

## 1.15.0

- Replaced Grocy API with HA-Storage API
- Removed Barcode Buddy integration (barcode queue in Storage)
- Updated product field names (parent_id, unit_id, picture_filename)
- Simplified nginx proxy configuration

## 1.14.3

- Fix instant "Product not found online" error: scraper uses fire-and-poll but frontend was not polling the task endpoint, so it mistook the running-task response for a failure

## 1.14.2

- Improve scan toast: show "Looking up new product…" instead of alarming "Product not found" while lookup is in progress

## 1.14.1

- Add connection keep-alive heartbeat to prevent Cloudflare 524 timeout when page is open for extended periods
- Show reconnect banner with reload button when connection is lost

## 1.14.0

- Yellow "Keep in stock" button when the parent product is already kept in stock, showing the parent name
- Clicking the yellow button offers: stop keeping the parent, or keep this specific product as well (detaches from parent)

## 1.13.0

- "Keep in stock" is now parent-aware: when pressed on a product with a parent, a dialog asks whether to keep the parent product or detach and keep only this product
- Keeping the parent sets min_stock on the parent (which cumulates child stock)
- Keeping only this product removes the parent link first, then sets min_stock, so Grocy respects it
- "Do not keep" simply clears min_stock without re-attaching to any parent

## 1.12.0

- Fix: unknown barcodes no longer create stale entries in Barcode Buddy when the scraper is available — Grocy is checked first, and unknown products go directly to the discover queue without touching BB
- When the scraper is unavailable or Grocy check fails, barcodes are still sent to BB as a fallback

## 1.11.0

- Add `debug` option (default: off) to control nginx log verbosity
- When debug is off, routine polling requests (stock, locations, product_groups) and static assets are suppressed from the log — only errors and meaningful actions (scans, consumes, discovers) are logged
- When debug is on, all requests are logged (previous behaviour)

## 1.10.1

- Barcode scan cooldown now only applies when re-scanning the same product; different products scan immediately
- Show info toast when a scan is blocked by cooldown

## 1.10.0

- Continuous scanning: queue unknown barcodes for AI lookup instead of dropping them when a discover is already in-flight
- Show queued-for-lookup count in the scanner overlay during continuous scanning
- Stock is automatically refreshed once all queued discovers complete

## 1.9.4

- Double-tap an already-selected location tab to collapse or expand all product groups at once

## 1.9.3

- Fix: tapping a product with slight finger drift no longer accidentally marks it as opened; small-distance long-press gestures now open the detail overlay instead

## 1.9.2

- Show opened count in stock label: "3 in stock (1 opened)" when a product has been marked as opened
- Optimistic UI update when opening a product

## 1.8.0

- Replace -1 button with swipe gestures: swipe left to consume, swipe right to add stock
- Color-coded swipe preview: green for add, red for consume, amber for open
- Long-press a product row for detailed gesture mode with directional hints
- Swipe down in long-press mode to mark a product as opened in Grocy
- Add "Open 1" button to the product detail overlay
- Row animates off-screen on action and slides back in

## 1.7.1

- Add 5-second cooldown between barcode scans to prevent duplicate scanning
- Move toast notifications to the top of the screen for better visibility during scanning

## 1.7.0

- Add automatic background sync so stock changes from other devices appear without refreshing
- Poll every 15 seconds when the tab is active, 60 seconds when hidden
- Sync immediately when switching back to the tab
- Skip background sync while local mutations are in-flight to preserve optimistic UI

## 1.6.1

- Restyle location tabs as overlapping trapezoidal tabs with green baseline
- Active tab uses accent green, inactive tabs use semi-transparent dark grey
- Tab labels are now uppercase with wider padding

## 1.6.0

- Add tab-style location filter to browse stock by Grocy storage location
- Locations are loaded dynamically from the Grocy API and only shown when in use

## 1.5.2

- Mirror the camera preview when using the front camera for easier barcode alignment

## 1.5.1

- Add bright white screen illumination when using front camera to light up barcodes
- Request wake lock to keep screen at full brightness during front camera scanning

## 1.5.0

- Add camera flip button to switch between front and rear camera while scanning
- Add continuous scanning mode for scanning many products in a row with a Finish button
- Add duplicate scan protection that waits for a clear view before allowing the next scan

## 1.4.5

- Fix blank screen after successful barcode scan by stopping camera before unmounting scanner

## 1.4.4

- Fix barcode scan consuming products instead of adding them by forcing purchase mode
- Fix blank screen and missing toast after barcode scan on mobile

## 1.4.3

- Fix barcode scan returning to empty screen instead of stock view on mobile

## 1.4.2

- Fix barcode scan returning 400 error by using correct Barcode Buddy API query parameter

## 1.4.1

- Fix camera access in HA ingress by adding Permissions-Policy header
- Add manual barcode entry fallback when camera is unavailable
- Improve error message when camera cannot be accessed

## 1.4.0

- Add green "+" button in title bar to scan barcodes with phone camera
- Integrate with Barcode Buddy API to add scanned products to stock
- Add `barcode_buddy_url` and `barcode_buddy_api_key` configuration options

## 1.3.2

- Fix sidebar panel visibility for non-admin users by setting `panel_admin: false`

## 1.3.1

- Fix sidebar visibility so non-admin users can see the panel

## 1.3.0

- Add product detail overlay when tapping an item in the stock list
- Add "Keep in stock" / "Do not keep" toggle to set minimum stock amount
- Add +1 and −1 buttons in overlay to add or consume stock
- Add "Consume all" button to consume entire stock of a product

## 1.2.0

- Add undo toast when consuming items with 5-second countdown and undo button
- Delay API call until undo window expires

## 1.1.0

- Switch to dark mode theme matching Home Assistant dark UI

## 1.0.2

- Fix s6-overlay PID 1 error by setting `init: false` in add-on config

## 1.0.1

- Fix s6-overlay startup error by migrating to s6-rc.d service structure
- Use correct shebang (`#!/command/with-contenv bashio`) for s6-overlay v3

## 1.0.0

- Initial release
