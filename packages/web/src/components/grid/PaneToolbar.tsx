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
      <button className="pane-toolbar-btn" onClick={onSplitH} title="Split horizontally">
        ⊟
      </button>
      <button className="pane-toolbar-btn" onClick={onSplitV} title="Split vertically">
        ⊞
      </button>
      {canMerge && (
        <button className="pane-toolbar-btn pane-toolbar-btn--merge" onClick={onMerge} title="Close pane (keep this one)">
          ✕
        </button>
      )}
    </div>
  );
}
