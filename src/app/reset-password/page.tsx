import { ResetPasswordForm } from "@/components/reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  return <ResetPasswordForm token={params.token ?? ""} invalidLink={params.error === "INVALID_TOKEN"} />;
}
