import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import IssuesClient from "./issues-client";

export const dynamic = "force-dynamic";

export default async function NovedadesPage({ searchParams }: { searchParams: { status?: string } }) {
  const supabase = createClient();
  const status = searchParams.status ?? "open";
  let query = supabase
    .from("issues")
    .select("id,item_name,category_key,severity,description,due_date,status,created_at,resolution_note,vehicle_id,vehicles(plate)")
    .order("created_at", { ascending: false }).limit(200);
  if (status === "open") query = query.neq("status", "resolved");
  else if (status !== "all") query = query.eq("status", status);
  const { data } = await query;

  const chip = (val: string, label: string) => (
    <Link href={`/admin/novedades?status=${val}`} className={"btn btn-sm " + (status === val ? "btn-primary" : "btn-ghost")}>{label}</Link>
  );

  return (
    <>
      <div className="toolbar">
        {chip("open", "Abiertas")}{chip("pending", "Pendientes")}{chip("review", "En revisión")}
        {chip("resolved", "Resueltas")}{chip("all", "Todas")}
      </div>
      <IssuesClient initial={(data ?? []) as any} />
    </>
  );
}
