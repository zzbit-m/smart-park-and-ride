export default function ZoneRow({ index, data, onChange, onRemove, canRemove }) {
  return (
    <div className="zone-row">
      <div className="zone-field zone-field--name">
        <label>ZONE</label>
        <input
          type="text" placeholder="Zone A"
          value={data.zone_name || ''}
          onChange={e => onChange(index, 'zone_name', e.target.value)}
        />
      </div>
      <div className="zone-field zone-field--num">
        <label>ROWS</label>
        <input
          type="number" min="1"
          value={data.rows ?? 1}
          onChange={e => onChange(index, 'rows', parseInt(e.target.value) || 1)}
        />
      </div>
      <div className="zone-field zone-field--num">
        <label>COLS</label>
        <input
          type="number" min="1"
          value={data.cols ?? 1}
          onChange={e => onChange(index, 'cols', parseInt(e.target.value) || 1)}
        />
      </div>
      <div className="zone-field zone-field--prefix">
        <label>PREFIX</label>
        <input
          type="text" placeholder="A" maxLength={5}
          value={data.slot_prefix || ''}
          onChange={e => onChange(index, 'slot_prefix', e.target.value.toUpperCase())}
        />
      </div>
      <div className="zone-field zone-field--type">
        <label>TYPE</label>
        <select
          value={data.slot_type || 'standard'}
          onChange={e => onChange(index, 'slot_type', e.target.value)}
        >
          <option value="standard">Standard</option>
          <option value="disabled">Disabled</option>
          <option value="ev">EV</option>
          <option value="motorcycle">Motorcycle</option>
        </select>
      </div>
      <button
        className="zone-remove-btn"
        onClick={() => onRemove(index)}
        disabled={!canRemove}
        title="Remove zone"
      >
        ✕
      </button>
    </div>
  );
}
