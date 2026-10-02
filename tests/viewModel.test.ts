import { describe, expect, it, vi } from 'vitest';
import { createStarterDocument } from '../src/domain';
import type { DocumentChangeMessage, DocumentChangeNotifier } from '../src/documentChangeNotifier';
import type { LayoutRepository, LoadedLayout, SaveOutcome } from '../src/repository';
import type { LayoutDocument } from '../src/types';
import { ExpoSketchViewModel } from '../src/viewModel';

class FakeChangeNotifier implements DocumentChangeNotifier {
  readonly messages: DocumentChangeMessage[] = [];
  private readonly listeners = new Set<(message: DocumentChangeMessage) => void>();

  publish(message: DocumentChangeMessage) {
    this.messages.push(message);
    this.listeners.forEach((listener) => listener(message));
  }

  subscribe(listener: (message: DocumentChangeMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const createFakeRepository = (initial: LayoutDocument | null = null): LayoutRepository & { revision: string | null; setRemoteDocument(document: LayoutDocument, revision: string): void } => {
  let document = initial ?? createStarterDocument();
  const nextRevision = () => `revision-${Math.random().toString(36).slice(2, 10)}`;
  const repository: LayoutRepository & { revision: string | null; setRemoteDocument(document: LayoutDocument, revision: string): void } = {
    revision: 'revision-1',
    setRemoteDocument(nextDocument: LayoutDocument, nextRevision: string) {
      document = nextDocument;
      repository.revision = nextRevision;
    },
    load: vi.fn(async (): Promise<LoadedLayout> => ({ document, revision: repository.revision, updatedAt: repository.revision ? 1000 : null })),
    save: vi.fn(async (candidate: LayoutDocument, expectedRevision: string | null): Promise<SaveOutcome> => {
      if (expectedRevision !== repository.revision) {
        return { status: 'conflict', conflict: { local: candidate, remote: document, expectedRevision, remoteRevision: repository.revision ?? 'missing', remoteUpdatedAt: 1000, detectedAt: 2000 } };
      }
      document = candidate;
      repository.revision = nextRevision();
      return { status: 'saved', revision: repository.revision };
    }),
  };
  return repository;
};

const fakeRepository = (initial: LayoutDocument | null = null): LayoutRepository => createFakeRepository(initial);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ExpoSketchViewModel', () => {
  it('initializes and updates the selected layout', async () => {
    const repository = fakeRepository();
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('ready');
    const count = vm.state.document.elements.length;
    vm.addElement('booth');
    await flush();
    expect(vm.state.document.elements).toHaveLength(count + 1);
    expect(vm.state.selectedId).toContain('booth-');
  });

  it('updates analysis immediately after moving an element into an overlap', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.moveElement('stage-1', 4.5, 2.5);
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);
  });

  it('recovers the example if repository loading fails', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => { throw new Error('bad storage'); }), save: vi.fn(async () => { throw new Error('not available'); }) };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('error');
    expect(vm.state.document.title).toContain('春日创意市集');
  });

  it('shows a save error without dropping the working document', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => ({ document: createStarterDocument(), revision: 'revision-1', updatedAt: 1000 })), save: vi.fn(async () => { throw new Error('quota'); }) };
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

  it('asks the user to choose when a save sees another tab revision', async () => {
    const repository = createFakeRepository();
    const notifier = new FakeChangeNotifier();
    const vm = new ExpoSketchViewModel(repository, notifier);
    await vm.initialize();

    repository.revision = 'revision-from-another-tab';
    vm.renameProject('当前标签页改动');
    await flush();

    expect(vm.state.conflict).not.toBeNull();
    expect(vm.state.conflict?.local.title).toBe('当前标签页改动');
    expect(vm.state.conflict?.remoteRevision).toBe('revision-from-another-tab');
    expect(notifier.messages).toHaveLength(0);

    vm.resolveConflictWithRemote();
    expect(vm.state.conflict).toBeNull();
    expect(vm.state.document).toEqual(createStarterDocument());
  });

  it('keeps the local copy only after the user confirms overwriting the remote copy', async () => {
    const repository = createFakeRepository();
    const notifier = new FakeChangeNotifier();
    const vm = new ExpoSketchViewModel(repository, notifier);
    await vm.initialize();

    repository.revision = 'revision-from-another-tab';
    vm.renameProject('当前标签页改动');
    await flush();
    vm.resolveConflictWithLocal();
    await flush();

    expect(vm.state.conflict).toBeNull();
    expect(vm.state.document.title).toBe('当前标签页改动');
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]?.revision).toBe(repository.revision);
  });

  it('silently refreshes a clean tab when another tab publishes a newer revision', async () => {
    const repository = createFakeRepository();
    const notifier = new FakeChangeNotifier();
    const vm = new ExpoSketchViewModel(repository, notifier);
    await vm.initialize();
    vm.startChangeNotifier();

    const remote = { ...createStarterDocument(), title: '其他标签页布局' };
    repository.setRemoteDocument(remote, 'revision-2');
    notifier.publish({ type: 'document-changed', tabId: 'other-tab', revision: 'revision-2', updatedAt: 2000 });
    await flush();

    expect(vm.state.document.title).toBe('其他标签页布局');
    expect(vm.state.conflict).toBeNull();
  });
});
