# Admin Layout Manager

Internal admin tool for managing parking lot layouts.
This is **not** a core production frontend — it is staff-only tooling.

## Scope (hard boundary)

**Allowed**: layout CRUD, diff preview, conflict detection, grid visualization.

**Not allowed**: booking management, QR scanning, real-time dashboard,
slot occupancy views, user management, or any feature that duplicates
`frontend/admin.js`. Requests outside this scope must go to the vanilla
admin panel or wait for a planned frontend unification.

## Tech stack

- React 18 + Vite 5
- No routing library (single-page, no navigation)
- Shares JWT token (`localStorage.adminToken`) with `admin.html`

## Commands

```bash
npm install        # first time
npm run dev        # dev server at http://localhost:5173
npm run build      # production build → dist/
```

## Deployment

The build output (`dist/`) is a set of static files. Serve it at
`/admin-layout/` via:

- **Dev / single-server**: volume-mount `dist/` into the Docker backend
  (set `ADMIN_LAYOUT_DIR` env var).
- **Production with reverse proxy**: nginx location block pointing to the
  build directory on disk or an object store.

Do **not** add features here that belong in `admin.html`/`admin.js`.
If the feature isn't layout management, it doesn't go in this repo directory.

## Architecture boundary

```
admin.html (vanilla JS)
├── Scanner tab
├── Dashboard tab
└── Layout tab → redirects to /admin-layout/ (React SPA)
```
