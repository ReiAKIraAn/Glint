/**
 * 统一的安全边界与敏感信息脱敏工具库 (Secret Redaction & Security Boundary)。
 *
 * 核心目标：
 * 1. 杜绝任何 API Key / 凭据进入 URL Query、Error message、console.log、DOM、或者跨上下文消息。
 * 2. 统一脱敏逻辑，防止未来新增 provider 时出现同类泄露。
 */

/** 敏感 query parameter 名称列表 */
const SENSITIVE_QUERY_PARAMS = new Set([
  'key',
  'apikey',
  'api_key',
  'token',
  'access_token',
  'auth',
  'secret',
  'password',
  'credential',
]);

/** 常见 API Key 格式的正规特征正则 */
const SECRET_PATTERNS = [
  /sk-ant-[a-zA-Z0-9_\-]{20,}/g, // Anthropic key
  /sk-[a-zA-Z0-9_\-]{20,}/g, // OpenAI / DeepSeek key
  /AIza[0-9A-Za-z\-_]{35}/g, // Google Gemini / Cloud key
  /Bearer\s+[a-zA-Z0-9_\-\.]{10,}/gi, // Bearer token
  /x-goog-api-key:\s*[a-zA-Z0-9_\-]{10,}/gi,
  /x-api-key:\s*[a-zA-Z0-9_\-]{10,}/gi,
];

/**
 * 彻底清除 URL 中的敏感 query 参数与用户名密码。
 */
export function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    // 无法解析为标准 URL 时，走文本正则替换
    return rawUrl.replace(/([?&](?:key|token|auth|secret|apikey|api_key)=)[^&\s#]*/gi, '$1[REDACTED]');
  }
}

/**
 * 统一脱敏函数：任何日志、异常信息、UI 报错在交付前必须经过脱敏。
 */
export function redactSecrets(text: string, knownSecrets: (string | undefined | null)[] = []): string {
  if (!text || typeof text !== 'string') return '';
  let result = text;

  // 1. 已知的真 Key 显式屏蔽
  for (const secret of knownSecrets) {
    if (secret && typeof secret === 'string' && secret.length >= 4) {
      result = result.split(secret).join('[REDACTED]');
    }
  }

  // 2. 正则通用敏感信息匹配替换
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.startsWith('Bearer ')) return 'Bearer [REDACTED]';
      if (match.toLowerCase().startsWith('x-goog-api-key:')) return 'x-goog-api-key: [REDACTED]';
      if (match.toLowerCase().startsWith('x-api-key:')) return 'x-api-key: [REDACTED]';
      return '[REDACTED]';
    });
  }

  // 3. 针对 URL 查询参数中的 key= 进行再次安全兜底
  result = result.replace(/([?&](?:key|token|auth|secret|apikey|api_key)=)[^&\s#]*/gi, '$1[REDACTED]');

  return result;
}

/**
 * 安全的错误信息提取器：提取错误文本并确保不携带任何 secret。
 */
export function safeErrorMessage(error: unknown, knownSecrets: (string | undefined | null)[] = []): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw, knownSecrets);
}
