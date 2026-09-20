"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@croft/shared-types";
import { Logo } from "./logo";
import { ThemeToggle } from "../theme-toggle";

interface AppHeaderProps {
  user: User;
  breadcrumb?: string;
}

const REPO = "https://github.com/senthilaim/croft";

interface Tab {
  label: string;
  href: string;
  active: (path: string) => boolean;
}

function tabsFor(pathname: string): Tab[] {
  const match = pathname.match(/^\/workspaces\/([0-9a-f]+)/);
  if (!match) {
    return [{ label: "Workspaces", href: "/workspaces", active: () => true }];
  }
  const base = `/workspaces/${match[1]}`;
  return [
    {
      label: "Overview",
      href: base,
      active: (p) => p === base || p.startsWith(`${base}/sample-project`),
    },
    { label: "Designer", href: `${base}/designer`, active: (p) => p.startsWith(`${base}/designer`) },
    {
      label: "Analytics",
      href: `${base}/dashboard`,
      active: (p) => p === `${base}/dashboard` || p.startsWith(`${base}/builds`),
    },
    { label: "Tests", href: `${base}/dashboard/tests`, active: (p) => p.startsWith(`${base}/dashboard/tests`) },
    { label: "Trends", href: `${base}/dashboard/trends`, active: (p) => p.startsWith(`${base}/dashboard/trends`) },
  ];
}

function MenuIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-zinc-500 dark:text-zinc-400"
    >
      {children}
    </svg>
  );
}

const menuItem =
  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-zinc-800 transition-colors hover:bg-black/[.04] dark:text-zinc-100 dark:hover:bg-white/[.06]";

export function AppHeader({ user, breadcrumb }: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);
  const tabs = tabsFor(pathname);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [menuOpen]);

  async function handleSignOut() {
    setSigningOut(true);
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/signin");
    router.refresh();
  }

  const initials =
    (user.name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || user.email[0].toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-black/10 bg-white/85 px-4 backdrop-blur-md sm:px-6 dark:border-white/10 dark:bg-zinc-950/85">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/workspaces"
          className="flex shrink-0 items-center gap-2.5 font-semibold text-black dark:text-zinc-50"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white">
            <Logo className="h-5 w-5" />
          </span>
          <span className="hidden text-base sm:inline">Croft</span>
        </Link>
        <span className="hidden rounded-md bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-brand md:inline dark:text-zinc-50">
          BETA
        </span>

        <nav
          aria-label="Primary"
          className="ml-1 flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-xl bg-black/[.05] p-1 dark:bg-white/[.06]"
        >
          {tabs.map((tab) => {
            const active = tab.active(pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-white text-black shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {breadcrumb && (
          <span className="hidden min-w-0 truncate text-sm text-zinc-400 xl:inline dark:text-zinc-500">
            / {breadcrumb}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <ThemeToggle compact />

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-2.5 rounded-xl border border-transparent py-1 pl-1.5 pr-2 text-left transition-colors hover:bg-black/[.04] aria-expanded:bg-black/[.05] sm:pr-3 dark:hover:bg-white/[.06] dark:aria-expanded:bg-white/[.07]"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand dark:text-zinc-50">
              {initials}
            </span>
            <span className="hidden min-w-0 leading-tight md:block">
              <span className="block max-w-[11rem] truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {user.name}
              </span>
              <span className="block max-w-[11rem] truncate text-xs text-zinc-500 dark:text-zinc-400">
                {user.email}
              </span>
            </span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="hidden text-zinc-400 md:block"
            >
              <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
            </svg>
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-2xl border border-black/10 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-3 px-4 py-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand dark:text-zinc-50">
                  {initials}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {user.name}
                  </p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{user.email}</p>
                </div>
              </div>

              <div className="border-t border-black/5 py-1 dark:border-white/5">
                <Link href="/workspaces" role="menuitem" onClick={() => setMenuOpen(false)} className={menuItem}>
                  <MenuIcon>
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </MenuIcon>
                  All workspaces
                </Link>
                <a href={`${REPO}/blob/main/SETUP.md`} target="_blank" rel="noreferrer" role="menuitem" className={menuItem}>
                  <MenuIcon>
                    <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2zM4 19a2 2 0 0 1 2-2h12" />
                  </MenuIcon>
                  Documentation
                </a>
                <a href={`${REPO}/issues/new`} target="_blank" rel="noreferrer" role="menuitem" className={menuItem}>
                  <MenuIcon>
                    <path d="M4 5h16v11H9l-5 4zM12 8v5M9.5 10.5h5" />
                  </MenuIcon>
                  Send feedback
                </a>
              </div>

              <div className="border-t border-black/5 py-1 dark:border-white/5">
                <button
                  role="menuitem"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className={`${menuItem} disabled:opacity-50`}
                >
                  <MenuIcon>
                    <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9" />
                  </MenuIcon>
                  {signingOut ? "Signing out…" : "Log out"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
