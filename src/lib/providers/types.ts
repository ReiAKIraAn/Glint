import type { Provider, ModelList } from '../types';
import { UnsupportedProviderError } from './errors';

export { UnsupportedProviderError };

/**
 * 跨服务商通用的生词释义请求载荷（纯语言语境，零专有字段）
 */
export interface ProviderStreamPayload {
  readonly word: string;
  readonly lemma?: string;
  readonly sentence: string;
}

/**
 * 流式执行上下文（包含鉴权、控制信号与回调）
 */
export interface ProviderStreamContext {
  readonly model: string;
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly signal: AbortSignal;
  readonly onChunk: (delta: string) => void;
  readonly options?: {
    readonly timeoutMs?: number;
    readonly fetchFn?: typeof fetch;
  };
}

/**
 * 模型列表查询上下文
 */
export interface ProviderModelsContext {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly signal?: AbortSignal;
  readonly fetchFn?: typeof fetch;
}

/**
 * Provider 适配器统一契约
 */
export interface ProviderAdapter {
  /** 唯一厂商标识符 */
  readonly id: Provider;

  /**
   * 发起流式文本释义生成
   * 成功完成时 resolve，发生错误时 reject 标准化的 ProviderError，取消时 reject ProviderAbortError
   */
  stream(payload: ProviderStreamPayload, ctx: ProviderStreamContext): Promise<void>;

  /**
   * 可选：查询该厂商当前凭据可用的模型列表
   */
  listModels?(ctx: ProviderModelsContext): Promise<ModelList>;
}
