import { useRef, useState } from 'react';
import { ELEMENT_SPECS } from '../../domain';
import type { LayoutMode, PathPreview, RenderElement } from '../../types';

interface FieldCanvasProps {
  field: { width: number; height: number };
  elements: RenderElement[];
  selectedId: string | null;
  mode: LayoutMode;
  overlaps: Array<{ firstId: string; secondId: string }>;
  bounds: Array<{ elementId: string }>;
  channels: Array<{ firstId: string; secondId: string }>;
  path: PathPreview | null;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}

export function FieldCanvas({ field, elements, selectedId, mode, overlaps, bounds, channels, path, onSelect, onMove }: FieldCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const issueIds = new Set(overlaps.flatMap((item) => [item.firstId, item.secondId]));
  const channelIds = new Set(channels.flatMap((item) => [item.firstId, item.secondId]));
  const boundsIds = new Set(bounds.map((item) => item.elementId));
  const canvasWidth = 100 / Math.max(1, field.width / (field.height * 1.35));

  const pointFromEvent = (event: React.PointerEvent) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: (event.clientX - box.left) * field.width / box.width, y: (event.clientY - box.top) * field.height / box.height };
  };

  return <div className="canvas-wrap">
    <div className="canvas-ruler top-ruler"><span>0 m</span><span>{Math.round(field.width / 2)} m</span><span>{field.width} m</span></div>
    <div className="canvas-ruler side-ruler"><span>0</span><span>{Math.round(field.height / 2)} m</span><span>{field.height} m</span></div>
    <div className={`field-canvas mode-${mode}`} ref={canvasRef} style={{ width: `${Math.min(100, canvasWidth)}%`, aspectRatio: `${field.width} / ${field.height}` }}>
      <div className="grid-overlay" />
      <div className="field-label"><span>EXPO HALL A</span><strong>{field.width} × {field.height} m</strong></div>
      {path && mode === 'path' ? <svg className="path-layer" viewBox={`0 0 ${field.width} ${field.height}`} preserveAspectRatio="none"><polyline points={path.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#ef795f" strokeWidth="0.3" strokeDasharray="0.75 0.55" /><circle cx={path.points[0].x} cy={path.points[0].y} r="0.45" fill="#ef795f" /><circle cx={path.points[path.points.length - 1].x} cy={path.points[path.points.length - 1].y} r="0.45" fill="#ef795f" /></svg> : null}
      {elements.map((element) => {
        const spec = ELEMENT_SPECS[element.kind];
        const classes = ['canvas-element', selectedId === element.id ? 'is-selected' : '', issueIds.has(element.id) && mode !== 'edit' ? 'is-overlap' : '', channelIds.has(element.id) && mode !== 'edit' ? 'is-channel' : '', boundsIds.has(element.id) ? 'is-out' : ''].filter(Boolean).join(' ');
        return <button key={element.id} type="button" className={classes} style={{ left: `${element.x / field.width * 100}%`, top: `${element.y / field.height * 100}%`, width: `${element.displayWidth / field.width * 100}%`, height: `${element.displayHeight / field.height * 100}%`, background: spec.color, transform: `rotate(${element.rotation}deg)` }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const point = pointFromEvent(event); setDrag({ id: element.id, dx: point.x - element.x, dy: point.y - element.y }); onSelect(element.id); }} onPointerMove={(event) => { if (!drag || drag.id !== element.id) return; const point = pointFromEvent(event); onMove(element.id, point.x - drag.dx, point.y - drag.dy); }} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
          <span className="element-icon">{spec.icon}</span><span className="element-name">{element.name}</span><small>{element.displayWidth.toFixed(1)} × {element.displayHeight.toFixed(1)} m</small>
          {issueIds.has(element.id) && mode !== 'edit' ? <span className="issue-dot">!</span> : null}
        </button>;
      })}
      <div className="axis-hint">拖动元素 · 点击选中</div>
    </div>
    <div className="canvas-legend"><span><i className="legend-dot green" />可通行</span><span><i className="legend-dot coral" />需关注</span><span><i className="legend-line" />访问路径</span></div>
  </div>;
}
