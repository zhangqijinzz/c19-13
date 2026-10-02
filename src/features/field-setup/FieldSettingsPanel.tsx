import type { LayoutDocument } from '../../types';

interface FieldSettingsPanelProps {
  document: LayoutDocument;
  onResizeField: (width: number, height: number) => void;
  onReset: () => void;
}

export function FieldSettingsPanel({ document, onResizeField, onReset }: FieldSettingsPanelProps) {
  return <section className="panel field-settings">
    <div className="panel-heading"><div><span className="section-kicker">FIELD SETUP</span><h2>场地设置</h2></div></div>
    <div className="field-summary"><span>当前尺寸</span><strong>{document.field.width} × {document.field.height} m</strong></div>
    <div className="field-inputs"><label>宽度 <input aria-label="场地宽度" type="number" min="12" step="0.5" defaultValue={document.field.width} key={`width-${document.field.width}`} onBlur={(event) => onResizeField(Number(event.target.value), document.field.height)} /></label><span>×</span><label>深度 <input aria-label="场地深度" type="number" min="10" step="0.5" defaultValue={document.field.height} key={`height-${document.field.height}`} onBlur={(event) => onResizeField(document.field.width, Number(event.target.value))} /></label></div>
    <button type="button" className="text-button" onClick={onReset}>↺ 恢复示例布局</button>
  </section>;
}
