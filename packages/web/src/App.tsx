import { useEffect, useRef, useState } from 'react';
import { WebSocketClient } from './services/websocket-client';
import { Sidebar } from './components/sidebar/Sidebar';
import { DagVisualization } from './components/workflow/DagVisualization';
import { FindingsPanel } from './components/workflow/FindingsPanel';
import { useWorkflowState } from './components/workflow/WorkflowPanel';

const wsUrl = `ws://${window.location.hostname}:${window.location.port}/ws`;

export function App() {
  const wsRef = useRef<WebSocketClient | null>(null);
  const [wsReady, setWsReady] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const [wfState, updateWfState] = useWorkflowState(wsReady ? wsRef.current : null);
  const [bottomTab, setBottomTab] = useState<'dag' | 'findings'>('dag');

  useEffect(() => {
    const ws = new WebSocketClient(wsUrl);
    wsRef.current = ws;
    setWsReady(true);
    ws.connect();
    return () => {
      ws.disconnect();
      setWsReady(false);
    };
  }, []);

  const showDag = wfState.nodes.length > 0;
  const showFindings = wfState.findings.length > 0;

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: 'var(--color-bg)',
      color: 'var(--color-text-primary)',
      fontFamily: 'var(--font-ui)',
    }}>
      <Sidebar
        ws={wsRef.current}
        workflowState={wfState}
        onWorkflowStateChange={updateWfState}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!showDag && !showFindings && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-secondary, #666)',
            fontSize: 14,
          }}>
            Select a workspace and start a workflow.
          </div>
        )}

        {(showDag || showFindings) && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {(showDag && showFindings) && (
              <div style={{
                display: 'flex',
                gap: 0,
                borderBottom: '1px solid var(--color-border, #333)',
                flexShrink: 0,
              }}>
                <button
                  onClick={() => setBottomTab('dag')}
                  style={{
                    padding: '8px 20px',
                    fontSize: 12,
                    fontWeight: bottomTab === 'dag' ? 600 : 400,
                    background: bottomTab === 'dag' ? 'var(--color-bg, #181818)' : 'transparent',
                    color: bottomTab === 'dag' ? 'var(--color-text-primary)' : 'var(--color-text-secondary, #888)',
                    border: 'none',
                    borderBottom: bottomTab === 'dag' ? '2px solid var(--color-accent, #569cd6)' : '2px solid transparent',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-ui)',
                  }}
                >
                  DAG
                </button>
                <button
                  onClick={() => setBottomTab('findings')}
                  style={{
                    padding: '8px 20px',
                    fontSize: 12,
                    fontWeight: bottomTab === 'findings' ? 600 : 400,
                    background: bottomTab === 'findings' ? 'var(--color-bg, #181818)' : 'transparent',
                    color: bottomTab === 'findings' ? 'var(--color-text-primary)' : 'var(--color-text-secondary, #888)',
                    border: 'none',
                    borderBottom: bottomTab === 'findings' ? '2px solid var(--color-accent, #569cd6)' : '2px solid transparent',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-ui)',
                  }}
                >
                  Findings ({wfState.findings.length})
                </button>
              </div>
            )}
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              {(bottomTab === 'dag' || !showFindings) && showDag && (
                <DagVisualization nodes={wfState.nodes} yamlContent={wfState.yaml} />
              )}
              {bottomTab === 'findings' && showFindings && (
                <FindingsPanel findings={wfState.findings} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
