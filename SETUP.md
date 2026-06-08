# System Installation & Setup

This guide outlines the process to launch, configure, and verify the Smart Park & Ride system.

---

## Prerequisites
* **Docker & Docker Compose:** Installed and active.
* **Python 3.11+** (Optional, only required if launching the frontend server via local python environments).

---

## 🚀 1. Infrastructure Execution

From the repository root, start the main backend infrastructure:
```bash
docker-compose up --build
```

This starts three services:
1. **API Web Server (FastAPI):** Exposed at `http://localhost:8000`
2. **Database Engine (PostgreSQL):** Accessible at port `5432`
3. **Session Cache & Lock Manager (Redis):** Listening at port `6379`

---

## 🖥️ 2. Frontend Launch

Since the client interface is built with static assets, start a simple HTTP server from the `frontend` folder:
```bash
cd frontend
python -m http.server 5500
```
Open the interfaces in your browser:
* **Rider portal:** `http://localhost:5500/index.html`
* **Operator console:** `http://localhost:5500/admin.html`

---

## ⚙️ 3. Environment Configurations

### Backend Setup (`.env`)
Create a `.env` file in the root directory if customizing environment settings. The backend maps configuration properties using the variables below:

| Environment Variable | Description | Default Value |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@db:5432/park_db` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379/0` |
| `ADMIN_USERNAME` | Administrator login | `admin` |
| `ADMIN_PASSWORD` | Administrator password | `password123` |
| `OPERATOR_USERNAME` | Operator login | `operator` |
| `OPERATOR_PASSWORD` | Operator password | `operator123` |
| `CORS_ALLOWED_ORIGINS`| Allowed host domains | `http://localhost:5500,http://127.0.0.1:5500` |

### Frontend Setup (`frontend/config.js`)
Ensure the frontend matches your active API port by configuring the base path in `frontend/config.js`:
```javascript
window.APP_CONFIG = {
  API_BASE: "http://localhost:8000"
};
```

---

## 🔍 4. Verification & Seeding

### Verify Connections
Ensure all backend connections are healthy by querying the health check route:
```bash
curl http://localhost:8000/health
```
A successful response returns: `{"status":"healthy","database":"connected","redis":"connected"}`

### Seed Initial Data
Populate the database with sample slot information.
1. Authenticate to retrieve an Admin token:
   ```bash
   curl -X POST http://localhost:8000/api/v1/auth/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "username=admin&password=password123"
   ```
2. Trigger the seeding execution using the returned token:
   ```bash
   curl -X POST http://localhost:8000/api/v1/admin/seed \
     -H "Authorization: Bearer <ADMIN_TOKEN>"
   ```
