# Changelog

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
