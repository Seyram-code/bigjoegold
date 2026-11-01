import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/authz";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return <LoginForm />;
}
