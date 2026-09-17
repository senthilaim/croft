export function StatTile({
  label,
  value,
  dotColorVar,
}: {
  label: string;
  value: string;
  dotColorVar?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-black/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-zinc-900">
      <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {dotColorVar && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: dotColorVar }}
            aria-hidden
          />
        )}
        {label}
      </span>
      <span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</span>
    </div>
  );
}
