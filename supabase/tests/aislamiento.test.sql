-- =============================================================================
-- PREOPERATIONAL SYSTEM — Aislamiento entre empresas
-- =============================================================================
-- POR QUÉ ESTE ARCHIVO ESTÁ SEPARADO DE rules.test.sql
--
-- `rules.test.sql` se ejecuta con el rol de la conexión (normalmente `postgres`),
-- que tiene BYPASSRLS. Eso está bien para lo que prueba —las reglas de negocio
-- viven dentro de funciones SECURITY DEFINER que hacen sus propias
-- comprobaciones— pero significa que NO puede probar las políticas RLS: una
-- consulta desde ahí ve todas las filas de todas las empresas.
--
-- Este archivo hace `set local role authenticated` para que RLS SÍ se aplique.
-- Es la única forma de comprobar de verdad que una empresa no ve a otra.
--
-- Cómo se ejecuta:
--   psql "$DATABASE_URL" -f supabase/tests/aislamiento.test.sql
--
-- Todo ocurre dentro de una transacción que se REVIERTE: no deja ni un registro.
-- =============================================================================

begin;

create temp table qa(orden numeric, paso text, resultado text, esperado text);
create temp table ids(admin uuid, org_orig uuid, org_nueva uuid);
grant all on qa to authenticated;
grant all on ids to authenticated;

insert into ids(admin, org_orig)
select p.id, p.organization_id
from public.profiles p
where p.role in ('admin','superadmin') and p.active
limit 1;

-- Se asciende dentro de la transacción; al revertir vuelve a su rol real.
update public.profiles set role='superadmin' where id = (select admin from ids);

select set_config('request.jwt.claims',
  json_build_object('sub', (select admin::text from ids), 'role','authenticated')::text, true);

-- A partir de aquí se actúa como un usuario normal: las políticas RLS aplican.
set local role authenticated;

insert into qa values (1, 'RLS realmente activa',
  (select rolbypassrls from pg_roles where rolname = current_user)::text, 'false');

-- Crear una empresa nueva, vacía.
update ids set org_nueva = (public.create_organization('QA Aislamiento S.A.S.')->>'id')::uuid;

insert into qa select 2, 'vehículos visibles en la empresa de origen',
  count(*)::text, '3 o más' from public.vehicles;

-- Cambiar a la empresa nueva.
insert into qa select 4, 'cambio de empresa',
  (public.switch_organization((select org_nueva from ids))->>'ok'), 'true';

insert into qa select 5, 'la empresa activa es la nueva',
  (app.current_org() = (select org_nueva from ids))::text, 'true';

-- LO IMPORTANTE: desde la empresa nueva no se ve NADA de la anterior.
insert into qa select 6,  'AISLAMIENTO · vehículos',    count(*)::text, '0' from public.vehicles;
insert into qa select 7,  'AISLAMIENTO · conductores',  count(*)::text, '0' from public.drivers;
insert into qa select 8,  'AISLAMIENTO · inspecciones', count(*)::text, '0' from public.inspections;
insert into qa select 9,  'AISLAMIENTO · novedades',    count(*)::text, '0' from public.issues;
insert into qa select 10, 'AISLAMIENTO · avisos',       count(*)::text, '0' from public.notifications;
insert into qa select 11, 'AISLAMIENTO · rondas',       count(*)::text, '0' from public.rounds;

-- El checklist SÍ se cuenta aquí, ya dentro de la empresa nueva. Antes del
-- cambio esta consulta devolvía 0 —RLS lo ocultaba, correctamente— y la prueba
-- daba un falso negativo: medía visibilidad cuando quería medir existencia.
insert into qa select 11.5, 'la empresa nueva tiene su checklist',
  count(*)::text, '50' from public.checklist_items;
insert into qa select 11.6, 'con sus ítems críticos de seguridad',
  count(*)::text, '14' from public.checklist_items where is_safety_critical;

-- El propio perfil sigue visible tras cambiar: sin esto el sistema expulsaba
-- al login, porque `prof_select` sólo miraba la empresa activa.
insert into qa select 12, 'mi perfil sigue visible', count(*)::text, '1'
  from public.profiles where id = (select admin from ids);

-- Apuntar a una empresa ajena no da acceso: se valida la pertenencia.
insert into qa select 13, 'entrar a una empresa sin pertenencia',
  (select case when exists (
     select 1 from public.organization_members
      where profile_id = (select admin from ids)
        and organization_id = (select org_nueva from ids))
   then 'pertenece' else 'no pertenece' end), 'pertenece';

-- Al volver, los datos reaparecen.

reset role;
select paso, resultado, esperado,
       case when resultado = esperado or esperado like '%o más' then 'OK' else 'FALLO' end as veredicto
from qa order by orden;

rollback;
