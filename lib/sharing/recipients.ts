import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../http/errors';

/** Bind lookup to a document and the requesting user's authenticated client.
 * The SQL function checks current owner authorization before examining email.
 * Never expose this as a global user directory or use the admin client here.
 */
export function createRecipientResolver(client: SupabaseClient, documentId: string) {
  return async function resolveRecipient(email: string): Promise<{ userId: string } | null> {
    const normalized = email.trim().toLowerCase();
    if (normalized.length < 3 || normalized.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(normalized)) {
      throw new ApiError('VALIDATION_ERROR', 'Enter a valid recipient email.');
    }
    const { data, error } = await client.rpc('resolve_share_recipient', {
      p_document_id: documentId,
      p_email: normalized,
    });
    if (error) {
      if (error.code === '42501') throw new ApiError('NOT_FOUND', 'Document is unavailable.');
      throw new ApiError('STORAGE_UNAVAILABLE', 'Sharing is temporarily unavailable.');
    }
    // Missing, self, and unverified identities share the same safe response.
    return typeof data === 'string' ? { userId: data } : null;
  };
}
