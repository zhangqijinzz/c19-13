export interface LayoutSaveEvent {
  revision: string;
  updatedAt: number;
}

export interface LayoutChangeNotifier {
  emitSaved(event: LayoutSaveEvent): void;
  subscribe(listener: (event: LayoutSaveEvent) => void): () => void;
}

const CHANNEL_NAME = 'exposketch.document.v1';
const FALLBACK_KEY = 'exposketch.touch.v1';

export class BrowserLayoutChangeNotifier implements LayoutChangeNotifier {
  private listeners = new Set<(event: LayoutSaveEvent) => void>();
  private channel: BroadcastChannel | null = null;
  private storageHandler: ((event: StorageEvent) => void) | null = null;

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (message: MessageEvent<LayoutSaveEvent>) => this.dispatch(message.data);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.storageHandler = (event: StorageEvent) => {
        if (event.key !== FALLBACK_KEY || !event.newValue) return;
        try {
          this.dispatch(JSON.parse(event.newValue) as LayoutSaveEvent);
        } catch {
          // 忽略无法解析的兜底信号
        }
      };
      window.addEventListener('storage', this.storageHandler);
    }
  }

  emitSaved(event: LayoutSaveEvent): void {
    this.channel?.postMessage(event);
    try {
      window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(event));
    } catch {
      // localStorage 不可用时仍有 BroadcastChannel
    }
  }

  subscribe(listener: (event: LayoutSaveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private dispatch(event: LayoutSaveEvent | null) {
    if (!event || typeof event.revision !== 'string') return;
    this.listeners.forEach((listener) => listener(event));
  }
}
