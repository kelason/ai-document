import { ApiError } from '@/lib/http/errors';
import { parseImportInWorker } from './docx';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_HTML_BYTES = 1024 * 1024;

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
  if (extension === 'docx' && (file.bytes.length < 4 || ![0x50, 0x4b, 0x03, 0x04].every((byte, index) => file.bytes[index] === byte))) throw invalid();
  return parseImportInWorker(file.bytes, extension as 'txt' | 'md' | 'docx');
}
