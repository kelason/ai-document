import type { DocumentRole, Operation } from './types';

const allowedOperations = new Map<DocumentRole, ReadonlySet<Operation>>([
  ['owner', new Set<Operation>(['read', 'edit', 'upload', 'restore', 'delete', 'manage-shares', 'presence'])],
  ['editor', new Set<Operation>(['read', 'edit', 'upload', 'restore', 'presence'])],
  ['viewer', new Set<Operation>(['read', 'presence'])],
]);

export function canPerform(role: DocumentRole, operation: Operation): boolean {
  return allowedOperations.get(role)?.has(operation) ?? false;
}
