-- =============================================================================
-- PREOPERATIONAL SYSTEM — Conjunto de demostración
-- =============================================================================
-- PARA QUÉ SIRVE
-- Deja la base con ocho días de operación creíble: 44 inspecciones repartidas
-- en trece turnos, siete conductores, siete vehículos, trece novedades (unas
-- resueltas y otras vivas), tres unidades retenidas y dos operaciones en ruta.
-- Es lo que se muestra a un cliente que quiere ver el sistema funcionando, y lo
-- que se usa para tomar capturas del panel.
--
-- LA REGLA QUE HACE QUE ESTO VALGA ALGO
-- Ni una sola fila se inserta a mano en `inspections`. Todo entra por las
-- MISMAS funciones que usa el kiosco: `claim_driver` con el PIN real verificado
-- con bcrypt, `submit_inspection`, `register_return`, `set_issue_status`. Eso
-- significa que el conjunto pasa por los índices únicos de operación abierta,
-- la reserva de perfil, la continuidad del odómetro, la permanencia mínima y
-- los topes de plausibilidad de la migración 0027. Si alguna de esas reglas se
-- rompiera, este archivo fallaría: sembrar la demo es, de paso, una prueba de
-- que el flujo normal sigue vivo.
--
-- EL ÚNICO AJUSTE ARTIFICIAL: EL RELOJ
-- Una demo necesita días de historia y `now()` sólo sabe del presente, así que
-- después de cada llamada se corrigen las marcas de tiempo. Ninguna regla de
-- negocio se evita por ese camino: las validaciones ya se ejecutaron.
--
-- CUÁNDO EJECUTARLO
-- Después de las 14:00 hora de Bogotá. El turno de mañana del día en curso
-- llega hasta las 11:10, y las inspecciones no pueden quedar en el futuro.
--
--   psql "$DATABASE_URL" -f supabase/seed-demo.sql
--
-- BORRA el historial de operación anterior de la organización (inspecciones,
-- novedades, rondas y avisos). No toca vehículos, conductores, usuarios ni
-- checklist. Pensado para una base de demostración, no para una con datos de
-- un cliente real.
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- andamiaje --
-- Estas cuatro funciones existen sólo mientras dura el sembrado. Se retiran al
-- final: no tienen por qué quedarse viviendo en la base.

-- Fecha y hora relativas al día en curso, en hora de Bogotá.
create or replace function app.qa_hito(p_dias int, p_hora text)
returns timestamptz language sql stable as $$
  select (((timezone('America/Bogota', now())::date - p_dias)::text || ' ' || p_hora)::timestamp
          at time zone 'America/Bogota');
$$;

-- Checklist completo en «todo bien», con las excepciones que se le pasen.
create or replace function app.qa_respuestas(p_fallas jsonb)
returns jsonb language sql stable
set search_path to 'public','app','pg_temp' as $$
  select jsonb_agg(jsonb_build_object(
           'category_key', c.key, 'item_id', i.id::text, 'item_name', i.name,
           'item_type', i.item_type::text,
           'value', coalesce(f.valor, case i.item_type::text
                      when 'nivel' then 'lleno' when 'estado' then 'bueno' else 'tiene' end),
           'note', coalesce(f.nota, ''))
         order by c.sort_order, i.sort_order)
  from public.checklist_items i
  join public.checklist_categories c on c.id = i.category_id
  left join lateral (
    select x->>'valor' as valor, x->>'nota' as nota
    from jsonb_array_elements(coalesce(p_fallas,'[]'::jsonb)) x
    where x->>'item' = i.name limit 1) f on true
  where i.active;
$$;

-- Una inspección completa: PIN, envío y, si procede, regreso.
create or replace function app.qa_inspeccion(
  p_placa text, p_conductor text, p_km_inicial int, p_fuel_in text,
  p_fallas jsonb, p_obs text, p_salida timestamptz,
  p_km_final int default null, p_fuel_out text default null,
  p_regreso timestamptz default null,
  p_dispositivo text default 'kiosco-planta-01',
  p_etiqueta text default 'Kiosco Planta · Tablet')
returns jsonb language plpgsql
set search_path to 'public','app','pg_temp' as $$
declare v_veh uuid; v_drv uuid; v_res jsonb; v_id uuid; v_claim jsonb;
begin
  select id into v_veh from public.vehicles where plate = p_placa;
  select id into v_drv from public.drivers where full_name = p_conductor;
  if v_veh is null then raise exception 'Vehículo % no existe', p_placa; end if;
  if v_drv is null then raise exception 'Conductor % no existe', p_conductor; end if;

  -- El conductor teclea su PIN en el kiosco. Flujo real, bcrypt incluido.
  v_claim := public.claim_driver(v_drv, '1234', p_dispositivo, p_etiqueta);
  if (v_claim->>'ok') is distinct from 'true' then
    raise exception 'No se pudo verificar a % : %', p_conductor, v_claim::text;
  end if;

  v_res := public.submit_inspection(v_veh, v_drv, app.qa_respuestas(p_fallas),
             p_km_inicial, p_fuel_in, coalesce(p_obs,''), null, p_dispositivo);
  v_id := (v_res->>'id')::uuid;

  update public.inspections
     set created_at = p_salida - interval '7 minutes', submitted_at = p_salida,
         authorized_at = case when authorized then p_salida else null end,
         device_label = p_etiqueta
   where id = v_id;
  update public.inspection_answers set created_at = p_salida where inspection_id = v_id;
  update public.issues set created_at = p_salida, updated_at = p_salida where inspection_id = v_id;
  update public.audit_logs set created_at = p_salida
   where entity_id = v_id::text and action = 'inspection_submitted';

  if p_km_final is not null then
    perform public.register_return(v_id, p_km_final, p_fuel_out, p_dispositivo);
    update public.inspections set closed_at = p_regreso where id = v_id;
    update public.audit_logs set created_at = p_regreso
     where entity_id = v_id::text and action = 'operation_closed';
  end if;
  return v_res;
end $$;

create or replace function app.qa_ronda(
  p_label text, p_responsable text, p_notas text, p_inicio timestamptz)
returns uuid language plpgsql
set search_path to 'public','app','pg_temp' as $$
declare v_id uuid; v_anterior uuid;
begin
  select id into v_anterior from public.rounds where status='open' order by round_number desc limit 1;
  v_id := (public.start_round(p_label, p_responsable, coalesce(p_notas,''))->>'id')::uuid;
  update public.rounds set started_at = p_inicio, created_at = p_inicio where id = v_id;
  if v_anterior is not null then
    update public.rounds set closed_at = p_inicio - interval '10 minutes' where id = v_anterior;
  end if;
  update public.audit_logs set created_at = p_inicio
   where entity_id = v_id::text and action = 'round_started';
  return v_id;
end $$;

create or replace function app.qa_resolver(
  p_placa text, p_item text, p_nota text, p_cuando timestamptz)
returns void language plpgsql
set search_path to 'public','app','pg_temp' as $$
declare v_id uuid;
begin
  select i.id into v_id from public.issues i join public.vehicles v on v.id = i.vehicle_id
   where v.plate = p_placa and i.item_name = p_item and i.status <> 'resolved'
   order by i.created_at desc limit 1;
  if v_id is null then raise exception 'No hay novedad abierta de % en %', p_item, p_placa; end if;
  perform public.set_issue_status(v_id, 'resolved'::app.issue_status, p_nota);
  update public.issues set resolved_at = p_cuando, updated_at = p_cuando where id = v_id;
  update public.audit_logs set created_at = p_cuando
   where entity_id = v_id::text and action = 'issue_status_changed';
end $$;

-- ------------------------------------------------------------- borrón previo --
delete from public.issue_evidence;
delete from public.issues;
delete from public.inspection_answers;
delete from public.notifications;
delete from public.inspections;
delete from public.rounds;
delete from public.driver_claims;
update public.vehicles set admin_blocked=false, admin_block_reason='',
       blocked_at=null, blocked_by=null, status='active';

-- ------------------------------------------------------------- el conjunto --
do $sembrado$
declare
  v_admin  text := (select id::text from public.profiles where role='superadmin' and active limit 1);
  v_kiosco text := (select id::text from public.profiles where role='operator'   and active order by created_at limit 1);
begin
  if v_admin is null or v_kiosco is null then
    raise exception 'Hacen falta un superadministrador y un usuario de kiosco activos';
  end if;

  -- ===================== D-7 · Turno Mañana =====================
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform app.qa_ronda('Turno Mañana','Julián Ospina','Operación portuaria Buenaventura', app.qa_hito(7,'06:00'));
  perform set_config('request.jwt.claims', json_build_object('sub',v_kiosco,'role','authenticated')::text, true);
  perform app.qa_inspeccion('ZZZ-001','Andrés Felipe Castro',184320,'lleno','[]','',
    app.qa_hito(7,'06:12'), 184632,'medio', app.qa_hito(7,'13:20'));
  perform app.qa_inspeccion('ZZZ-003','Carlos Andrés Mendoza',231870,'lleno','[]','',
    app.qa_hito(7,'06:25'), 232145,'medio', app.qa_hito(7,'13:45'));
  perform app.qa_inspeccion('ZZZ-005','Juan David Herrera',143605,'medio','[]','',
    app.qa_hito(7,'06:40'), 143823,'bajo', app.qa_hito(7,'12:55'));

  -- ===================== D-7 · Turno Tarde =====================
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform app.qa_ronda('Turno Tarde','Marcela Ríos','Despachos a Cali y Palmira', app.qa_hito(7,'14:00'));
  perform set_config('request.jwt.claims', json_build_object('sub',v_kiosco,'role','authenticated')::text, true);
  perform app.qa_inspeccion('ZZZ-002','Luis Fernando Rojas',96540,'lleno','[]','',
    app.qa_hito(7,'14:15'), 96712,'medio', app.qa_hito(7,'20:40'));
  perform app.qa_inspeccion('ZZZ-004','Miguel Ángel Torres',58210,'lleno','[]','',
    app.qa_hito(7,'14:28'), 58395,'medio', app.qa_hito(7,'21:05'));
  perform app.qa_inspeccion('ZZZ-006','Sebastián Ramírez López',209480,'lleno',
    '[{"item":"Limpiabrisas","valor":"regular","nota":"La plumilla del lado del conductor está reseca y deja huella en el vidrio."}]',
    'Se reporta la plumilla para cambio en el próximo mantenimiento.',
    app.qa_hito(7,'14:42'), 209694,'bajo', app.qa_hito(7,'20:15'));

  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform app.qa_resolver('ZZZ-006','Limpiabrisas',
    'Plumillas cambiadas por juego nuevo. Verificado en seco y con agua.', app.qa_hito(6,'05:30'));

  -- ===================== D-6 · Turno Mañana =====================
  perform app.qa_ronda('Turno Mañana','Julián Ospina','Operación portuaria Buenaventura', app.qa_hito(6,'06:00'));
  perform set_config('request.jwt.claims', json_build_object('sub',v_kiosco,'role','authenticated')::text, true);
  perform app.qa_inspeccion('ZZZ-001','Jorge Eliécer Martínez',184632,'lleno','[]','',
    app.qa_hito(6,'06:10'), 184901,'medio', app.qa_hito(6,'13:30'));
  perform app.qa_inspeccion('ZZZ-006','Andrés Felipe Castro',209694,'lleno','[]','',
    app.qa_hito(6,'06:22'), 209908,'medio', app.qa_hito(6,'13:05'));
  perform app.qa_inspeccion('ZZZ-007','Carlos Andrés Mendoza',77950,'lleno',
    '[{"item":"Frenos","valor":"malo","nota":"Pedal esponjoso y recorrido largo. El vehículo no frena en seco a la primera."}]',
    'Se reporta a mantenimiento de inmediato. Unidad retenida.', app.qa_hito(6,'06:35'));

  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform app.qa_resolver('ZZZ-007','Frenos',
    'Purga del sistema y cambio de pastillas delanteras. Prueba de frenado conforme.', app.qa_hito(5,'09:00'));

  -- ===================== D-5 · Turno Único =====================
  perform app.qa_ronda('Turno Único · Domingo','Marcela Ríos','Guardia dominical, operación reducida', app.qa_hito(5,'07:00'));
  perform set_config('request.jwt.claims', json_build_object('sub',v_kiosco,'role','authenticated')::text, true);
  perform app.qa_inspeccion('ZZZ-003','Luis Fernando Rojas',232145,'lleno','[]','',
    app.qa_hito(5,'07:15'), 232298,'medio', app.qa_hito(5,'12:40'));
  perform app.qa_inspeccion('ZZZ-005','Juan David Herrera',143823,'lleno','[]','',
    app.qa_hito(5,'07:30'), 143977,'medio', app.qa_hito(5,'13:10'));

  -- ===================== D-4 · Turno Mañana =====================
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform app.qa_ronda('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3', app.qa_hito(4,'06:00'));
  perform set_config('request.jwt.claims', json_build_object('sub',v_kiosco,'role','authenticated')::text, true);
  perform app.qa_inspeccion('ZZZ-001','Andrés Felipe Castro',184901,'lleno','[]','',
    app.qa_hito(4,'06:05'), 185188,'medio', app.qa_hito(4,'13:40'));
  perform app.qa_inspeccion('ZZZ-002','Miguel Ángel Torres',96712,'lleno','[]','',
    app.qa_hito(4,'06:18'), 96921,'medio', app.qa_hito(4,'13:15'));
  perform app.qa_inspeccion('ZZZ-004','Sebastián Ramírez López',58395,'lleno',
    '[{"item":"Nivel de refrigerante","valor":"bajo","nota":"El depósito está por debajo de la marca mínima. Se completa antes de salir y se deja reportado."}]',
    'Se completó refrigerante en patio. Revisar posible fuga.',
    app.qa_hito(4,'06:31'), 58602,'bajo', app.qa_hito(4,'12:55'));
  perform app.qa_inspeccion('ZZZ-007','Jorge Eliécer Martínez',77950,'lleno','[]','',
    app.qa_hito(4,'06:44'), 78176,'medio', app.qa_hito(4,'13:50'), 'movil-conductor-a1','Móvil del conductor');

  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform app.qa_resolver('ZZZ-004','Nivel de refrigerante',
    'Se localizó fuga en manguera superior del radiador. Manguera reemplazada y sistema presurizado sin pérdidas.',
    app.qa_hito(4,'15:40'));

  -- ===================== D-4 · Turno Tarde =====================
  perform app.qa_ronda('Turno Tarde','Marcela Ríos','Despachos a Cali y Palmira', app.qa_hito(4,'14:00'));
  perform set_config('request.jwt.claims', json_build_object('sub',v_kiosco,'role','authenticated')::text, true);
  perform app.qa_inspeccion('ZZZ-003','Carlos Andrés Mendoza',232298,'lleno','[]','',
    app.qa_hito(4,'14:12'), 232461,'medio', app.qa_hito(4,'20:35'));
  perform app.qa_inspeccion('ZZZ-005','Luis Fernando Rojas',143977,'lleno','[]','',
    app.qa_hito(4,'14:26'), 144150,'medio', app.qa_hito(4,'21:10'));
  perform app.qa_inspeccion('ZZZ-006','Juan David Herrera',209908,'lleno',
    '[{"item":"Luz de freno (stop)","valor":"malo","nota":"Ninguno de los dos stops enciende al pisar el freno. Se revisó el fusible y sigue sin responder."}]',
    'Unidad retenida. No puede circular de noche sin luz de freno.', app.qa_hito(4,'14:39'));

  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform app.qa_resolver('ZZZ-006','Luz de freno (stop)',
    'Interruptor de pedal de freno defectuoso. Reemplazado y probado con los dos stops encendiendo.',
    app.qa_hito(3,'05:35'));

  -- ===================== D-3 · Turno Mañana =====================
  perform app.qa_ronda('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3', app.qa_hito(3,'06:00'));
  perform set_config('request.jwt.claims', json_build_object('sub',v_kiosco,'role','authenticated')::text, true);
  perform app.qa_inspeccion('ZZZ-001','Miguel Ángel Torres',185188,'lleno','[]','',
    app.qa_hito(3,'06:08'), 185474,'medio', app.qa_hito(3,'13:35'));
  perform app.qa_inspeccion('ZZZ-004','Andrés Felipe Castro',58602,'lleno','[]','',
    app.qa_hito(3,'06:21'), 58825,'medio', app.qa_hito(3,'13:00'));
  perform app.qa_inspeccion('ZZZ-006','Sebastián Ramírez López',209908,'lleno',
    '[{"item":"Botiquín de primeros auxilios","valor":"incompleto","nota":"Faltan vendas y gasas estériles. El resto del contenido está completo y vigente."}]',
    'Se solicita reposición del botiquín a almacén.',
    app.qa_hito(3,'06:34'), 210099,'bajo', app.qa_hito(3,'12:45'));

  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform app.qa_resolver('ZZZ-006','Botiquín de primeros auxilios',
    'Botiquín repuesto completo por almacén, con fechas de vencimiento vigentes.', app.qa_hito(2,'05:30'));

  -- ===================== D-2 · Turno Mañana =====================
  perform app.qa_ronda('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3', app.qa_hito(2,'06:00'));
  perform set_config('request.jwt.claims', json_build_object('sub',v_kiosco,'role','authenticated')::text, true);
  perform app.qa_inspeccion('ZZZ-002','Jorge Eliécer Martínez',96921,'lleno','[]','',
    app.qa_hito(2,'06:07'), 97143,'medio', app.qa_hito(2,'13:25'));
  perform app.qa_inspeccion('ZZZ-003','Juan David Herrera',232461,'lleno','[]','',
    app.qa_hito(2,'06:20'), 232694,'medio', app.qa_hito(2,'13:50'));
  perform app.qa_inspeccion('ZZZ-005','Carlos Andrés Mendoza',144150,'lleno',
    '[{"item":"Espejos retrovisores","valor":"regular","nota":"El espejo izquierdo tiene juego y se desajusta con la vibración en carretera destapada."}]',
    'Se ajusta provisionalmente. Requiere cambio de soporte.',
    app.qa_hito(2,'06:33'), 144332,'bajo', app.qa_hito(2,'12:40'));

  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform app.qa_resolver('ZZZ-005','Espejos retrovisores',
    'Soporte del espejo izquierdo reemplazado. Sin juego tras prueba en ruta destapada.', app.qa_hito(2,'15:20'));

  -- ===================== D-2 · Turno Tarde =====================
  perform app.qa_ronda('Turno Tarde','Marcela Ríos','Despachos a Cali y Palmira', app.qa_hito(2,'14:00'));
  perform set_config('request.jwt.claims', json_build_object('sub',v_kiosco,'role','authenticated')::text, true);
  perform app.qa_inspeccion('ZZZ-001','Luis Fernando Rojas',185474,'lleno','[]','',
    app.qa_hito(2,'14:10'), 185651,'medio', app.qa_hito(2,'20:30'));
  perform app.qa_inspeccion('ZZZ-007','Andrés Felipe Castro',78176,'lleno','[]','',
    app.qa_hito(2,'14:24'), 78364,'medio', app.qa_hito(2,'21:00'));
  perform app.qa_inspeccion('ZZZ-004','Miguel Ángel Torres',58825,'lleno',
    '[{"item":"Presión de aire","valor":"malo","nota":"Llanta delantera izquierda en 62 PSI contra 110 de especificación. Pierde aire de forma visible."}]',
    'Unidad retenida hasta reparar. No se despacha con esa presión.', app.qa_hito(2,'14:37'));

  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform app.qa_resolver('ZZZ-004','Presión de aire',
    'Válvula defectuosa reemplazada y llanta calibrada a 110 PSI. Sin pérdida tras 12 horas.', app.qa_hito(1,'05:30'));

  -- ===================== D-1 · Turno Mañana =====================
  perform app.qa_ronda('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3', app.qa_hito(1,'06:00'));
  perform set_config('request.jwt.claims', json_build_object('sub',v_kiosco,'role','authenticated')::text, true);
  perform app.qa_inspeccion('ZZZ-002','Sebastián Ramírez López',97143,'lleno','[]','',
    app.qa_hito(1,'06:06'), 97389,'medio', app.qa_hito(1,'13:40'));
  perform app.qa_inspeccion('ZZZ-003','Jorge Eliécer Martínez',232694,'lleno','[]','',
    app.qa_hito(1,'06:19'), 232920,'medio', app.qa_hito(1,'13:15'));
  perform app.qa_inspeccion('ZZZ-005','Andrés Felipe Castro',144332,'lleno','[]','',
    app.qa_hito(1,'06:32'), 144558,'medio', app.qa_hito(1,'13:55'));
  perform app.qa_inspeccion('ZZZ-006','Carlos Andrés Mendoza',210099,'lleno','[]','',
    app.qa_hito(1,'06:45'), 210306,'medio', app.qa_hito(1,'12:50'), 'movil-conductor-a1','Móvil del conductor');

  -- ===================== D-1 · Turno Tarde =====================
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform app.qa_ronda('Turno Tarde','Marcela Ríos','Despachos a Cali y Palmira', app.qa_hito(1,'14:00'));
  perform set_config('request.jwt.claims', json_build_object('sub',v_kiosco,'role','authenticated')::text, true);
  perform app.qa_inspeccion('ZZZ-001','Juan David Herrera',185651,'lleno','[]','',
    app.qa_hito(1,'14:08'), 185839,'medio', app.qa_hito(1,'20:25'));
  perform app.qa_inspeccion('ZZZ-004','Luis Fernando Rojas',58825,'lleno','[]','',
    app.qa_hito(1,'14:22'), 59014,'medio', app.qa_hito(1,'21:05'));
  perform app.qa_inspeccion('ZZZ-007','Miguel Ángel Torres',78364,'lleno',
    '[{"item":"Nivel de aceite motor","valor":"bajo","nota":"Varilla marca por debajo del mínimo. Se completa un litro antes de salir."}]',
    'Revisar consumo de aceite en el próximo servicio.',
    app.qa_hito(1,'14:35'), 78555,'bajo', app.qa_hito(1,'20:40'));
  perform app.qa_inspeccion('ZZZ-002','Andrés Felipe Castro',97389,'lleno','[]','',
    app.qa_hito(1,'14:48'), 97563,'medio', app.qa_hito(1,'21:20'));

  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform app.qa_resolver('ZZZ-007','Nivel de aceite motor',
    'Cambio de aceite y filtro adelantado. Se descarta fuga; consumo dentro de norma.', app.qa_hito(1,'22:10'));

  -- ===================== HOY · Turno Noche (cerrado) =====================
  perform app.qa_ronda('Turno Noche','Rafael Guerrero','Retiro de contenedores refrigerados, muelle 1', app.qa_hito(0,'00:05'));
  perform set_config('request.jwt.claims', json_build_object('sub',v_kiosco,'role','authenticated')::text, true);
  -- Sale con dos novedades menores anotadas: se autoriza, pero la unidad queda
  -- retenida para los turnos siguientes hasta que mantenimiento las cierre.
  perform app.qa_inspeccion('ZZZ-001','Jorge Eliécer Martínez',185839,'medio',
    '[{"item":"Nivel de aceite motor","valor":"bajo","nota":"Varilla justo en el mínimo. Se completa medio litro antes de salir."},
      {"item":"Espejo central","valor":"regular","nota":"El espejo interior vibra y se desajusta en destapado."}]',
    'Dos novedades menores anotadas para el taller.',
    app.qa_hito(0,'00:10'), 185921,'bajo', app.qa_hito(0,'02:05'));
  perform app.qa_inspeccion('ZZZ-003','Miguel Ángel Torres',232920,'lleno','[]','',
    app.qa_hito(0,'00:35'), 232995,'medio', app.qa_hito(0,'02:40'));
  perform app.qa_inspeccion('ZZZ-006','Sebastián Ramírez López',210306,'lleno','[]','',
    app.qa_hito(0,'01:15'), 210374,'medio', app.qa_hito(0,'03:20'));

  -- ===================== HOY · Turno Mañana (abierto) =====================
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform app.qa_ronda('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3 y despachos a Cali', app.qa_hito(0,'06:00'));
  perform set_config('request.jwt.claims', json_build_object('sub',v_kiosco,'role','authenticated')::text, true);

  -- Dos fallas críticas en la misma unidad: no sale.
  perform app.qa_inspeccion('ZZZ-005','Carlos Andrés Mendoza',144558,'lleno',
    '[{"item":"Frenos","valor":"malo","nota":"Chirrido metálico continuo y pedal que se va al fondo. Pastillas al límite."},
      {"item":"Luz de freno (stop)","valor":"malo","nota":"El stop derecho no enciende. Bombillo fundido."}]',
    'Unidad retenida. Dos hallazgos críticos en el mismo vehículo.', app.qa_hito(0,'06:15'));

  perform app.qa_inspeccion('ZZZ-002','Luis Fernando Rojas',97563,'lleno',
    '[{"item":"Presión de aire","valor":"malo","nota":"Llanta trasera derecha del eje motriz en 55 PSI. Se detecta clavo en la banda de rodadura."}]',
    'Unidad retenida hasta reparación de la llanta.', app.qa_hito(0,'07:30'));

  -- Estas dos siguen EN RUTA: salieron y todavía no registran regreso.
  perform app.qa_inspeccion('ZZZ-004','Andrés Felipe Castro',59014,'lleno','[]','', app.qa_hito(0,'08:45'));

  perform app.qa_inspeccion('ZZZ-003','Jorge Eliécer Martínez',232995,'lleno','[]','',
    app.qa_hito(0,'09:20'), 233178,'medio', app.qa_hito(0,'12:50'));
  perform app.qa_inspeccion('ZZZ-006','Carlos Andrés Mendoza',210374,'lleno','[]','',
    app.qa_hito(0,'10:05'), 210531,'medio', app.qa_hito(0,'13:15'));

  perform app.qa_inspeccion('ZZZ-007','Juan David Herrera',78555,'lleno','[]','',
    app.qa_hito(0,'11:10'), null, null, null, 'movil-conductor-a1','Móvil del conductor');
end $sembrado$;

-- Recordatorio de regreso para las unidades que siguen fuera: se ENCOLA, no se
-- envía. Es el mismo camino que usa el kiosco.
do $avisos$
declare r record;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub',(select id::text from public.profiles where role='operator' and active order by created_at limit 1),
                      'role','authenticated')::text, true);
  for r in select id, submitted_at from public.inspections where operation_status='open' loop
    perform public.enqueue_return_reminder(r.id);
    update public.notifications set created_at = r.submitted_at + interval '1 minute' where inspection_id = r.id;
  end loop;
end $avisos$;

-- ------------------------------------------------- se retira el andamiaje --
drop function if exists app.qa_inspeccion(text,text,int,text,jsonb,text,timestamptz,int,text,timestamptz,text,text);
drop function if exists app.qa_respuestas(jsonb);
drop function if exists app.qa_ronda(text,text,text,timestamptz);
drop function if exists app.qa_resolver(text,text,text,timestamptz);
drop function if exists app.qa_hito(int,text);

-- ------------------------------------------------------------ comprobación --
with ops as (
  select vehicle_id, submitted_at, closed_at, km_inicial, km_final,
         lag(km_final) over (partition by vehicle_id order by submitted_at) km_prev
  from public.inspections where status in ('authorized','closed'))
select 'odómetro que retrocede' as comprobacion,
       count(*) filter (where km_prev is not null and km_inicial < km_prev)::text as obtenido, '0' as esperado from ops
union all select 'operaciones de menos de 5 minutos',
  count(*) filter (where closed_at is not null and closed_at - submitted_at < interval '5 minutes')::text, '0' from ops
union all select 'velocidad media por encima de 120 km/h',
  count(*) filter (where closed_at is not null and km_final is not null
    and (km_final-km_inicial)::numeric*3600/greatest(extract(epoch from (closed_at-submitted_at))::int,1) > 120)::text, '0' from ops
union all select 'marcas de tiempo en el futuro',
  (select count(*)::text from public.inspections where submitted_at > now() or closed_at > now()), '0'
union all select 'borradores huérfanos',
  (select count(*)::text from public.inspections where status='in_progress'), '0'
union all select 'inspecciones sembradas',
  (select count(*)::text from public.inspections), '44'
union all select 'novedades (abiertas / total)',
  (select count(*) filter (where status<>'resolved')||' / '||count(*) from public.issues), '5 / 13'
union all select 'unidades en ruta',
  (select count(*)::text from public.inspections where operation_status='open'), '2';
