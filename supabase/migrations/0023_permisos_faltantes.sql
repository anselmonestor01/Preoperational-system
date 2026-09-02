-- 0023 — Permisos de lectura que faltaban en tres tablas.
--
-- EL FALLO
-- En PostgreSQL, una política RLS no CONCEDE nada: sólo filtra lo que ya se
-- tiene permiso de leer. Tres tablas se crearon con su política pero sin el
-- `grant select` correspondiente, así que para el cliente eran ilegibles:
--
--   · notifications        (0017) — el panel de Avisos no podía leer NADA. Se
--     veía "no hay recordatorios" cuando en realidad la consulta fallaba y el
--     error se descartaba en silencio.
--   · driver_claims        (0016) — sin efecto visible, porque sólo se usa a
--     través de RPC, pero igual de incorrecto.
--   · organization_members (0020) — habría roto la lectura de perfiles para
--     TODOS los usuarios, porque la política `prof_select` la consulta.
--
-- Se conceden sólo las columnas necesarias, siguiendo el criterio del resto del
-- esquema (igual que en `drivers`, donde el hash del PIN nunca se concede).

grant select on public.notifications        to authenticated;
grant select on public.driver_claims        to authenticated;
grant select on public.organization_members to authenticated;
