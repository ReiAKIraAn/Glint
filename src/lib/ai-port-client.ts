import { browser } from '#imports';

export const AI_PORT_NAME = 'glint:ai-stream';

/**
 * ============================================================================
 * Milestone 4: 冻结的 Port IPC 消息协议 (Frozen Port Message Protocol)
 * ============================================================================
 */

export interface AIStartMessage {
  type: 'AI_START';
  requestId: string;
  payload: {
    word: string;
    lemma?: string;
    sentence: string;
  };
}

export interface AIAbortMessage {
  type: 'AI_ABORT';
  requestId: string;
}

export interface AIChunkMessage {
  type: 'AI_CHUNK';
  requestId: string;
  text: string;
}

export interface AIDoneMessage {
  type: 'AI_DONE';
  requestId: string;
}

export interface AIErrorMessage {
  type: 'AI_ERROR';
  requestId: string;
  code: string;
  message: string;
}

export type ClientPortMessage = AIStartMessage | AIAbortMessage;
export type ServerPortMessage = AIChunkMessage | AIDoneMessage | AIErrorMessage;

/**
 * 抽象 Port 接口，兼容 WebExtension browser.runtime.Port 及测试 Mock
 */
export interface PortLike {
  name: string;
  postMessage(message: unknown): void;
  disconnect?(): void;
  onMessage: {
    addListener(callback: (message: unknown, port: PortLike) => void): void;
    removeListener?(callback: (message: unknown, port: PortLike) => void): void;
  };
  onDisconnect: {
    addListener(callback: (port: PortLike) => void): void;
    removeListener?(callback: (port: PortLike) => void): void;
  };
}

/**
 * Content Script 侧 AI 流式客户端管理器 (Client Harness)
 */
export interface StreamHandlers {
  onChunk(text: string): void;
  onDone(): void;
  onError(code: string, message: string): void;
}

export class AiStreamClient {
  private port: PortLike | null = null;
  private currentRequestId: string | null = null;
  private activeHandlers: StreamHandlers | null = null;
  private connectFn: () => PortLike;

  constructor(connectFn: () => PortLike = () => browser.runtime.connect({ name: AI_PORT_NAME })) {
    this.connectFn = connectFn;
  }

  private ensurePort(): PortLike {
    if (!this.port) {
      this.port = this.connectFn();
      this.port.onMessage.addListener((rawMsg: unknown) => {
        if (!rawMsg || typeof rawMsg !== 'object') return;
        const msg = rawMsg as Partial<ServerPortMessage>;
        if (typeof msg.requestId !== 'string' || msg.requestId !== this.currentRequestId) {
          return; // 丢弃不匹配或过期的消息
        }
        if (msg.type === 'AI_CHUNK' && typeof msg.text === 'string') {
          this.activeHandlers?.onChunk(msg.text);
        } else if (msg.type === 'AI_DONE') {
          const handlers = this.activeHandlers;
          this.currentRequestId = null;
          this.activeHandlers = null;
          handlers?.onDone();
        } else if (msg.type === 'AI_ERROR') {
          const handlers = this.activeHandlers;
          this.currentRequestId = null;
          this.activeHandlers = null;
          handlers?.onError(msg.code || 'UNKNOWN_ERROR', msg.message || '未知错误');
        }
      });
      this.port.onDisconnect.addListener(() => {
        this.port = null;
        if (this.currentRequestId && this.activeHandlers) {
          const handlers = this.activeHandlers;
          this.currentRequestId = null;
          this.activeHandlers = null;
          handlers.onError('DISCONNECTED', '连接已断开');
        }
      });
    }
    return this.port;
  }

  start(
    payload: { word: string; lemma?: string; sentence: string },
    handlers: StreamHandlers,
  ): string {
    const port = this.ensurePort();
    if (this.currentRequestId) {
      try {
        port.postMessage({ type: 'AI_ABORT', requestId: this.currentRequestId });
      } catch {}
    }
    const requestId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.currentRequestId = requestId;
    this.activeHandlers = handlers;

    const startMsg: AIStartMessage = {
      type: 'AI_START',
      requestId,
      payload,
    };
    port.postMessage(startMsg);
    return requestId;
  }

  abort(): void {
    if (!this.currentRequestId || !this.port) return;
    const reqId = this.currentRequestId;
    this.currentRequestId = null;
    this.activeHandlers = null;
    try {
      this.port.postMessage({ type: 'AI_ABORT', requestId: reqId });
    } catch {}
  }

  disconnect(): void {
    this.abort();
    if (this.port) {
      try {
        this.port.disconnect?.();
      } catch {}
      this.port = null;
    }
  }

  getActiveRequestId(): string | null {
    return this.currentRequestId;
  }
}
