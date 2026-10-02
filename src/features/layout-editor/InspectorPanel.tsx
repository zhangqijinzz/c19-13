import type { RenderElement } from '../../types';

interface InspectorPanelProps {
  selectedElement: RenderElement | null;
  onRename: (name: string) => void;
  onResize: (width: number, height: number) => void;
  onRotate: () => void;
  onDelete: () => void;
}

export function InspectorPanel({ selectedElement, onRename, onResize, onRotate, onDelete }: InspectorPanelProps) {
  return <section className="panel inspector-panel">
    <div className="panel-heading"><div><span className="section-kicker">SELECTION</span><h2>属性面板</h2></div><span className="selection-indicator" /></div>
    {selectedElement ? <SelectedFields element={selectedElement} onRename={onRename} onResize={onResize} onRotate={onRotate} onDelete={onDelete} /> : <div className="empty-inspector"><span>⌁</span><p>点击场地中的元素<br />开始调整布局</p></div>}
  </section>;
}

interface SelectedFieldsProps { element: RenderElement; onRename: (name: string) => void; onResize: (width: number, height: number) => void; onRotate: () => void; onDelete: () => void; }

function SelectedFields({ element, onRename, onResize, onRotate, onDelete }: SelectedFieldsProps) {
  return <div className="selected-fields">
    <div className="selected-kind"><span className="selected-symbol">{element.kind === 'stage' ? '✦' : element.kind === 'entrance' ? '↗' : element.kind === 'seating' ? '▤' : '▦'}</span><div><strong>{element.kind.toUpperCase()}</strong><small>ID · {element.id.slice(0, 12)}</small></div></div>
    <label className="field-label-input">名称<input aria-label="元素名称" value={element.name} onChange={(event) => onRename(event.target.value)} /></label>
    <div className="dimension-grid"><label>宽度<input aria-label="元素宽度" type="number" min="1" step="0.5" value={element.width} onChange={(event) => onResize(Number(event.target.value), element.height)} /></label><label>深度<input aria-label="元素深度" type="number" min="1" step="0.5" value={element.height} onChange={(event) => onResize(element.width, Number(event.target.value))} /></label></div>
    <div className="transform-readout"><span>位置 <strong>{element.x.toFixed(1)}, {element.y.toFixed(1)}</strong></span><span>旋转 <strong>{element.rotation}°</strong></span><span>占地 <strong>{element.occupiedArea.toFixed(1)} m²</strong></span></div>
    <div className="inspector-actions"><button type="button" className="secondary-button" onClick={onRotate}>↻ 旋转 90°</button><button type="button" className="icon-button danger" aria-label="删除元素" onClick={onDelete}>⌫</button></div>
  </div>;
}
