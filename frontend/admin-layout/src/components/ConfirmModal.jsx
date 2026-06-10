export default function ConfirmModal({ visible, title, children, onConfirm, onCancel, confirmLabel, loading }) {
  if (!visible) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">{title || 'Confirm'}</h3>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? 'Applying...' : confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
