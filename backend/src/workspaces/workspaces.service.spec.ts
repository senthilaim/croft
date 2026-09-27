import { describe, expect, it } from 'vitest';
import { WorkspacesService } from './workspaces.service.js';
import type { WorkspaceDocument } from './schemas/workspace.schema.js';

// getRole() reads only ownerId/members/memberIds -- no Mongoose/DB interaction needed to unit
// test it, so a bare instance with unused constructor deps stubbed out is enough.
const service = new WorkspacesService({} as never, {} as never);

function workspace(overrides: Partial<WorkspaceDocument>): WorkspaceDocument {
  return {
    ownerId: 'owner-1',
    memberIds: [],
    members: [],
    ...overrides,
  } as WorkspaceDocument;
}

describe('WorkspacesService.getRole', () => {
  it('returns "owner" for the workspace owner, even if also listed as a member (should never happen, but owner wins)', () => {
    const ws = workspace({ ownerId: 'u1', members: [{ userId: 'u1', role: 'viewer' }] });
    expect(service.getRole(ws, 'u1')).toBe('owner');
  });

  it('returns the real role for a member entry', () => {
    const ws = workspace({ members: [{ userId: 'u2', role: 'admin' }] });
    expect(service.getRole(ws, 'u2')).toBe('admin');
  });

  it('returns "viewer" for a viewer entry', () => {
    const ws = workspace({ members: [{ userId: 'u3', role: 'viewer' }] });
    expect(service.getRole(ws, 'u3')).toBe('viewer');
  });

  it('falls back to "member" for a legacy workspace with no `members` field but a matching memberIds entry', () => {
    const ws = workspace({ memberIds: ['owner-1', 'u4'], members: [] });
    expect(service.getRole(ws, 'u4')).toBe('member');
  });

  it('prefers a real `members` entry over the legacy memberIds fallback when both exist', () => {
    const ws = workspace({ memberIds: ['owner-1', 'u5'], members: [{ userId: 'u5', role: 'viewer' }] });
    expect(service.getRole(ws, 'u5')).toBe('viewer');
  });

  it('returns null for someone with no relationship to the workspace at all', () => {
    const ws = workspace({ memberIds: ['owner-1'], members: [] });
    expect(service.getRole(ws, 'a-stranger')).toBeNull();
  });
});
