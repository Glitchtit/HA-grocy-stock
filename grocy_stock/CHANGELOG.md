# Changelog

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
