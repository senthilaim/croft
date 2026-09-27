"use client";

import { useState } from "react";
import type { WorkspaceMember, WorkspaceRole } from "@croft/shared-types";

const field =
  "h-9 w-full rounded-lg border border-black/10 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100";
const card =
  "rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900";

const ASSIGNABLE_ROLES: Exclude<WorkspaceRole, "owner">[] = ["admin", "member", "viewer"];

const roleLabel: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export function MembersSettings({
  workspaceId,
  myUserId,
  myRole,
  initialMembers,
}: {
  workspaceId: string;
  myUserId: string;
  myRole: WorkspaceRole;
  initialMembers: WorkspaceMember[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<WorkspaceRole, "owner">>("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canManageMembers = myRole === "owner" || myRole === "admin";

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const body = await res.json();
      if (!res.ok) {
        setInviteError(body?.message ?? "Could not invite this person.");
        return;
      }
      setMembers(body);
      setEmail("");
    } catch {
      setInviteError("Could not reach the server.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(userId: string, role: Exclude<WorkspaceRole, "owner">) {
    setBusyUserId(userId);
    setActionError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const body = await res.json();
      if (!res.ok) {
        setActionError(body?.message ?? "Could not change this person's role.");
        return;
      }
      setMembers(body);
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRemove(userId: string, isSelf: boolean) {
    if (!confirm(isSelf ? "Leave this workspace?" : "Remove this person from the workspace?")) return;
    setBusyUserId(userId);
    setActionError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) {
        setActionError(body?.message ?? "Could not remove this person.");
        return;
      }
      if (isSelf) {
        window.location.href = "/workspaces";
        return;
      }
      setMembers(body);
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className={`${card} overflow-hidden`}>
        <table className="w-full text-left text-sm">
          <thead className="bg-black/[.03] text-xs text-zinc-600 dark:bg-white/[.04] dark:text-zinc-300">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/5">
            {members.map((m) => {
              const isSelf = m.userId === myUserId;
              const isOwner = m.role === "owner";
              const canChangeThisRole = myRole === "owner" && !isOwner;
              // The owner can never leave/be removed in v1 (no ownership transfer yet) -- !isOwner
              // applies unconditionally, not just when someone else is looking at their own row.
              const canRemoveThisMember = !isOwner && (isSelf || myRole === "owner" || myRole === "admin");
              return (
                <tr key={m.userId}>
                  <td className="px-4 py-2.5 font-medium text-zinc-900 dark:text-zinc-50">
                    {m.name}
                    {isSelf && <span className="ml-1.5 text-xs font-normal text-zinc-400">(you)</span>}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{m.email}</td>
                  <td className="px-4 py-2.5">
                    {canChangeThisRole ? (
                      <select
                        value={m.role}
                        disabled={busyUserId === m.userId}
                        onChange={(e) =>
                          handleRoleChange(m.userId, e.target.value as Exclude<WorkspaceRole, "owner">)
                        }
                        className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-zinc-950"
                      >
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-zinc-600 dark:text-zinc-400">{roleLabel[m.role]}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canRemoveThisMember && (
                      <button
                        onClick={() => handleRemove(m.userId, isSelf)}
                        disabled={busyUserId === m.userId}
                        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                      >
                        {isSelf ? "Leave" : "Remove"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}

      {canManageMembers && (
        <div className={`${card} p-5`}>
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Invite someone</h2>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            They need an existing Croft account -- ask them to sign up first if they don&apos;t have one yet.
          </p>
          <form onSubmit={handleInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
                className={field}
                required
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Role
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Exclude<WorkspaceRole, "owner">)}
                className="h-9 rounded-lg border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-zinc-950"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel[r]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={inviting}
              className="h-9 shrink-0 rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
            >
              {inviting ? "Inviting…" : "Invite"}
            </button>
          </form>
          {inviteError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{inviteError}</p>}
        </div>
      )}
    </div>
  );
}
