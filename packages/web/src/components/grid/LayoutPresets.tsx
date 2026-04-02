interface LayoutPresetsProps {
  onSelect: (cols: number, rows: number) => void;
}

const PRESETS = [
  { label: '1x1', cols: 1, rows: 1 },
  { label: '2x1', cols: 2, rows: 1 },
  { label: '2x2', cols: 2, rows: 2 },
  { label: '3x2', cols: 3, rows: 2 },
  { label: '3x3', cols: 3, rows: 3 },
];

export function LayoutPresets({ onSelect }: LayoutPresetsProps) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {PRESETS.map((p) => (
        <button
          key={p.label}
          onClick={() => onSelect(p.cols, p.rows)}
          style={{
            padding: '4px 8px',
            background: '#3c3c3c',
            color: '#ccc',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
