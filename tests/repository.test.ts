import { describe, expect, it } from 'vitest';
import { createStarterDocument } from '../src/domain';
import { LocalLayoutRepository } from '../src/repository';
import { BrowserStorageService } from '../src/storageService';

describe('LocalLayoutRepository', () => {
  it('falls back to the starter document when persisted JSON is damaged', async () => {
    window.localStorage.setItem('exposketch.document.v1', '{broken-json');
    const repository = new LocalLayoutRepository(new BrowserStorageService());
    const loaded = await repository.load();
    expect(loaded.document).toEqual(createStarterDocument());
    expect(loaded.revision).toBeNull();
    window.localStorage.clear();
  });

  it('keeps optimistic saves on the revision that was loaded', async () => {
    const document = createStarterDocument();
    const storage = new BrowserStorageService();
    const repository = new LocalLayoutRepository(storage);
    const first = await repository.save(document, null);
    expect(first.status).toBe('saved');
    if (first.status !== 'saved') return;

    const conflicting = await repository.save({ ...document, title: '后保存版本' }, 'stale-revision');
    expect(conflicting.status).toBe('conflict');

    const stored = await storage.read();
    expect(stored?.document.title).toBe(document.title);
    window.localStorage.clear();
  });
});
