import { useEffect, useRef, useState } from 'react';
import { WebSocketClient } from './services/websocket-client';
import { Sidebar } from './components/sidebar/Sidebar';
import { useWorkflowState } from './components/workflow/WorkflowPanel';
import { RunHistoryPanel } from './components/runs/RunHistoryPanel';
import { RunDetailView } from './components/runDetail/RunDetailView';
import { RegistryBrowser } from './components/registry/RegistryBrowser';

const wsUrl = `ws://${window.location.hostname}:${window.location.port}/ws`;

type ActiveView = 'run-detail' | 'registry';

const NAV_BTN_BASE: React.CSSProperties = {
  padding: '6px 16px',
  fontSize: 12,
  background: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)',
};

export function App() {
  const wsRef = useRef<WebSocketClient | null>(null);
  const [wsReady, setWsReady] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const [wfState, updateWfState] = useWorkflowState(wsReady ? wsRef.current : null);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('run-detail');
  const [navigateToTool, setNavigateToTool] = useState<string | null>(null);

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

  // When a new run starts via sidebar, select it and switch to run-detail
  useEffect(() => {
    if (wfState.runId) {
      setSelectedRunId(wfState.runId);
      setActiveView('run-detail');
    }
  }, [wfState.runId]);

  function handleNavigateToTool(name: string) {
    setNavigateToTool(name);
    setActiveView('registry');
  }

  function handleSelectView(view: ActiveView) {
    setActiveView(view);
    if (view !== 'registry') setNavigateToTool(null);
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: 'var(--color-bg)',
      color: 'var(--color-text-primary)',
      fontFamily: 'var(--font-ui)',
    }}>
      {/* Top nav strip */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid var(--color-border, #333)',
        background: 'var(--color-bg-elevated, #1e1e1e)',
        flexShrink: 0,
        height: 36,
        paddingLeft: 8,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary, #888)', paddingRight: 16, paddingLeft: 8 }}>
          Plurics
        </span>
        {(['run-detail', 'registry'] as ActiveView[]).map(view => {
          const label = view === 'run-detail' ? 'Runs' : 'Registry';
          const isActive = activeView === view;
          return (
            <button
              key={view}
              onClick={() => handleSelectView(view)}
              style={{
                ...NAV_BTN_BASE,
                color: isActive ? 'var(--color-accent, #569cd6)' : 'var(--color-text-secondary, #888)',
                borderBottom: isActive ? '2px solid var(--color-accent, #569cd6)' : '2px solid transparent',
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Body row */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar — workflow start controls */}
        <Sidebar
          ws={wsRef.current}
          workflowState={wfState}
          onWorkflowStateChange={updateWfState}
        />

        {/* Run history panel — fixed 280px */}
        {activeView === 'run-detail' && (
          <RunHistoryPanel
            selectedRunId={selectedRunId}
            onSelectRun={id => { setSelectedRunId(id); setActiveView('run-detail'); }}
            onResumeRun={id => { setSelectedRunId(id); setActiveView('run-detail'); }}
            wsClient={wsRef.current}
          />
        )}

        {/* Main content area */}
        <div style={{ flex: 1, overflow: 'hidden', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {activeView === 'run-detail' && selectedRunId ? (
            <RunDetailView
              runId={selectedRunId}
              wsClient={wsRef.current}
              onNavigateToTool={handleNavigateToTool}
            />
          ) : activeView === 'registry' ? (
            <RegistryBrowser
              wsClient={wsRef.current}
              initialToolName={navigateToTool}
            />
          ) : (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-secondary, #666)',
              fontSize: 14,
            }}>
              Select a run from the history panel, or start a new workflow.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
