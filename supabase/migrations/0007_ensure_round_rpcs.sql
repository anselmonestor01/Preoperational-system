-- Ensure start_round / close_round exist and are callable by authenticated admins.
-- Safe to re-run (CREATE OR REPLACE).

create or replace function public.start_round(p_label text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_org uuid;
  v_num int;
  v_id uuid;
  v_label text;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then
    raise exception 'No autorizado';
  end if;
  perform pg_advisory_xact_lock(hashtext('round:'||v_org::text));
  update public.rounds
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where organization_id = v_org and status = 'open';
  select coalesce(max(round_number), 0) + 1 into v_num
    from public.rounds where organization_id = v_org;
  v_label := coalesce(nullif(trim(p_label), ''), 'Ronda ' || v_num);
  insert into public.rounds (organization_id, round_number, label, status, started_by)
  values (v_org, v_num, v_label, 'open', auth.uid())
  returning id into v_id;
  begin
    perform app.write_audit(
      'round_started', 'round', v_id::text, null,
      jsonb_build_object('round_number', v_num, 'label', v_label), null
    );
  exception when others then
    null; -- audit is best-effort
  end;
  return jsonb_build_object('id', v_id, 'round_number', v_num, 'label', v_label);
end;
$$;

create or replace function public.close_round()
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_org uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then
    raise exception 'No autorizado';
  end if;
  update public.rounds
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where organization_id = v_org and status = 'open';
  begin
    perform app.write_audit('round_closed', 'round', null, null, null, null);
  exception when others then
    null;
  end;
end;
$$;

revoke execute on function public.start_round(text) from public, anon;
revoke execute on function public.close_round() from public, anon;
grant execute on function public.start_round(text) to authenticated;
grant execute on function public.close_round() to authenticated;

-- Refresh PostgREST schema cache so the RPCs appear immediately
notify pgrst, 'reload schema';
