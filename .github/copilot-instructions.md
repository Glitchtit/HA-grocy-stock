# Copilot Instructions

## Project Overview

This is a **Home Assistant add-on** that provides an ingress-compatible stock management dashboard for [Grocy](https://grocy.info/). The add-on runs an nginx server that serves a React SPA and proxies Grocy API requests, injecting the API key server-side so it is never exposed to the browser.

## Architecture

The request flow is: **HA Ingress → nginx (port 8099) → React SPA / Grocy API proxy**.

- The s6-overlay `run` script (`rootfs/etc/s6-overlay/s6-rc.d/grocy-stock/run`) reads HA add-on options via bashio, renders the nginx config with `envsubst`, and starts nginx.
- nginx serves the built React app from `/var/www/html`, proxies `/api/grocy/*` to the Grocy instance (adding the `GROCY-API-KEY` header), and injects the HA ingress path into a `<meta>` tag via `sub_filter`.
- The React app reads `<meta name="ingress-path">` at startup to prefix all API calls, making URLs work both inside HA ingress and standalone.

The Dockerfile is a **multi-stage build**: Node 20 builds the React frontend, then the HA base image runs nginx.

## Development Commands

All frontend commands run from `grocy_stock/frontend/`:

```bash
npm install        # install dependencies
npm run dev        # dev server at localhost:5173
npm run build      # production build to dist/
```

Set `VITE_GROCY_BASE_URL` and `VITE_GROCY_API_KEY` environment variables when running the dev server against a real Grocy instance.

There is no test suite, linter, or formatter configured.

## Key Conventions

- **Single-file React app**: All components (`App`, `ProductThumbnail`, `ProductGroup`, `Toasts`) and API logic live in `App.jsx`. There are no separate component files, hooks, or service modules.
- **Optimistic UI**: The consume action decrements the item count immediately and rolls back on API error. Follow this pattern for any new mutations.
- **Ingress-aware URLs**: All API calls use `${INGRESS_PATH}/api/grocy/...`. Never hard-code absolute paths — always prefix with the ingress path constant.
- **API key is server-side only**: The Grocy API key is added by nginx, not the frontend. The frontend never sends or stores the API key.
- **Relative base path**: Vite is configured with `base: './'` so all asset references are relative, which is required for HA ingress compatibility.

## HA Add-on Structure

- `repository.json` at the repo root registers this as an HA add-on repository.
- The add-on lives in `grocy_stock/`, matching the `slug` in `config.json`.
- `config.json` defines add-on metadata, options schema (`grocy_base_url`, `grocy_api_key`), and ingress settings.
- `build.json` maps architectures to HA base images for multi-arch Docker builds.

## Versioning and Changelog

When making changes that warrant a release, **both files must be updated together**:

1. **`grocy_stock/config.json`** — bump the `"version"` field following [Semantic Versioning](https://semver.org/):
   - **MAJOR** (e.g. 1.0.0 → 2.0.0): breaking changes or major rework.
   - **MINOR** (e.g. 1.0.0 → 1.1.0): new features, backwards-compatible.
   - **PATCH** (e.g. 1.0.0 → 1.0.1): bug fixes, dependency bumps, minor tweaks.

2. **`grocy_stock/CHANGELOG.md`** — add a new section **at the top** of the file, below the `# Changelog` heading. Follow the official Home Assistant add-on changelog format (flat bullet list per version, no date stamps, no category headers):

   ```markdown
   ## 1.1.0

   - Add search bar to filter products
   - Fix image fallback on slow connections
   ```

   **Format rules (match official HA add-ons):**
   - Use `## x.y.z` as the version heading (no `v` prefix).
   - Each change is a single `- ` bullet — concise, user-facing language.
   - Newest version goes first, above all previous entries.
   - No date stamps, no "Added/Changed/Fixed" category sub-headers.
   - Mention dependency or base image updates when relevant (e.g. "Update base image to Alpine 3.19").

The version in `config.json` is what Home Assistant displays to users and uses to detect updates. The `CHANGELOG.md` is shown in the add-on details page. **These must always stay in sync.**
