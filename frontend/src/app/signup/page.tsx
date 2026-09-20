import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { Logo } from "@/components/layout/logo";

const HIGHLIGHTS = [
  "Drag-and-drop Buildfarm designer",
  "One-click provisioning on real Docker infra",
  "Live build analytics: status, cache hits, failures",
];

export default function SignupPage() {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-between bg-brand-panel p-10 text-white lg:flex">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Logo className="h-6 w-6" />
          Croft
        </Link>
        <div>
          <h2 className="text-3xl font-semibold leading-tight text-balance">
            Design, provision, and watch your Buildfarm live.
          </h2>
          <ul className="mt-6 flex flex-col gap-2.5 text-sm text-white/75">
            {HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="h-1 w-1 shrink-0 rounded-full bg-background/50" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/50">
          © {new Date().getFullYear()} Croft
        </p>
      </div>

      <div className="relative flex w-full flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-16 lg:w-1/2 dark:bg-black">
        <ThemeToggle className="absolute right-4 top-4" />
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold text-black lg:hidden dark:text-zinc-50"
        >
          <Logo className="h-6 w-6" />
          Croft
        </Link>

        <div className="w-full max-w-sm rounded-xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
            Create your account
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Start designing your Buildfarm in minutes.
          </p>
          <div className="mt-6">
            <AuthForm mode="signup" />
          </div>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Already have an account?{" "}
          <Link href="/signin" className="font-medium text-black underline dark:text-zinc-50">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
