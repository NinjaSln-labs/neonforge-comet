export function redact(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(
      /(["']?(?:api[_-]?key|authorization|token|secret)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
      "$1***"
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1***");
}
