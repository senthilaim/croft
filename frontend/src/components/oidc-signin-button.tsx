const OIDC_ERROR_MESSAGES: Record<string, string> = {
  oidc_failed: "Single sign-on failed. Please try again, or use your email and password.",
  oidc_state_mismatch: "Your sign-in attempt expired or could not be verified. Please try again.",
};

export function oidcErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
  return OIDC_ERROR_MESSAGES[error] ?? "Single sign-on failed. Please try again.";
}

export function OidcSigninButton({ displayName }: { displayName: string }) {
  return (
    <div className="flex flex-col gap-4">
      <a
        href="/api/auth/oidc/start"
        className="flex h-11 items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-5 text-sm font-medium text-zinc-800 transition-colors hover:bg-black/[.03] dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/[.06]"
      >
        Continue with {displayName}
      </a>
      <div className="flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
        <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
        or
        <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
      </div>
    </div>
  );
}
