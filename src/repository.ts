import { createStarterDocument } from './domain';
import type { DocumentStorageService, StoredRecord } from './storageService';
import type { LayoutDocument } from './types';

export interface SavedLayout {
  document: LayoutDocument;
  revision: string | null;
  updatedAt: number | null;
}

export interface SaveOutcome {
  ok: boolean;
  saved: SavedLayout | null;
  remote: SavedLayout | null;
}

export interface LayoutRepository {
  load(): Promise<SavedLayout>;
  conditionalSave(document: LayoutDocument, expectedRevision: string | null): Promise<SaveOutcome>;
  forceSave(document: LayoutDocument): Promise<SavedLayout>;
}

const isElement = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const element = value as Record<string, unknown>;
  return typeof element.id === 'string' && typeof element.kind === 'string' && typeof element.x === 'number' && typeof element.y === 'number' && typeof element.width === 'number' && typeof element.height === 'number' && typeof element.rotation === 'number';
};

const isDocument = (value: unknown): value is LayoutDocument => {
  if (!value || typeof value !== 'object') return false;
  const document = value as Record<string, unknown>;
  const field = document.field as Record<string, unknown> | undefined;
  return document.version === 1 && typeof document.title === 'string' && !!field && typeof field.width === 'number' && typeof field.height === 'number' && Array.isArray(document.elements) && document.elements.every(isElement);
};

export const createRevision = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const toSavedLayout = (record: StoredRecord): SavedLayout => ({ document: record.document, revision: record.revision, updatedAt: record.updatedAt });

const starterLayout = (): SavedLayout => ({ document: createStarterDocument(), revision: null, updatedAt: null });

export class LocalLayoutRepository implements LayoutRepository {
  constructor(private readonly storage: DocumentStorageService) {}

  async load(): Promise<SavedLayout> {
    try {
      const record = await this.storage.readRecord();
      if (record && isDocument(record.document)) return toSavedLayout(record);
      return starterLayout();
    } catch {
      return starterLayout();
    }
  }

  async conditionalSave(document: LayoutDocument, expectedRevision: string | null): Promise<SaveOutcome> {
    const record: StoredRecord = { document, revision: createRevision(), updatedAt: Date.now() };
    const result = await this.storage.compareAndSwap(record, expectedRevision);
    if (result.ok) return { ok: true, saved: toSavedLayout(record), remote: null };
    return {
      ok: false,
      saved: null,
      remote: result.current && isDocument(result.current.document) ? toSavedLayout(result.current) : null,
    };
  }

  async forceSave(document: LayoutDocument): Promise<SavedLayout> {
    const record: StoredRecord = { document, revision: createRevision(), updatedAt: Date.now() };
    await this.storage.forcePut(record);
    return toSavedLayout(record);
  }
}
