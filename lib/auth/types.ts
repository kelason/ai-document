import type { DocumentStore } from '../documents/types';

export type DemoPersona = 'alice' | 'bob' | 'charlie';

export type Actor =
  | { kind: 'user'; userId: string }
  | {
      kind: 'guest';
      workspaceId: string;
      sessionId: string;
      generation: number;
      expiresAt: string;
    }
  | {
      kind: 'demo';
      workspaceId: string;
      sessionId: string;
      generation: number;
      expiresAt: string;
      persona: DemoPersona;
    };

/** Server-only composition. Never serialize the store or its private credentials. */
export interface RequestContext {
  actor: Actor;
  store: DocumentStore;
}

/** Safe metadata for browser expiry/reset UX; never a credential or proof of access. */
export interface TemporarySessionMetadata {
  kind: 'guest' | 'demo';
  expiresAt: string;
  generation: number;
}
