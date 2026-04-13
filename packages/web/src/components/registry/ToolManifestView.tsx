import type { ToolDetail } from '../../types';

interface ToolManifestViewProps {
  tool: ToolDetail;
}

export function ToolManifestView({ tool }: ToolManifestViewProps) {
  return (
    <div style={{ padding: '12px 16px', overflow: 'auto' }}>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.5 }}>
        {tool.description}
      </p>

      {/* Input ports */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary, #888)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          Input Ports
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--color-bg-elevated, #1e1e1e)' }}>
              <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--color-text-secondary, #888)', fontWeight: 600 }}>Name</th>
              <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--color-text-secondary, #888)', fontWeight: 600 }}>Type</th>
              <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--color-text-secondary, #888)', fontWeight: 600 }}>Required</th>
            </tr>
          </thead>
          <tbody>
            {tool.inputPorts.map(port => (
              <tr key={port.name} style={{ borderBottom: '1px solid var(--color-border, #333)' }}>
                <td style={{ padding: '5px 8px', fontFamily: 'monospace', color: 'var(--color-text-primary)' }}>{port.name}</td>
                <td style={{ padding: '5px 8px', color: 'var(--color-text-secondary, #888)' }}>{port.type}</td>
                <td style={{ padding: '5px 8px' }}>
                  {port.required
                    ? <span style={{ color: '#4ade80' }}>● yes</span>
                    : <span style={{ color: 'var(--color-text-secondary, #888)' }}>no</span>
                  }
                </td>
              </tr>
            ))}
            {tool.inputPorts.length === 0 && (
              <tr><td colSpan={3} style={{ padding: '5px 8px', color: 'var(--color-text-secondary, #888)' }}>None</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Output ports */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary, #888)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          Output Ports
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--color-bg-elevated, #1e1e1e)' }}>
              <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--color-text-secondary, #888)', fontWeight: 600 }}>Name</th>
              <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--color-text-secondary, #888)', fontWeight: 600 }}>Type</th>
              <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--color-text-secondary, #888)', fontWeight: 600 }}>Required</th>
            </tr>
          </thead>
          <tbody>
            {tool.outputPorts.map(port => (
              <tr key={port.name} style={{ borderBottom: '1px solid var(--color-border, #333)' }}>
                <td style={{ padding: '5px 8px', fontFamily: 'monospace', color: 'var(--color-text-primary)' }}>{port.name}</td>
                <td style={{ padding: '5px 8px', color: 'var(--color-text-secondary, #888)' }}>{port.type}</td>
                <td style={{ padding: '5px 8px' }}>
                  {port.required
                    ? <span style={{ color: '#4ade80' }}>● yes</span>
                    : <span style={{ color: 'var(--color-text-secondary, #888)' }}>no</span>
                  }
                </td>
              </tr>
            ))}
            {tool.outputPorts.length === 0 && (
              <tr><td colSpan={3} style={{ padding: '5px 8px', color: 'var(--color-text-secondary, #888)' }}>None</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
