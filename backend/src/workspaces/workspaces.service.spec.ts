import { describe, expect, it } from 'vitest';
import { FREE_PLAN_MEMBER_LIMIT, WorkspacesService } from './workspaces.service.js';
import type { WorkspaceDocument } from './schemas/workspace.schema.js';

// getRole() reads only ownerId/members/memberIds -- no Mongoose/DB interaction needed to unit
// test it, so a bare instance with unused constructor deps stubbed out is enough.
const service = new WorkspacesService({} as never, {} as never);

function workspace(overrides: Partial<WorkspaceDocument>): WorkspaceDocument {
  return {
    ownerId: 'owner-1',
    memberIds: ['owner-1'],
    members: [],
    save: () => Promise.resolve(),
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

function serviceWithUser(user: { id: string; email: string; name: string } | null): WorkspacesService {
  const usersService = { findPublicByEmail: () => Promise.resolve(user) };
  return new WorkspacesService({} as never, usersService as never);
}

describe('WorkspacesService.inviteMember -- free-tier member cap', () => {
  it('rejects the invite once a free-plan workspace is already at the cap (owner + 2)', async () => {
    const svc = serviceWithUser({ id: 'new-user', email: 'new@example.com', name: 'New User' });
    const ws = workspace({
      members: [
        { userId: 'm1', role: 'member' },
        { userId: 'm2', role: 'member' },
      ],
    }); // 1 (owner) + 2 members == FREE_PLAN_MEMBER_LIMIT
    expect(1 + ws.members.length).toBe(FREE_PLAN_MEMBER_LIMIT);

    await expect(svc.inviteMember(ws, 'new@example.com', 'member')).rejects.toThrow(/free plan is limited/i);
  });

  it('allows the invite on a free-plan workspace below the cap', async () => {
    const svc = serviceWithUser({ id: 'new-user', email: 'new@example.com', name: 'New User' });
    const ws = workspace({ members: [{ userId: 'm1', role: 'member' }] }); // 1 + 1 == 2, below the cap

    const updated = await svc.inviteMember(ws, 'new@example.com', 'member');

    expect(updated.members.map((m) => m.userId)).toContain('new-user');
  });

  it('does not enforce a cap on a "team"-plan workspace', async () => {
    const svc = serviceWithUser({ id: 'new-user', email: 'new@example.com', name: 'New User' });
    const ws = workspace({
      plan: 'team',
      members: [
        { userId: 'm1', role: 'member' },
        { userId: 'm2', role: 'member' },
      ],
    });

    const updated = await svc.inviteMember(ws, 'new@example.com', 'member');

    expect(updated.members.map((m) => m.userId)).toContain('new-user');
  });

  it('rejects inviting an email with no matching Croft account', async () => {
    const svc = serviceWithUser(null);
    const ws = workspace({});

    await expect(svc.inviteMember(ws, 'nobody@example.com', 'member')).rejects.toThrow(/no croft account/i);
  });
});
