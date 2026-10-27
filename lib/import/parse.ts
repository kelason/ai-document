import { ApiError } from '@/lib/http/errors';
import { sanitizeDocumentHtml } from '@/lib/security/html';
import { parseDocx } from './docx';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_HTML_BYTES = 1024 * 1024;

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMarkdown(value: string): string {
  return value.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_whole, label: string, href: string) => `<a href="${href.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}">${label}</a>`);
}

function renderText(text: string, markdown: boolean): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => {
    const safe = escapeText(line);
    if (!safe.trim()) return '<br>';
    if (!markdown) return `<p>${safe}</p>`;
    const heading = /^(#{1,6})\s+(.+)$/.exec(safe);
    if (heading) return `<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`;
    if (/^\s*[-*+]\s+/.test(safe)) return `<ul><li>${inlineMarkdown(safe.replace(/^\s*[-*+]\s+/, ''))}</li></ul>`;
    if (/^\s*\d+\.\s+/.test(safe)) return `<ol><li>${inlineMarkdown(safe.replace(/^\s*\d+\.\s+/, ''))}</li></ol>`;
    return `<p>${inlineMarkdown(safe)}</p>`;
  }).join('');
}

export async function parseImport(file: { name: string; mimeType: string; bytes: Uint8Array }): Promise<string> {
  const invalid = () => new ApiError('VALIDATION_ERROR', 'Unsupported, malformed, or unsafe import file.');
  if (file.bytes.byteLength > MAX_IMPORT_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE', 'Uploaded file exceeds 5 MiB.');
  if (!file.name || file.name.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(file.name)) throw invalid();
  const extension = /\.(txt|md|docx)$/i.exec(file.name)?.[1].toLowerCase();
  if (!extension) throw invalid();
  const mime = file.mimeType.toLowerCase().split(';')[0].trim();
  const expected: Record<string, string[]> = {
    txt: ['text/plain'], md: ['text/markdown', 'text/plain'],
    docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  };
  if (mime && mime !== 'application/octet-stream' && !expected[extension].includes(mime)) throw invalid();
  let html: string;
  if (extension === 'docx') {
    if (file.bytes.length < 4 || ![0x50, 0x4b, 0x03, 0x04].every((byte, index) => file.bytes[index] === byte)) throw invalid();
    html = await parseDocx(file.bytes);
  } else {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); } catch { throw invalid(); }
    // Text formats have no magic number: require valid UTF-8 without binary control characters.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw invalid();
    html = renderText(text, extension === 'md');
  }
  const safe = sanitizeDocumentHtml(html);
  if (Buffer.byteLength(safe, 'utf8') > MAX_DOCUMENT_HTML_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE', 'Imported document exceeds 1 MiB.');
  return safe;
}
