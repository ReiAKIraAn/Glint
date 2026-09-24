export const DEFAULT_EXTRA_BODY_OBJECT: Record<string, unknown> = {
  thinking_mode: false,
};

export const DEFAULT_EXTRA_BODY_STRING = JSON.stringify(DEFAULT_EXTRA_BODY_OBJECT, null, 2);

/**
 * 严格校验额外请求体是否为纯 JSON Object
 * 明确拒绝：null、数组、字符串、数字、布尔值等非纯对象结构
 */
export function isValidExtraBodyObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * 解析并校验用户输入的额外请求体 JSON 字符串
 */
export function parseAndValidateExtraBody(raw: string):
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, data: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: '额外请求体必须是合法的 JSON 格式' };
  }

  if (!isValidExtraBodyObject(parsed)) {
    return {
      ok: false,
      error: '额外请求体必须是 JSON 对象（如 {"thinking_mode": false}），不能是数组、基础类型或 null',
    };
  }

  return { ok: true, data: parsed };
}

/**
 * 将额外请求体与系统核心字段合并。
 * 系统字段优先（System fields override），防止用户通过 extraBody 破坏 messages、stream 或 model 等核心协议。
 */
export function mergeRequestBody(
  baseSystemFields: Record<string, unknown>,
  extraBody?: Record<string, unknown>,
): Record<string, unknown> {
  if (!extraBody || !isValidExtraBodyObject(extraBody)) {
    return { ...baseSystemFields };
  }

  return {
    ...extraBody,
    ...baseSystemFields,
  };
}
