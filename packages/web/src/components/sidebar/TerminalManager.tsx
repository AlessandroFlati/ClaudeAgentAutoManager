import type { TerminalInfo } from '../../types';

interface TerminalManagerProps {
  terminals: TerminalInfo[];
  onSpawn: (name?: string) => void;
  onKill: (id: string) => void;
}

export function TerminalManager(_props: TerminalManagerProps) {
  return <div>Sidebar placeholder</div>;
}
