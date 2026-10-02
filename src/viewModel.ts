import { createElement, createStarterDocument, analyzeLayout, findElement, getBoundingBox, normalizeRotation } from './domain';
import { BrowserDocumentChangeNotifier, createTabId, type DocumentChangeNotifier } from './documentChangeNotifier';
import type { LayoutRepository } from './repository';
import type { Analysis, ElementKind, LayoutConflict, LayoutDocument, LayoutMode, Notice, RenderElement, ViewPhase } from './types';

export interface ExpoSketchState {
  phase: ViewPhase;
  document: LayoutDocument;
  renderElements: RenderElement[];
  selectedId: string | null;
  selectedElement: RenderElement | null;
  mode: LayoutMode;
  analysis: Analysis;
  notice: Notice;
  lastSavedAt: number | null;
  conflict: LayoutConflict | null;
}

const toRenderElements = (document: LayoutDocument): RenderElement[] => document.elements.map((element) => {
  const box = getBoundingBox(element);
  return { ...element, displayWidth: box.width, displayHeight: box.height, occupiedArea: Number((box.width * box.height).toFixed(1)) };
});

const sameDocument = (first: LayoutDocument, second: LayoutDocument) => JSON.stringify(first) === JSON.stringify(second);

const starter = createStarterDocument();
const starterRenderElements = toRenderElements(starter);

type Listener = () => void;

export class ExpoSketchViewModel {
  private listeners = new Set<Listener>();
  private stateValue: ExpoSketchState = {
    phase: 'loading',
    document: starter,
    renderElements: starterRenderElements,
    selectedId: 'stage-1',
    selectedElement: starterRenderElements.find((element) => element.id === 'stage-1') ?? null,
    mode: 'edit',
    analysis: analyzeLayout(createStarterDocument()),
    notice: { tone: 'info', message: '正在恢复最近布局…' },
    lastSavedAt: null,
    conflict: null,
  };
  private knownRevision: string | null = null;
  private baseDocument: LayoutDocument = starter;
  private saveInFlight = false;
  private saveQueued = false;
  private initializer: Promise<void> | null = null;
  private readonly tabId = createTabId();

  constructor(
    private readonly repository: LayoutRepository,
    private readonly changeNotifier: DocumentChangeNotifier = new BrowserDocumentChangeNotifier(),
  ) {}

  get state() { return this.stateValue; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  initialize(): Promise<void> {
    if (!this.initializer) this.initializer = this.loadDocument();
    return this.initializer;
  }

  startChangeNotifier() {
    return this.changeNotifier.subscribe((message) => { void this.handleRemoteChange(message.revision, message.updatedAt); });
  }

  selectElement(id: string) { this.commit({ selectedId: id }); }

  setMode(mode: LayoutMode) { this.commit({ mode, notice: { tone: 'info', message: mode === 'inspect' ? '检查模式已开启：拖动元素查看即时提示' : mode === 'path' ? '路径模式已开启：入口到重点区域的访问路线已生成' : '编辑模式已开启' } }); }

  addElement(kind: ElementKind) {
    const element = createElement(kind, this.stateValue.document.elements.length, this.stateValue.document.field);
    const document = { ...this.stateValue.document, elements: [...this.stateValue.document.elements, element] };
    this.commitAndPersist({ document, selectedId: element.id, notice: { tone: 'success', message: `${element.name} 已加入场地` } });
  }

  removeSelected() {
    if (!this.stateValue.selectedId) return;
    const removed = findElement(this.stateValue.document, this.stateValue.selectedId);
    const elements = this.stateValue.document.elements.filter((element) => element.id !== this.stateValue.selectedId);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements }, selectedId: elements[0]?.id ?? null, notice: { tone: 'info', message: `${removed?.name ?? '元素'} 已移除` } });
  }

  moveElement(id: string, x: number, y: number) {
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  resizeSelected(width: number, height: number) {
    const id = this.stateValue.selectedId;
    if (!id || width <= 0 || height <= 0) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  rotateSelected() {
    const id = this.stateValue.selectedId;
    if (!id) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, rotation: normalizeRotation(element.rotation + 90) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements }, notice: { tone: 'info', message: '方向已旋转 90°' } });
  }

  renameSelected(name: string) {
    const id = this.stateValue.selectedId;
    if (!id || !name.trim()) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, name: name.trim() } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  resizeField(width: number, height: number) {
    if (width < 12 || height < 10) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, field: { width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } }, notice: { tone: 'success', message: '场地尺寸已更新' } });
  }

  renameProject(title: string) {
    if (!title.trim()) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, title: title.trim() } });
  }

  resetExample() {
    const document = createStarterDocument();
    this.commitAndPersist({ document, selectedId: 'stage-1', mode: 'edit', notice: { tone: 'success', message: '已恢复示例布局' } });
  }

  resolveConflictWithRemote() {
    const conflict = this.stateValue.conflict;
    if (!conflict) return;
    const selectedId = conflict.remote.elements.some((element) => element.id === this.stateValue.selectedId) ? this.stateValue.selectedId : conflict.remote.elements[0]?.id ?? null;
    this.knownRevision = conflict.remoteRevision;
    this.baseDocument = conflict.remote;
    this.commit({
      document: conflict.remote,
      selectedId,
      conflict: null,
      notice: { tone: 'info', message: '已切换到其他标签页保存的最新版本' },
    });
  }

  resolveConflictWithLocal() {
    const conflict = this.stateValue.conflict;
    if (!conflict) return;
    this.commit({
      conflict: null,
      notice: { tone: 'warning', message: '正在保留当前标签页的改动，并覆盖其他标签页版本…' },
    });
    this.schedulePersist();
  }

  private async loadDocument() {
    try {
      const loaded = await this.repository.load();
      this.knownRevision = loaded.revision;
      this.baseDocument = loaded.document;
      this.commit({ document: loaded.document, selectedId: loaded.document.elements[0]?.id ?? null, phase: 'ready', lastSavedAt: loaded.updatedAt, notice: { tone: 'success', message: '布局已就绪，可开始编辑' } });
    } catch {
      this.commit({ phase: 'error', notice: { tone: 'error', message: '布局读取失败，已载入安全示例' } });
    }
  }

  private async handleRemoteChange(revision: string, updatedAt: number) {
    if (this.stateValue.phase === 'loading' || revision === this.knownRevision) return;

    let loaded;
    try {
      loaded = await this.repository.load();
    } catch {
      return;
    }
    if (loaded.revision === null || loaded.revision === this.knownRevision) return;

    if (this.stateValue.conflict) {
      this.updateConflictFromRemote(loaded.document, loaded.revision, loaded.updatedAt ?? updatedAt);
      return;
    }

    if (sameDocument(loaded.document, this.stateValue.document)) {
      this.adoptRemoteDocument(loaded.document, loaded.revision, loaded.updatedAt ?? updatedAt, { tone: 'success', message: '布局版本已与其他标签页同步' });
      return;
    }

    if (sameDocument(this.baseDocument, this.stateValue.document)) {
      this.adoptRemoteDocument(loaded.document, loaded.revision, loaded.updatedAt ?? updatedAt, { tone: 'info', message: '其他标签页保存了新布局，当前页面已自动刷新' });
      return;
    }

    this.openConflict(loaded.document, loaded.revision, loaded.updatedAt ?? updatedAt);
  }

  private adoptRemoteDocument(document: LayoutDocument, revision: string, updatedAt: number, notice: Notice) {
    const selectedId = document.elements.some((element) => element.id === this.stateValue.selectedId) ? this.stateValue.selectedId : document.elements[0]?.id ?? null;
    this.knownRevision = revision;
    this.baseDocument = document;
    this.commit({ document, selectedId, lastSavedAt: updatedAt, notice });
  }

  private openConflict(remote: LayoutDocument, remoteRevision: string, remoteUpdatedAt: number) {
    const conflict: LayoutConflict = {
      local: this.stateValue.document,
      remote,
      expectedRevision: this.knownRevision,
      remoteRevision,
      remoteUpdatedAt,
      detectedAt: Date.now(),
    };
    this.knownRevision = remoteRevision;
    this.commit({ conflict, notice: { tone: 'warning', message: '检测到其他标签页已保存不同版本，请选择要保留的布局' } });
  }

  private updateConflictFromRemote(remote: LayoutDocument, remoteRevision: string, remoteUpdatedAt: number) {
    const current = this.stateValue.conflict;
    if (!current || remoteRevision === current.remoteRevision) return;
    this.knownRevision = remoteRevision;
    this.commit({
      conflict: { ...current, remote, remoteRevision, remoteUpdatedAt, detectedAt: Date.now() },
      notice: { tone: 'warning', message: '其他标签页又保存了新版本，冲突内容已刷新' },
    });
  }

  private commitAndPersist(patch: Partial<ExpoSketchState>) {
    this.commit(patch);
    this.schedulePersist();
  }

  private schedulePersist() {
    if (this.stateValue.conflict || this.stateValue.phase === 'loading') return;
    if (this.saveInFlight) {
      this.saveQueued = true;
      return;
    }
    void this.persist();
  }

  private async persist() {
    if (this.saveInFlight || this.stateValue.conflict) return;
    const document = this.stateValue.document;
    const expectedRevision = this.knownRevision;
    this.saveInFlight = true;
    this.saveQueued = false;

    try {
      const savedAt = Date.now();
      const outcome = await this.repository.save(document, expectedRevision);
      if (outcome.status === 'saved' && outcome.revision) {
        this.knownRevision = outcome.revision;
        this.baseDocument = this.stateValue.document;
        this.commit({ lastSavedAt: savedAt });
        this.changeNotifier.publish({ type: 'document-changed', tabId: this.tabId, revision: outcome.revision, updatedAt: savedAt });
      } else if (outcome.status === 'conflict' && outcome.conflict) {
        this.handleSaveConflict(outcome.conflict);
      }
    } catch {
      this.commit({ notice: { tone: 'error', message: '本地保存失败，当前编辑仍保留在页面中' } });
    } finally {
      this.saveInFlight = false;
      if (this.saveQueued && !this.stateValue.conflict) {
        this.saveQueued = false;
        void this.persist();
      } else {
        this.saveQueued = false;
      }
    }
  }

  private handleSaveConflict(conflict: LayoutConflict) {
    if (sameDocument(conflict.remote, this.stateValue.document)) {
      this.knownRevision = conflict.remoteRevision;
      this.baseDocument = conflict.remote;
      this.commit({ lastSavedAt: conflict.remoteUpdatedAt ?? Date.now(), notice: { tone: 'success', message: '布局内容已一致，版本已同步' } });
      return;
    }

    this.knownRevision = conflict.remoteRevision;
    this.commit({ conflict, notice: { tone: 'warning', message: '保存前发现其他标签页改动，请选择保留哪一份' } });
  }

  private commit(patch: Partial<ExpoSketchState>) {
    const next = { ...this.stateValue, ...patch };
    const renderElements = toRenderElements(next.document);
    this.stateValue = { ...next, renderElements, selectedElement: renderElements.find((element) => element.id === next.selectedId) ?? null, analysis: analyzeLayout(next.document) };
    this.listeners.forEach((listener) => listener());
  }
}
