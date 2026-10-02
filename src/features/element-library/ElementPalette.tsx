import { ELEMENT_SPECS } from '../../domain';
import type { ElementKind } from '../../types';

interface ElementPaletteProps { onAdd: (kind: ElementKind) => void; }

export function ElementPalette({ onAdd }: ElementPaletteProps) {
  return (
    <section className="panel palette-panel">
      <div className="panel-heading"><div><span className="section-kicker">ELEMENT LIBRARY</span><h2>元素库</h2></div><span className="count-badge">4</span></div>
      <p className="panel-hint">选择一个元素加入场地，再拖动它调整位置。</p>
      <div className="palette-list">
        {(Object.keys(ELEMENT_SPECS) as ElementKind[]).map((kind) => {
          const item = ELEMENT_SPECS[kind];
          return <button className="palette-item" key={kind} type="button" onClick={() => onAdd(kind)}>
            <span className="palette-icon" style={{ background: item.color }}>{item.icon}</span>
            <span className="palette-copy"><strong>{item.label}</strong><small>{item.width} × {item.height} m</small></span>
            <span className="add-mark">+</span>
          </button>;
        })}
      </div>
    </section>
  );
}
