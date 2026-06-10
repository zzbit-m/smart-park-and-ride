export default function DiffPreview({ diff, loading }) {
  if (loading) {
    return (
      <div className="card diff-card">
        <p className="text-dim">Loading preview...</p>
      </div>
    );
  }

  if (!diff) return null;

  const created = diff.slots_to_create || [];
  const removed = diff.slots_to_remove || [];
  const conflicts = diff.conflicts || [];
  const unchanged = diff.unchanged || 0;

  return (
    <div className="card diff-card">
      <div className="card-header">
        <h2>Preview</h2>
        {diff.dry_run && <span className="badge badge--warn">Dry Run</span>}
      </div>

      {conflicts.length > 0 && (
        <div className="conflict-banner">
          <strong>⚠️ {conflicts.length} conflict(s)</strong> — active bookings on:{' '}
          {conflicts.map(c => c.slot_code).join(', ')}
          <p className="text-sm">Release or complete these bookings before applying.</p>
        </div>
      )}

      <div className="diff-stats">
        <div className="diff-stat diff-stat--create">
          <span className="stat-label">To Create</span>
          <span className="stat-value">{created.length}</span>
        </div>
        <div className="diff-stat diff-stat--remove">
          <span className="stat-label">To Remove</span>
          <span className="stat-value">{removed.length}</span>
        </div>
        <div className="diff-stat diff-stat--keep">
          <span className="stat-label">Unchanged</span>
          <span className="stat-value">{unchanged}</span>
        </div>
        <div className="diff-stat">
          <span className="stat-label">Version</span>
          <span className="stat-value">{diff.version || '—'}</span>
        </div>
        <div className="diff-stat">
          <span className="stat-label">Zones</span>
          <span className="stat-value">{diff.zones || '—'}</span>
        </div>
      </div>

      {created.length > 0 && (
        <div className="diff-list">
          <h4>Slots to create</h4>
          <div className="slot-codes slot-codes--create">
            {created.join(', ')}
          </div>
        </div>
      )}

      {removed.length > 0 && (
        <div className="diff-list">
          <h4>Slots to remove</h4>
          <div className="slot-codes slot-codes--remove">
            {removed.join(', ')}
          </div>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="diff-list">
          <h4>Conflicts</h4>
          <div className="slot-codes slot-codes--conflict">
            {conflicts.map(c => c.slot_code).join(', ')}
          </div>
        </div>
      )}
    </div>
  );
}
