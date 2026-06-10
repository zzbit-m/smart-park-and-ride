import { useState, useEffect, useCallback } from 'react';
import LoginForm from './components/LoginForm';
import LayoutForm from './components/LayoutForm';
import DiffPreview from './components/DiffPreview';
import ConfirmModal from './components/ConfirmModal';
import GridPreview from './components/GridPreview';
import { isLoggedIn, fetchCurrentLayout, previewDiff, applyLayout, logout } from './api';
import './App.css';

export default function App() {
  const [authenticated, setAuthenticated] = useState(isLoggedIn());
  const [currentLayout, setCurrentLayout] = useState(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');

  // Form state
  const [version, setVersion] = useState(1);
  const [label, setLabel] = useState('');
  const [zones, setZones] = useState([{ zone_name: '', rows: 1, cols: 5, slot_prefix: '', slot_type: 'standard' }]);

  // Diff state
  const [diff, setDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [hasPreviewed, setHasPreviewed] = useState(false);

  // Apply state
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingConfig, setPendingConfig] = useState(null);
  const [applying, setApplying] = useState(false);

  // Grid preview toggle
  const [showGrid, setShowGrid] = useState(false);

  const loadCurrent = useCallback(async () => {
    try {
      const data = await fetchCurrentLayout();
      const layout = data?.layout || null;
      setCurrentLayout(layout);

      if (layout) {
        setVersion((layout.version || 0) + 1);
        setLabel(`v${(layout.version || 0) + 1}`);
        const existingZones = (layout.config?.zones || layout.zones || []);
        if (existingZones.length > 0) {
          setZones(existingZones.map(z => ({
            zone_name: z.zone_name || '',
            rows: z.rows || 1,
            cols: z.cols || 1,
            slot_prefix: z.slot_prefix || '',
            slot_type: z.slot_type || 'standard',
          })));
        }
      }
    } catch (err) {
      if (err.message === 'Unauthorized') {
        setAuthenticated(false);
      }
      setError(err.message);
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) loadCurrent();
    else setInitialLoading(false);
  }, [authenticated, loadCurrent]);

  function handleLogin() {
    setAuthenticated(true);
    setError('');
  }

  function handleLogout() {
    logout();
    setAuthenticated(false);
    setDiff(null);
    setHasPreviewed(false);
  }

  async function handlePreview(config) {
    setDiffLoading(true);
    setError('');
    try {
      const result = await previewDiff(config);
      setDiff(result);
      setHasPreviewed(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setDiffLoading(false);
    }
  }

  function handleApplyRequest(config) {
    if (!hasPreviewed) {
      setError('Please preview changes before applying.');
      return;
    }
    setPendingConfig(config);
    setShowConfirm(true);
  }

  async function handleApplyConfirm() {
    if (!pendingConfig) return;
    setApplying(true);
    setError('');
    try {
      const result = await applyLayout(pendingConfig);
      setShowConfirm(false);
      setPendingConfig(null);
      setDiff(null);
      setHasPreviewed(false);
      // Reload current layout
      await loadCurrent();
    } catch (err) {
      setShowConfirm(false);
      setPendingConfig(null);
      if (err.conflicts) {
        setDiff(prev => ({ ...prev, conflicts: err.conflicts }));
        setHasPreviewed(true);
      }
      const msg = err.data?.detail || err.message;
      setError(typeof msg === 'string' ? msg : 'Apply failed due to conflicts');
    } finally {
      setApplying(false);
    }
  }

  if (!authenticated) {
    return <LoginForm onLogin={handleLogin} />;
  }

  if (initialLoading) {
    return (
      <div className="app-shell">
        <div className="loading-screen">
          <p>Loading layout data...</p>
        </div>
      </div>
    );
  }

  const conflicts = diff?.conflicts || [];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <span className="header-logo">P&amp;R</span>
          <h1>Layout Management</h1>
        </div>
        <div className="header-right">
          <label className="grid-toggle" title="Show grid preview">
            <input
              type="checkbox"
              checked={showGrid}
              onChange={e => setShowGrid(e.target.checked)}
            />
            <span>Grid Preview</span>
          </label>
          <button className="btn-logout" onClick={handleLogout}>Logout</button>
          <a className="btn-back" href="/admin.html">← Admin</a>
        </div>
      </header>

      <main className="app-main">
        <LayoutForm
          currentLayout={currentLayout}
          zones={zones} setZones={setZones}
          version={version} setVersion={setVersion}
          label={label} setLabel={setLabel}
          onPreview={handlePreview}
          onApply={handleApplyRequest}
          hasPreviewed={hasPreviewed}
          diff={diff}
          loading={diffLoading || applying}
          error={error}
        />

        <DiffPreview diff={diff} loading={diffLoading} />

        {showGrid && zones.length > 0 && (
          <GridPreview zones={zones} />
        )}

        {!hasPreviewed && diff === null && !diffLoading && (
          <p className="text-dim text-center" style={{ marginTop: 16 }}>
            Preview changes before applying
          </p>
        )}
      </main>

      {error && (
        <div className="toast toast--error">
          {error}
          <button onClick={() => setError('')} className="toast-close">✕</button>
        </div>
      )}

      <ConfirmModal
        visible={showConfirm}
        title="Apply Layout"
        confirmLabel="Apply"
        loading={applying}
        onConfirm={handleApplyConfirm}
        onCancel={() => { setShowConfirm(false); setPendingConfig(null); }}
      >
        <p>Are you sure you want to apply this layout?</p>
        <div className="modal-summary">
          <div><strong>Version:</strong> {pendingConfig?.version}</div>
          <div><strong>Label:</strong> {pendingConfig?.label}</div>
          <div><strong>Zones:</strong> {pendingConfig?.zones?.length}</div>
          <div><strong>Total slots:</strong> {pendingConfig?.zones?.reduce((s, z) => s + (z.rows || 1) * (z.cols || 1), 0)}</div>
        </div>
        {conflicts.length > 0 && (
          <p className="text-warn">⚠️ {conflicts.length} conflict(s) exist but Apply is disabled.</p>
        )}
      </ConfirmModal>
    </div>
  );
}
