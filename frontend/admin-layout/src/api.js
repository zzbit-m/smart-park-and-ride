const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || 'http://localhost:8000';

function getToken() {
  return localStorage.getItem('adminToken');
}

function setToken(token) {
  localStorage.setItem('adminToken', token);
}

function clearToken() {
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminRole');
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getToken()}`,
  };
}

export async function login(username, password) {
  const res = await fetch(`${API}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Login failed');
  setToken(data.token);
  localStorage.setItem('adminRole', data.role);
  return data;
}

export async function fetchCurrentLayout() {
  const res = await fetch(`${API}/api/admin/layout/current`, {
    method: 'GET',
    headers: authHeaders(),
  });
  if (res.status === 401) { clearToken(); throw new Error('Unauthorized'); }
  if (!res.ok) throw new Error(`Failed to fetch layout (${res.status})`);
  return res.json();
}

export async function previewDiff(config) {
  const res = await fetch(`${API}/api/admin/layout/diff`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(config),
  });
  if (res.status === 401) { clearToken(); throw new Error('Unauthorized'); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Preview failed');
  return data;
}

export async function applyLayout(config) {
  const res = await fetch(`${API}/api/admin/layout/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(config),
  });
  if (res.status === 401) { clearToken(); throw new Error('Unauthorized'); }
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.detail || 'Apply failed');
    err.conflicts = data.detail?.conflicts || data.conflicts;
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function isLoggedIn() {
  return !!getToken();
}

export function logout() {
  clearToken();
}
