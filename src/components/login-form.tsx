"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Coins, Eye, EyeOff, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { ThemeToggle } from "@/components/theme-toggle";

type LoginValues = { accessCode: string; email: string; password: string };
type LoginMode = "staff" | "owner";

export function LoginForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState("");
  const [mode, setMode] = useState<LoginMode>("staff");
  const [showAccessCode, setShowAccessCode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const [passwordResetSuccess, setPasswordResetSuccess] = useState(false);
  const { register, handleSubmit, formState: { isSubmitting, errors } } = useForm<LoginValues>();

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = window.setTimeout(() => setLockoutSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [lockoutSeconds]);

  useEffect(() => {
    setPasswordResetSuccess(new URLSearchParams(window.location.search).get("passwordReset") === "1");
  }, []);

  async function handleFailedLogin(response: Response, fallback: string) {
    const body: unknown = await response.json().catch(() => null);
    const message = typeof body === "object" && body !== null
      ? "message" in body && typeof body.message === "string" && body.message.trim()
        ? body.message
        : "error" in body && typeof body.error === "string" && body.error.trim()
          ? body.error
          : fallback
      : fallback;
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After")) || 60;
      setLockoutSeconds(retryAfter);
      setServerError(`${message} (${retryAfter} seconds remaining.)`);
      return;
    }
    setServerError(message);
  }

  async function submit(values: LoginValues) {
    setServerError("");
    try {
      if (forgotPassword) {
        const response = await fetch("/api/auth/request-password-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: values.email.trim().toLowerCase(),
            redirectTo: `${window.location.origin}/reset-password`,
          }),
        });
        if (!response.ok) {
          await handleFailedLogin(response, "Unable to request a password reset. Please try again.");
          return;
        }
        setResetMessage("If an active owner account uses that email, a password reset link will be sent.");
        return;
      }
      if (mode === "owner") {
        const response = await fetch("/api/auth/owner-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: values.email.trim(), password: values.password }),
        });
        if (!response.ok) {
          await handleFailedLogin(response, "Sign in failed. Check your email and password.");
          return;
        }
        router.replace("/");
        router.refresh();
        return;
      }
      const response = await fetch("/api/auth/access-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: values.accessCode }),
      });
      if (!response.ok) {
        await handleFailedLogin(response, "Sign in failed. Check your access code and try again.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setServerError("Unable to reach the sign-in service. Check your connection and try again.");
    }
  }

  return <main className="grid min-h-screen bg-[#17212f] lg:grid-cols-[1.05fr_.95fr]">
    <section className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex xl:p-16">
      <div className="absolute -right-40 -top-24 size-[570px] rounded-full border border-white/5" />
      <div className="absolute -right-20 -top-[-40px] size-[400px] rounded-full border border-white/5" />
      <div className="relative flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-[#bc8c36] text-white"><Coins size={22} /></div>
        <div><p className="text-sm font-bold tracking-wide">BIG JOE GOLD</p><p className="mt-0.5 text-[9px] uppercase tracking-[.18em] text-white/50">Trading management</p></div>
      </div>
      <div className="relative max-w-xl">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white/70"><span className="size-1.5 rounded-full bg-[#cda351]" /> Ghana cedi workspace</div>
        <h1 className="text-4xl font-semibold leading-[1.15] tracking-tight xl:text-5xl">Every gram accounted for.<br /><span className="text-[#d7b76f]">Every decision clearer.</span></h1>
        <p className="mt-5 max-w-md text-sm leading-6 text-white/55">A single, secure workspace for gold trading, stock movements, customer accounts, and business performance.</p>
      </div>
      <p className="relative text-[11px] text-white/35">Private local workspace · Access restricted to your team</p>
    </section>
    <section className="relative flex min-h-screen items-center justify-center bg-white px-6 py-12">
      <ThemeToggle className="absolute right-4 top-4 text-[#52606d] hover:bg-[#f1f3f5] hover:text-[#17212f]" />
      <div className="w-full max-w-[380px]">
        <div className="mb-10 flex items-center gap-3 lg:hidden"><div className="flex size-10 items-center justify-center rounded-xl bg-[#17212f] text-[#d7b76f]"><Coins size={22} /></div><span className="text-sm font-bold">BIG JOE GOLD</span></div>
        <p className="text-xs font-bold uppercase tracking-[.16em] text-[#bc8c36]">Welcome back</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#17212f]">Sign in to your desk</h2>
        <p className="mt-2 text-sm text-[#7b8591]">{forgotPassword ? "Enter your owner email and we'll send a reset link if it belongs to an active owner account." : mode === "owner" ? "Sign in with your owner account credentials." : "Enter the staff access code provided by your workspace owner."}</p>
        <div className="mt-6 grid grid-cols-2 rounded-xl bg-[#f3f5f7] p-1">
          <button type="button" onClick={() => { setMode("staff"); setForgotPassword(false); setResetMessage(""); setServerError(""); }} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${mode === "staff" ? "bg-white text-[#17212f] shadow-sm" : "text-[#7b8591] hover:text-[#17212f]"}`}>Staff access code</button>
          <button type="button" onClick={() => { setMode("owner"); setForgotPassword(false); setResetMessage(""); setServerError(""); }} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${mode === "owner" ? "bg-white text-[#17212f] shadow-sm" : "text-[#7b8591] hover:text-[#17212f]"}`}>Owner sign in</button>
        </div>
        <form onSubmit={handleSubmit(submit)} className="mt-8 space-y-5">
          {mode === "staff" ? <>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[#47515d]">Staff access code</span>
              <span className="relative block"><KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ba3ad]" size={16} /><input type={showAccessCode ? "text" : "password"} autoComplete="one-time-code" spellCheck={false} autoCapitalize="characters" maxLength={23} className="h-11 w-full rounded-lg border border-[#dfe4e9] bg-white pl-10 pr-11 font-mono text-sm uppercase tracking-wide outline-none focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15" placeholder="BJG-ABCD-EFGH-JKLM-NPQR" {...register("accessCode", { required: mode === "staff" ? "Enter your staff access code" : false })} /><button type="button" onClick={() => setShowAccessCode((visible) => !visible)} aria-label={showAccessCode ? "Hide access code" : "Show access code"} aria-pressed={showAccessCode} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#89929e] hover:bg-[#f1f3f5] hover:text-[#344151]">{showAccessCode ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>
            </label>
          </> : <>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[#47515d]">Owner email</span>
              <input type="email" autoComplete="username" className="h-11 w-full rounded-lg border border-[#dfe4e9] bg-white px-3 text-sm outline-none focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15" placeholder="owner@company.com" {...register("email", { required: mode === "owner" ? "Enter your owner email" : false })} />
            </label>
            {!forgotPassword && <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[#47515d]">Password</span>
              <span className="relative block"><input type={showPassword ? "text" : "password"} autoComplete="current-password" className="h-11 w-full rounded-lg border border-[#dfe4e9] bg-white px-3 pr-11 text-sm outline-none focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15" placeholder="Your password" {...register("password", { required: "Enter your password" })} /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#89929e] hover:bg-[#f1f3f5] hover:text-[#344151]">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>
            </label>}
            {forgotPassword && resetMessage && <p role="status" className="rounded-lg bg-[#f3f5f7] p-3 text-sm text-[#47515d]">{resetMessage}</p>}
            {!forgotPassword && <button type="button" onClick={() => { setForgotPassword(true); setResetMessage(""); setServerError(""); }} className="text-xs font-semibold text-[#8a6829] hover:underline">Forgot your password?</button>}
            {forgotPassword && <button type="button" onClick={() => { setForgotPassword(false); setResetMessage(""); setServerError(""); }} className="text-xs font-semibold text-[#8a6829] hover:underline">Back to owner sign in</button>}
          </>}
          <Button type="submit" variant="gold" className="mt-2 w-full" disabled={isSubmitting || lockoutSeconds > 0}>{isSubmitting ? (forgotPassword ? "Sending…" : "Signing in…") : lockoutSeconds > 0 ? `Try again in ${lockoutSeconds}s` : forgotPassword ? "Send reset link" : "Sign in"}</Button>
        </form>
        {passwordResetSuccess && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-center text-sm text-green-800">Your password was updated. Sign in with your new password.</p>}
        <p className="mt-8 text-center text-[11px] leading-5 text-[#929ba6]">Staff access is provisioned by an owner.<br />Public account registration is disabled.</p>
      </div>
    </section>
    <AlertDialog
      open={Boolean(serverError || errors.accessCode || errors.email || errors.password)}
      title={serverError ? "Sign-in error" : "Check your details"}
      description={[serverError, errors.accessCode?.message, errors.email?.message, errors.password?.message].filter(Boolean).join("\n")}
      onConfirm={() => setServerError("")}
    />
  </main>;
}
