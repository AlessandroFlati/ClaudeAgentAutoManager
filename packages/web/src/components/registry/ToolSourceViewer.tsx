import { useState, useEffect } from 'react';
import { getToolSource } from '../../services/api';

interface ToolSourceViewerProps {
  toolName: string;
  toolVersion: string;
}

export function ToolSourceViewer({ toolName, toolVersion }: ToolSourceViewerProps) {
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getToolSource(toolName, toolVersion)
      .then(s => setSource(s))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [toolName, toolVersion]);

  function handleCopy() {
    if (source) navigator.clipboard.writeText(source).catch(() => undefined);
  }

  if (loading) {
    return <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-secondary, #888)' }}>Loading source…</div>;
  }
  if (error) {
    return <div style={{ padding: 16, fontSize: 12, color: '#f87171' }}>{error}</div>;
  }
  if (source === null) return null;

  const lines = source.split('\n');

  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 12px', flexShrink: 0 }}>
        <button
          onClick={handleCopy}
          style={{
            fontSize: 11,
            padding: '3px 10px',
            background: 'transparent',
            border: '1px solid var(--color-border, #555)',
            borderRadius: 4,
            color: 'var(--color-text-secondary, #888)',
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
          }}
        >
          Copy
        </button>
      </div>
      <pre style={{
        margin: 0,
        flex: 1,
        overflow: 'auto',
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: 1.5,
        background: '#111',
        padding: 12,
        borderRadius: 4,
        color: 'var(--color-text-primary)',
      }}>
        {lines.map((line, i) => (
          <span key={i} style={{ display: 'block' }}>
            <span style={{
              display: 'inline-block',
              width: 36,
              color: 'rgba(255,255,255,0.3)',
              userSelect: 'none',
              textAlign: 'right',
              marginRight: 12,
            }}>
              {String(i + 1).padStart(3, ' ')}
            </span>
            {line}
          </span>
        ))}
      </pre>
    </div>
  );
}
