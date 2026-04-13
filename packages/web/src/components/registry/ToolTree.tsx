import { useState, useMemo } from 'react';
import type { RegistryCategory, ToolSummary } from '../../types';

interface ToolTreeProps {
  categories: RegistryCategory[];
  tools: ToolSummary[];
  selectedTool: string | null;
  onSelectTool: (name: string, version: string) => void;
}

export function ToolTree({ categories, tools, selectedTool, onSelectTool }: ToolTreeProps) {
  const initExpanded = useMemo(() => {
    const s = new Set<string>();
    if (tools.length < 50) {
      for (const cat of categories) s.add(cat.category);
    }
    return s;
  }, [categories, tools.length]);

  const [expanded, setExpanded] = useState<Set<string>>(initExpanded);

  function toggleCategory(name: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div style={{ overflow: 'auto', flex: 1 }}>
      {categories.map(cat => {
        const catTools = tools.filter(t => t.category === cat.category);
        const isExpanded = expanded.has(cat.category);
        return (
          <div key={cat.category}>
            <div
              onClick={() => toggleCategory(cat.category)}
              style={{
                padding: '8px 12px',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--color-text-primary)',
                borderBottom: '1px solid var(--color-border, #333)',
                userSelect: 'none',
              }}
            >
              <span style={{ fontSize: 10, color: 'var(--color-text-secondary, #888)' }}>
                {isExpanded ? '▼' : '▶'}
              </span>
              <span style={{ flex: 1 }}>{cat.category}</span>
              <span style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 8,
                background: 'var(--color-bg-elevated, #1e1e1e)',
                color: 'var(--color-text-secondary, #888)',
              }}>
                {catTools.length}
              </span>
            </div>
            {isExpanded && catTools.map(tool => {
              const isSelected = selectedTool === tool.name;
              return (
                <div
                  key={`${tool.name}@${tool.version}`}
                  onClick={() => onSelectTool(tool.name, tool.version)}
                  style={{
                    padding: '6px 20px',
                    cursor: 'pointer',
                    background: isSelected ? 'var(--color-bg-elevated, #1e1e1e)' : 'transparent',
                    borderBottom: '1px solid var(--color-border, #222)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--color-text-primary)' }}>
                      {tool.name}
                    </span>
                    <span style={{
                      fontSize: 9,
                      padding: '1px 5px',
                      borderRadius: 6,
                      background: 'var(--color-bg-elevated, #1e1e1e)',
                      color: 'var(--color-text-secondary, #888)',
                      border: '1px solid var(--color-border, #333)',
                    }}>
                      v{tool.version}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {categories.length === 0 && (
        <div style={{ padding: 16, color: 'var(--color-text-secondary, #888)', fontSize: 12 }}>
          No tools found.
        </div>
      )}
    </div>
  );
}
