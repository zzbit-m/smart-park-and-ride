/**
 * config.example.js — Template for frontend runtime configuration.
 *
 * Copy this file to config.js and edit as needed.
 * DO NOT commit config.js to version control when it contains
 * environment-specific values.
 *
 * Usage:
 *   cp frontend/config.example.js frontend/config.js
 */
window.APP_CONFIG = {
  // URL of the FastAPI backend.
  // Local development:  "http://localhost:8000"
  // Device testing:     "http://<your-machine-ip>:8000"
  // Production:         "https://api.your-domain.com"
  API_BASE: "http://localhost:8000",
};
