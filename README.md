# HA-grocy-stock

A Home Assistant Add-on that provides an ingress-compatible frontend
dashboard for **[HA-Storage](https://github.com/Glitchtit/HA-storage)** stock management.

## Features

- 📦 Displays all in-stock products grouped by product group
- 🪗 Collapsible accordion groups with aggregate quantity badges
- 🖼️ Product thumbnail images with symmetrical placeholder fallback
- ➖ One-click **−1** consume button per product with **optimistic UI updates**
- 🔄 Error toast with automatic rollback if the API call fails
- 📱 Responsive layout for both desktop and mobile
- 🔗 Full Home Assistant Ingress compatibility (relative asset paths + ingress-path injection)

## Installation

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Click the ⋮ menu → **Repositories** and add this repository's URL:
   ```
   https://github.com/Glitchtit/HA-apps
   ```
3. Find **Grocy Stock** and click **Install**.
4. Start the add-on — it automatically discovers the HA-Storage instance on the local HA network.
5. The panel will appear in the HA sidebar.

## Repository Structure

```
HA-grocy-stock/
├── repository.json          # Repository metadata for HA add-on store
└── grocy_stock/             # The add-on
    ├── config.json          # HA Add-on manifest
    ├── build.json           # Multi-architecture build configuration
    ├── Dockerfile           # Multi-stage: Node 20 builds React; HA base runs nginx
    ├── nginx.conf.template  # nginx template with Storage proxy + ingress injection
    ├── rootfs/              # Files overlaid onto the container filesystem
    │   └── etc/s6-overlay/s6-rc.d/
    │       ├── grocy-stock/run   # Reads HA options via bashio, starts nginx
    │       └── user/contents.d/  # Registers the service with s6-overlay
    └── frontend/            # Vite + React + Tailwind CSS application
```

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Home Assistant Ingress                                  │
│  (strips /api/hassio_ingress/<token> prefix)             │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│  nginx  (port 8099)                                      │
│  ├─ /api/storage/*  → proxy to HA-Storage REST API       │
│  └─ /*              → serve React SPA (sub_filter        │
│                        injects ingress path)              │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│  HA-Storage REST API                                     │
│  (on your local HA network)                              │
└──────────────────────────────────────────────────────────┘
```

## Development

```bash
cd grocy_stock/frontend
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # production build to grocy_stock/frontend/dist/
```

