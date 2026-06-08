# Smart Park & Ride

Smart Park & Ride is a robust parking reservation and check-in system designed for managed park-and-ride facilities. It features real-time slot booking, license-plate validation, and operator tools (including HTML5 camera QR ticket scanning and analytics dashboards).

## Quick Start

### 1. Launch Services
Ensure you have Docker Desktop installed. Build and start the backend infrastructure (FastAPI, PostgreSQL, Redis) from the root directory:
```bash
docker-compose up --build
```
* **API Server:** `http://localhost:8000`

### 2. Launch Operator/User Frontend
Run a local static web server inside the `frontend` folder:
```bash
cd frontend
python -m http.server 5500
```
* **User Booking Portal:** `http://localhost:5500/index.html`
* **Operator Admin Dashboard:** `http://localhost:5500/admin.html`

### 3. Log In Credentials
Default login roles configured in `docker-compose.yml`:
* **Administrator:** `admin` / `password123`
* **Operator:** `operator` / `operator123`

---

## Documentation Directory
- **[ARCHITECTURE.md](file:///c:/Users/Admin/Documents/GitHub/smart-park-and-ride/ARCHITECTURE.md)**: Details backend architecture principles, booking lifecycle state machine, and configuration mechanisms.
- **[FEATURES.md](file:///c:/Users/Admin/Documents/GitHub/smart-park-and-ride/FEATURES.md)**: Lists completed capabilities grouped by phases.
- **[SETUP.md](file:///c:/Users/Admin/Documents/GitHub/smart-park-and-ride/SETUP.md)**: Elaborates on prerequisites, configuration parameters, and manual verification steps.
- **[STATE.md](file:///c:/Users/Admin/Documents/GitHub/smart-park-and-ride/STATE.md)**: Single source of truth tracking completed tasks, current milestone (Phase 4), and remaining targets.
