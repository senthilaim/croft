"use client";

import { useState } from "react";

export function CopyLocation({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-md border border-black/10 px-2 py-0.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/[.06]"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
