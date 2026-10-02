import { describe, expect, it } from 'vitest';
import { createStarterDocument } from '../src/domain';
import { LocalLayoutRepository } from '../src/repository';
import { BrowserStorageService } from '../src/storageService';
import type { LayoutDocument } from '../src/types';

const freshStorage = () => {
  window.localStorage.clear();
  return new BrowserStorageService();
};

describe('LocalLayoutRepository', () => {
  it('falls back to the starter document when persisted JSON is damaged', async () => {
    window.localStorage.clear();
    window.localStorage.setItem('exposketch.document.v1', '{broken-json');
    const repository = new LocalLayoutRepository(new BrowserStorageService());
    expect((await repository.load()).document).toEqual(createStarterDocument());
    window.localStorage.clear();
  });

  it('reads a legacy bare document as the base revision', async () => {
    freshStorage();
    window.localStorage.setItem('exposketch.document.v1', JSON.stringify(createStarterDocument()));
    const repository = new LocalLayoutRepository(new BrowserStorageService());
    const loaded = await repository.load();
    expect(loaded.document).toEqual(createStarterDocument());
    expect(loaded.revision).toBe('legacy');
  });

  it('accepts a save based on the current revision and rejects a stale write', async () => {
    const storage = freshStorage();
    const repositoryA = new LocalLayoutRepository(storage);
    const repositoryB = new LocalLayoutRepository(storage);

    const first = await repositoryA.load();
    const docA: LayoutDocument = { ...first.document, title: '标签页 A 的改动' };
    const saveA = await repositoryA.conditionalSave(docA, first.revision);
    expect(saveA.ok).toBe(true);
    expect(saveA.saved?.revision).toBeTruthy();

    // B 仍然基于旧版本保存：必须被拒绝，并返回存储中的新版本
    const docB: LayoutDocument = { ...first.document, title: '标签页 B 的改动' };
    const saveB = await repositoryB.conditionalSave(docB, first.revision);
    expect(saveB.ok).toBe(false);
    expect(saveB.remote?.document.title).toBe('标签页 A 的改动');
    expect(saveB.remote?.revision).toBe(saveA.saved?.revision);

    // 存储内容没有被 B 覆盖
    const storageNow = new LocalLayoutRepository(storage);
    expect((await storageNow.load()).document.title).toBe('标签页 A 的改动');
  });

  it('backs up the current version before overwriting it', async () => {
    const storage = freshStorage();
    const repository = new LocalLayoutRepository(storage);
    const first = await repository.load();
    const saved = await repository.conditionalSave({ ...first.document, title: '新版本' }, first.revision);
    expect(saved.ok).toBe(true);

    await repository.forceSave({ ...first.document, title: '强制覆盖' });
    const backup = await storage.readBackup();
    expect(backup?.document.title).toBe('新版本');
  });
});
