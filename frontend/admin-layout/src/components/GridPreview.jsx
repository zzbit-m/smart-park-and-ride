function slotCode(prefix, rows, cols, row, col) {
  if (rows === 1 && cols <= 10) {
    return `${prefix}${String(col).padStart(2, '0')}`;
  }
  return `${prefix}${String(row).padStart(2, '0')}-${String(col).padStart(2, '0')}`;
}

export default function GridPreview({ zones }) {
  if (!zones || zones.length === 0) return null;

  return (
    <div className="card">
      <div className="card-header">
        <h2>Grid Preview</h2>
      </div>
      <div className="grid-previews">
        {zones.map((zone, zi) => {
          const rows = zone.rows || 1;
          const cols = zone.cols || 1;
          const dense = rows * cols > 20;
          const cells = [];
          for (let r = 1; r <= rows; r++) {
            for (let c = 1; c <= cols; c++) {
              cells.push({ row: r, col: c });
            }
          }
          return (
            <div key={zi} className="grid-zone">
              <h4 className="grid-zone-title">
                {zone.zone_name || `Zone ${zi + 1}`}
                <span className="text-dim"> ({rows}×{cols} = {rows * cols})</span>
              </h4>
              <div
                className={`grid-viz ${dense ? 'grid-viz--dense' : ''}`}
                style={{
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  gridTemplateRows: `repeat(${rows}, auto)`,
                }}
              >
                {cells.map(cell => (
                  <div key={`${cell.row}-${cell.col}`} className="grid-cell">
                    <span className="grid-cell-label">
                      {slotCode(zone.slot_prefix, rows, cols, cell.row, cell.col)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
