import { createStarterDocument } from './domain';
import type { CompareSaveResult, DocumentStorageService } from './storageService';
import type { ExpoElement, LayoutConflict, LayoutDocument } from './types';

export interface LoadedLayout {
  document: LayoutDocument;
  revision: string | null;
  updatedAt: number | null;
}

export interface SaveOutcome {
  status: 'saved' | 'conflict';
  revision?: string;
  conflict?: LayoutConflict;
}

export interface LayoutRepository {
  load(): Promise<LoadedLayout>;
  save(document: LayoutDocument, expectedRevision: string | null): Promise<SaveOutcome>;
}

const isElement = (value: unknown): value is ExpoElement => {
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

const toSaveResult = (document: LayoutDocument, expectedRevision: string | null, result: CompareSaveResult): SaveOutcome => {
  if (result.status === 'saved') return { status: 'saved', revision: result.revision };
  if (!isDocument(result.current.document)) throw new Error('存储中的布局无法识别');
  return {
    status: 'conflict',
    conflict: {
      local: document,
      remote: result.current.document,
      expectedRevision,
      remoteRevision: result.current.revision,
      remoteUpdatedAt: result.current.updatedAt,
      detectedAt: Date.now(),
    },
  };
};

export class LocalLayoutRepository implements LayoutRepository {
  constructor(private readonly storage: DocumentStorageService) {}

  async load(): Promise<LoadedLayout> {
    try {
      const saved = await this.storage.read();
      if (saved && isDocument(saved.document)) {
        return { document: saved.document, revision: saved.revision, updatedAt: saved.updatedAt || null };
      }
      return { document: createStarterDocument(), revision: null, updatedAt: null };
    } catch {
      return { document: createStarterDocument(), revision: null, updatedAt: null };
    }
  }

  async save(document: LayoutDocument, expectedRevision: string | null): Promise<SaveOutcome> {
    const result = await this.storage.compareAndSave({ document, revision: '', updatedAt: Date.now() }, expectedRevision);
    return toSaveResult(document, expectedRevision, result);
  }
}
