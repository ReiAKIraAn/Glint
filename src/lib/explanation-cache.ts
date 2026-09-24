import { storage } from '#imports';
import type { ExplanationCacheEntry } from './types';

/**
 * 缓存上限容量。
 * 遵循 Safari WebExtension storage 配额余量设计，最多存储 2,000 条。
 */
export const EXPLANATION_LIMIT = 2000;

/**
 * 词汇规范化 Key：统一小写并裁剪前后空格。
 * 确保 "Sediment", "sediment", " SEDIMENT " 命中同一个缓存槽位。
 */
export function normalizeWordKey(word: string): string {
  return (word || '').trim().toLowerCase();
}

/**
 * 严格校验对象是否符合新持久化契约。
 * 严禁携带 sentence, analysis, surface 等任何上下文敏感字段。
 */
export function isCleanCacheEntry(val: unknown): val is ExplanationCacheEntry {
  if (!val || typeof val !== 'object') return false;
  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 3) return false;
  return (
    typeof obj.word === 'string' &&
    obj.word.trim().length > 0 &&
    typeof obj.explanation === 'string' &&
    obj.explanation.trim().length > 0 &&
    typeof obj.updatedAt === 'number' &&
    !Number.isNaN(obj.updatedAt) &&
    keys.every((k) => k === 'word' || k === 'explanation' || k === 'updatedAt')
  );
}

/**
 * 清理/脱敏历史存储数据：
 * 遇到旧版本带有 sentence, analysis, surface 的记录时，直接丢弃，
 * 绝不让敏感网页原句继续残留于持久化存储中。
 */
export function sanitizeExplanationStore(raw: Record<string, unknown>): {
  sanitized: Record<string, ExplanationCacheEntry>;
  needsMigration: boolean;
} {
  const result: Record<string, ExplanationCacheEntry> = {};
  let needsMigration = false;

  for (const [key, val] of Object.entries(raw || {})) {
    if (isCleanCacheEntry(val)) {
      result[key] = val;
    } else {
      // 发现旧格式或污染字段，安全丢弃并标记需要写回持久化存储
      needsMigration = true;
    }
  }

  return { sanitized: result, needsMigration };
}

/**
 * LRU 淘汰算法：
 * 当缓存容量超过 limit (2,000) 时，按 updatedAt 倒序排序，丢弃最旧的条目。
 */
export function capExplanationEntries(
  entries: Record<string, ExplanationCacheEntry>,
  limit: number = EXPLANATION_LIMIT,
): Record<string, ExplanationCacheEntry> {
  const keys = Object.keys(entries);
  if (keys.length <= limit) return entries;
  const sorted = keys.sort((a, b) => (entries[b]?.updatedAt ?? 0) - (entries[a]?.updatedAt ?? 0));
  const kept = sorted.slice(0, limit);
  const result: Record<string, ExplanationCacheEntry> = {};
  for (const k of kept) {
    if (entries[k]) result[k] = entries[k]!;
  }
  return result;
}

/**
 * 持久化存储定义：local:explanations
 */
export const explanationsStore = storage.defineItem<Record<string, ExplanationCacheEntry>>(
  'local:explanations',
  { fallback: {} },
);

/**
 * 串行化任务队列：保证同一 context 内并发读-改-写时操作顺序执行，防止并发冲突覆盖
 */
let queue: Promise<unknown> = Promise.resolve();

export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(() => task(), () => task());
  queue = next.then(() => {}, () => {});
  return next;
}

/**
 * 查询缓存中的释义：
 * 命中时同步刷新 updatedAt 活跃度并写回，返回纯文本释义；未命中返回 null。
 */
export async function getExplanation(word: string): Promise<string | null> {
  const normKey = normalizeWordKey(word);
  if (!normKey) return null;

  return enqueue(async () => {
    const raw = (await explanationsStore.getValue()) as Record<string, unknown>;
    const { sanitized, needsMigration } = sanitizeExplanationStore(raw);

    const entry = sanitized[normKey];
    if (!entry) {
      if (needsMigration) {
        await explanationsStore.setValue(sanitized);
      }
      return null;
    }

    // 缓存命中：更新 LRU 活跃时间戳
    entry.updatedAt = Date.now();
    await explanationsStore.setValue(sanitized);
    return entry.explanation;
  });
}

/**
 * 写入/更新释义缓存：
 * 当且仅当生成完整且非空时写入。仅持久化 word, explanation, updatedAt。
 */
export async function putExplanation(word: string, explanation: string): Promise<void> {
  const normKey = normalizeWordKey(word);
  const cleanText = (explanation || '').trim();
  if (!normKey || !cleanText) return;

  return enqueue(async () => {
    const raw = (await explanationsStore.getValue()) as Record<string, unknown>;
    const { sanitized } = sanitizeExplanationStore(raw);

    sanitized[normKey] = {
      word: normKey,
      explanation: cleanText,
      updatedAt: Date.now(),
    };

    const capped = capExplanationEntries(sanitized, EXPLANATION_LIMIT);
    await explanationsStore.setValue(capped);
  });
}

/**
 * 删除单条生词释义
 */
export async function deleteExplanation(word: string): Promise<void> {
  const normKey = normalizeWordKey(word);
  if (!normKey) return;

  return enqueue(async () => {
    const raw = (await explanationsStore.getValue()) as Record<string, unknown>;
    const { sanitized } = sanitizeExplanationStore(raw);
    if (normKey in sanitized) {
      delete sanitized[normKey];
      await explanationsStore.setValue(sanitized);
    }
  });
}

/**
 * 清空所有 AI 释义缓存：
 * 绝对不触碰 API Keys、设置项或权限。
 */
export async function clearExplanations(): Promise<void> {
  return enqueue(async () => {
    await explanationsStore.setValue({});
  });
}

/**
 * 获取所有已缓存的释义列表（按更新时间倒序排列，供设置页展示）
 */
export async function getAllExplanations(): Promise<ExplanationCacheEntry[]> {
  return enqueue(async () => {
    const raw = (await explanationsStore.getValue()) as Record<string, unknown>;
    const { sanitized, needsMigration } = sanitizeExplanationStore(raw);
    if (needsMigration) {
      await explanationsStore.setValue(sanitized);
    }
    return Object.values(sanitized).sort((a, b) => b.updatedAt - a.updatedAt);
  });
}
