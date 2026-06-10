import ZoneRow from './ZoneRow';

export default function LayoutForm({
  currentLayout,
  zones, setZones,
  version, setVersion,
  label, setLabel,
  onPreview,
  onApply,
  hasPreviewed,
  diff,
  loading,
  error,
}) {
  function addZone() {
    setZones([...zones, { zone_name: '', rows: 1, cols: 5, slot_prefix: '', slot_type: 'standard' }]);
  }

  function removeZone(i) {
    if (zones.length <= 1) return;
    setZones(zones.filter((_, idx) => idx !== i));
  }

  function updateZone(i, field, value) {
    const updated = zones.map((z, idx) =>
      idx === i ? { ...z, [field]: value } : z
    );
    setZones(updated);
  }

  const totalSlots = zones.reduce((sum, z) => sum + (z.rows || 1) * (z.cols || 1), 0);
  const conflicts = diff?.conflicts || [];
  const canApply = hasPreviewed && conflicts.length === 0 && !loading;

  return (
    <div className="layout-form">
      {/* Current layout info */}
      <div className="card current-card">
        <div className="card-header">
          <h2>Current Layout</h2>
          {currentLayout && (
            <span className="badge">v{currentLayout.version}</span>
          )}
        </div>
        {currentLayout ? (
          <div className="current-info">
            <div className="current-stat">
              <span className="stat-label">Version</span>
              <span className="stat-value">{currentLayout.version}</span>
            </div>
            <div className="current-stat">
              <span className="stat-label">Label</span>
              <span className="stat-value">{currentLayout.label}</span>
            </div>
            <div className="current-stat">
              <span className="stat-label">Zones</span>
              <span className="stat-value">
                {(currentLayout.config?.zones || currentLayout.zones || []).length}
              </span>
            </div>
            <div className="current-stat">
              <span className="stat-label">Layout ID</span>
              <span className="stat-value mono">{currentLayout.id}</span>
            </div>
          </div>
        ) : (
          <p className="text-dim" style={{ padding: '12px 0' }}>No layout applied yet.</p>
        )}
      </div>

      {/* New layout form */}
      <div className="card">
        <div className="card-header">
          <h2>New Layout</h2>
        </div>

        <div className="form-row">
          <div className="form-field form-field--sm">
            <label>VERSION</label>
            <input
              type="number" min="1"
              value={version}
              onChange={e => setVersion(parseInt(e.target.value) || 1)}
            />
          </div>
          <div className="form-field form-field--lg">
            <label>LABEL</label>
            <input
              type="text" placeholder="e.g. Main Lot v3"
              value={label}
              onChange={e => setLabel(e.target.value)}
            />
          </div>
        </div>

        {/* Zone rows */}
        {zones.map((zone, i) => (
          <ZoneRow
            key={i}
            index={i}
            data={zone}
            onChange={updateZone}
            onRemove={removeZone}
            canRemove={zones.length > 1}
          />
        ))}

        <button className="btn-add" onClick={addZone}>
          ➕ Add Zone
        </button>

        <div className="total-slots">
          Total: <span className="total-count">{totalSlots}</span> slots
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="btn-row">
          <button
            className="btn btn-preview"
            onClick={() => onPreview({ version, label, zones })}
            disabled={loading || zones.length === 0}
          >
            {loading ? '⏳ Previewing...' : '🔍 Preview Changes'}
          </button>
          <button
            className="btn btn-apply"
            onClick={() => onApply({ version, label, zones })}
            disabled={!canApply}
            title={
              !hasPreviewed
                ? 'Preview changes first'
                : conflicts.length > 0
                  ? 'Resolve conflicts before applying'
                  : ''
            }
          >
            💾 Apply Layout
          </button>
        </div>
      </div>
    </div>
  );
}
