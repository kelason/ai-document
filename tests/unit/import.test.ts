import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseImport } from '@/lib/import/parse';

const text = (name: string, value: string, mimeType = 'text/plain') => ({ name, mimeType, bytes: new TextEncoder().encode(value) });
const docx = (name: string) => ({ name, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: readFileSync(`tests/fixtures/imports/${name}`) });

describe('bounded import boundary', () => {
  it('escapes plain text rather than treating it as HTML', async () => {
    expect(await parseImport(text('notes.txt', '<img src=x onerror=alert(1)> & "text"'))).toBe('<p>&lt;img src=x onerror=alert(1)&gt; &amp; "text"</p>');
  });
  it('supports markdown while escaping source HTML and unsafe URLs', async () => {
    const safe = await parseImport(text('notes.md', '# <svg onload=alert(1)>\n**safe** [link](javascript:alert)\n- item', 'text/markdown'));
    expect(safe).toContain('<h1>&lt;svg onload=alert(1)&gt;</h1>');
    expect(safe).toContain('<strong>safe</strong>');
    expect(safe).toContain('<ul><li>item</li></ul>');
    expect(safe).not.toContain('href="javascript:');
  });
  it.each([
    text('file.html', '<p>x</p>', 'text/html'),
    text('file.txt', 'text', 'application/pdf'),
    text('../file.txt', 'text'),
    text('file.exe.txt', '\u0000MZbinary'),
    { ...text('file.txt', ''), bytes: Uint8Array.of(0xff, 0xfe, 0x00) },
    text('file.docx', 'not a zip', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  ])('rejects mismatched, binary, malformed, or unsafe input $name', async (input) => {
    await expect(parseImport(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('enforces input size before parsing', async () => {
    await expect(parseImport(text('large.txt', 'x'.repeat(5 * 1024 * 1024 + 1)))).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
  it('enforces the HTML output limit after escaping', async () => {
    await expect(parseImport(text('large.txt', '<'.repeat(300_000)))).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
  it('imports a real DOCX in the bounded worker', async () => {
    expect(await parseImport(docx('safe.docx'))).toContain('<p>Hello <strong>safe</strong></p>');
  });
  it.each(['bomb.docx', 'traversal.docx', 'external.docx', 'encrypted.docx', 'too-many.docx', 'forged-size.docx', 'corrupt.docx'])('rejects dangerous archive %s before rendering', async (name) => {
    await expect(parseImport(docx(name))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// A real worker is started, then the deadline is advanced before it can deliver any result.
it('terminates an import worker when its execution deadline is reached', async () => {
  const { vi } = await import('vitest');
  vi.useFakeTimers();
  try {
    const pending = parseImport(docx('safe.docx'));
    const rejection = expect(pending).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
  } finally {
    vi.useRealTimers();
  }
});
