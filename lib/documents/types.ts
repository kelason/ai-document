import type { DemoPersona, TemporarySessionMetadata } from '../auth/types';

export type DocumentRole = 'owner' | 'editor' | 'viewer';
export type Operation = 'read' | 'edit' | 'upload' | 'restore' | 'delete' | 'manage-shares' | 'presence';
export type SharePermission = 'view' | 'edit';

export interface DocumentPermissions {
  role: DocumentRole;
  allowedOperations: Operation[];
}

export interface DocumentVersion {
  id: string;
  title: string;
  /** Sanitized HTML. */
  content: string;
  updatedAt: string;
  updatedBy: string;
}

/** Recipient identity must be resolved on the server within the selected context. */
export type ShareRecipient = { userId: string; persona?: never } | { persona: DemoPersona; userId?: never };

export interface Share {
  id: string;
  documentId: string;
  recipient: ShareRecipient;
  permission: SharePermission;
  createdAt: string;
}

export interface Attachment {
  id: string;
  documentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Safe placeholder URL; attachments never provide executable HTML. */
  url: string;
  uploadedAt: string;
}

export interface Presence {
  userId: string;
  name: string;
  avatar: string;
  color: string;
  cursorOffset?: number;
  cursorY?: number;
  lastActive: number;
}

export interface DocumentSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Display metadata only. Authorization never compares owner names. */
  owner: string;
  ownerId?: string;
  ownerPersona?: DemoPersona;
  permissions: DocumentPermissions;
  session?: TemporarySessionMetadata;
}

export interface DocumentDetail extends DocumentSummary {
  /** Sanitized HTML. */
  content: string;
  history: DocumentVersion[];
  shares: Share[];
  attachments: Attachment[];
}

export interface CreateDocumentInput {
  title: string;
  content: string;
}

export interface UpdateDocumentInput {
  title?: string;
  content?: string;
  createVersion?: boolean;
}

export interface AttachmentInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

/** Coordinates must be finite and bounded by server input validation. */
export interface PresenceInput {
  active: boolean;
  cursorOffset?: number;
  cursorY?: number;
}

/**
 * Server repository boundary. Missing/denied records throw the standard ApiError.
 * Identity comes from the store, never a browser-supplied owner or presence identity.
 * Temporary implementations bind validated credentials and expected generation at
 * construction; an Actor DTO alone cannot authorize a temporary store.
 */
export interface DocumentStore {
  list(): Promise<DocumentSummary[]>;
  get(id: string): Promise<DocumentDetail>;
  create(input: CreateDocumentInput): Promise<DocumentDetail>;
  update(id: string, input: UpdateDocumentInput): Promise<DocumentDetail>;
  remove(id: string): Promise<void>;
  restore(id: string, versionId: string): Promise<DocumentDetail>;
  listShares(id: string): Promise<Share[]>;
  grantShare(id: string, recipient: ShareRecipient, permission: SharePermission): Promise<Share>;
  revokeShare(id: string, shareId: string): Promise<void>;
  addAttachment(id: string, input: AttachmentInput): Promise<Attachment>;
  heartbeat(id: string, input: PresenceInput): Promise<Presence[]>;
}
