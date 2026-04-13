import { useState, useEffect } from 'react';

interface RegistrySearchProps {
  value: string;
  onChange: (q: string) => void;
}

export function RegistrySearch({ value, onChange }: RegistrySearchProps) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onChange(localValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [localValue, onChange]);

  return (
    <input
      type="text"
      value={localValue}
      onChange={e => setLocalValue(e.target.value)}
      placeholder="Search tools by name, description, or tag…"
      style={{
        width: '100%',
        boxSizing: 'border-box',
        background: 'var(--color-bg, #181818)',
        border: 'none',
        borderBottom: '1px solid var(--color-border, #333)',
        color: 'var(--color-text-primary)',
        padding: '8px 12px',
        fontSize: 13,
        fontFamily: 'var(--font-ui)',
        outline: 'none',
      }}
    />
  );
}
