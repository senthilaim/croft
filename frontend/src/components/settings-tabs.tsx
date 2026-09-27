import Link from "next/link";

// A small local tab strip -- this branch predates the nav-reorg branch's global sub-tab header,
// so there's no shared sub-nav to hook into yet. Deliberately temporary: whoever merges the two
// branches should fold this into that branch's real sub-tab mechanism instead.
const TABS = [
  { key: "members", label: "Members", path: "members" },
  { key: "billing", label: "Billing", path: "billing" },
] as const;

export function SettingsTabs({ workspaceId, active }: { workspaceId: string; active: "members" | "billing" }) {
  return (
    <div className="flex gap-1 border-b border-black/10 dark:border-white/10">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/workspaces/${workspaceId}/settings/${tab.path}`}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            active === tab.key
              ? "border-brand text-brand"
              : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
