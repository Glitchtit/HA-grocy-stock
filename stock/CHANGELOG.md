## 2.6.0
- 📌 pinning a shopping list item is now permanent for that product: once you pin a brand it stays pinned for all future shopping, even after the item is ticked off and re-added. Pinning one row lights up every row of the same product at once. (Backed by Storage's new per-product `pin_brand` preference.)

## 2.5.2
- The 📌 pin on shopping list rows now clearly shows its state: unpinned pins are dimmed and greyed out, a pinned pin lights up full-colour inside an orange chip with a ring. Previously a pinned item looked almost identical to an unpinned one — the only hint was the hover tooltip.

## 2.5.1
- Swiping a just-scanned item down during a shopping scan now counts as a correction, not a consumption. Scan 2 by mistake and dial it back to 1 and the history shows a clean purchase of 1 — no more phantom "consumed 1" entry inflating your stats.

## 2.5.0
- Smarter shopping list: if you buy a different brand of something still on the list, finishing a shopping scan now pops a dialog proposing to tick it off (powered by Storage's AI reconcile) — e.g. you listed one Gouda but bought another, or any Béarnaise for a listed Béarnaise. Confirm the matches or skip; the usual "who shopped/scanned" chore-credit prompt follows either way. Falls back silently when the AI is unavailable.
- Each shopping list row has a 📌 pin toggle to lock it to the exact brand. Pinned items are excluded from cross-brand matching (only that exact product ticks them off).

## 2.4.3
- Reordered the shopping list overlay sections so the actual list comes first, followed by Suositukset, Ehdotus, and Toistuvat ostokset. The predictive Ehdotus panel no longer pushes the real list down off the top.

## 2.4.2
- Consume hand-scanner mode now auto-finishes after 1 minute of inactivity instead of 5. Each consume scan commits immediately, so the shorter idle timeout closes the mode sooner without losing anything. Other scan modes (shopping, inventory, add-to-list) keep the 5-minute timeout.

## 2.4.1
- Fix: row swipe (add/remove) and hold-to-swipe gestures stopped working on devices with the hardware scanner enabled. The always-focused scan-capture input re-asserted focus on every `focusout`; on Android the drag-start blur triggered a refocus mid-gesture, which cancelled the touch. Refocus is now suppressed while a finger is down and restored when the gesture ends, so scans still land and gestures work again. Devices without the scanner were never affected.

## 2.4.0
- Hands-free scan modes via printed EAN-8 "control code" tags. Scan a tag to enter a mode, scan products, and scan the same tag again to finish: `00000000` shopping, `00000178` consume, `00000246` inventory, `00000314` add to shopping list. A mode also auto-finishes after 5 minutes of inactivity (inventory counts still commit). Scanning a different control tag while a mode is active is ignored.
- New "Consume" scan mode (also a ➖ button in the Scan menu): scan a product to remove one from stock, with a running list and toast per item.
- Hardware-scanner input is now a single always-on capture point routed through one place, replacing the per-overlay listeners.

## 2.3.3
- Hardware-scanner capture now uses a read-only input, so Android's on-screen keyboard no longer pops up (or lingers after pressing Finish) in any scan mode — shopping, inventory, or add-to-shopping-list.
- The same-item cooldown ("Already scanned — wait a moment") is now skipped for hardware-scanner scans, since the scanner debounces itself. Rapidly scanning the same item repeatedly works without errors. The camera reader keeps the cooldown.

## 2.3.2
- Rework how hardware-scanner input is captured. Scans in the list-only overlays (and idle on the stock screen) now go through a focused, hidden input with the on-screen keyboard suppressed — the same mechanism that already works in other apps' text fields — instead of a document-level key listener. This fixes Bluetooth scans that worked for the first couple of items and then captured only part of the barcode or stopped entirely until the scanner was reconnected. No timing heuristics; the full barcode plus its Enter terminator is read directly.

## 2.3.1
- Fix Bluetooth barcode scans being truncated to their last few digits (e.g. 5711953182419 read as 53182419), which caused failed lookups and items not landing on the list. The scan detector now classifies a barcode by its average keystroke speed and waits for the terminator, so a Bluetooth latency stall mid-scan no longer splits one barcode into pieces. Normal typing is still left untouched.

## 2.3.0
- Bluetooth (HID) barcode scanner support. When a hardware scanner is detected — or the new "Hardware scanner" toggle in the Scan menu is turned on — the shopping / inventory / add-to-shopping-list flows open a full-screen, camera-less list of scanned items instead of the camera view. The toggle auto-enables the first time a scan is detected.
- Scanning a barcode with HA-stock open and no overlay now opens the shopping list and records the item automatically.

## 2.2.3
- Keeping a child product in stock no longer detaches it from its parent. The "Keep in stock" dialog's "Keep only this" option (and "Keep this as well" when a parent is already kept) now simply sets the child's keep threshold while leaving the parent grouping link intact — a child and its parent can be kept independently. This drops a leftover Grocy workaround (Grocy ignored min_stock on a child that still had a parent_id); HA-Storage has no such limitation. Whether a product's parent is already kept is still surfaced via the keep button's amber state.

## 2.2.2
- Shopping-list rows: a kept-in-stock item that has run fully out of stock now shows a red "Loppu" badge instead of the amber "Vähissä" one. Driven by current stock (a product absent from the stock list = zero on hand); items still above zero but below their keep threshold keep the amber "Vähissä" badge.

## 2.2.1
- Move the "🔁 Toistuvat ostokset" section to the bottom of the shopping-list overlay (below the aisle list and "💡 Suositukset"), so the active list stays at the top.

## 2.2.0
- New "🔁 Toistuvat ostokset" section in the shopping-list overlay: suggests products that are due for restock based on **purchase cadence** (the average interval between past purchases), distinct from the consumption-velocity "💡 Ehdotus" panel. Surfaces frequently-bought and kept-in-stock products when today is within ±1 week of the expected next purchase and the item isn't already on the list or well-stocked. Each row shows the reasoning ("~N pv välein, ostettu M pv sitten"), the suggested amount, and a badge (amber "≈ N pv" when due, red "myöhässä" when overdue); select rows and tap "Lisää valitut" to add them, or "Hylkää" to dismiss.
- Requires HA-storage ≥ 0.13.0 for the new `/api/shopping-list/cadence-suggestions` endpoint. On older versions the request 404s and the section simply stays empty.

## 2.1.2
- Shopping-attribution modal: warn before double-crediting. After picking shoppers and scanners, the modal now queries HA-chores' new `/api/completions/recent` endpoint (filtered to the shopping + scan chore IDs) for each picked person. If anyone has already been credited for shopping or scanning in the last hour, a new "Already credited recently" step lists who/what/when and asks "Continue anyway?" before firing the attribution POSTs. Lookup failures never block — the modal falls through to the original behaviour.
- Requires HA-chores ≥ 0.7.6 for the new endpoint. On older versions the lookup 404s and the check is silently skipped.

## 2.1.1
- Shopping list "sort by store location": expand the Finnish aisle mapping (`FI_AISLE_ORDER` in `App.jsx`) from 32 to ~95 substring keys so far fewer items fall into **Muut**. New keys cover roots/berries/herbs, sausages/cold cuts/ground meat/poultry/shellfish, ready meals (pizza/lasagne/soup), ice cream (filed under Pakaste), pasta/rice/flour/sugar/salt/cereal/sauce/oil/vinegar/legumes, sweets/chocolate/chips/nuts/gum, juice/soft drinks/mineral water, liquor/cider/lonkero/spirits, laundry/dish/household care, shampoo/soap/dental/vitamins/medicine/paper/wipes/diapers, and pet/baby/kids categories. Order is hand-tuned so `Vauvanvaipat` and `Lastenpyyhkeet` land in **Vauva & lemmikki**, not Hygienia.
- Dev-only: `aisleFor()` now emits a `console.debug('[shopping] unmapped product group → Muut:', name)` when a non-empty product-group name fails to match any aisle key. Vite strips this in production builds; use it locally to spot new optimizer-generated category names that need a mapping.

## 2.1.0
- Add **🖨 Tulosta** button in the shopping-list overlay header. Renders the current list grouped by Finnish grocery aisle and POSTs it to the new HA-print add-on for printing on an IP-connected 80mm thermal receipt printer (Xprinter XP-80T compatible). Per-item notes and done-items (struck through) are included; the button is disabled when the list is empty.
- Add `/api/print/` nginx proxy with auto-discovery of the HA-print add-on (matches the existing storage/scraper/chores discovery pattern). Optional `print_url` config override.

## 2.0.4
- Add **"What's new"** popup — when you open Stock after an update, a dismissable modal shows the changelog entries for every version released since your last visit. Markers persist per-browser via `localStorage` (`stock_whatsnew_lastSeen`); first visit silently marks the current version as seen so users don't get a wall of historical changelog on first install

## 2.0.3
- Fix: receipt scan now opens the shopping-attribution modal after a successful commit, matching the continuous shopping scanner. Previously the prompt only ran for barcode-scan sessions, so receipt-based shopping was never credited to HA-chores. The committed line count is passed through as `scanCount` so the modal copy stays accurate.

## 2.0.2
- Fixed "Käytä pian" double-counting expired lots. The overlay was making two `/stock/entries` calls (`expiring_within_days=14` and `expired=true`) and concatenating the results. As of HA-Storage 0.9.4 the first call already includes expired lots, so every expired item appeared twice. Now uses one call; 2.0.1's aggregation also dedupes by lot id as a defensive guard.

## 2.0.1
- "Käytä pian" overlay now aggregates lots by (product_id, best_before_date). Three bread lots all expiring on the same day collapse into one row showing the summed amount, instead of three identical lines. Per-product tap target is preserved.

## 2.0.0
- **BREAKING**: dropped all "grocy" naming. Add-on slug `grocy_stock` → `stock`. Existing installations must be **uninstalled and reinstalled** — HA treats the renamed slug as a new add-on
- Repo renamed from `HA-grocy-stock` to `HA-stock` on GitHub (old URL still 301-redirects)
- Internal: inner dir `grocy_stock/` → `stock/`, s6 service dirs `grocy-stock` → `stock`, scraper auto-discovery now looks up `${REPO_PREFIX}-scraper` (matches the renamed HA-scraper 2.0.0 add-on)
- Frontend: dropped legacy `grocy_id` fallback in barcode-discover result handler — the scraper has been returning `product_id` for many releases
- Docs: stripped vestigial Barcode Buddy mentions from README + copilot-instructions
- Requires HA-scraper 2.0.0 (or compatible) for barcode-discover proxying; the stock add-on auto-detects it by slug `scraper` now

## 1.25.0
- Feat: offline-aware boot. Stock, products, groups, locations, and shopping list are mirrored to localStorage on every successful sync and hydrate the UI on cold start, so the app shows the last-known state immediately even when the Storage backend is unreachable
- Feat: when the background sync fails the existing banner now reads "📡 Offline — näytetään tallennettu tila" instead of asking the user to reload. The poll keeps running and the banner clears automatically once Storage responds
- Cache lives under `stock.offline.v1.*` keys, expires after 24h to avoid stale-forever data
- Deferred (not in this release): full PWA service worker and mutation queue. The plan flagged service-worker + HA-ingress interaction as needing a dedicated spike before committing — left for a future minor. Until then, mutations performed while offline still need a live network call

## 1.24.0
- Feat: new "🧾 Scan receipt" option in the Scan picker. Snap or upload a photo of a grocery receipt — AI parses the lines and shows an editable confirmation sheet
- Feat: each parsed line shows the matched product (or "no match — skipped"), confidence percentage, raw OCR text, and an editable qty. Untick to skip a line; tap "Lisää varastoon" to batch-add
- Feat: image stays in memory only — never uploaded to disk on the Storage backend
- Internal: requires HA-Storage 0.7.0 (new `/api/receipts/parse` and `/api/receipts/commit`) and `ai_provider=claude` with a valid `claude_api_key` for vision. UI shows a clear error when AI is unconfigured

## 1.23.0
- Feat: new "⏳ Käytä pian" header button surfaces stock entries that are about to expire. Tap to open a full-screen view sorted by days-to-expire (expired first, then due in N days)
- Feat: header badge shows the count of urgent items (expired or due within 2 days) in red; button is hidden entirely when nothing is approaching its `best_before_date`
- Feat: tapping a row opens the existing product detail overlay so the user can consume / open / mark spoiled with one tap from there
- Internal: pulls from HA-Storage's existing `GET /api/stock/entries?expiring_within_days` and `?expired=true` — no backend changes required

## 1.22.0
- Feat: shopping list now opens with an "💡 Ehdotus" panel that lists products predicted to deplete within the next week based on consumption velocity. Each row shows a days-to-zero badge (red ≤ 2 days, amber otherwise) and a Finnish reasoning string ("1.2/vk, varastossa 0.5")
- Feat: tick or untick rows then tap "Lisää valitut" to batch-add the selected predictions to the shopping list at the suggested amount (max of `min_stock_amount` and two weeks at current rate). Tap "Hylkää" to dismiss the panel for this session
- Internal: requires HA-Storage 0.6.0 for the new `GET /api/shopping-list/proposal` endpoint; the panel silently stays empty on older versions

## 1.21.0
- Feat: after finishing a shopping-mode scanning session, prompt for who did the shopping and who did the scanning (multi-select, with Skip)
- Feat: each picked person gets the corresponding chore completed in HA-chores with full XP, streak, badge and level-up tracking
- Feat: when at least one scanner is picked, the auto-spawned "Unpack & scan" follow-up chore is suppressed so the chore list doesn't show a duplicate
- Feat: level-up / badge / power-up popups appear inside the Chores add-on on its next open
- Internal: new add-on option `chores_url` (auto-detected by default) plus `/api/chores/` nginx proxy upstream

## 1.20.0
- Feat: shopping list now ends with a "💡 Suositukset" section that lists the 5 most recently fully-consumed products that are not kept in stock. Tap a recommendation to add it to the list. Sourced from HA-Storage's consume history, refreshed each time the list opens
- Feat: product detail overlay reorganised — the +1 / −1 buttons are now side-by-side on their own row, with "Keep in stock" and a new "🛒 Add to Shopping" button on the row below

## 1.19.10
- Fix: barcode-scan adds (both inventory and shopping flows) now also trigger HA-Storage's AI optimizer for newly-discovered products. Previously only the shopping-list quick-add fired the single-fire optimize after 1.19.9; scanned products went unenriched. Refactored the optimize-and-poll logic into a shared `triggerAiOptimize` helper used by both paths. Skipped when the barcode mapped to an already-existing product

## 1.19.9
- AI product enrichment now runs through HA-Storage's `/api/ai/optimize` (the maintained 3-phase pipeline) instead of the scraper's older single-fire AI. After a shopping-list quick-add creates a product, the stock app fires the optimize task directly against HA-Storage and shows a non-blocking "🤖 AI luokittelee tuotetta…" toast. Group / location / unit / parent / best-before / pack now reliably get filled in
- Refresh `allProducts` when the AI task completes so the new metadata appears in the UI without a manual reload

## 1.19.8
- Fix: extend the shopping-list scraper-add poll deadline from 60s to 120s so the scraper add-on has enough time to finish its AI categorisation pass (group / location / best-before / pack) before the frontend resolves the new product. Previously a slow Gemini response could time out the poll, leaving the product without AI-assigned metadata
- Revert: the token-overlap "similar product" heuristic introduced in 1.19.7 has been removed — group / location now come exclusively from the scraper's configured AI optimizer, as intended

## 1.19.7
- Fix: adding a scraped product from the shopping-list search now enriches it properly (picture, group, location, unit when AI is configured). The previous workaround — creating the product locally to avoid the +1 stock side-effect — also stripped out all enrichment. The shopping-list flow now calls the scraper's `/api/add_products` endpoint, which performs a partial sync (creates the product, attaches the barcode, uploads the image, runs AI categorisation) without touching stock. Falls back to a bare create if the scraper is offline

## 1.19.6
- Fix: shopping-list quick-add no longer surfaces unrelated products. Searches like "serto" used to match "Red Bull energiajuoma sokeriton" because the matcher allowed letters to appear anywhere in order. The subsequence fallback has been removed — query letters must now appear contiguously in the product name (substring match)

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
