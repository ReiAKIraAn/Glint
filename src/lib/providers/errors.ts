import { browser } from '#imports';

export const MAX_RESPONSE_CHARS = 4_000;
export const STREAM_TIMEOUT = 60_000;
export const MODELS_TIMEOUT = 20_000;

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class ProviderHttpError extends ProviderError {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
  }
}

export class ProviderNetworkError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderNetworkError';
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

export class ProviderAbortError extends ProviderError {
  constructor(message: string = '请求已取消') {
    super(message);
    this.name = 'ProviderAbortError';
  }
}

export class ProviderProtocolError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderProtocolError';
  }
}

export class ProviderResponseTooLargeError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderResponseTooLargeError';
  }
}

export class UnsupportedProviderError extends ProviderError {
  readonly provider: string;

  constructor(provider: string) {
    super(`不支持的 AI 服务商: ${provider}`);
    this.name = 'UnsupportedProviderError';
    this.provider = provider;
  }
}

/**
 * 校验某 Provider 的 API 地址是否已获得网络权限
 */
export async function isOriginAllowed(url: string): Promise<boolean> {
  if (!browser?.permissions?.contains) return true;
  try {
    const origin = `${new URL(url).origin}/*`;
    return await browser.permissions.contains({ origins: [origin] });
  } catch {
    return true; // 无法检查时不阻拦，由底层网络沙盒捕获
  }
}
