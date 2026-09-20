"use client";

import { useState } from "react";

export function CopyBlock({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
      <div className="flex items-center justify-between border-b border-black/10 bg-black/[.03] px-3 py-1.5 dark:border-white/10 dark:bg-white/[.04]">
        <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400">{title}</span>
        <button
          type="button"
          onClick={copy}
          className="rounded-md px-2 py-0.5 text-xs font-medium text-zinc-700 hover:bg-black/[.06] dark:text-zinc-300 dark:hover:bg-white/[.08]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto p-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {text}
      </pre>
    </div>
  );
}
