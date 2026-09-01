// Layout del panel de administración: exige sesión con rol administrativo.
import { redirect } from "next/navigation";
import { getProfile, ADMIN_ROLES } from "@/lib/auth";
import AdminShell from "@/components/admin/AdminShell";
import { DialogProvider } from "@/components/ui/dialogs";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!ADMIN_ROLES.includes(profile.role)) redirect("/kiosco");
  return (
    <DialogProvider>
      <AdminShell name={profile.full_name} role={profile.role}>
        {children}
      </AdminShell>
    </DialogProvider>
  );
}
