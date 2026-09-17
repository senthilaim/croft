export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect x="2" y="2" width="8.5" height="8.5" rx="2" fill="currentColor" />
      <rect x="13.5" y="2" width="8.5" height="8.5" rx="2" fill="currentColor" opacity="0.55" />
      <rect x="2" y="13.5" width="8.5" height="8.5" rx="2" fill="currentColor" opacity="0.55" />
      <rect x="13.5" y="13.5" width="8.5" height="8.5" rx="2" fill="currentColor" />
    </svg>
  );
}
