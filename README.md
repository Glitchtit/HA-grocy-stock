# HA-grocy-stock

A Home Assistant Add-on repository that provides an ingress-compatible frontend
dashboard for [Grocy](https://grocy.info/) stock management.

## Features

- 📦 Displays all in-stock Grocy products grouped by product group
- 🪗 Collapsible accordion groups with aggregate quantity badges
- 🖼️ Product thumbnail images with symmetrical placeholder fallback
- ➖ One-click **−1** consume button per product with **optimistic UI updates**
- 🔄 Error toast with automatic rollback if the API call fails
- 📱 Responsive layout for both desktop and mobile
- 🔐 Grocy API key handled server-side (never exposed to the browser)
- 🔗 Full Home Assistant Ingress compatibility (relative asset paths + ingress-path injection)

## Installation

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Click the ⋮ menu → **Repositories** and add this repository's URL:
   ```
   https://github.com/Glitchtit/HA-grocy-stock
   ```
3. Find **Grocy Stock** and click **Install**.
4. Configure the add-on options:
   - `grocy_base_url` – The base URL of your Grocy instance (e.g. `http://192.168.1.10:9283`)
   - `grocy_api_key` – A Grocy API key with at least read + consume permissions
5. Click **Start**. The panel will appear in the HA sidebar.

## Repository Structure

```
HA-grocy-stock/
├── repository.json          # Repository metadata for HA add-on store
└── grocy_stock/             # The add-on
    ├── config.json          # HA Add-on manifest
    ├── build.json           # Multi-architecture build configuration
    ├── Dockerfile           # Multi-stage: Node 20 builds React; HA base runs nginx
    ├── run.sh               # Reads HA options via bashio, starts nginx
    ├── nginx.conf.template  # nginx template with Grocy proxy + ingress injection
    └── frontend/            # Vite + React + Tailwind CSS application
```

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Home Assistant Ingress                          │
│  (strips /api/hassio_ingress/<token> prefix)     │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│  nginx  (port 8099)                              │
│  ├─ /api/grocy/*  → proxy to Grocy + add API key │
│  └─ /*            → serve React SPA (sub_filter  │
│                      injects ingress path)        │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│  Grocy REST API                                  │
│  (on your local network)                        │
└──────────────────────────────────────────────────┘
```

## Development

```bash
cd grocy_stock/frontend
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # production build to grocy_stock/frontend/dist/
```

Set `VITE_GROCY_BASE_URL` and `VITE_GROCY_API_KEY` environment variables when
running the dev server against a real Grocy instance. For the production add-on
those values come from the HA add-on options and are injected by nginx.
