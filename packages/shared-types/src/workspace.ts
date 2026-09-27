/** "owner" is implicit (workspaceId's ownerId === userId), never stored as a member entry --
 * computed, not persisted, to avoid a dual-source-of-truth bug where the owner's own entry in two
 * places could disagree. */
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  /** Derived/denormalized from `ownerId` + the real membership list -- kept in sync on every
   * membership change so existing `.length` displays and lookups keep working unchanged. Not the
   * source of truth for roles; see the member-management endpoints for that. */
  memberIds: string[];
  /** The requesting user's own role in this workspace. Only present on responses fetched by an
   * authenticated member (always true today, since every read is membership-gated). */
  myRole: WorkspaceRole;
  createdAt: string;
}

export interface CreateWorkspaceRequest {
  name: string;
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
}

export interface InviteMemberRequest {
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
}

export interface UpdateMemberRoleRequest {
  role: Exclude<WorkspaceRole, "owner">;
}
