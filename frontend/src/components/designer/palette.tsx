"use client";

import { NODE_PALETTE } from "./node-defaults";

export const DRAG_DATA_TYPE = "application/buildfarm-node-type";

export function Palette() {
  return (
    <aside className="flex w-52 shrink-0 flex-col gap-2 border-r border-black/10 p-4 dark:border-white/10">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Components
      </h2>
      {NODE_PALETTE.map((item) => (
        <div
          key={item.type}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_DATA_TYPE, item.type);
            e.dataTransfer.effectAllowed = "move";
          }}
          className="cursor-grab rounded-md border border-black/10 bg-white px-3 py-2 text-sm shadow-sm transition-colors hover:bg-black/[.03] active:cursor-grabbing dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-white/[.05]"
        >
          <div className="font-medium text-zinc-900 dark:text-zinc-50">{item.label}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{item.description}</div>
        </div>
      ))}
      <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
        Drag a component onto the canvas, then connect and configure it.
      </p>
    </aside>
  );
}
