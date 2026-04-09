# Copilot Instructions

## Project Overview

**Stock** is a Home Assistant add-on providing a stock management dashboard. It reads and writes data via the **HA-Storage** REST API (a separate add-on). Features include one-click consume, product grouping, and optional barcode scanning.

## Architecture

Request flow: **HA Ingress → nginx (port 8099) → React SPA / Storage API proxy**.

- The s6-overlay `run` script reads HA add-on options via bashio, renders the nginx config with `envsubst`, and starts nginx.
- nginx serves the built React app from `/var/www/html` and injects the HA ingress path into a `<meta>` tag via `sub_filter`.
- nginx proxy routes:
  - `/api/storage/*` → Storage API (HA-Storage add-on)
  - `/api/scraper/*` → Scraper add-on (for product discovery, optional)
- The React app reads `<meta name="ingress-path">` at startup to prefix all API calls, making URLs work both inside HA ingress and standalone.

The Dockerfile is a **multi-stage build**: Node 20 builds the React frontend, then the HA base image runs nginx.

### Config options

```json
{
  "storage_url": "http://localhost:8099",
  "scraper_url": "url?",
  "debug": false
}
```

No Grocy URL, no API key, no Barcode Buddy — all data access goes through Storage.

## Development Commands

All frontend commands run from `grocy_stock/frontend/`:

```bash
npm install        # install dependencies
npm run dev        # dev server
npm run build      # production build to dist/
```

There is no test suite, linter, or formatter configured.

## Key Conventions

- **Single-file React app**: All components and API logic live in `App.jsx`. There are no separate component files, hooks, or service modules.
- **Dark mode**: Uses Tailwind dark theme (`bg-gray-900` base, `bg-gray-800` cards, emerald accents).
- **Optimistic UI**: Consume/open actions update the UI immediately and roll back on error. Follow this pattern for any new mutations.
- **Ingress-aware URLs**: All API calls use `${INGRESS_PATH}/api/storage/...`. Never hard-code absolute paths — always prefix with the ingress path constant.
- **API keys server-side**: Storage handles auth internally. No API keys are sent or stored by the frontend.
- **Relative base path**: Vite is configured with `base: './'` so all asset references are relative, which is required for HA ingress compatibility.
- **Retry logic**: The frontend health-checks Storage on startup with a loading spinner until the service is available.

## HA Add-on Structure

- The add-on lives in `grocy_stock/`, matching the slug in `config.json`.
- `config.json` defines add-on metadata, options schema, and ingress settings.
- `build.json` maps architectures to HA base images for multi-arch Docker builds.

## Versioning and Changelog

When making user-facing changes, **both files must be updated together**:

| File | Field |
|---|---|
| `grocy_stock/config.json` | `"version": "X.Y.Z"` |
| `grocy_stock/CHANGELOG.md` | New `## X.Y.Z` section |

**CHANGELOG format rules:**
- Use `## x.y.z` as the version heading (no `v` prefix, no dates, no brackets).
- Each change is a single `- ` bullet — concise, user-facing language.
- Newest version goes first, above all previous entries.
- No "Added/Changed/Fixed" category sub-headers.

The version in `config.json` is what Home Assistant displays to users and uses to detect updates. The `CHANGELOG.md` is shown in the add-on details page. **These must always stay in sync.**
