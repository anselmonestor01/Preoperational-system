import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import IssuesClient, { type IssueRow } from "./issues-client";

export const dynamic = "force-dynamic";

export default async function NovedadesPage({ searchParams }: { searchParams: { status?: string } }) {
  const supabase = createClient();
  const status = searchParams.status ?? "open";

  let query = supabase.from("issues")
    .select("id,item_name,category_key,severity,description,due_date,status,created_at,vehicle_id,inspection_id,vehicles(plate),drivers(full_name)")
    .order("created_at", { ascending: false }).limit(300);
  if (status === "open") query = query.neq("status", "resolved");
  else if (status !== "all") query = query.eq("status", status);
  const { data } = await query;
  const issues = (data ?? []) as unknown as IssueRow[];

  // Evidencias (URLs firmadas) por novedad.
  const evByIssue: Record<string, string[]> = {};
  if (issues.length) {
    const { data: evs } = await supabase.from("issue_evidence")
      .select("issue_id,storage_path").in("issue_id", issues.map((i) => i.id));
    const paths = (evs ?? []).map((e) => e.storage_path);
    const signedMap: Record<string, string> = {};
    if (paths.length) {
      const { data: signed } = await supabase.storage.from("evidence").createSignedUrls(paths, 3600);
      (signed ?? []).forEach((s) => { if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl; });
    }
    (evs ?? []).forEach((e) => { if (signedMap[e.storage_path]) (evByIssue[e.issue_id] ??= []).push(signedMap[e.storage_path]); });
  }

  const chip = (val: string, label: string) => (
    <Link href={`/admin/novedades?status=${val}`} className={"btn btn-sm " + (status === val ? "btn-primary" : "btn-ghost")}>{label}</Link>
  );

  return (
    <>
      <div className="toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {chip("open", "Abiertas")}{chip("pending", "Pendientes")}{chip("review", "En revisión")}{chip("resolved", "Resueltas")}{chip("all", "Todas")}
      </div>
      <IssuesClient issues={issues} evidence={evByIssue} />
    </>
  );
}
