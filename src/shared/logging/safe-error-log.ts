const SENSITIVE_VALUE_PATTERN =
  /\b(password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|oauth[_-]?code|authorization[_-]?code|authorization|api[_-]?key|client_secret)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const URL_PASSWORD_PATTERN = /([a-z][a-z\d+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function redactSensitiveText(value: string): string {
  return value
    .replace(URL_PASSWORD_PATTERN, '$1<redacted>$3')
    .replace(SENSITIVE_VALUE_PATTERN, '$1$2<redacted>')
    .replace(BEARER_TOKEN_PATTERN, 'Bearer <redacted>')
    .slice(0, 8_000);
}

export function safeErrorForLog(error: unknown): {
  message: string;
  stack?: string;
} {
  if (!(error instanceof Error)) {
    return { message: redactSensitiveText(String(error)) };
  }
  return {
    message: redactSensitiveText(`${error.name}: ${error.message}`),
    ...(error.stack ? { stack: redactSensitiveText(error.stack) } : {}),
  };
}
