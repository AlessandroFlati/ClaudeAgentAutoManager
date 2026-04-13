import { useState, useEffect } from 'react';
import type { ToolInvocationRecord } from '../../types';
import { getToolInvocations } from '../../services/api';

interface ToolInvocationHistoryProps {
  toolName: string;
  toolVersion: string;
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '—';
  const ms = Date.parse(completedAt) - Date.parse(startedAt);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function ToolInvocationHistory({ toolName, toolVersion }: ToolInvocationHistoryProps) {
  const [invocations, setInvocations] = useState<ToolInvocationRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getToolInvocations(toolName, toolVersion)
      .then(data => setInvocations(data))
      .catch(() => setInvocations([]))
      .finally(() => setLoading(false));
  }, [toolName, toolVersion]);

  if (loading) {
    return <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-secondary, #888)' }}>Loading history…</div>;
  }

  if (invocations.length === 0) {
    return <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-secondary, #888)' }}>No invocations recorded.</div>;
  }

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--color-bg-elevated, #1e1e1e)', position: 'sticky', top: 0 }}>
            {['Run ID', 'Node', 'Scope', 'Result', 'Duration', 'Time'].map(col => (
              <th key={col} style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--color-text-secondary, #888)', fontWeight: 600 }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {invocations.map(inv => (
            <tr key={inv.invocationId} style={{ borderBottom: '1px solid var(--color-border, #333)' }}>
              <td style={{ padding: '5px 10px', fontFamily: 'monospace', fontSize: 11 }}>
                {inv.runId.slice(0, 8)}
              </td>
              <td style={{ padding: '5px 10px' }}>{inv.nodeName}</td>
              <td style={{ padding: '5px 10px', color: 'var(--color-text-secondary, #888)' }}>—</td>
              <td style={{ padding: '5px 10px' }}>
                {inv.success
                  ? <span style={{ color: '#4ade80' }}>ok</span>
                  : <span style={{ color: '#f87171' }}>fail</span>
                }
              </td>
              <td style={{ padding: '5px 10px' }}>{formatDuration(inv.startedAt, inv.completedAt)}</td>
              <td style={{ padding: '5px 10px', color: 'var(--color-text-secondary, #888)' }}>
                {formatRelative(inv.startedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
