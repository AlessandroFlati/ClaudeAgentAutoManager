import { useState, useEffect, useCallback } from 'react';
import type { WebSocketClient } from '../../services/websocket-client';
import type { RegistryCategory, ToolSummary, ServerMessage } from '../../types';
import { listCategories, listTools } from '../../services/api';
import { useWorkflowEvents } from '../../hooks/useWorkflowEvents';
import { RegistrySearch } from './RegistrySearch';
import { ToolTree } from './ToolTree';
import { ToolDetailPane } from './ToolDetailPane';

interface RegistryBrowserProps {
  wsClient: WebSocketClient | null;
  initialToolName?: string | null;
}

export function RegistryBrowser({ wsClient, initialToolName }: RegistryBrowserProps) {
  const [categories, setCategories] = useState<RegistryCategory[]>([]);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [selectedTool, setSelectedTool] = useState<{ name: string; version: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  // Load on mount
  useEffect(() => {
    setLoading(true);
    Promise.all([listCategories(), listTools()])
      .then(([cats, ts]) => {
        setCategories(cats);
        setTools(ts);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Re-fetch tools when search changes
  useEffect(() => {
    if (searchQuery === '') return;
    listTools(searchQuery)
      .then(ts => setTools(ts))
      .catch(() => {});
  }, [searchQuery]);

  // Auto-select initialToolName
  useEffect(() => {
    if (!initialToolName) return;
    const found = tools.find(t => t.name === initialToolName);
    if (found) setSelectedTool({ name: found.name, version: found.version });
  }, [initialToolName, tools]);

  const handler = useCallback((_msg: ServerMessage) => {
    // registry:tool_registered is not in the ServerMessage union yet; handle future extension gracefully
  }, []);
  useWorkflowEvents(wsClient, null, handler);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left panel */}
      <div style={{
        width: 280,
        flexShrink: 0,
        borderRight: '1px solid var(--color-border, #333)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <RegistrySearch value={searchQuery} onChange={setSearchQuery} />
        {loading ? (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-secondary, #888)' }}>Loading…</div>
        ) : (
          <ToolTree
            categories={categories}
            tools={tools}
            selectedTool={selectedTool?.name ?? null}
            onSelectTool={(name, version) => setSelectedTool({ name, version })}
          />
        )}
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
        {selectedTool ? (
          <ToolDetailPane toolName={selectedTool.name} toolVersion={selectedTool.version} />
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--color-text-secondary, #888)',
            fontSize: 14,
          }}>
            Select a tool from the list.
          </div>
        )}
      </div>
    </div>
  );
}
