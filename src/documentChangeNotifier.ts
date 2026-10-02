export interface DocumentChangedMessage {
  type: 'document-changed';
  tabId: string;
  revision: string;
  updatedAt: number;
}

export type DocumentChangeMessage = DocumentChangedMessage;

export interface DocumentChangeNotifier {
  publish(message: DocumentChangeMessage): void;
  subscribe(listener: (message: DocumentChangeMessage) => void): () => void;
}

const CHANNEL_NAME = 'exposketch.document.changed.v1';
const FALLBACK_KEY = 'exposketch.document.changed.v1';

const hasBroadcastChannel = () => typeof BroadcastChannel !== 'undefined';

export class BrowserDocumentChangeNotifier implements DocumentChangeNotifier {
  private readonly channel: BroadcastChannel | null = hasBroadcastChannel() ? new BroadcastChannel(CHANNEL_NAME) : null;
  private readonly listeners = new Set<(message: DocumentChangeMessage) => void>();

  constructor() {
    if (!this.channel && typeof window !== 'undefined') {
      window.addEventListener('storage', this.handleStorage);
    }
  }

  publish(message: DocumentChangeMessage) {
    if (this.channel) {
      this.channel.postMessage(message);
      return;
    }
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(message));
  }

  subscribe(listener: (message: DocumentChangeMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private handleStorage = (event: StorageEvent) => {
    if (event.key !== FALLBACK_KEY || !event.newValue) return;
    try {
      const message = JSON.parse(event.newValue) as DocumentChangeMessage;
      if (message.type === 'document-changed') this.listeners.forEach((listener) => listener(message));
    } catch {
      // Ignore malformed fallback notifications.
    }
  };
}

export const createTabId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
