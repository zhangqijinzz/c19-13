import { describe, expect, it, vi } from 'vitest';
import { createStarterDocument } from '../src/domain';
import type { LayoutChangeNotifier } from '../src/notifier';
import type { LayoutRepository, SavedLayout, SaveOutcome } from '../src/repository';
import type { LayoutDocument } from '../src/types';
import { ExpoSketchViewModel } from '../src/viewModel';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const layout = (document: LayoutDocument = createStarterDocument(), revision: string | null = 'rev-1'): SavedLayout => ({
  document,
  revision,
  updatedAt: revision ? Date.now() : null,
});

const fakeRepository = (initial: LayoutDocument | null = null): LayoutRepository => ({
  load: vi.fn(async () => layout(initial ?? createStarterDocument())),
  conditionalSave: vi.fn(async (document) => ({ ok: true, saved: { document, revision: `rev-${Math.random().toString(36).slice(2)}`, updatedAt: Date.now() }, remote: null })),
  forceSave: vi.fn(async (document) => ({ document, revision: `rev-force-${Math.random().toString(36).slice(2)}`, updatedAt: Date.now() })),
});

class FakeNotifier implements LayoutChangeNotifier {
  listeners = new Set<(event: { revision: string; updatedAt: number }) => void>();
  emitted: Array<{ revision: string; updatedAt: number }> = [];

  emitSaved(event: { revision: string; updatedAt: number }) { this.emitted.push(event); }
  subscribe(listener: (event: { revision: string; updatedAt: number }) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  simulateRemote(event: { revision: string; updatedAt: number }) {
    this.listeners.forEach((listener) => listener(event));
  }
}

describe('ExpoSketchViewModel', () => {
  it('initializes and updates the selected layout', async () => {
    const repository = fakeRepository();
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('ready');
    const count = vm.state.document.elements.length;
    vm.addElement('booth');
    expect(vm.state.document.elements).toHaveLength(count + 1);
    expect(vm.state.selectedId).toContain('booth-');
  });

  it('updates analysis immediately after moving an element into an overlap', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.moveElement('stage-1', 4.5, 2.5);
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);
  });

  it('recovers the example if repository loading fails', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => { throw new Error('bad storage'); }), conditionalSave: vi.fn(), forceSave: vi.fn() };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('error');
    expect(vm.state.document.title).toContain('春日创意市集');
  });

  it('shows a save error without dropping the working document', async () => {
    const repository: LayoutRepository = {
      load: vi.fn(async () => layout()),
      conditionalSave: vi.fn(async () => { throw new Error('quota'); }),
      forceSave: vi.fn(),
    };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    vm.addElement('stage');
    await flush();
    expect(vm.state.document.elements.some((element) => element.kind === 'stage' && element.id.startsWith('stage-'))).toBe(true);
    expect(vm.state.notice.tone).toBe('error');
  });

  it('ignores invalid dimensions instead of corrupting the working selection', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    const before = vm.state.document.elements[0].width;
    vm.resizeSelected(0, 0);
    expect(vm.state.document.elements[0].width).toBe(before);
  });

  it('blocks a save made on a stale revision and asks which version to keep', async () => {
    const remoteDoc: LayoutDocument = { ...createStarterDocument(), title: '另一标签页的版本' };
    const remote: SavedLayout = { document: remoteDoc, revision: 'rev-remote', updatedAt: 123456 };
    const conditionalSave = vi.fn(async (): Promise<SaveOutcome> => ({ ok: false, saved: null, remote }));
    const repository: LayoutRepository = { load: vi.fn(async () => layout()), conditionalSave, forceSave: vi.fn() };

    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    vm.renameProject('我在本标签页的改动');
    await flush();

    expect(vm.state.conflict?.kind).toBe('save-conflict');
    if (vm.state.conflict?.kind === 'save-conflict') {
      expect(vm.state.conflict.remote.document.title).toBe('另一标签页的版本');
      expect(vm.state.conflict.localDocument.title).toBe('我在本标签页的改动');
    }
    // 本地编辑仍然留在画布上，没有被静默覆盖
    expect(vm.state.document.title).toBe('我在本标签页的改动');
  });

  it('adopts the remote version when the user chooses the other tab', async () => {
    const remoteDoc: LayoutDocument = { ...createStarterDocument(), title: '对方的标题' };
    const remote: SavedLayout = { document: remoteDoc, revision: 'rev-remote-2', updatedAt: 123 };
    const conditionalSave = vi.fn(async (document: LayoutDocument, expectedRevision: string | null): Promise<SaveOutcome> => {
      if (expectedRevision === 'rev-remote-2') return { ok: true, saved: { document, revision: 'rev-after-adopt', updatedAt: Date.now() }, remote: null };
      return { ok: false, saved: null, remote };
    });
    const repository: LayoutRepository = {
      load: vi.fn(async () => layout()),
      conditionalSave,
      forceSave: vi.fn(),
    };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    vm.renameProject('本地标题');
    await flush();
    expect(vm.state.conflict).not.toBeNull();

    await vm.adoptRemoteVersion();
    expect(vm.state.document.title).toBe('对方的标题');
    expect(vm.state.conflict).toBeNull();

    // 采用之后再保存，应基于新 revision，不再报冲突
    vm.renameProject('继续编辑');
    await flush();
    expect(vm.state.conflict).toBeNull();
    expect(conditionalSave).toHaveBeenLastCalledWith(expect.objectContaining({ title: '继续编辑' }), 'rev-remote-2');
  });

  it('force-overwrites through the repository and notifies other tabs', async () => {
    const remoteDoc: LayoutDocument = { ...createStarterDocument(), title: '对方的标题' };
    const remote: SavedLayout = { document: remoteDoc, revision: 'rev-remote-3', updatedAt: 123 };
    const forceSave = vi.fn(async (document: LayoutDocument): Promise<SavedLayout> => ({ document, revision: 'rev-force-1', updatedAt: 999 }));
    const repository: LayoutRepository = {
      load: vi.fn(async () => layout()),
      conditionalSave: vi.fn(async () => ({ ok: false, saved: null, remote })),
      forceSave,
    };
    const notifier = new FakeNotifier();
    const vm = new ExpoSketchViewModel(repository, notifier);
    await vm.initialize();
    vm.renameProject('我要保留的标题');
    await flush();

    await vm.forceOverwriteRemote();
    expect(forceSave).toHaveBeenCalledTimes(1);
    expect(forceSave.mock.calls[0][0].title).toBe('我要保留的标题');
    expect(vm.state.document.title).toBe('我要保留的标题');
    expect(vm.state.conflict).toBeNull();
    expect(notifier.emitted.some((event) => event.revision === 'rev-force-1')).toBe(true);
  });

  it('shows a non-blocking banner when another tab saves while this tab is untouched in storage', async () => {
    const otherDoc: LayoutDocument = { ...createStarterDocument(), title: '其他标签页新布局' };
    const repository = fakeRepository();
    const load = repository.load as ReturnType<typeof vi.fn>;
    load.mockResolvedValueOnce(layout())
      .mockResolvedValueOnce({ document: otherDoc, revision: 'rev-other', updatedAt: 42 });

    const notifier = new FakeNotifier();
    const vm = new ExpoSketchViewModel(repository, notifier);
    await vm.initialize();

    notifier.simulateRemote({ revision: 'rev-other', updatedAt: 42 });
    await flush();

    expect(vm.state.conflict?.kind).toBe('remote-update');
    expect(vm.state.document.title).toBe(createStarterDocument().title);
  });

  it('silently adopts a remote revision when the document content is identical', async () => {
    const repository = fakeRepository();
    const load = repository.load as ReturnType<typeof vi.fn>;
    load.mockResolvedValueOnce(layout())
      .mockResolvedValueOnce(layout(createStarterDocument(), 'rev-same-content'));

    const notifier = new FakeNotifier();
    const vm = new ExpoSketchViewModel(repository, notifier);
    await vm.initialize();

    notifier.simulateRemote({ revision: 'rev-same-content', updatedAt: 1 });
    await flush();

    expect(vm.state.conflict).toBeNull();
    expect(vm.state.remoteRevision).toBe('rev-same-content');
  });

  it('keeps editing on the canvas while the conflict dialog is open and shows the freshest local title', async () => {
    const remoteDoc: LayoutDocument = { ...createStarterDocument(), title: '对方的标题' };
    const remote: SavedLayout = { document: remoteDoc, revision: 'rev-remote-x', updatedAt: 1 };
    const repository: LayoutRepository = {
      load: vi.fn(async () => layout()),
      conditionalSave: vi.fn(async () => ({ ok: false, saved: null, remote })),
      forceSave: vi.fn(),
    };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    vm.renameProject('第一个本地改动');
    await flush();
    expect(vm.state.conflict?.kind).toBe('save-conflict');

    // 弹窗开着时继续编辑：画布与弹窗里的本地卡片都应反映最新内容，且不会再发保存请求
    const callsBefore = (repository.conditionalSave as ReturnType<typeof vi.fn>).mock.calls.length;
    vm.renameProject('第二个本地改动');
    await flush();
    expect((repository.conditionalSave as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(callsBefore);
    expect(vm.state.document.title).toBe('第二个本地改动');
    if (vm.state.conflict?.kind === 'save-conflict') {
      expect(vm.state.conflict.localDocument.title).toBe('第二个本地改动');
    } else {
      throw new Error('冲突弹窗应保持打开');
    }
  });

  it('retries the save with the newest revision after an in-flight edit lands', async () => {
    const repository = fakeRepository();
    const conditionalSave = repository.conditionalSave as ReturnType<typeof vi.fn>;
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();

    const pending: { resolve: ((value: SaveOutcome) => void) | null } = { resolve: null };
    conditionalSave.mockImplementationOnce(() => new Promise<SaveOutcome>((resolve) => { pending.resolve = resolve; }));

    vm.renameProject('在途编辑');
    vm.renameProject('更新的编辑');
    expect(conditionalSave).toHaveBeenCalledTimes(1);

    if (!pending.resolve) throw new Error('首次保存应处于在途状态');
    pending.resolve({ ok: true, saved: { document: createStarterDocument(), revision: 'rev-inflight', updatedAt: 1 }, remote: null });
    await flush();

    expect(conditionalSave).toHaveBeenCalledTimes(2);
    expect(conditionalSave.mock.calls[1][0].title).toBe('更新的编辑');
    expect(conditionalSave.mock.calls[1][1]).toBe('rev-inflight');
    expect(vm.state.conflict).toBeNull();
  });
});
