import { useState, useEffect } from 'react';
import type { ToolDetail } from '../../types';
import { getToolDetail } from '../../services/api';
import { ToolManifestView } from './ToolManifestView';
import { ToolSourceViewer } from './ToolSourceViewer';
import { ToolInvocationHistory } from './ToolInvocationHistory';

interface ToolDetailPaneProps {
  toolName: string;
  toolVersion: string;
}

type PaneTab = 'overview' | 'source' | 'tests' | 'history';
const TABS: { id: PaneTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'source', label: 'Source' },
  { id: 'tests', label: 'Tests' },
  { id: 'history', label: 'History' },
];

export function ToolDetailPane({ toolName, toolVersion }: ToolDetailPaneProps) {
  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<PaneTab>('overview');

  useEffect(() => {
    setLoading(true);
    getToolDetail(toolName, toolVersion)
      .then(d => setTool(d))
      .catch(() => setTool(null))
      .finally(() => setLoading(false));
  }, [toolName, toolVersion]);

  if (loading) {
    return <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-secondary, #888)' }}>Loading…</div>;
  }
  if (!tool) {
    return <div style={{ padding: 20, fontSize: 13, color: '#f87171' }}>Failed to load tool details.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Title bar */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--color-border, #333)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
        background: 'var(--color-bg-elevated, #1e1e1e)',
      }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{tool.name}</span>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #888)' }}>v{tool.version}</span>
        <span style={{
          fontSize: 10,
          padding: '2px 8px',
          borderRadius: 8,
          background: 'var(--color-accent, #569cd6)',
          color: '#fff',
          fontWeight: 600,
        }}>
          {tool.category}
        </span>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--color-border, #333)',
        flexShrink: 0,
      }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '7px 14px',
                fontSize: 12,
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--color-accent, #569cd6)' : '2px solid transparent',
                color: isActive ? 'var(--color-accent, #569cd6)' : 'var(--color-text-secondary, #888)',
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {activeTab === 'overview' && <ToolManifestView tool={tool} />}
        {activeTab === 'source' && <ToolSourceViewer toolName={toolName} toolVersion={toolVersion} />}
        {activeTab === 'tests' && (
          <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-secondary, #888)' }}>
            Tests viewer coming soon.
          </div>
        )}
        {activeTab === 'history' && <ToolInvocationHistory toolName={toolName} toolVersion={toolVersion} />}
      </div>
    </div>
  );
}
