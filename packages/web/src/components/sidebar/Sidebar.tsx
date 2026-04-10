import { useState } from 'react';
import type { WebSocketClient } from '../../services/websocket-client';
import { WorkspaceSelector } from './WorkspaceSelector';
import { WorkflowPanel, type WorkflowState } from '../workflow/WorkflowPanel';
import './Sidebar.css';

interface SidebarProps {
  ws: WebSocketClient | null;
  workflowState: WorkflowState;
  onWorkflowStateChange: (partial: Partial<WorkflowState>) => void;
}

export function Sidebar({ ws, workflowState, onWorkflowStateChange }: SidebarProps) {
  const [activeCwd, setActiveCwd] = useState<string | null>(null);

  return (
    <div className="plurics-sidebar">
      <div className="plurics-sidebar-app-header">Plurics</div>

      <div className="plurics-sidebar-section">
        <div className="plurics-sidebar-section-label">Workspace</div>
        <WorkspaceSelector
          onSelect={(ws) => { setActiveCwd(ws.path); }}
          onNewPath={(p) => { setActiveCwd(p); }}
          locked={!!activeCwd}
          onUnlock={() => setActiveCwd(null)}
        />
      </div>

      <div className="plurics-sidebar-divider" />

      <WorkflowPanel
        ws={ws}
        workspacePath={activeCwd}
        workflowState={workflowState}
        onStateChange={onWorkflowStateChange}
      />
    </div>
  );
}
