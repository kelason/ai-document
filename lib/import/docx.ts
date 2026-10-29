import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { ApiError } from '@/lib/http/errors';
// Static dependencies let Next's file tracer follow the worker's complete native dependency graph.
import 'yauzl';
import 'fast-xml-parser';
import 'mammoth';
import 'sanitize-html';
import { DOCUMENT_ATTRIBUTES, DOCUMENT_TAGS, DOCUMENT_STYLES } from '@/lib/security/html-policy';

// Keep native dependencies external and traced in next.config for production workers.
const nativeRequire = createRequire(import.meta.url);
// Keep resolution a native runtime call. Turbopack rewrites direct literal
// require.resolve calls to numeric module IDs, which are invalid in a worker.
const resolveNative = nativeRequire.resolve.bind(nativeRequire);
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const yauzl = require(workerData.yauzl);
const { XMLParser, XMLValidator } = require(workerData.xml);
const mammoth = require(workerData.mammoth);
const sanitizeHtml = require(workerData.sanitizer);
const { crc32 } = require('node:zlib');
const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
const LIMIT = 20 * 1024 * 1024;
const bytes = Buffer.from(workerData.bytes);
let zip;
let done = false;
function fail(tooLarge = false) {
  if (done) return;
  done = true;
  if (zip) zip.close();
  parentPort.postMessage({ ok: false, tooLarge: tooLarge === true });
}
function publish(html) {
  if (Buffer.byteLength(html, 'utf8') > 1024 * 1024) return fail(true);
  const styles = Object.fromEntries(Object.entries(workerData.policy.styles).map(([key, rules]) => [key, rules.map(([source, flags]) => new RegExp(source, flags))]));
  const safe = sanitizeHtml(html, {
    allowedTags: workerData.policy.tags, allowedAttributes: workerData.policy.attributes,
    allowedSchemes: ['http', 'https', 'mailto'], allowProtocolRelative: false, parseStyleAttributes: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'svg', 'math', 'iframe', 'object', 'embed', 'template', 'noscript', 'xmp'],
    transformTags: { '*': (tagName, original) => {
      const attribs = { ...original };
      if (attribs.href && !/^(?:https?:\/\/|mailto:)[^\u0000-\u0020\u007f<>"\\]*$/i.test(attribs.href)) delete attribs.href;
      if (attribs.style) {
        attribs.style = attribs.style.split(';').flatMap(declaration => {
          const colon = declaration.indexOf(':');
          if (colon < 0) return [];
          const property = declaration.slice(0, colon).trim().toLowerCase(), value = declaration.slice(colon + 1).trim();
          return styles[property]?.some(rule => rule.test(value)) ? [property + ':' + value] : [];
        }).join(';');
        if (!attribs.style) delete attribs.style;
      }
      for (const key of ['colspan', 'rowspan', 'span', 'start', 'value']) if (attribs[key] && !/^\d{1,4}$/.test(attribs[key])) delete attribs[key];
      return { tagName, attribs };
    } },
  });
  if (Buffer.byteLength(safe, 'utf8') > 1024 * 1024) return fail(true);
  done = true;
  parentPort.postMessage({ ok: true, html: safe });
}
function escapeText(value) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function inlineMarkdown(value, depth = 0, allowLinks = true) {
  // Matched spans are disjoint at each level; the fixed depth cap bounds nested work to 8 * input length.
  if (depth >= 8) return value;
  const out = [], closes = new Map(), links = new Map(), whitespacePattern = /\s/g;
  let whitespace = -2;
  function hasWhitespace(start, end) {
    if (whitespace === -2 || (whitespace >= 0 && whitespace < start)) {
      whitespacePattern.lastIndex = start;
      whitespace = whitespacePattern.exec(value)?.index ?? -1;
    }
    return whitespace >= 0 && whitespace < end;
  }
  // Each delimiter's search cursor only advances, so malformed delimiter runs remain linear.
  function next(token, start) {
    if (!closes.has(token) || (closes.get(token) >= 0 && closes.get(token) < start)) closes.set(token, value.indexOf(token, start));
    return closes.get(token);
  }
  for (let i = 0; i < value.length;) {
    if (allowLinks && value[i] === '[') {
      const close = next(']', i + 1);
      if (close > i + 1 && !links.has(close)) {
        const end = value[close + 1] === '(' ? next(')', close + 2) : -1;
        links.set(close, end > close + 2 && !hasWhitespace(close + 2, end) ? { end, href: value.slice(close + 2, end) } : null);
      }
      const link = links.get(close);
      if (link && close > i + 1) {
        out.push('<a href="' + link.href.replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '">' + inlineMarkdown(value.slice(i + 1, close), depth + 1, false) + '</a>');
        i = link.end + 1; continue;
      }
    }
    const token = value.startsWith('**', i) ? '**' : ['*', '_', String.fromCharCode(96)].includes(value[i]) ? value[i] : null;
    if (token) {
      const close = next(token, i + token.length);
      if (close > i + token.length) {
        const tag = token === '**' ? 'strong' : token === String.fromCharCode(96) ? 'code' : 'em';
        const content = value.slice(i + token.length, close);
        out.push('<' + tag + '>' + (tag === 'code' ? content : inlineMarkdown(content, depth + 1, allowLinks)) + '</' + tag + '>');
        i = close + token.length; continue;
      }
    }
    out.push(value[i++]);
  }
  return out.join('');
}
function importText() {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return fail();
    const html = text.replace(/\r\n?/g, '\n').split('\n').map(line => {
      const safe = escapeText(line);
      if (!safe.trim()) return '<br>';
      if (workerData.format === 'txt') return '<p>' + safe + '</p>';
      const heading = /^(#{1,6})\s+(.+)$/.exec(safe);
      if (heading) return '<h' + heading[1].length + '>' + inlineMarkdown(heading[2]) + '</h' + heading[1].length + '>';
      if (/^\s*[-*+]\s+/.test(safe)) return '<ul><li>' + inlineMarkdown(safe.replace(/^\s*[-*+]\s+/, '')) + '</li></ul>';
      if (/^\s*\d+\.\s+/.test(safe)) return '<ol><li>' + inlineMarkdown(safe.replace(/^\s*\d+\.\s+/, '')) + '</li></ol>';
      return '<p>' + inlineMarkdown(safe) + '</p>';
    }).join('');
    publish(html);
  } catch { fail(); }
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
function validateLocal(entry, centralStart) {
  const offset = entry.relativeOffsetOfLocalHeader, raw = entry.fileNameRaw;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 30 > centralStart || bytes.readUInt32LE(offset) !== 0x04034b50) throw Error('header bounds');
  const flags = bytes.readUInt16LE(offset + 6), method = bytes.readUInt16LE(offset + 8);
  const nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength, end = start + entry.compressedSize;
  if (flags !== entry.generalPurposeBitFlag || flags & ~0x080e || method !== entry.compressionMethod || ![0, 8].includes(method) ||
    bytes.readUInt16LE(offset + 4) !== entry.versionNeededToExtract || entry.versionNeededToExtract > 20 ||
    start > centralStart || end > centralStart || !Number.isSafeInteger(end) ||
    !bytes.subarray(offset + 30, offset + 30 + nameLength).equals(raw)) throw Error('inconsistent metadata');
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  if (decoded !== entry.fileName || !Buffer.from(decoded, 'utf8').equals(raw) || (!(flags & 0x800) && raw.some(byte => byte > 127))) throw Error('ambiguous filename');
  const central = [entry.crc32, entry.compressedSize, entry.uncompressedSize];
  const local = [14, 18, 22].map(at => bytes.readUInt32LE(offset + at));
  if (!(flags & 8)) {
    if (local.some((value, i) => value !== central[i])) throw Error('inconsistent sizes');
    return [offset, end];
  }
  if (local.some((value, i) => value !== 0 && value !== central[i])) throw Error('inconsistent descriptor');
  const descriptor = end + (end + 4 <= centralStart && bytes.readUInt32LE(end) === 0x08074b50 ? 4 : 0);
  if (descriptor + 12 > centralStart || central.some((value, i) => bytes.readUInt32LE(descriptor + i * 4) !== value)) throw Error('invalid descriptor');
  return [offset, descriptor + 12];
}
function canonicalZip(records) {
  // Mammoth only receives freshly written UTF-8 headers with no extras or descriptors.
  const local = [], central = [];
  let offset = 0;
  for (const [name, data] of records) {
    const filename = Buffer.from(name, 'utf8'), header = Buffer.alloc(30), directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    header.copy(directory, 8, 6, 30); directory.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(directory, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(records.length, 8); end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
if (workerData.format !== 'docx') importText();
else yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, opened) => {
  if (error) return fail();
  zip = opened;
  let entries = 0, expanded = 0, compressed = 0;
  const names = new Set(), records = [], ranges = [];
  const centralStart = zip.readEntryCursor;
  zip.on('error', fail);
  zip.on('entry', (entry) => {
    if (done) return;
    const name = entry.fileName;
    if (++entries > 2000 || names.has(name) || entry.generalPurposeBitFlag & 0x41 ||
      /(^|\/)\.\.?(\/|$)|\\|^\//.test(name) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 ||
      /vbaProject\.bin$/i.test(name) || entry.uncompressedSize > LIMIT ||
      entry.uncompressedSize > Math.max(1, entry.compressedSize) * 100) return fail();
    try { ranges.push(validateLocal(entry, centralStart)); } catch { return fail(); }
    names.add(name);
    compressed += entry.compressedSize;
    if (name.endsWith('/')) {
      if (entry.uncompressedSize || entry.compressedSize) return fail();
      return zip.readEntry();
    }
    zip.openReadStream(entry, (streamError, stream) => {
      if (streamError) return fail();
      let actual = 0, checksum = 0;
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
        checksum = crc32(chunk, checksum);
        chunks.push(chunk);
      });
      stream.on('end', () => {
        if (done) return;
        if (actual !== entry.uncompressedSize || checksum !== entry.crc32) return fail();
        try {
          const content = Buffer.concat(chunks);
          if (xml) checkXml(content, /\.rels$/i.test(name));
          records.push([name, content]);
        } catch { return fail(); }
        zip.readEntry();
      });
    });
  });
  zip.on('end', async () => {
    if (done) return;
    ranges.sort((a, b) => a[0] - b[0]);
    if (ranges.some((range, i) => i && range[0] < ranges[i - 1][1])) return fail();
    if (expanded > Math.max(1, compressed) * 100 || !names.has('[Content_Types].xml') || !names.has('_rels/.rels') || !names.has('word/document.xml')) return fail();
    try {
      const result = await mammoth.convertToHtml({ buffer: canonicalZip(records) }, {
        externalFileAccess: false,
        convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
      });
      publish(result.value);
    } catch { fail(); }
  });
  zip.readEntry();
});
`;

/** Inspection and conversion both run outside the request thread, with a hard termination deadline. */
export async function parseImportInWorker(bytes: Uint8Array, format: 'txt' | 'md' | 'docx'): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        bytes, format,
        sanitizer: resolveNative('sanitize-html'),
        policy: { tags: DOCUMENT_TAGS, attributes: DOCUMENT_ATTRIBUTES, styles: Object.fromEntries(Object.entries(DOCUMENT_STYLES).map(([key, rules]) => [key, rules.map(rule => [rule.source, rule.flags])])) },
        yauzl: resolveNative('yauzl'),
        xml: resolveNative('fast-xml-parser'),
        mammoth: resolveNative('mammoth'),
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
    const invalid = () => new ApiError('VALIDATION_ERROR', 'Could not safely import this file.');
    const timeout = setTimeout(() => finish(invalid()), 5_000);
    worker.once('message', (message: { ok?: boolean; tooLarge?: boolean; html?: unknown }) => {
      if (message.ok && typeof message.html === 'string') finish(undefined, message.html);
      else finish(message.tooLarge ? new ApiError('PAYLOAD_TOO_LARGE', 'Imported document exceeds 1 MiB.') : invalid());
    });
    worker.once('error', () => finish(invalid()));
    worker.once('exit', () => { if (!settled) finish(invalid()); });
  });
}
