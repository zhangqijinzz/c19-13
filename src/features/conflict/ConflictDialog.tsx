import type { LayoutConflict } from '../../types';

interface ConflictDialogProps {
  conflict: LayoutConflict;
  onKeepLocal: () => void;
  onUseRemote: () => void;
}

const formatTime = (time: number | null) => {
  if (!time) return '未知时间';
  return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const versionSummary = (label: string, document: { title: string; field: { width: number; height: number }; elements: unknown[] }, time: number | null) => <div className="conflict-version">
  <span>{label}</span>
  <strong>{document.title}</strong>
  <small>{document.elements.length} 个元素 · {document.field.width}×{document.field.height} m · {formatTime(time)}</small>
</div>;

export const ConflictDialog = ({ conflict, onKeepLocal, onUseRemote }: ConflictDialogProps) => <div className="conflict-backdrop" role="presentation">
  <section className="conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" aria-describedby="conflict-description">
    <div className="conflict-icon">!</div>
    <h2 id="conflict-title">检测到布局版本冲突</h2>
    <p id="conflict-description">另一个标签页已经保存了不同布局。请选择要继续编辑的版本；被放弃的改动不会被自动合并。</p>
    <div className="conflict-versions">
      {versionSummary('当前标签页', conflict.local, conflict.detectedAt)}
      {versionSummary('其他标签页', conflict.remote, conflict.remoteUpdatedAt)}
    </div>
    <div className="conflict-actions">
      <button type="button" className="conflict-button secondary" onClick={onUseRemote}>使用其他标签页版本</button>
      <button type="button" className="conflict-button primary" onClick={onKeepLocal}>保留当前版本并覆盖</button>
    </div>
  </section>
</div>;
