"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? "Could not create workspace");
        return;
      }

      setName("");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
      <input
        type="text"
        required
        placeholder="e.g. My Project"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-shadow focus:border-black/20 focus:ring-2 focus:ring-black/10 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-white/20 dark:focus:ring-white/10"
      />
      <button
        type="submit"
        disabled={submitting}
        className="shrink-0 rounded-full bg-brand px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create workspace"}
      </button>
      {error && <p className="self-center text-sm text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}
