import type { ConflictState } from '../../types';

interface ConflictOverlayProps {
  conflict: ConflictState;
  onAdoptRemote: () => void;
  onKeepLocal: () => void;
  onDismiss: () => void;
}

const formatTime = (time: number | null) => time
  ? new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  : '较早前';

export function ConflictOverlay({ conflict, onAdoptRemote, onKeepLocal, onDismiss }: ConflictOverlayProps) {
  if (!conflict) return null;
  const { document, updatedAt } = conflict.remote;
  const time = formatTime(updatedAt);

  if (conflict.kind === 'remote-update') {
    return <div className="conflict-banner" role="status">
      <span className="conflict-icon">⚠</span>
      <div className="conflict-copy">
        <strong>另一个标签页保存了新版本</strong>
        <p>「{document.title}」更新于 {time}。继续保存前请确认保留哪一份，当前编辑不会自动覆盖。</p>
      </div>
      <div className="conflict-actions">
        <button type="button" className="conflict-secondary" onClick={onDismiss}>知道了</button>
        <button type="button" className="conflict-secondary" onClick={onKeepLocal}>保留当前编辑</button>
        <button type="button" className="conflict-primary" onClick={onAdoptRemote}>改用最新版本</button>
      </div>
    </div>;
  }

  return <div className="conflict-backdrop" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
    <div className="conflict-modal">
      <div className="conflict-modal-head">
        <span className="conflict-icon lg">⚠</span>
        <div>
          <h2 id="conflict-title">检测到布局冲突</h2>
          <p>另一个标签页在 {time} 保存了「{document.title}」，与你当前页面的编辑基于不同版本。请选择要保留的内容，被覆盖的版本会先备份到本地，不会丢失。</p>
        </div>
      </div>
      <div className="conflict-cards">
        <div className="conflict-card">
          <span className="conflict-card-tag">另一标签页</span>
          <strong>{document.title}</strong>
          <small>{document.elements.length} 个元素 · {document.field.width}×{document.field.height} m · {time}</small>
        </div>
        <div className="conflict-card current">
          <span className="conflict-card-tag">当前页面</span>
          <strong>{conflict.localDocument.title}</strong>
          <small>{conflict.localDocument.elements.length} 个元素 · {conflict.localDocument.field.width}×{conflict.localDocument.field.height} m · 未保存</small>
        </div>
      </div>
      <div className="conflict-modal-actions">
        <button type="button" className="conflict-secondary" onClick={onAdoptRemote}>采用另一标签页版本</button>
        <button type="button" className="conflict-primary" onClick={onKeepLocal}>保留我的编辑并覆盖</button>
      </div>
    </div>
  </div>;
}
