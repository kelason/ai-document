import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sanitizeDocumentHtml } from '@/lib/security/html';

// Removing sanitization, allowing media, URLs, events, or active CSS must break these cases.
describe('document HTML boundary', () => {
  it('preserves basic supported rich text exactly', () => {
    expect(sanitizeDocumentHtml('<p><strong>safe</strong></p>')).toBe('<p><strong>safe</strong></p>');
  });
  it.each([
    '<img src=x onerror=alert(1)>',
    '<svg><script>alert(1)</script><a xlink:href="javascript:alert(1)">bad</a></svg>',
    '<script>alert(1)</script><iframe src="https://evil.test"></iframe><object data="https://evil.test"></object>',
    '<p onclick="alert(1)">text</p>',
    '<a href="javascript:alert(1)">link</a>',
    '<a href="&#x6a;avascript:alert(1)">link</a>',
    '<a href="data:text/html,bad">link</a>',
    '<a href="//evil.test">link</a>',
    '<p style="background-image:url(https://evil.test);position:fixed;behavior:url(x)">text</p>',
  ])('removes executable or fetching markup: %s', (input) => {
    const safe = sanitizeDocumentHtml(input);
    expect(safe).not.toMatch(/<(?:img|svg|script|iframe|object)|\son\w+=|javascript:|data:|href="\/\/|url\(|position:|behavior:/i);
  });
  it('preserves tables, headings, lists, links, and supported editor styles', () => {
    const input = readFileSync('tests/fixtures/imports/rich.html', 'utf8').trim();
    const safe = sanitizeDocumentHtml(input);
    for (const fragment of ['<h1>', '<ul><li>', '<table', '<thead>', '<tbody>', '<th', '<td', 'colspan="2"', 'text-align:center', 'border-collapse:collapse', 'padding:8px', 'https://example.test', 'mailto:person@example.test']) {
      expect(safe).toContain(fragment);
    }
  });
  it('is idempotent on hostile malformed nested markup', () => {
    const once = sanitizeDocumentHtml('<table><tr><td><svg><style><img src=x onerror=alert(1)></style></svg>safe</td></tr></table>');
    expect(sanitizeDocumentHtml(once)).toBe(once);
    expect(once).not.toMatch(/img|onerror|svg|style|alert/i);
  });
});
