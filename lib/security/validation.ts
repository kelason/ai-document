import 'server-only';
import { z } from 'zod';
import { ApiError } from '../http/errors';
import { sanitizeDocumentHtml } from './html';

export const HTML_BYTES = 1024 * 1024;
export const UPLOAD_BYTES = 5 * 1024 * 1024;
// JSON may encode each ASCII HTML character as six bytes (\uXXXX).
export const DOCUMENT_REQUEST_BYTES = HTML_BYTES * 6 + 16 * 1024;
export const DEFAULT_REQUEST_BYTES = 64 * 1024;

const title = z.string().trim().min(1).max(200);
const html = z.string().refine((value) => Buffer.byteLength(value, 'utf8') <= HTML_BYTES, 'Document is too large.').transform(sanitizeDocumentHtml).refine((value) => Buffer.byteLength(value, 'utf8') <= HTML_BYTES, 'Document is too large.');
export const personaSchema = z.enum(['alice', 'bob', 'charlie']);
export const idSchema = z.uuid();
export const createDocumentSchema = z.object({
  title: title.default('Untitled'), content: html.default(''),
  template: z.enum(['blank', 'meeting-notes', 'project-proposal', 'software-spec']).optional(),
}).strict();
export const updateDocumentSchema = z.object({ title: title.optional(), content: html.optional(), createVersion: z.boolean().optional() }).strict().refine((value) => value.title !== undefined || value.content !== undefined, 'An update is required.');
export const restoreDocumentSchema = z.object({ restoreVersionId: idSchema }).strict();
export const presenceSchema = z.object({ active: z.boolean(), cursorOffset: z.number().int().min(0).max(10_000_000).optional(), cursorY: z.number().finite().min(-1_000_000).max(1_000_000).optional() }).strict();
export const shareSchema = z.union([
  z.object({ email: z.email().max(320).transform((value) => value.toLowerCase()), permission: z.enum(['view', 'edit']) }).strict(),
  z.object({ persona: personaSchema, permission: z.enum(['view', 'edit']) }).strict(),
]);
export const sessionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('guest') }).strict(),
  z.object({ kind: z.literal('demo'), persona: personaSchema }).strict(),
]);
export const personaChangeSchema = z.object({ persona: personaSchema }).strict();
export const emailSchema = z.email().max(320).transform((value) => value.toLowerCase());
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(256) }).strict();
export const signupSchema = z.object({ displayName: z.string().trim().min(1).max(100), email: emailSchema, password: z.string().min(12).max(256) }).strict();
export const emailActionSchema = z.object({ email: emailSchema }).strict();
export const resetPasswordSchema = z.object({ password: z.string().min(12).max(256) }).strict();
export const emptyBodySchema = z.object({}).strict();

/** Call origin/CSRF and durable request limits BEFORE this function. Never request.json() first. */
export async function parseJsonBody<T extends z.ZodType>(request: Request, schema: T, maxBytes = DEFAULT_REQUEST_BYTES): Promise<z.output<T>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DOCUMENT_REQUEST_BYTES) throw new ApiError('VALIDATION_ERROR', 'Invalid request body budget.');
  const tooLarge = () => new ApiError('PAYLOAD_TOO_LARGE', 'Request body is too large.');
  const invalid = () => new ApiError('VALIDATION_ERROR', 'Invalid request body.');
  const length = request.headers.get('content-length');
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw invalid();
    if (BigInt(length) > BigInt(maxBytes)) throw tooLarge();
  }
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') || (request.headers.get('content-encoding') ?? 'identity').toLowerCase() !== 'identity') throw invalid();
  if (!request.body) throw invalid();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel().catch(() => undefined); throw tooLarge(); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalid();
  } finally { reader.releaseLock(); }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    const result = schema.safeParse(JSON.parse(decoded));
    if (!result.success) throw invalid();
    return result.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalid();
  }
}
