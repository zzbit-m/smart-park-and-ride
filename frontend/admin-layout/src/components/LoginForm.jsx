import { useState } from 'react';
import { login } from '../api';

export default function LoginForm({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username || !password) { setError('Please enter username and password'); return; }
    setLoading(true);
    setError('');
    try {
      await login(username, password);
      onLogin();
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-overlay">
      <div className="login-card">
        <div className="login-logo-row">
          <span className="login-logo">P<span className="accent">&</span>R</span>
          <span className="login-role-badge">ADMIN</span>
        </div>
        <h1 className="login-title">Layout Management</h1>
        <p className="login-sub">เข้าสู่ระบบเพื่อจัดการผังที่จอดรถ</p>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label className="login-label">USERNAME</label>
            <input
              type="text" className="login-input" placeholder="admin"
              value={username} onChange={e => setUsername(e.target.value)}
              autoFocus spellCheck={false} autoComplete="username"
            />
          </div>
          <div className="login-field">
            <label className="login-label">PASSWORD</label>
            <input
              type="password" className="login-input" placeholder="••••••"
              value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ →'}
          </button>
        </form>
      </div>
    </div>
  );
}
