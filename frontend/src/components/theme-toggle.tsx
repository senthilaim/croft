"use client";

import { useEffect, useSyncExternalStore } from "react";

type Preference = "light" | "dark" | "system";
const STORAGE_KEY = "croft-theme";
const ORDER: Preference[] = ["system", "light", "dark"];
const LABEL: Record<Preference, string> = { system: "System", light: "Light", dark: "Dark" };

function readPreference(): Preference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "system";
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
const emit = () => listeners.forEach((l) => l());

function apply(pref: Preference) {
  const dark =
    pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function Icon({ pref }: { pref: Preference }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (pref === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (pref === "dark")
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

export function ThemeToggle({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const pref = useSyncExternalStore(subscribe, readPreference, () => "system" as Preference);

  useEffect(() => {
    document.documentElement.classList.add("theme-ready");
  }, []);

  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    apply(next);
    emit();
  }

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${LABEL[pref]} (click to change)`}
      aria-label={`Theme: ${LABEL[pref]}. Click to switch.`}
      className={`flex h-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-black/[.05] dark:text-zinc-300 dark:hover:bg-white/[.08] ${className}`}
    >
      <Icon pref={pref} />
      {!compact && <span className="hidden sm:inline">{LABEL[pref]}</span>}
    </button>
  );
}
