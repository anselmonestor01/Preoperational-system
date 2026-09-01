// Raíz `/`: redirige a cada usuario a su panel según su rol.
import { redirect } from "next/navigation";
import { getProfile, roleHome } from "@/lib/auth";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  redirect(roleHome(profile.role));
}
