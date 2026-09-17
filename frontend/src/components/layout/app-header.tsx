"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@bazel-bootstrap/shared-types";
import { Logo } from "./logo";

interface AppHeaderProps {
  user: User;
  breadcrumb?: string;
}

export function AppHeader({ user, breadcrumb }: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    setSigningOut(true);
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/signin");
    router.refresh();
  }

  const initial = (user.name?.trim()?.[0] ?? user.email[0]).toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-black/10 bg-white/90 px-6 backdrop-blur-sm dark:border-white/10 dark:bg-black/90">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Link
          href="/workspaces"
          className="flex shrink-0 items-center gap-2 font-semibold text-black dark:text-zinc-50"
        >
          <Logo className="h-6 w-6" />
          <span className="hidden sm:inline">Buildfarm</span>
        </Link>
        {breadcrumb && (
          <>
            <span className="shrink-0 text-zinc-300 dark:text-zinc-600">/</span>
            <span className="truncate text-zinc-500 dark:text-zinc-400">{breadcrumb}</span>
          </>
        )}
      </div>

      <div className="relative shrink-0">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm transition-colors hover:bg-black/[.04] sm:pr-3 dark:hover:bg-white/[.06]"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
            {initial}
          </span>
          <span className="hidden max-w-[10rem] truncate text-zinc-700 sm:inline dark:text-zinc-300">
            {user.name}
          </span>
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-lg border border-black/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-zinc-900">
              <div className="border-b border-black/5 px-3 py-2.5 dark:border-white/5">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {user.name}
                </p>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{user.email}</p>
              </div>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="w-full px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-black/[.03] disabled:opacity-50 dark:text-red-400 dark:hover:bg-white/[.05]"
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
