import { useEffect, useRef, useState } from 'react';
import { WebSocketClient } from './services/websocket-client';
import { initTerminalStore, useTerminals } from './stores/terminal-store';
import { SplitLayout } from './components/grid/SplitLayout';
import { TerminalManager } from './components/sidebar/TerminalManager';
import { type LayoutNode, createPreset, assignTerminals, splitLeaf, mergePane } from './components/grid/split-tree';

const wsUrl = `ws://${window.location.hostname}:${window.location.port}/ws`;

export function App() {
  const wsRef = useRef<WebSocketClient | null>(null);
  const terminals = useTerminals();
  const [layout, setLayout] = useState<LayoutNode>({ type: 'leaf', terminalId: null });
  const [cwd, setCwd] = useState<string | null>(null);

  useEffect(() => {
    const ws = new WebSocketClient(wsUrl);
    wsRef.current = ws;
    const unsub = initTerminalStore(ws);
    ws.connect();
    return () => {
      unsub();
      ws.disconnect();
    };
  }, []);

  const terminalMap = new Map(terminals.map(t => [t.id, t]));

  function handlePresetSelect(_label: string, cols: number, rows: number) {
    const tree = createPreset(cols, rows);
    const terminalIds = terminals.map(t => t.id);
    setLayout(assignTerminals(tree, terminalIds));
  }

  function handleSpawn(name: string, spawnCwd: string) {
    setCwd(spawnCwd);
    wsRef.current?.send({ type: 'terminal:spawn', name, cwd: spawnCwd });
  }

  function handleSpawnInSlot(_leafPath: string) {
    if (!cwd) return;
    const name = `agent-${terminals.length + 1}`;
    wsRef.current?.send({ type: 'terminal:spawn', name, cwd });
  }

  function handleKill(id: string) {
    wsRef.current?.send({ type: 'terminal:kill', terminalId: id });
  }

  function handleSplitH(terminalId: string) {
    setLayout(prev => splitLeaf(prev, terminalId, 'horizontal'));
  }

  function handleSplitV(terminalId: string) {
    setLayout(prev => splitLeaf(prev, terminalId, 'vertical'));
  }

  function handleMerge(terminalId: string) {
    setLayout(prev => mergePane(prev, terminalId));
  }

  // When a new terminal is created, assign it to the first empty slot
  useEffect(() => {
    setLayout(prev => {
      const assignedIds = new Set<string>();
      function collectAssigned(node: LayoutNode) {
        if (node.type === 'leaf' && node.terminalId) assignedIds.add(node.terminalId);
        if (node.type === 'split') { node.children.forEach(collectAssigned); }
      }
      collectAssigned(prev);

      const unassigned = terminals.filter(t => !assignedIds.has(t.id));
      if (unassigned.length === 0) return prev;

      let tree = prev;
      for (const t of unassigned) {
        let placed = false;
        function placeInEmpty(node: LayoutNode): LayoutNode {
          if (placed) return node;
          if (node.type === 'leaf' && node.terminalId === null) {
            placed = true;
            return { type: 'leaf', terminalId: t.id };
          }
          if (node.type === 'split') {
            return {
              type: 'split', direction: node.direction, ratio: node.ratio,
              children: [placeInEmpty(node.children[0]), placeInEmpty(node.children[1])],
            };
          }
          return node;
        }
        tree = placeInEmpty(tree);
        if (!placed) {
          function findLastTerminalId(node: LayoutNode): string | null {
            if (node.type === 'leaf') return node.terminalId;
            return findLastTerminalId(node.children[1]) ?? findLastTerminalId(node.children[0]);
          }
          const lastId = findLastTerminalId(tree);
          if (lastId) {
            tree = splitLeaf(tree, lastId, 'horizontal');
            placed = false;
            tree = placeInEmpty(tree);
          }
        }
      }
      return tree;
    });
  }, [terminals]);

  // Remove exited terminals from layout
  useEffect(() => {
    const activeIds = new Set(terminals.map(t => t.id));
    setLayout(prev => {
      function clean(node: LayoutNode): LayoutNode {
        if (node.type === 'leaf') {
          if (node.terminalId && !activeIds.has(node.terminalId)) {
            return { type: 'leaf', terminalId: null };
          }
          return node;
        }
        return {
          type: 'split', direction: node.direction, ratio: node.ratio,
          children: [clean(node.children[0]), clean(node.children[1])],
        };
      }
      return clean(prev);
    });
  }, [terminals]);

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-ui)' }}>
      <TerminalManager
        terminals={terminals}
        onSpawn={handleSpawn}
        onKill={handleKill}
        onPresetSelect={handlePresetSelect}
      />
      <SplitLayout
        layout={layout}
        terminals={terminalMap}
        ws={wsRef.current}
        onSpawnInSlot={handleSpawnInSlot}
        onSplitH={handleSplitH}
        onSplitV={handleSplitV}
        onMerge={handleMerge}
      />
    </div>
  );
}
