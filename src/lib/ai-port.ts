import { browser } from '#imports';
import { apiKeysStore } from './keys';
import {
  fetchProviderStream,
  ProviderAbortError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderProtocolError,
  ProviderResponseTooLargeError,
  ProviderTimeoutError,
} from './provider-network';
import { safeErrorMessage } from './security';
import { readSettings } from './settings';
import { isConfigured, type Settings } from './types';

import { putExplanation } from './explanation-cache';

export const AI_PORT_NAME = 'glint:ai-stream';

/**
 * ============================================================================
 * Milestone 4 Step 2: 冻结的 Port IPC 消息协议 (Frozen Port Message Protocol)
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
 * 依赖注入接口，方便单元测试控制与验证
 */
export interface AiPortHandlerDeps {
  streamFn?: typeof fetchProviderStream;
  getSettings?: () => Promise<Settings>;
  getApiKey?: (settings: Settings) => Promise<string>;
  putExplanation?: (word: string, explanation: string) => Promise<void>;
}

/**
 * 统一将底层网络错误安全映射为稳定错误码与脱敏信息
 */
export function mapProviderError(err: unknown, key: string = ''): { code: string; message: string } {
  const safeMsg = safeErrorMessage(err, [key]);
  if (err instanceof ProviderHttpError) {
    return { code: 'HTTP_ERROR', message: safeMsg };
  }
  if (err instanceof ProviderNetworkError) {
    return { code: 'NETWORK_ERROR', message: safeMsg };
  }
  if (err instanceof ProviderTimeoutError) {
    return { code: 'TIMEOUT', message: safeMsg };
  }
  if (err instanceof ProviderAbortError) {
    return { code: 'ABORTED', message: '请求已取消' };
  }
  if (err instanceof ProviderProtocolError) {
    return { code: 'PROTOCOL_ERROR', message: safeMsg };
  }
  if (err instanceof ProviderResponseTooLargeError) {
    return { code: 'RESPONSE_TOO_LARGE', message: safeMsg };
  }
  return { code: 'UNKNOWN_ERROR', message: safeMsg };
}

interface PortState {
  activeRequestId: string | null;
  activeAbortController: AbortController | null;
  isDisconnected: boolean;
}

/**
 * 存储活跃连接的映射表（按 Port 隔离，绝无跨 Port 共享请求状态，使用 WeakMap 避免保留引用）
 */
const activeConnections = new WeakMap<PortLike, PortState>();

/**
 * 处理单个 Content Script Port 连接的完整生命周期 (Background 侧核心调度器)
 *
 * 核心设计：
 * 1. 严格保证【每个 Port 对应独立的请求生命周期】。Port A 的 abort/supersede 绝不影响 Port B。
 * 2. 同一 Port 实行【单活动请求】：若在 A 未完成时发起 B，A 立即被 abort 并标记 stale，B 成为活跃请求。
 * 3. 严格 stale response 保护：任何来自被 supersede 或已取消请求的 late chunk/done/error 坚决不向 Port 发送。
 * 4. API Key 绝对隔离：Key 仅在 Background 内部读取，绝对不进入 Port 消息负载。
 * 5. Port disconnect 清理：标签页关闭或导航触发 disconnect 时，立即 abort 活动请求并清理连接引用，绝无悬挂。
 */
export function handleAiPortConnection(port: PortLike, deps?: AiPortHandlerDeps): void {
  const state: PortState = {
    activeRequestId: null,
    activeAbortController: null,
    isDisconnected: false,
  };
  activeConnections.set(port, state);

  // 安全向此 Port 发送消息：断开或已被 supersede 时不发送
  const safePost = (serverMsg: ServerPortMessage, forRequestId: string) => {
    if (state.isDisconnected) return;
    if (state.activeRequestId !== forRequestId) return;
    try {
      port.postMessage(serverMsg);
    } catch {
      state.isDisconnected = true;
      cleanup();
    }
  };

  const cleanup = () => {
    if (state.activeAbortController) {
      state.activeAbortController.abort();
      state.activeAbortController = null;
    }
    state.activeRequestId = null;
    activeConnections.delete(port);
  };

  port.onDisconnect.addListener(() => {
    state.isDisconnected = true;
    cleanup();
  });

  port.onMessage.addListener(async (rawMsg: unknown) => {
    if (state.isDisconnected) return;
    if (!rawMsg || typeof rawMsg !== 'object') return;
    const msg = rawMsg as Partial<ClientPortMessage>;

    // 1. 处理用户主动取消 (AI_ABORT)
    if (msg.type === 'AI_ABORT') {
      if (typeof msg.requestId !== 'string' || !msg.requestId) return;
      if (state.activeRequestId === msg.requestId) {
        if (state.activeAbortController) {
          state.activeAbortController.abort();
          state.activeAbortController = null;
        }
        state.activeRequestId = null;
      }
      return;
    }

    // 2. 处理发起请求 (AI_START)
    if (msg.type === 'AI_START') {
      const startMsg = msg as Partial<AIStartMessage>;
      if (typeof startMsg.requestId !== 'string' || !startMsg.requestId) return;
      const requestId = startMsg.requestId;

      const payload = startMsg.payload;
      if (!payload || typeof payload.word !== 'string' || typeof payload.sentence !== 'string') {
        safePost(
          {
            type: 'AI_ERROR',
            requestId,
            code: 'INVALID_PAYLOAD',
            message: '请求载荷格式无效',
          },
          requestId,
        );
        return;
      }

      // 同 Port 替换机制 (Same-Port Replacement)：旧请求立即 abort 并标记 stale
      if (state.activeAbortController) {
        state.activeAbortController.abort();
        state.activeAbortController = null;
      }
      state.activeRequestId = requestId;
      const controller = new AbortController();
      state.activeAbortController = controller;

      let keyForRedaction = '';

      try {
        const getSettings = deps?.getSettings ?? readSettings;
        const settings = await getSettings();

        if (state.isDisconnected || state.activeRequestId !== requestId) return;

        if (!settings.aiEnabled) {
          safePost(
            {
              type: 'AI_ERROR',
              requestId,
              code: 'AI_DISABLED',
              message: 'AI 释义在设置中未开启',
            },
            requestId,
          );
          return;
        }

        if (settings.provider !== 'anthropic') {
          safePost(
            {
              type: 'AI_ERROR',
              requestId,
              code: 'UNSUPPORTED_PROVIDER',
              message: '当前仅支持 Anthropic 服务商',
            },
            requestId,
          );
          return;
        }

        const getApiKey =
          deps?.getApiKey ??
          (async (s: Settings) => {
            const rawKey = (await apiKeysStore.getValue())[s.provider] ?? '';
            return isConfigured(s, !!rawKey) ? rawKey : '';
          });
        const apiKey = await getApiKey(settings);

        if (state.isDisconnected || state.activeRequestId !== requestId) return;

        if (!apiKey || !apiKey.trim()) {
          safePost(
            {
              type: 'AI_ERROR',
              requestId,
              code: 'NO_API_KEY',
              message: '未配置 Anthropic API Key',
            },
            requestId,
          );
          return;
        }

        keyForRedaction = apiKey;
        const streamFn = deps?.streamFn ?? fetchProviderStream;

        let fullText = '';
        await streamFn(
          settings,
          apiKey,
          payload,
          controller.signal,
          (delta: string) => {
            if (state.isDisconnected) return;
            if (state.activeRequestId !== requestId) return;
            if (controller.signal.aborted) return;
            fullText += delta;
            safePost(
              {
                type: 'AI_CHUNK',
                requestId,
                text: delta,
              },
              requestId,
            );
          },
        );

        if (state.isDisconnected || state.activeRequestId !== requestId) return;
        if (controller.signal.aborted) return;

        // M5-W2: AI Persistence - 仅在完整成功、未取消、非空的 stream 下写入本地缓存
        // 严格仅持久化 word 与 explanation，绝不带入 sentence, context, url 或凭据
        const trimmedExplanation = fullText.trim();
        if (trimmedExplanation) {
          try {
            const cacheWord = (payload.lemma || payload.word || '').trim();
            const putCache = deps?.putExplanation ?? putExplanation;
            await putCache(cacheWord, trimmedExplanation);
          } catch (cacheErr) {
            // Section 7: Cache write failure 不得破坏 AI UX
            console.warn('[Glint] Failed to persist AI explanation:', cacheErr);
          }
        }

        safePost(
          {
            type: 'AI_DONE',
            requestId,
          },
          requestId,
        );
      } catch (err: unknown) {
        if (state.isDisconnected || state.activeRequestId !== requestId) return;
        // 用户主动取消时不发送错误通知 (正常生命周期)
        if (
          controller.signal.aborted ||
          (err instanceof Error && err.name === 'AbortError') ||
          err instanceof ProviderAbortError
        ) {
          return;
        }
        const mapped = mapProviderError(err, keyForRedaction);
        safePost(
          {
            type: 'AI_ERROR',
            requestId,
            code: mapped.code,
            message: mapped.message,
          },
          requestId,
        );
      } finally {
        if (state.activeRequestId === requestId) {
          state.activeAbortController = null;
          state.activeRequestId = null;
        }
      }
    }
  });
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
