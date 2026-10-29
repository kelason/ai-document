// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeEditorHtml } from '@/lib/security/html-client';

// This tests the actual browser DOM sanitizer used for paste, broadcasts and initial content.
describe('editor insertion guard', () => {
  it('removes active tags, events, remote media, dangerous URLs and CSS before insertion', () => {
    const container = document.createElement('div');
    container.innerHTML = sanitizeEditorHtml('<img src="https://evil.test" onerror="alert(1)"><svg onload="alert(1)"></svg><script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">link</a><p style="position:fixed;background:url(https://evil.test);text-align:center">safe</p>');
    expect(container.querySelector('img,svg,script')).toBeNull();
    expect(container.querySelector('[onclick],[onload],[onerror],[href]')).toBeNull();
    expect(container.querySelector('p')?.getAttribute('style')).toBe('text-align:center');
    expect(container.textContent).toBe('linksafe');
  });
  it('preserves rich pasted tables and safe links through the browser parser', () => {
    const container = document.createElement('div');
    container.innerHTML = sanitizeEditorHtml('<h2>Heading</h2><table style="border-collapse:collapse;width:100%"><thead><tr><th colspan="2" style="padding:8px;border:1px solid var(--border-color)">Title</th></tr></thead><tbody><tr><td>one</td><td><a href="https://example.test">two</a></td></tr></tbody></table>');
    expect(container.querySelectorAll('table tbody td')).toHaveLength(2);
    expect(container.querySelector('th')?.colSpan).toBe(2);
    expect(container.querySelector('table')?.style.borderCollapse).toBe('collapse');
    expect(container.querySelector('a')?.href).toBe('https://example.test/');
  });
});
