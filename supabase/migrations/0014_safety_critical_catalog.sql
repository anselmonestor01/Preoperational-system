-- 0014 — Catálogo de criticidad de seguridad.
--
-- Un ítem marcado como crítico BLOQUEA la salida si el conductor lo reporta en
-- mal estado, sin importar cuántos otros ítems estén bien. Se marca aquí, en la
-- base de datos, porque es la regla que protege vidas y no puede depender de
-- que alguien la configure bien en la interfaz.
--
-- POR QUÉ EXISTE ESTA MIGRACIÓN
-- La suite `supabase/tests/rules.test.sql` descubrió que NINGÚN ítem estaba
-- marcado como crítico: el sistema autorizaba la salida de un camión con los
-- frenos en mal estado. Esta migración corrige ese fallo.
--
-- Criterio (mecánica preventiva de vehículos de carga):
--  · Frenado: sin frenos no hay operación posible.
--  · Rodadura: la llanta es el único contacto con la vía.
--  · Dirección y suspensión: su falla produce pérdida de control.
--  · Señalización de frenado y visibilidad nocturna: evitan alcances.
--  · Retención de ocupantes: cinturones.
--  · Equipo exigido por norma para transitar: extintor y botiquín.
--
-- Tras aplicarla hay que publicar una nueva versión del checklist
-- (`publish_checklist_version`) para que las inspecciones nuevas usen el
-- catálogo corregido: las inspecciones ya hechas conservan su copia inmutable.

update public.checklist_items set is_safety_critical = true
where active and name in (
  -- Frenado
  'Frenos',
  'Nivel líquido bomba de frenos',
  'Freno de mano',
  -- Rodadura
  'Sin cortaduras',
  'Presión de aire',
  'Labrado',
  -- Control del vehículo
  'Dirección y suspensión',
  'Sistema eléctrico / encendido',
  -- Señalización y visibilidad
  'Luz de freno (stop)',
  'Luz baja',
  'Luz alta',
  -- Retención de ocupantes
  'Cinturones de seguridad',
  -- Equipo exigido por norma
  'Extintor (carga / vencimiento)',
  'Botiquín de primeros auxilios'
);

-- El resto queda explícitamente como NO crítico: su falla se reporta como
-- novedad y suma al límite de fallas no críticas, pero no bloquea por sí sola.
update public.checklist_items set is_safety_critical = false
where active and name not in (
  'Frenos','Nivel líquido bomba de frenos','Freno de mano',
  'Sin cortaduras','Presión de aire','Labrado',
  'Dirección y suspensión','Sistema eléctrico / encendido',
  'Luz de freno (stop)','Luz baja','Luz alta',
  'Cinturones de seguridad',
  'Extintor (carga / vencimiento)','Botiquín de primeros auxilios'
);
