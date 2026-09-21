"use client";

import { useEffect, useRef, useState } from "react";
import type { FileContent } from "@croft/shared-types";

export function FileViewer({ file, highlightLine }: { file: FileContent; highlightLine: number | null }) {
  const lines = file.content.replace(/\n$/, "").split("\n");
  const [copied, setCopied] = useState(false);
  const highlighted = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: "center" });
  }, [file.path, highlightLine]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  function download() {
    const url = URL.createObjectURL(new Blob([file.content], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file.path.split("/").pop() ?? "file.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const button =
    "rounded-md border border-black/10 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/[.06]";

  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 bg-black/[.03] px-4 py-2 dark:border-white/10 dark:bg-white/[.04]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-sm text-zinc-800 dark:text-zinc-100">{file.path}</span>
          <span className="shrink-0 rounded-full bg-black/[.06] px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-white/[.1] dark:text-zinc-300">
            Read-only · {file.lineCount} lines
          </span>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={copy} className={button}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={download} className={button}>
            Download
          </button>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse font-mono text-xs leading-5">
          <tbody>
            {lines.map((text, i) => {
              const n = i + 1;
              const isHit = highlightLine === n;
              return (
                <tr
                  key={n}
                  id={`L${n}`}
                  ref={isHit ? highlighted : undefined}
                  className={isHit ? "bg-amber-100 dark:bg-amber-900/30" : undefined}
                >
                  <td className="w-12 select-none border-r border-black/5 px-3 text-right text-zinc-400 dark:border-white/5 dark:text-zinc-500">
                    {n}
                  </td>
                  <td className="whitespace-pre px-4 text-zinc-800 dark:text-zinc-200">{text || " "}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
