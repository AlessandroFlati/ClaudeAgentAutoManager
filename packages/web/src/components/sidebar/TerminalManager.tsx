import { useState } from 'react';
import type { TerminalInfo } from '../../types';
import './TerminalManager.css';

interface TerminalManagerProps {
  terminals: TerminalInfo[];
  onSpawn: (name: string, cwd: string) => void;
  onKill: (id: string) => void;
}

export function TerminalManager({ terminals, onSpawn, onKill }: TerminalManagerProps) {
  const [newName, setNewName] = useState('');
  const [cwdInput, setCwdInput] = useState('');
  const [cwdLocked, setCwdLocked] = useState(false);
  const [cwdError, setCwdError] = useState('');
  const [validating, setValidating] = useState(false);

  async function handleSetCwd() {
    const path = cwdInput.trim();
    if (!path) {
      setCwdError('Enter a path');
      return;
    }
    setValidating(true);
    setCwdError('');
    try {
      const res = await fetch('/api/validate-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (data.valid) {
        setCwdLocked(true);
        setCwdError('');
      } else {
        setCwdError(data.error || 'Invalid path');
      }
    } catch {
      setCwdError('Failed to validate path');
    } finally {
      setValidating(false);
    }
  }

  function handleChangeCwd() {
    setCwdLocked(false);
    setCwdError('');
  }

  function handleSpawn() {
    if (!cwdLocked) return;
    const name = newName.trim() || `agent-${terminals.length + 1}`;
    onSpawn(name, cwdInput.trim());
    setNewName('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      handleSpawn();
    }
  }

  function handleCwdKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      handleSetCwd();
    }
  }

  return (
    <div className="terminal-manager">
      <h2 className="terminal-manager-title">Terminals</h2>

      <div className="terminal-manager-cwd">
        <label className="terminal-manager-label">Working directory</label>
        <div className="terminal-manager-cwd-row">
          <input
            type="text"
            value={cwdInput}
            onChange={(e) => setCwdInput(e.target.value)}
            onKeyDown={handleCwdKeyDown}
            placeholder="/path/to/project"
            className={'terminal-manager-input' + (cwdError ? ' terminal-manager-input--error' : '')}
            disabled={cwdLocked || validating}
          />
          {cwdLocked ? (
            <button onClick={handleChangeCwd} className="terminal-manager-btn terminal-manager-btn--secondary">
              Change
            </button>
          ) : (
            <button onClick={handleSetCwd} className="terminal-manager-btn" disabled={validating}>
              {validating ? '...' : 'Set'}
            </button>
          )}
        </div>
        {cwdError && <div className="terminal-manager-error">{cwdError}</div>}
        {cwdLocked && <div className="terminal-manager-success">Path set</div>}
      </div>

      <div className={'terminal-manager-spawn' + (cwdLocked ? '' : ' terminal-manager-spawn--disabled')}>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Terminal name..."
          className="terminal-manager-input"
          disabled={!cwdLocked}
        />
        <button onClick={handleSpawn} className="terminal-manager-btn" disabled={!cwdLocked}>
          Spawn
        </button>
      </div>

      <ul className="terminal-manager-list">
        {terminals.map((t) => (
          <li key={t.id} className="terminal-manager-item">
            <span className="terminal-manager-item-name">{t.name}</span>
            <span className={`terminal-manager-item-status terminal-manager-item-status--${t.status}`}>
              {t.status}
            </span>
            <button
              className="terminal-manager-item-kill"
              onClick={() => onKill(t.id)}
              title="Kill terminal"
            >
              x
            </button>
          </li>
        ))}
        {terminals.length === 0 && (
          <li className="terminal-manager-empty">No terminals running</li>
        )}
      </ul>
    </div>
  );
}
