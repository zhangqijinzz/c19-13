import { createElement, createStarterDocument, analyzeLayout, findElement, getBoundingBox, isSameDocument, normalizeRotation } from './domain';
import type { LayoutChangeNotifier } from './notifier';
import type { LayoutRepository, SavedLayout } from './repository';
import type { Analysis, ConflictState, ElementKind, LayoutDocument, LayoutMode, Notice, RemoteVersion, RenderElement, ViewPhase } from './types';

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
  conflict: ConflictState;
  remoteRevision: string | null;
}

const toRenderElements = (document: LayoutDocument): RenderElement[] => document.elements.map((element) => {
  const box = getBoundingBox(element);
  return { ...element, displayWidth: box.width, displayHeight: box.height, occupiedArea: Number((box.width * box.height).toFixed(1)) };
});

const starter = createStarterDocument();
const starterRenderElements = toRenderElements(starter);

type Listener = () => void;

const toRemoteVersion = (layout: SavedLayout): RemoteVersion => ({ document: layout.document, revision: layout.revision ?? 'unknown', updatedAt: layout.updatedAt });

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
    remoteRevision: null,
  };
  private baseRevision: string | null = null;
  private persistQueued = false;
  private persisting = false;
  private unsubscribeNotifier: (() => void) | null = null;

  constructor(
    private readonly repository: LayoutRepository,
    private readonly notifier?: LayoutChangeNotifier,
  ) {}

  get state() { return this.stateValue; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize() {
    this.unsubscribeNotifier = this.notifier?.subscribe((event) => this.handleRemoteSaved(event)) ?? null;
    try {
      const layout = await this.repository.load();
      this.baseRevision = layout.revision;
      this.commit({
        document: layout.document,
        selectedId: layout.document.elements[0]?.id ?? null,
        phase: 'ready',
        notice: { tone: 'success', message: '布局已就绪，可开始编辑' },
        lastSavedAt: layout.updatedAt,
        remoteRevision: layout.revision,
      });
    } catch {
      this.commit({ phase: 'error', notice: { tone: 'error', message: '布局读取失败，已载入安全示例' } });
    }
  }

  dispose() {
    this.unsubscribeNotifier?.();
    this.unsubscribeNotifier = null;
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

  /** 冲突弹窗：放弃本地编辑，采用另一个标签页保存的新版本 */
  async adoptRemoteVersion() {
    const conflict = this.stateValue.conflict;
    if (!conflict) return;
    const remote = conflict.remote;
    this.baseRevision = remote.revision === 'unknown' ? null : remote.revision;
    this.commit({
      document: remote.document,
      selectedId: remote.document.elements.find((element) => element.id === this.stateValue.selectedId)?.id ?? remote.document.elements[0]?.id ?? null,
      conflict: null,
      remoteRevision: remote.revision,
      lastSavedAt: remote.updatedAt ?? this.stateValue.lastSavedAt,
      notice: { tone: 'info', message: '已切换到另一标签页保存的最新版本' },
    });
  }

  /** 冲突弹窗 / 顶部横幅：以当前编辑强制覆盖存储里的新版本（旧版本会先备份） */
  async forceOverwriteRemote() {
    const document = this.stateValue.document;
    this.commit({ conflict: null, notice: { tone: 'info', message: '正在以当前编辑覆盖另一标签页的版本…' } });
    this.persisting = true;
    try {
      const saved = await this.repository.forceSave(document);
      this.baseRevision = saved.revision;
      this.notifier?.emitSaved({ revision: saved.revision ?? '', updatedAt: saved.updatedAt ?? Date.now() });
      this.commit({ lastSavedAt: saved.updatedAt, remoteRevision: saved.revision, notice: { tone: 'success', message: '已保留当前版本，另一标签页的改动已备份，不会丢失' } });
    } catch {
      this.commit({ notice: { tone: 'error', message: '强制保存失败，当前编辑仍保留在页面中' } });
    } finally {
      this.persisting = false;
      if (this.persistQueued && this.stateValue.conflict?.kind !== 'save-conflict') void this.persist();
    }
  }

  /** 顶部横幅：知道了，先保留本地编辑继续工作（下次保存仍会拦截冲突） */
  dismissRemoteUpdate() {
    if (this.stateValue.conflict?.kind !== 'remote-update') return;
    this.commit({ conflict: null });
  }

  private handleRemoteSaved(event: { revision: string }) {
    if (!event.revision || event.revision === this.baseRevision || event.revision === this.stateValue.remoteRevision) return;
    void this.loadRemoteVersion(event.revision);
  }

  private async loadRemoteVersion(revision: string) {
    try {
      const layout = await this.repository.load();
      if (layout.revision !== revision) return;
      const remote = toRemoteVersion(layout);
      const sameContent = isSameDocument(layout.document, this.stateValue.document);
      const existing = this.stateValue.conflict;
      if (existing?.kind === 'save-conflict') {
        // 另一端又保存了更新的版本，刷新弹窗里的“对方版本”；若内容已经一致则直接收敛
        if (sameContent) {
          this.baseRevision = layout.revision;
          this.commit({ conflict: null, remoteRevision: layout.revision, lastSavedAt: layout.updatedAt ?? this.stateValue.lastSavedAt, notice: { tone: 'success', message: '两边内容已一致，冲突已解除' } });
          return;
        }
        this.commit({ conflict: { kind: 'save-conflict', remote, localDocument: this.stateValue.document }, remoteRevision: remote.revision });
        return;
      }
      if (sameContent) {
        this.baseRevision = layout.revision;
        this.commit({ remoteRevision: layout.revision, lastSavedAt: layout.updatedAt ?? this.stateValue.lastSavedAt, conflict: null });
        return;
      }
      this.commit({
        conflict: { kind: 'remote-update', remote },
        remoteRevision: remote.revision,
        notice: { tone: 'warning', message: '另一个标签页保存了新版本，当前页面尚未同步' },
      });
    } catch {
      // 拉取远端版本失败时不打断当前编辑
    }
  }

  private commitAndPersist(patch: Partial<ExpoSketchState>) {
    this.commit(patch);
    this.schedulePersist();
  }

  private schedulePersist() {
    if (this.stateValue.conflict?.kind === 'save-conflict') return;
    if (this.persisting) {
      this.persistQueued = true;
      return;
    }
    void this.persist();
  }

  private async persist() {
    this.persisting = true;
    try {
      while (true) {
        this.persistQueued = false;
        const snapshot = this.stateValue.document;
        let outcome;
        try {
          outcome = await this.repository.conditionalSave(snapshot, this.baseRevision);
        } catch {
          this.commit({ notice: { tone: 'error', message: '本地保存失败，当前编辑仍保留在页面中' } });
          return;
        }
        if (!outcome.ok) {
          if (outcome.remote) {
            const remote = toRemoteVersion(outcome.remote);
            if (isSameDocument(remote.document, this.stateValue.document)) {
              // 在途的旧请求返回时，画布内容已与存储一致（例如刚采用了对方版本），直接收敛
              this.baseRevision = outcome.remote.revision;
              this.commit({ remoteRevision: remote.revision, lastSavedAt: remote.updatedAt ?? this.stateValue.lastSavedAt });
              return;
            }
            this.baseRevision = null;
            this.commit({
              conflict: { kind: 'save-conflict', remote, localDocument: this.stateValue.document },
              remoteRevision: remote.revision,
              notice: { tone: 'warning', message: '检测到另一标签页的改动与当前编辑冲突，请选择保留哪一份' },
            });
          } else {
            this.commit({ notice: { tone: 'error', message: '无法核对存储中的版本，当前编辑仍保留在页面中' } });
          }
          return;
        }
        const saved = outcome.saved;
        if (!saved) return;
        this.baseRevision = saved.revision;
        this.notifier?.emitSaved({ revision: saved.revision ?? '', updatedAt: saved.updatedAt ?? Date.now() });
        if (this.stateValue.document === snapshot) {
          this.commit({ lastSavedAt: saved.updatedAt, remoteRevision: saved.revision });
          return;
        }
        // 保存期间用户继续编辑过，用新版本号再提交一次最新内容
      }
    } finally {
      this.persisting = false;
      if (this.persistQueued && this.stateValue.conflict?.kind !== 'save-conflict') void this.persist();
    }
  }

  private commit(patch: Partial<ExpoSketchState>) {
    const next = { ...this.stateValue, ...patch };
    const renderElements = toRenderElements(next.document);
    // 冲突弹窗若开着，始终展示最新的本地编辑，避免弹窗与画布不一致
    const conflict = next.conflict?.kind === 'save-conflict'
      ? { ...next.conflict, localDocument: next.document }
      : next.conflict;
    this.stateValue = { ...next, renderElements, selectedElement: renderElements.find((element) => element.id === next.selectedId) ?? null, analysis: analyzeLayout(next.document), conflict };
    this.listeners.forEach((listener) => listener());
  }
}
