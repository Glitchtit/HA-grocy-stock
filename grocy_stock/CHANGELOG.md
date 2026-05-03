## 1.19.5
- Add: tap the star on any product-group accordion to mark it as a favourite. Favourites pin to the top of the list (sorted alphabetically among themselves) inside whichever location tab is active. Tap again to unstar. Choices persist across reloads via localStorage

## 1.19.4
- Fix: shopping-list quick-add no longer spams the K-Ruoka scraper while the user is typing. The scraper accepts only one job at a time and was returning 409 (busy) for queries fired mid-keystroke. The scraper search now waits for a 2 s typing pause (local fuzzy suggestions still update at 250 ms so the dropdown stays snappy) and retries up to 3 times with a 1.5 s backoff if a 409 still slips through

## 1.19.3
- Fix: adding a scraped product from the shopping-list quick-add no longer also adds 1 to stock. The previous flow routed the EAN through the scraper's discover pipeline, which always adds 1 to stock as part of an inventory scan. Shopping-list adds now create the product directly via `POST /products` and (best-effort) attach the barcode via `POST /barcodes`, never touching stock

## 1.19.2
- Fix: shopping-list quick-add scraper search now actually returns results. The scraper add-on uses fire-and-poll (`POST /api/search` returns `{task_id, status: "running"}` and the result is fetched via `GET /api/task/{id}`). The stock app was reading `products` directly from the POST response, which is always undefined — so every search returned 0 hits. Now polls the task with a 30 s deadline, mirroring the existing `/discover` flow

## 1.19.1
- Fix: shopping-list quick-add scraper search now returns hits for partial / niche queries (e.g. "sudachi") that the standalone scraper UI does find. Root cause: we asked the scraper for `max_products=4`, which limits the *upstream* API result pool too — the upstream returns broad fuzzy hits and the scraper filters client-side for the query word, so a tiny pool can yield zero matches. Now requesting 50 and slicing to 4 in the UI, mirroring the standalone scraper's default

## 1.19.0
- Product detail overlay: new "Spoiled" button reduces stock by 1 and is recorded as a `spoil` event in the product's history (HA-storage statistics now reflect quantity-based spoilage, not just full-row discards)
- Spoiled action follows the same 5-second undo-toast + 500 ms interactive-guard pattern as the other overlay buttons to prevent accidental taps and allow undo

## 1.18.3
- Shopping-list quick-add now ALWAYS shows up to 4 K-Ruoka scraper results below local matches (previously the scraper was suppressed whenever any local fuzzy match was found, hiding products that just happened to share a few letters with something already in the database)
- Scraper hits are clearly tagged with a "K-Ruoka" badge so it's obvious which rows come from the scraper vs. the local product database

## 1.18.2
- Fix: the "Vähissä" badge on auto-added shopping-list rows now sticks across syncs — previously the polling sync re-fetched the row from HA-Storage where the flag was always `false`, clobbering the optimistic value. Frontend now sends `auto_added: true` on the POST and coerces the field on every fetch (requires HA-Storage ≥ 0.4.1)

## 1.18.1
- Fix: products that drop below their tracked `min_stock_amount` are now auto-added to the shopping list (one row per low product, with a "Vähissä" badge); the row is left alone once it's there so manual edits/done state aren't clobbered, and a future drop will re-add only after the row is cleared

## 1.18.0
- New "Ostoslista" button in the top header opens a full-screen shopping-list overlay sourced from HA-Storage, with a count badge for un-done items
- Shopping list is grouped and sorted by Finnish-grocery aisle order (produce → bread → dairy → meat → frozen → dry goods → drinks → household …); done items sink within their aisle
- Quick-add bar with fuzzy search over existing products; if no local match, falls back to scraper search (top 4 K-Ruoka results) which routes through the existing discover flow and lands on the list when found
- Free-text "Lisää muistilappuna" tail option for items that don't match any product (backed by a hidden Muistilappu sentinel product, created on first use)
- Parent products on the list show a chip strip of "usually bought" child variants; tapping a chip swaps the row to that variant
- Each row supports done toggle, ± amount stepper and delete, all with optimistic UI

## 1.17.3
- Fix: in "Scan shopping" mode, products discovered from unknown barcodes now appear in the "Scanned this session" strip and sheet, with the count reflecting both the trigger scan and any extras scanned while the lookup was in flight (previously the discovered product was silently missing from session recents)

## 1.17.2
- Fix: "Add to shopping list" now actually adds the item after an unknown barcode is discovered (was reading the product id from the wrong field on the scraper response, so the post-discover shopping-list write was silently skipped)

## 1.17.1
- Session recents sheet now supports swipe gestures: swipe right on a row to add 1, swipe left to remove 1 — quick correction of mistaken scans
- Shopping mode adjusts stock by the matched pack size; inventory mode adjusts the local count (committed on Finish)
- Recents entry is dropped automatically when its count reaches 0

## 1.17.0
- Revamp scanning: header now has a single Scan button that opens a bottom-sheet picker with three modes — Scan shopping (continuous), Inventory (continuous), Add to shopping list (single-fire)
- Add new "Add to shopping list" flow — one scan posts to `/api/storage/shopping-list`, with confirmation toast; unknown barcodes are discovered in the background and added to the list when found
- Continuous scanners now show a tap-to-expand strip of the last 3 scanned products; tapping opens a sheet with the full session list
- Remove camera-flip button (front camera quality was unusable) and remove the in-scanner Continuous toggle (mode is now decided by the picker)

## 1.16.21
- Apply GlitchyRee design system: brand-orange trapezoidal location tabs and baseline, brand-orange undo toast affordances, cobalt primary scan/+ FAB
- Add CSS design tokens at src/styles/design-tokens.css
- Self-hosted Space Grotesk / Inter / JetBrains Mono fonts
- Wire Tailwind theme.extend to expose brand.* / semantic.* / font-display utilities

## 1.16.20
- Fix: fast flick scrolls no longer open product details — scroll-phase tap escape now requires dist < 30px (quick flicks travel 50-200px and are correctly ignored)

## 1.16.19
- Fix: scrolling no longer opens product details — touchcancel handler now requires zero finger movement before treating a cancelled touch as a tap (browser fires touchcancel when taking over for scrolling)
- Fix: idle-phase tap detection restored distance guard (30px) alongside bounding-rect to prevent slow scrolls from triggering taps

## 1.16.18
- Fix: idle-phase tap detection now uses bounding-rect instead of 15px distance threshold — tolerates natural finger drift at bottom-of-screen without false negatives
- Fix: added touchcancel handler — if the OS/WebView gesture recogniser cancels a tap (common near iOS home indicator and Android nav bar), the tap is still delivered
- Fix: overlay close is debounced for 500ms after opening — prevents any phantom click race from closing the overlay before the user sees it

## 1.16.17
- Fix: bottom-of-screen products now open on first tap — replaced brittle pixel-distance scroll-phase escape with bounding-rect check (if finger lifts within the row it is always a tap, regardless of overscroll drift)
- Fix: added touch-action:manipulation to product rows — eliminates 300ms click delay and browser gesture ambiguity in WebViews
- Fix: all overlay buttons (Keep in stock, +1, Open 1) now have the interactive guard — no button can be pressed during the 500ms anti-phantom-click window
- Fix: increased overlay interactive guard from 350ms to 500ms for extra safety on slow-click WebViews

## 1.16.16
- Fix: phantom synthetic click no longer closes overlay or presses overlay buttons — overlay is fully pointer-events inert for 350ms after opening, blocking the browser's delayed synthetic click from reaching any element (backdrop, close button, action buttons)
- Fix: relaxed scroll-phase tap escape from 200ms/15px to 400ms/20px so bottom-of-screen taps that get briefly misclassified as scrolls still correctly open the detail overlay

## 1.16.15
- Fix: all stock-mutating actions now have a 5-second undo toast — Add (+1 from list swipe and overlay), Consume -1 (overlay), Open 1 (swipe-down and overlay) all now use the same deferred-commit + undo pattern that Consume and Consume All already had

## 1.16.14
- Fix: bottom products are now fully tappable in the HA companion app — added `viewport-fit=cover` and `env(safe-area-inset-bottom)` padding so the home indicator / gesture bar no longer obscures the last rows
- Fix: "Consume all" now has a 5-second undo toast (same as single consume) — action is deferred and can be cancelled before it commits

## 1.16.13
- Feature: Product thumbnails in the stock list now load as compressed 128×128 JPEG thumbnails instead of full-size images — significantly faster on large stock lists; detail overlay still shows the full-size image

## 1.16.12
- Fix: Tapping the bottom product in a long list now reliably opens the detail overlay (removed overly strict 250ms tap-time guard; added tap-escape for touches briefly misclassified as scrolls due to small vertical drift)
- Fix: "Consume all" no longer fires accidentally on a subsequent tap after a failed bottom-item tap (onClick fallback now updates lastTouchRef; destructive overlay buttons disabled for 300ms after overlay opens to block phantom synthetic clicks)

## 1.16.11
- Stability: Storage health check now caps at 60 retries with retry counter and error state UI with manual retry button instead of silent infinite loop
- Stability: nginx Storage proxy timeout raised from 30s to 120s read (prevents 504 during optimize), added explicit send timeout

## 1.16.10
- Cleanup: updated README to describe HA-Storage architecture (removed Grocy references)

## 1.16.9
- Scanning an unknown product multiple times while it is being discovered now accumulates count; all scanned units are added to stock when discovery completes (toast shows "×N when found" then "Discovered: … +N more added")

## 1.16.8
- Barcode scanner plays an audible blip (Web Audio API) on every successful scan, both in regular and inventory mode

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
