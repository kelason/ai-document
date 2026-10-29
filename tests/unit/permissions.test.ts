import { describe, expect, it } from 'vitest';
import { canPerform } from '../../lib/documents/permissions';
import type { DocumentRole, Operation } from '../../lib/documents/types';

// Each row catches an accidental grant or denial at the authorization boundary.
const matrix: [DocumentRole, Operation, boolean][] = [
  ['owner', 'read', true],
  ['owner', 'edit', true],
  ['owner', 'upload', true],
  ['owner', 'restore', true],
  ['owner', 'delete', true],
  ['owner', 'manage-shares', true],
  ['owner', 'presence', true],
  ['editor', 'read', true],
  ['editor', 'edit', true],
  ['editor', 'upload', true],
  ['editor', 'restore', true],
  ['editor', 'delete', false],
  ['editor', 'manage-shares', false],
  ['editor', 'presence', true],
  ['viewer', 'read', true],
  ['viewer', 'edit', false],
  ['viewer', 'upload', false],
  ['viewer', 'restore', false],
  ['viewer', 'delete', false],
  ['viewer', 'manage-shares', false],
  ['viewer', 'presence', true],
];

describe('canPerform', () => {
  it.each(matrix)('%s permission for %s is %s', (role, operation, expected) => {
    expect(canPerform(role, operation)).toBe(expected);
  });

  it('denies an unrecognized runtime role', () => {
    expect(canPerform('intruder' as DocumentRole, 'read')).toBe(false);
  });

  it('denies an unrecognized runtime operation', () => {
    expect(canPerform('owner', 'transfer-ownership' as Operation)).toBe(false);
  });
});
