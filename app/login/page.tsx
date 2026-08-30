import { redirect } from "next/navigation";
import { getProfile, roleHome } from "@/lib/auth";
import LoginForm from "./login-form";

export default async function LoginPage() {
  const profile = await getProfile();
  if (profile) redirect(roleHome(profile.role));
  return <LoginForm />;
}
