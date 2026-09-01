-- =============================================================================
-- PREOPERATIONAL SYSTEM — Inspección preoperacional de flotas
-- Migración 0001: Extensiones, esquema app, enums y funciones auxiliares (RLS)
-- -----------------------------------------------------------------------------
-- Fundamento del modelo multi-tenant y de seguridad. Todas las políticas RLS
-- y RPCs posteriores dependen de las funciones de este archivo.
-- =============================================================================

-- Extensiones (pgcrypto vive en el esquema `extensions` en Supabase).
create extension if not exists pgcrypto with schema extensions;

-- Esquema de utilidades del dominio. No expuesto vía PostgREST.
create schema if not exists app;
revoke all on schema app from anon, authenticated;
grant usage on schema app to authenticated;

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------
do $$ begin
  create type app.user_role as enum
    ('superadmin','admin','supervisor','maintenance','auditor','operator','driver');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.vehicle_status as enum ('active','inactive','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.inspection_status as enum
    ('in_progress','submitted','authorized','rejected','closed','voided');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.inspection_result as enum ('bueno','regular','malo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.operation_status as enum ('none','open','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.issue_status as enum ('pending','review','resolved','reopened');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.answer_severity as enum ('ok','warn','bad');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.item_type as enum ('nivel','estado','equipo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.round_status as enum ('open','closed');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Trigger genérico updated_at
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- NOTA: las funciones de contexto de sesión (current_org, current_role,
-- is_active, has_role) referencian public.profiles y por eso se definen en la
-- migración 0003, después de crear las tablas.

-- Mapeo determinista tipo+valor -> severidad (idéntico al prototipo ITEM_TYPES).
create or replace function app.severity_of(p_type app.item_type, p_value text)
returns app.answer_severity
language sql
immutable
as $$
  select case p_type
    when 'nivel' then case p_value
        when 'lleno' then 'ok' when 'medio' then 'warn'
        when 'bajo' then 'warn' when 'vacio' then 'bad' else null end
    when 'estado' then case p_value
        when 'bueno' then 'ok' when 'regular' then 'warn'
        when 'malo' then 'bad' else null end
    when 'equipo' then case p_value
        when 'tiene' then 'ok' when 'incompleto' then 'warn'
        when 'no_tiene' then 'bad' else null end
  end::app.answer_severity;
$$;

grant execute on function app.severity_of(app.item_type, text) to authenticated;
