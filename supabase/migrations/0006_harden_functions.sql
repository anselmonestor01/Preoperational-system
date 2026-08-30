-- =============================================================================
-- MUNDO MARÍTIMO — Migración 0006: Endurecimiento de funciones
-- -----------------------------------------------------------------------------
-- 1) search_path fijo en funciones auxiliares (lint 0011).
-- 2) Revocar EXECUTE a anon/public en los RPC: sólo `authenticated` (que además
--    se autoprotege con app.current_org()/app.has_role dentro de cada función).
-- =============================================================================

alter function app.touch_updated_at() set search_path = '';
alter function app.severity_of(app.item_type, text) set search_path = '';

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.app_bootstrap()',
    'public.verify_driver_pin(uuid,text)',
    'public.save_inspection_draft(uuid,uuid,jsonb,int,text,text)',
    'public.submit_inspection(uuid,uuid,jsonb,int,text,text,text)',
    'public.register_return(uuid,int,text)',
    'public.set_vehicle_block(uuid,boolean,text)',
    'public.override_authorization(uuid,boolean,text)',
    'public.set_issue_status(uuid,app.issue_status,text)',
    'public.void_inspection(uuid,text)',
    'public.release_inspection(uuid)',
    'public.start_round(text)',
    'public.close_round()',
    'public.publish_checklist_version(text)',
    'public.admin_create_driver(text,text,text,text)',
    'public.set_driver_pin(uuid,text)'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant execute on function %s to authenticated;', fn);
  end loop;
end $$;
