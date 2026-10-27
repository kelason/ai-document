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
it.each([docx('safe.docx'), text('notes.md', '**safe**', 'text/markdown'), text('notes.txt', 'safe')])('terminates the entire $name conversion when its execution deadline is reached', async (input) => {
  const { vi } = await import('vitest');
  vi.useFakeTimers();
  try {
    const pending = parseImport(input);
    const rejection = expect(pending).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
  } finally {
    vi.useRealTimers();
  }
});

it.each([['unmatched-bracket', '['.repeat(128 * 1024)], ['malformed-link', '[x]('.repeat(192 * 1024) + ' )']])('bounds %s markdown without blocking the calling thread', async (_case, input) => {
  const { Worker } = await import('node:worker_threads');
  const parserUrl = new URL('../../lib/import/parse.ts', import.meta.url).href;
  const projectUrl = new URL('../../', import.meta.url).href;
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const moduleApi = require('node:module');
    moduleApi.registerHooks({ load(url, context, next) {
      if (url.endsWith('.ts')) return {format:'module', source:moduleApi.stripTypeScriptTypes(require('node:fs').readFileSync(new URL(url), 'utf8'), {mode:'transform'}), shortCircuit:true};
      return next(url, context);
    }, resolve(specifier, context, next) {
      if (specifier.startsWith('@/')) specifier = new URL(specifier.slice(2), workerData.projectUrl).href;
      try { return next(specifier, context); } catch (error) {
        if (specifier.startsWith('file:') || specifier.startsWith('.')) return next(specifier + '.ts', context);
        throw error;
      }
    }});
    import(workerData.parserUrl).then(({ parseImport }) => parseImport({name:'brackets.md', mimeType:'text/markdown', bytes:Buffer.from(workerData.input)}))
      .then(html => parentPort.postMessage({html}), error => parentPort.postMessage({error:error.message}));
  `, { eval: true, workerData: { parserUrl, projectUrl, input } });
  try {
    const result = await new Promise<{ html?: string; error?: string }>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Import exceeded the 1500ms regression budget.')), 1_500);
      worker.once('message', (message) => { clearTimeout(deadline); resolve(message); });
      worker.once('error', (error) => { clearTimeout(deadline); reject(error); });
    });
    expect(result.error).toBeUndefined();
    expect(result.html?.length).toBe(input.length + 7);
    expect(result.html?.startsWith('<p>[')).toBe(true);
  } finally { await worker.terminate(); }
}, 3_000);

it('rejects central/local filename disagreement hiding an external relationship', async () => {
  await expect(parseImport(docx('central-local-mismatch.docx'))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});

it('rejects aggregate expansion above 20MiB when every entry is below the ratio limit', async () => {
  const { zipFixture, minimalDocxEntries } = await import('../fixtures/imports/zip-fixture');
  expect(await parseImport({ ...docx('safe.docx'), bytes: zipFixture(minimalDocxEntries) })).toBe('<p>Aggregate boundary</p>');
  const { randomBytes } = await import('node:crypto');
  const data = Buffer.alloc(1024 * 1024), entropy = randomBytes(data.length / 16);
  for (let i = 0; i < entropy.length; i++) data[i * 16] = entropy[i];
  const bytes = zipFixture([...minimalDocxEntries, ...Array.from({ length: 21 }, (_, i): [string, Buffer] => [`word/assets/${i}.bin`, data])]);
  expect(bytes.length).toBeLessThan(5 * 1024 * 1024);
  await expect(parseImport({ ...docx('safe.docx'), bytes })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});

it.each(['flags', 'compression', 'size', 'offset', 'invalid-utf8', 'unflagged-utf8', 'directory-name'])('rejects ambiguous ZIP %s metadata before conversion', async (variant) => {
  const { zipFixture, minimalDocxEntries } = await import('../fixtures/imports/zip-fixture');
  const name = Buffer.from('word/assets/test.bin');
  const bytes = zipFixture([...minimalDocxEntries, [name.toString(), Buffer.from('benign')]]);
  const centralStart = bytes.indexOf(Buffer.from('PK\x01\x02'));
  const central = bytes.indexOf(name, centralStart) - 46;
  const local = bytes.readUInt32LE(central + 42);
  if (variant === 'flags') bytes.writeUInt16LE(0, local + 6);
  if (variant === 'compression') bytes.writeUInt16LE(0, local + 8);
  if (variant === 'size') bytes.writeUInt32LE(1, local + 22);
  if (variant === 'offset') bytes.writeUInt32LE(bytes.length - 1, central + 42);
  if (variant === 'directory-name') bytes[local + 30 + name.length - 1] = 47;
  if (variant === 'invalid-utf8') { bytes[local + 30] = 255; bytes[central + 46] = 255; }
  if (variant === 'unflagged-utf8') {
    bytes.writeUInt16LE(0, local + 6); bytes.writeUInt16LE(0, central + 8);
    bytes.set([0xc3, 0xa9], local + 30); bytes.set([0xc3, 0xa9], central + 46);
  }
  await expect(parseImport({ ...docx('safe.docx'), bytes })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});

it.each([
  ['**bold _italic_**', '<p><strong>bold <em>italic</em></strong></p>'],
  ['[**bold label**](https://example.test)', '<p><a href="https://example.test"><strong>bold label</strong></a></p>'],
  ['[**bold _italic_ label**](https://example.test)', '<p><a href="https://example.test"><strong>bold <em>italic</em> label</strong></a></p>'],
  ['`**literal code**`', '<p><code>**literal code**</code></p>'],
])('preserves supported nested markdown formatting in %s', async (source, expected) => {
  expect(await parseImport(text('nested.md', source, 'text/markdown'))).toBe(expected);
});
