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
  UnsupportedProviderError,
} from './provider-network';
import { getProviderAdapter, hasProviderAdapter } from './providers';
import { safeErrorMessage } from './security';
import { readSettings } from './settings';
import { isConfigured, type Settings } from './types';

import { putExplanation } from './explanation-cache';

export * from './ai-port-client';
import type {
  ClientPortMessage,
  PortLike,
  ServerPortMessage,
  AIStartMessage,
} from './ai-port-client';

/**
 * 依赖注入接口，方便单元测试控制与验证
 */
export interface AiPortHandlerDeps {
  streamFn?: typeof fetchProviderStream;
  getSettings?: () => Promise<Settings>;
  getApiKey?: (settings: Settings) => Promise<string>;
  putExplanation?: (word: string, explanation: string) => Promise<void>;
  getAdapter?: typeof getProviderAdapter;
  hasAdapter?: typeof hasProviderAdapter;
}

/**
 * 统一将底层网络错误安全映射为稳定错误码与脱敏信息
 */
export function mapProviderError(err: unknown, key: string = ''): { code: string; message: string } {
  const safeMsg = safeErrorMessage(err, [key]);
  if (err instanceof UnsupportedProviderError) {
    return { code: 'UNSUPPORTED_PROVIDER', message: safeMsg };
  }
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

        const hasAdapter = deps?.hasAdapter ?? hasProviderAdapter;
        if (!hasAdapter(settings.provider)) {
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
        let fullText = '';

        if (deps?.streamFn) {
          await deps.streamFn(
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
        } else {
          const getAdapter = deps?.getAdapter ?? getProviderAdapter;
          const adapter = getAdapter(settings.provider);
          const model = settings.models?.[settings.provider] || '';
          const baseURL = settings.baseURLs?.[settings.provider];

          await adapter.stream(
            payload,
            {
              model,
              apiKey,
              baseURL,
              signal: controller.signal,
              onChunk: (delta: string) => {
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
            },
          );
        }

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
