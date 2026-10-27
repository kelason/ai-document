import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { ApiError } from '@/lib/http/errors';
// Static dependencies let Next's file tracer follow the worker's complete native dependency graph.
import 'yauzl';
import 'fast-xml-parser';
import 'mammoth';

// Keep native dependencies external and traced in next.config for production workers.
const nativeRequire = createRequire(import.meta.url);
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const yauzl = require(workerData.yauzl);
const { XMLParser, XMLValidator } = require(workerData.xml);
const mammoth = require(workerData.mammoth);
const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
const LIMIT = 20 * 1024 * 1024;
const bytes = Buffer.from(workerData.bytes);
let zip;
let done = false;
function fail() {
  if (done) return;
  done = true;
  if (zip) zip.close();
  parentPort.postMessage({ ok: false });
}
function checkXml(content, relationships) {
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(content);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw Error('invalid xml');
  if (!relationships) return;
  const tree = parser.parse(xml);
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    const mode = value['@_TargetMode'];
    const target = value['@_Target'];
    if ((typeof mode === 'string' && mode.toLowerCase() === 'external') ||
      (typeof target === 'string' && (/^[a-z][a-z0-9+.-]*:/i.test(target) || /^[/\\]{2}/.test(target) || /[\u0000-\u001f]/.test(target)))) throw Error('external resource');
    for (const child of Object.values(value)) walk(child);
  }
  walk(tree);
}
yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, opened) => {
  if (error) return fail();
  zip = opened;
  let entries = 0, expanded = 0, compressed = 0;
  const names = new Set();
  zip.on('error', fail);
  zip.on('entry', (entry) => {
    if (done) return;
    const name = entry.fileName;
    if (++entries > 2000 || names.has(name) || entry.generalPurposeBitFlag & 0x41 ||
      /(^|\/)\.\.?(\/|$)|\\|^\//.test(name) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 ||
      /vbaProject\.bin$/i.test(name) || entry.uncompressedSize > LIMIT ||
      entry.uncompressedSize > Math.max(1, entry.compressedSize) * 100) return fail();
    names.add(name);
    compressed += entry.compressedSize;
    if (name.endsWith('/')) return zip.readEntry();
    zip.openReadStream(entry, (streamError, stream) => {
      if (streamError) return fail();
      let actual = 0;
      const chunks = [];
      const xml = /\.(?:xml|rels)$/i.test(name);
      stream.on('error', fail);
      stream.on('data', (chunk) => {
        actual += chunk.length;
        expanded += chunk.length;
        if (expanded > LIMIT || actual > Math.max(1, entry.compressedSize) * 100) {
          stream.destroy();
          return fail();
        }
        if (xml) chunks.push(chunk);
      });
      stream.on('end', () => {
        if (done) return;
        if (actual !== entry.uncompressedSize) return fail();
        try {
          if (xml) checkXml(Buffer.concat(chunks), /\.rels$/i.test(name));
        } catch { return fail(); }
        zip.readEntry();
      });
    });
  });
  zip.on('end', async () => {
    if (done) return;
    if (expanded > Math.max(1, compressed) * 100 || !names.has('[Content_Types].xml') || !names.has('_rels/.rels') || !names.has('word/document.xml')) return fail();
    try {
      const result = await mammoth.convertToHtml({ buffer: bytes }, {
        externalFileAccess: false,
        convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
      });
      if (Buffer.byteLength(result.value, 'utf8') > 1024 * 1024) {
        done = true;
        return parentPort.postMessage({ ok: false, tooLarge: true });
      }
      done = true;
      parentPort.postMessage({ ok: true, html: result.value });
    } catch { fail(); }
  });
  zip.readEntry();
});
`;

/** Inspection and conversion both run outside the request thread, with a hard termination deadline. */
export async function parseDocx(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        bytes,
        yauzl: nativeRequire.resolve('yauzl'),
        xml: nativeRequire.resolve('fast-xml-parser'),
        mammoth: nativeRequire.resolve('mammoth'),
      },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    const finish = (error?: ApiError, html?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate();
      if (error) reject(error);
      else resolve(html ?? '');
    };
    const invalid = () => new ApiError('VALIDATION_ERROR', 'Could not safely import this DOCX file.');
    const timeout = setTimeout(() => finish(invalid()), 5_000);
    worker.once('message', (message: { ok?: boolean; tooLarge?: boolean; html?: unknown }) => {
      if (message.ok && typeof message.html === 'string') finish(undefined, message.html);
      else finish(message.tooLarge ? new ApiError('PAYLOAD_TOO_LARGE', 'Imported document exceeds 1 MiB.') : invalid());
    });
    worker.once('error', () => finish(invalid()));
    worker.once('exit', () => { if (!settled) finish(invalid()); });
  });
}
