-- =============================================================================
-- Migración 0030: la comprobación de velocidad necesita una ventana mínima
-- -----------------------------------------------------------------------------
-- EL FALLO
-- `register_return` calculaba la velocidad media dividiendo el recorrido entre
-- el tiempo transcurrido, sin exigir que ese tiempo fuera representativo:
--
--     v_kmh := (v_recorrido * 3600) / v_segundos;
--
-- Sobre intervalos cortos esa media no mide nada. Un conductor que sale, hace
-- once kilómetros y vuelve en cinco minutos —una operación perfectamente
-- normal, y justo la permanencia mínima que trae el sistema de fábrica— arroja
-- 132 km/h y el registro se rechaza. No es un caso de laboratorio: es el
-- reparto urbano corto, que es exactamente la operación de muchas flotas.
--
-- EL ARREGLO
-- La media se calcula sobre `greatest(transcurrido, ventana)`. Con una ventana
-- de treinta minutos:
--
--   · 11 km en 5 min   → se evalúan como 11 km en 30 min = 22 km/h   ✔ pasa
--   · 500 km en 20 min → se evalúan como 500 km en 30 min = 1000 km/h ✘ rechaza
--   · 300 km en 4 h    → 75 km/h                                      ✔ pasa
--
-- Es decir: el suelo impide que dividir por un tiempo diminuto produzca
-- disparates, y sigue atrapando las distancias genuinamente imposibles. El
-- tope duro de kilómetros por operación no se toca: ese sí es absoluto.
-- =============================================================================

alter table public.organizations
  add column if not exists ventana_kmh_segundos int not null default 1800;

alter table public.organizations
  drop constraint if exists chk_org_ventana_kmh,
  add  constraint chk_org_ventana_kmh
    check (ventana_kmh_segundos between 60 and 86400);

comment on column public.organizations.ventana_kmh_segundos is
  'Ventana mínima sobre la que se promedia la velocidad de una operación. '
  'Por debajo de ella la media no es representativa y se usa la ventana en su '
  'lugar, para no rechazar trayectos cortos legítimos.';
