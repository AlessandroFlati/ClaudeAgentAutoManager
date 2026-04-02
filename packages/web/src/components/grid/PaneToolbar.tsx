import './PaneToolbar.css';

interface PaneToolbarProps {
  terminalId: string;
  onSplitH: () => void;
  onSplitV: () => void;
  onMerge: () => void;
  canMerge: boolean;
}

export function PaneToolbar({ terminalId: _terminalId, onSplitH, onSplitV, onMerge, canMerge }: PaneToolbarProps) {
  return (
    <div className="pane-toolbar">
      <button className="pane-toolbar-btn" onClick={onSplitH} title="Split horizontal">
        H
      </button>
      <button className="pane-toolbar-btn" onClick={onSplitV} title="Split vertical">
        V
      </button>
      {canMerge && (
        <button className="pane-toolbar-btn pane-toolbar-btn--merge" onClick={onMerge} title="Merge (keep this pane)">
          M
        </button>
      )}
    </div>
  );
}
