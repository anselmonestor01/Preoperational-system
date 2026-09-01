-- 0013 — Gestión de usuarios desde la interfaz: cambiar rol y activar/desactivar.
--
-- Protecciones deliberadas: nadie puede degradarse ni desactivarse a sí mismo
-- (sería la forma más fácil de dejar la cuenta sin acceso por accidente), y la
-- organización nunca puede quedarse sin ningún administrador activo.

create or replace function public.set_profile_role(p_profile_id uuid, p_role app.user_role)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp as $$
declare v_org uuid; v_prev app.user_role; v_admins int;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin') then
    raise exception 'No autorizado';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'No puedes cambiar tu propio rol';
  end if;

  select role into v_prev from public.profiles
    where id = p_profile_id and organization_id = v_org for update;
  if not found then raise exception 'Usuario no encontrado'; end if;

  -- Si se está quitando el último administrador activo, se bloquea.
  if v_prev in ('admin','superadmin') and p_role not in ('admin','superadmin') then
    select count(*) into v_admins from public.profiles
      where organization_id = v_org and active and role in ('admin','superadmin')
        and id <> p_profile_id;
    if v_admins = 0 then
      raise exception 'La organización debe conservar al menos un administrador activo';
    end if;
  end if;

  update public.profiles set role = p_role where id = p_profile_id;

  perform app.write_audit('profile_role_changed','profile',p_profile_id::text,
    jsonb_build_object('role',v_prev), jsonb_build_object('role',p_role), null);

  return jsonb_build_object('id',p_profile_id,'role',p_role);
end; $$;

create or replace function public.set_profile_active(p_profile_id uuid, p_active boolean)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp as $$
declare v_org uuid; v_prev boolean; v_role app.user_role; v_admins int;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin') then
    raise exception 'No autorizado';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'No puedes desactivar tu propio usuario';
  end if;

  select active, role into v_prev, v_role from public.profiles
    where id = p_profile_id and organization_id = v_org for update;
  if not found then raise exception 'Usuario no encontrado'; end if;

  if v_prev and not p_active and v_role in ('admin','superadmin') then
    select count(*) into v_admins from public.profiles
      where organization_id = v_org and active and role in ('admin','superadmin')
        and id <> p_profile_id;
    if v_admins = 0 then
      raise exception 'La organización debe conservar al menos un administrador activo';
    end if;
  end if;

  update public.profiles set active = p_active where id = p_profile_id;

  perform app.write_audit(
    case when p_active then 'profile_activated' else 'profile_deactivated' end,
    'profile', p_profile_id::text,
    jsonb_build_object('active',v_prev), jsonb_build_object('active',p_active), null);

  return jsonb_build_object('id',p_profile_id,'active',p_active);
end; $$;

revoke execute on function public.set_profile_role(uuid, app.user_role) from public, anon;
revoke execute on function public.set_profile_active(uuid, boolean) from public, anon;
grant execute on function public.set_profile_role(uuid, app.user_role) to authenticated;
grant execute on function public.set_profile_active(uuid, boolean) to authenticated;
