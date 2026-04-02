import type { TerminalInfo } from '../../types';
import type { WebSocketClient } from '../../services/websocket-client';

interface TerminalGridProps {
  terminals: TerminalInfo[];
  ws: WebSocketClient | null;
}

export function TerminalGrid(_props: TerminalGridProps) {
  return <div>Grid placeholder</div>;
}
