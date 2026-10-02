export type ElementKind = 'booth' | 'stage' | 'seating' | 'entrance';
export type LayoutMode = 'edit' | 'inspect' | 'path';
export type ViewPhase = 'loading' | 'ready' | 'error';

export interface ExpoElement {
  id: string;
  kind: ElementKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface RenderElement extends ExpoElement {
  displayWidth: number;
  displayHeight: number;
  occupiedArea: number;
}

export interface FieldSize {
  width: number;
  height: number;
}

export interface LayoutDocument {
  version: 1;
  title: string;
  field: FieldSize;
  elements: ExpoElement[];
}

export interface ElementSpec {
  kind: ElementKind;
  label: string;
  eyebrow: string;
  icon: string;
  color: string;
  width: number;
  height: number;
}

export interface OverlapIssue {
  firstId: string;
  secondId: string;
  amount: number;
}

export interface BoundsIssue {
  elementId: string;
  overflow: number;
}

export interface ChannelIssue {
  firstId: string;
  secondId: string;
  gap: number;
}

export interface PathPreview {
  points: Array<{ x: number; y: number }>;
  distance: number;
  fromName: string;
  toName: string;
}

export interface Analysis {
  overlaps: OverlapIssue[];
  bounds: BoundsIssue[];
  channels: ChannelIssue[];
  path: PathPreview | null;
}

export interface Notice {
  tone: 'info' | 'success' | 'warning' | 'error';
  message: string;
}
