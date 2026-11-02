"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ResetPasswordForm({ token, invalidLink }: { token: string; invalidLink: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 12) {
      setError("Your password must be at least 12 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password, token }),
      });
      if (!response.ok) {
        setError("This reset link is invalid or expired. Request a new one and try again.");
        return;
      }
      router.replace("/login?passwordReset=1");
    } catch {
      setError("Unable to reach the password reset service. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-[#f3f5f7] px-4 py-12">
    <section className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[.16em] text-[#bc8c36]">Big Joe Gold</p>
      <h1 className="mt-3 text-2xl font-semibold text-[#17212f]">Reset your password</h1>
      {invalidLink || !token ? <>
        <p className="mt-3 text-sm text-[#66717d]">This reset link is invalid or expired. Request a new link from the sign-in page.</p>
        <Link href="/login" className="mt-5 inline-block text-sm font-semibold text-[#8a6829] hover:underline">Return to sign in</Link>
      </> : <>
        <p className="mt-2 text-sm text-[#7b8591]">Choose a new password with at least 12 characters.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-xs font-semibold text-[#47515d]">
            New password
            <input autoComplete="new-password" type="password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[#dfe4e9] px-3 text-sm outline-none focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15" />
          </label>
          <label className="block text-xs font-semibold text-[#47515d]">
            Confirm new password
            <input autoComplete="new-password" type="password" minLength={12} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[#dfe4e9] px-3 text-sm outline-none focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15" />
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <Button type="submit" variant="gold" className="w-full" disabled={isSubmitting}>{isSubmitting ? "Updating…" : "Update password"}</Button>
        </form>
      </>}
    </section>
  </main>;
}
