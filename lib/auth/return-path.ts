/** Accept only unambiguous local paths, including after repeated URL decoding. */
export function safeReturnPath(value: string | null): string {
  if (!value || value.length > 2048 || value.trim() !== value) return '/';
  let decoded = value;
  for (let pass = 0; pass < 8; pass++) {
    if (!decoded.startsWith('/') || decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded) || /\s/.test(decoded.split(/[?#]/, 1)[0])) return '/';
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        const parsed = new URL(value, 'https://local.invalid');
        return parsed.origin === 'https://local.invalid' ? value : '/';
      }
      decoded = next;
    } catch { return '/'; }
  }
  return '/';
}
