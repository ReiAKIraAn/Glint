import type { Provider } from '../types';
import { anthropicAdapter } from './anthropic-adapter';
import { type ProviderAdapter, UnsupportedProviderError } from './types';

/**
 * 静态 Provider Adapter 注册表
 * 严格遵循编译期静态注册原则，严禁动态引入远端代码或 eval
 */
const REGISTRY = new Map<Provider, ProviderAdapter>([
  ['anthropic', anthropicAdapter],
]);

/**
 * 获取指定 Provider 的适配器实例
 * 若未注册则抛出强类型的 UnsupportedProviderError
 */
export function getProviderAdapter(provider: Provider): ProviderAdapter {
  const adapter = REGISTRY.get(provider);
  if (!adapter) {
    throw new UnsupportedProviderError(provider);
  }
  return adapter;
}

/**
 * 检查指定 Provider 是否已具备适配器
 */
export function hasProviderAdapter(provider: Provider): boolean {
  return REGISTRY.has(provider);
}

/**
 * 列出所有已注册的适配器列表
 */
export function getAllProviderAdapters(): ProviderAdapter[] {
  return Array.from(REGISTRY.values());
}
