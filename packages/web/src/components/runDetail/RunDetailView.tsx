import { useState, useEffect, useCallback } from 'react';
import type { WebSocketClient } from '../../services/websocket-client';
import type { RunSummary, NodeState, ServerMessage } from '../../types';
import { getRun, getRunNodes } from '../../services/api';
import { useWorkflowEvents } from '../../hooks/useWorkflowEvents';
import { RunMetadataHeader } from './RunMetadataHeader';
import { RightPanelTabs } from './RightPanelTabs';
import { DagVisualization } from '../workflow/DagVisualization';

interface RunDetailViewProps {
  runId: string;
  wsClient: WebSocketClient | null;
  onNavigateToTool: (toolName: string) => void;
}

export function RunDetailView({ runId, wsClient, onNavigateToTool }: RunDetailViewProps) {
  const [run, setRun] = useState<RunSummary | null>(null);
  const [nodes, setNodes] = useState<NodeState[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setSelectedNode(null);
    Promise.all([getRun(runId), getRunNodes(runId)])
      .then(([r, n]) => {
        setRun(r);
        setNodes(n);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [runId]);

  const handler = useCallback((msg: ServerMessage) => {
    if (msg.type === 'node:state_changed' && msg.runId === runId) {
      setNodes(prev => prev.map(n =>
        n.nodeName === msg.nodeName && n.scope === msg.scope
          ? { ...n, state: msg.state }
          : n
      ));
    } else if (msg.type === 'workflow:state_changed' && msg.runId === runId) {
      setRun(prev => prev ? { ...prev, status: msg.status } : prev);
    }
  }, [runId]);

  useWorkflowEvents(wsClient, runId, handler);

  const dagNodes = nodes.map(n => ({ name: n.nodeName, state: n.state, scope: n.scope }));

  if (loading || run === null) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-secondary, #888)',
        fontSize: 13,
      }}>
        {loading ? 'Loading run…' : 'Run not found.'}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <RunMetadataHeader run={run} />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* DAG — left 65% */}
        <div style={{ flex: '0 0 65%', overflow: 'hidden', minWidth: 0 }}>
          <DagVisualization
            nodes={dagNodes}
            yamlContent=""
            nodesDetail={nodes}
            selectedNode={selectedNode}
            onNodeSelect={setSelectedNode}
          />
        </div>
        {/* Right panel — 35% */}
        <div style={{
          flex: '0 0 35%',
          borderLeft: '1px solid var(--color-border, #333)',
          overflow: 'hidden',
          minWidth: 0,
        }}>
          <RightPanelTabs
            runId={runId}
            selectedNode={selectedNode}
            wsClient={wsClient}
            onNavigateToTool={onNavigateToTool}
          />
        </div>
      </div>
    </div>
  );
}
