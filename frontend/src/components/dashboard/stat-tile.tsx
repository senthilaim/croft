export function StatTile({
  label,
  value,
  dotColorVar,
  sub,
  valueColorVar,
  info,
}: {
  label: string;
  value: string;
  dotColorVar?: string;
  sub?: string;
  valueColorVar?: string;
  info?: string;
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
        {info && (
          <span
            title={info}
            aria-label={info}
            className="flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-black/[.07] text-[10px] font-semibold text-zinc-600 dark:bg-white/[.1] dark:text-zinc-300"
          >
            i
          </span>
        )}
      </span>
      <span
        className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50"
        style={valueColorVar ? { color: valueColorVar } : undefined}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-zinc-500 dark:text-zinc-400">{sub}</span>}
    </div>
  );
}
