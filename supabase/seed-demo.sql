-- =============================================================================
-- PREOPERATIONAL SYSTEM — Conjunto de demostración a escala
-- =============================================================================
-- QUÉ DEJA
-- Una operación creíble de dos semanas sobre una flota de setenta y siete
-- unidades y una plantilla de setenta y siete conductores: veinticinco turnos,
-- más de ciento setenta inspecciones, sesenta novedades entre resueltas y
-- vivas, unidades retenidas por falla crítica y otras todavía en ruta.
--
-- LA REGLA QUE HACE QUE ESTO VALGA ALGO
-- Ni una sola inspección se inserta a mano. Todo entra por las MISMAS
-- funciones que usa el kiosco: `claim_driver` con el PIN real verificado con
-- bcrypt, `submit_inspection`, `register_return` y `set_issue_status`. El
-- conjunto atraviesa por tanto los índices únicos de operación abierta, la
-- reserva de perfil, la continuidad del odómetro, la permanencia mínima y los
-- topes de plausibilidad de la migración 0027. Si alguna de esas reglas
-- estuviera rota, este archivo fallaría: sembrar la demo es, de paso, una
-- prueba de que el flujo normal sigue vivo a escala.
--
-- REGLAS DE REALISMO QUE IMPONE EL GENERADOR
--   · Un conductor no aparece dos veces en la misma ronda.
--   · Un vehículo tampoco, y sobre todo NO rota entre decenas de conductores:
--     cada unidad tiene un conductor titular, con relevo sólo cuando hace
--     falta. Es como funciona una flota de verdad.
--   · El odómetro avanza. Cada salida arranca donde cerró la anterior.
--   · Una unidad con novedades vivas no sale, porque el sistema no la deja.
--     Mantenimiento cierra lo que lleva más de tres días abierto.
--
-- EL ÚNICO AJUSTE ARTIFICIAL: EL RELOJ
-- Una demo necesita dos semanas de historia y `now()` sólo sabe del presente,
-- así que las marcas de tiempo se corrigen después de cada llamada. Ninguna
-- validación se evita por ese camino: ya se ejecutaron todas.
--
-- CUÁNDO EJECUTARLO
-- Después de las 15:00 hora de Bogotá. El turno de mañana del día en curso
-- llega hasta las 08:30 y sus regresos caen unas horas más tarde; antes de esa
-- hora quedarían en el futuro.
--
--   psql "$DATABASE_URL" -f supabase/seed-demo.sql
--
-- BORRA el historial de operación anterior (rondas, inspecciones, novedades y
-- avisos) y AÑADE setenta conductores y setenta vehículos a los que ya haya.
-- Pensado para una base de demostración, no para una con datos de un cliente.
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- andamiaje --
-- Cinco funciones que viven sólo mientras dura el sembrado. Se retiran al final.

create or replace function app.qa_hito(p_dias int, p_hora text)
returns timestamptz language sql stable as $$
  select (((timezone('America/Bogota', now())::date - p_dias)::text || ' ' || p_hora)::timestamp
          at time zone 'America/Bogota');
$$;

-- El PIN real del conductor, descifrado igual que lo hace el panel. Sin esto el
-- generador tendría que inventar credenciales y `claim_driver` las rechazaría.
create or replace function app.qa_pin(p_driver uuid)
returns text language sql stable security definer
set search_path to 'public','app','extensions','pg_temp' as $$
  select extensions.pgp_sym_decrypt(pin_encrypted, app.pin_key())
  from public.drivers where id = p_driver;
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

create or replace function app.qa_inspeccion(
  p_vehiculo uuid, p_conductor uuid, p_km_inicial int, p_fuel_in text,
  p_fallas jsonb, p_obs text, p_salida timestamptz,
  p_km_final int default null, p_fuel_out text default null,
  p_regreso timestamptz default null,
  p_dispositivo text default 'kiosco-planta-01',
  p_etiqueta text default 'Kiosco Planta · Tablet')
returns uuid language plpgsql
set search_path to 'public','app','pg_temp' as $$
declare v_res jsonb; v_id uuid; v_claim jsonb;
begin
  v_claim := public.claim_driver(p_conductor, app.qa_pin(p_conductor), p_dispositivo, p_etiqueta);
  if (v_claim->>'ok') is distinct from 'true' then
    raise exception 'No se pudo verificar al conductor %: %', p_conductor, v_claim::text;
  end if;

  v_res := public.submit_inspection(
             p_vehiculo, p_conductor, app.qa_respuestas(p_fallas),
             p_km_inicial, p_fuel_in, coalesce(p_obs,''), null, p_dispositivo);
  v_id := (v_res->>'id')::uuid;

  update public.inspections
     set created_at = p_salida - interval '8 minutes', submitted_at = p_salida,
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
  return v_id;
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
    update public.rounds set closed_at = p_inicio - interval '15 minutes' where id = v_anterior;
  end if;
  update public.audit_logs set created_at = p_inicio
   where entity_id = v_id::text and action = 'round_started';
  return v_id;
end $$;

-- Un turno completo: abre la ronda, deja que mantenimiento cierre lo que lleva
-- días pendiente, y despacha las unidades que le tocan.
create or replace function app.qa_ronda_masiva(
  p_label text, p_resp text, p_notas text,
  p_inicio timestamptz, p_fin timestamptz,
  p_desde int, p_cuantos int, p_semilla int,
  p_dejar_en_ruta int default 0)
returns text language plpgsql
set search_path to 'public','app','pg_temp' as $$
declare
  v_vehs uuid[]; v_placas text[]; v_drvs uuid[]; v_n int;
  v_ronda uuid; j int; vidx int; v_veh uuid; v_drv uuid;
  v_usados uuid[] := '{}'; v_km int; v_rec int; v_h int; v_f int;
  v_salida timestamptz; v_regreso timestamptz; v_paso interval;
  v_fallas jsonb; v_obs text; v_hechas int := 0; v_saltadas int := 0;
  -- OJO con el indexado: en PostgreSQL `arr[i]` sobre un array de DOS
  -- dimensiones no devuelve la fila, devuelve un escalar (y NULL si faltan
  -- índices). Hay que indexar `arr[i][k]`. Hacerlo mal dejaba las fallas en
  -- nulo y ninguna inspección generaba novedades: el sembrado terminaba «bien»
  -- con cero hallazgos y sin dar ni un error.
  v_criticas text[][] := array[
    array['Frenos','malo','Pedal esponjoso y recorrido largo. No frena en seco a la primera.'],
    array['Luz de freno (stop)','malo','Ninguno de los dos stops enciende al pisar el freno.'],
    array['Presión de aire','malo','Llanta del eje motriz muy por debajo de especificación. Pierde aire.'],
    array['Dirección y suspensión','malo','Juego excesivo en el volante y ruido al pasar resaltos.'],
    array['Cinturones de seguridad','malo','El cinturón del conductor no retrae ni traba.'],
    array['Labrado','malo','Llanta delantera lisa, por debajo del testigo de desgaste.'],
    array['Nivel líquido bomba de frenos','vacio','Depósito prácticamente seco. No se despacha así.'],
    array['Sistema eléctrico / encendido','malo','Arranca sólo con empujón. Falla intermitente de encendido.']];
  v_leves text[][] := array[
    array['Nivel de aceite motor','bajo','Varilla en el mínimo. Se completa antes de salir.'],
    array['Espejo central','regular','El espejo interior vibra y se desajusta en destapado.'],
    array['Limpiabrisas','regular','Plumilla reseca, deja huella en el vidrio.'],
    array['Botiquín de primeros auxilios','incompleto','Faltan vendas y gasas estériles.'],
    array['Nivel de refrigerante','bajo','Depósito por debajo de la marca mínima.'],
    array['Espejos retrovisores','regular','El espejo izquierdo tiene juego con la vibración.'],
    array['Conos','incompleto','Sólo dos conos de los tres reglamentarios.'],
    array['Aire acondicionado','regular','Enfría poco; molesto en ruta larga.'],
    array['Nivel de ácido de batería','bajo','Una celda por debajo del nivel.'],
    array['Extintor (carga / vencimiento)','incompleto','Manómetro en zona amarilla, requiere recarga.']];
begin
  select array_agg(id order by plate), array_agg(plate order by plate)
    into v_vehs, v_placas from public.vehicles where status='active';
  select array_agg(id order by full_name) into v_drvs from public.drivers where active;
  v_n := least(array_length(v_vehs,1), array_length(v_drvs,1));

  v_ronda := app.qa_ronda(p_label, p_resp, p_notas, p_inicio);

  -- Sin este cierre la flota se iría bloqueando entera y ninguna unidad podría
  -- volver a salir: el sistema no despacha un vehículo con novedades vivas.
  perform public.set_issue_status(i.id, 'resolved'::app.issue_status,
            'Atendida por mantenimiento y verificada antes del turno.')
  from public.issues i
  where i.status <> 'resolved' and i.created_at < p_inicio - interval '3 days';
  update public.issues set resolved_at = p_inicio - interval '2 hours'
   where status='resolved' and resolved_at > p_inicio;

  v_paso := (p_fin - p_inicio) / greatest(p_cuantos, 1);

  for j in 0..(p_cuantos - 1) loop
    vidx := ((p_desde + j - 1) % v_n) + 1;
    v_veh := v_vehs[vidx];

    -- Una unidad retenida no sale. Es la regla del sistema, no una decisión
    -- del generador: se salta y se sigue con la siguiente.
    if exists (select 1 from public.issues where vehicle_id = v_veh and status <> 'resolved') then
      v_saltadas := v_saltadas + 1; continue;
    end if;

    -- Conductor titular de esa unidad. Si ya salió en esta ronda entra su
    -- relevo habitual: el titular de la unidad contigua.
    v_drv := v_drvs[vidx];
    if v_drv = any(v_usados) then v_drv := v_drvs[(vidx % v_n) + 1]; end if;
    if v_drv = any(v_usados) then v_saltadas := v_saltadas + 1; continue; end if;
    if exists (select 1 from public.inspections where driver_id = v_drv and operation_status='open') then
      v_saltadas := v_saltadas + 1; continue;
    end if;

    v_h := abs(hashtext(p_semilla::text || ':' || j::text));
    v_salida := p_inicio + v_paso * j;
    v_km := greatest(app.ultimo_odometro(v_veh), 40000 + (abs(hashtext(v_placas[vidx])) % 260000));
    v_rec := 90 + (v_h % 290);
    v_regreso := v_salida + (interval '1 hour' * (4 + (v_h % 4)));
    v_fallas := '[]'::jsonb; v_obs := '';

    if v_h % 9 = 0 then
      v_f := 1 + (v_h / 9) % 8;
      v_fallas := jsonb_build_array(jsonb_build_object(
        'item', v_criticas[v_f][1], 'valor', v_criticas[v_f][2], 'nota', v_criticas[v_f][3]));
      v_obs := 'Unidad retenida. Hallazgo crítico reportado a mantenimiento.';
      perform app.qa_inspeccion(v_veh, v_drv, v_km, 'lleno', v_fallas, v_obs, v_salida);
    else
      if v_h % 4 = 0 then
        v_f := 1 + (v_h / 4) % 10;
        v_fallas := jsonb_build_array(jsonb_build_object(
          'item', v_leves[v_f][1], 'valor', v_leves[v_f][2], 'nota', v_leves[v_f][3]));
        v_obs := 'Novedad menor anotada para el taller.';
      end if;
      if j >= p_cuantos - p_dejar_en_ruta then
        perform app.qa_inspeccion(v_veh, v_drv, v_km, 'lleno', v_fallas, v_obs, v_salida);
      else
        perform app.qa_inspeccion(v_veh, v_drv, v_km, 'lleno', v_fallas, v_obs, v_salida,
                  v_km + v_rec, (array['lleno','medio','bajo'])[1 + v_h % 3], v_regreso);
      end if;
    end if;

    v_usados := v_usados || v_drv;
    v_hechas := v_hechas + 1;
  end loop;

  return format('%s: %s inspecciones, %s omitidas', p_label, v_hechas, v_saltadas);
end $$;

-- ------------------------------------------------------- plantilla y flota --
-- Los conductores se dan de alta por `admin_create_driver`, que es la vía real:
-- guarda el hash bcrypt y la copia cifrada que permite revelar el PIN desde el
-- panel. Un insert directo dejaría conductores que el kiosco no podría validar.
do $alta$
declare
  v_nom text[] := array['Andrés','Carlos','Juan','Luis','Miguel','Sebastián','Jorge','Diego','Fernando','Ricardo',
                        'Álvaro','Óscar','Julián','Mauricio','Héctor','Wilson','Nelson','Edwin','Fabián','Camilo',
                        'Yeison','Duván','Brayan','Alexander','Gustavo','Hernán','Iván','Javier','Leonardo','Marlon',
                        'Norberto','Omar','Pablo','Rubén','Samuel','Tomás','Uriel','Vladimir','Wilmar','Yamid'];
  v_nom2 text[] := array['Felipe','Andrés','David','Fernando','Ángel','Alberto','Eliécer','Armando','José','Antonio',
                         'Enrique','Mauricio','Esteban','Ignacio','Emilio','Ramiro','Alonso','Gabriel','Arturo','Danilo'];
  v_ape text[] := array['Castro','Mendoza','Herrera','Rojas','Torres','Ramírez','Martínez','Gutiérrez','Valencia','Ospina',
                        'Cárdenas','Moreno','Quintero','Zapata','Betancur','Arango','Salazar','Peña','Vargas','Mejía',
                        'Restrepo','Bedoya','Agudelo','Londoño','Osorio','Grajales','Marulanda','Cifuentes','Hoyos','Palacio',
                        'Murillo','Bolaños','Caicedo','Mosquera','Riascos','Angulo','Balanta','Solís','Preciado','Ibargüen'];
  v_ape2 text[] := array['Gómez','Ríos','López','Díaz','Pérez','Sánchez','Álvarez','Muñoz','Jiménez','Ruiz',
                         'Cortés','Naranjo','Escobar','Toro','Velásquez','Giraldo','Cardona','Correa','Duque','Franco'];
  i int; v_nombre text; v_vistos text[] := '{}'; v_giro int;
begin
  for i in 1..70 loop
    -- CUIDADO CON EL PERIODO. La primera versión combinaba los cuatro nombres
    -- con `(i*k) % n` sobre listas de 40, 20, 40 y 20. Cada índice es coprimo
    -- con su lista, así que cada uno tiene periodo igual al tamaño de la lista,
    -- y el conjunto se repite cada mcm(40,20,40,20) = 40. Con setenta
    -- conductores eso significaba treinta nombres repetidos exactos —los pares
    -- (1,41), (2,42)… (30,70)— y no por azar, sino por construcción.
    --
    -- Ahora el cuarto elemento gira con `i / 40`, que rompe el ciclo, y además
    -- se comprueba que el nombre no se haya usado ya: si se repitiera, se
    -- desplaza el apellido hasta que sea único. Un generador que produce
    -- homónimos silenciosos es peor que uno que falle.
    v_giro := 0;
    loop
      v_nombre := v_nom[1 + (i * 7) % array_length(v_nom,1)] || ' ' ||
                  v_nom2[1 + (i * 11) % array_length(v_nom2,1)] || ' ' ||
                  v_ape[1 + (i * 13) % array_length(v_ape,1)] || ' ' ||
                  v_ape2[1 + (i * 17 + (i / 40) * 3 + v_giro) % array_length(v_ape2,1)];
      exit when not (v_nombre = any(v_vistos));
      v_giro := v_giro + 1;
      if v_giro > array_length(v_ape2,1) then
        raise exception 'No se pudo generar un nombre único para el conductor %', i;
      end if;
    end loop;
    v_vistos := v_vistos || v_nombre;
    -- C2 y C3 son las categorías de carga en Colombia; el número imita una
    -- cédula, que es lo que lleva impreso la licencia de verdad.
    perform public.admin_create_driver(
      v_nombre,
      (case when i % 3 = 0 then 'C3-' else 'C2-' end) || (1000000000 + i * 7654321)::text,
      '+57 3' || lpad(((i * 3797) % 100000000)::text, 8, '0'),
      lpad(((i * 2137) % 10000)::text, 4, '0'));
  end loop;
end $alta$;

do $flota$
declare
  v_org uuid := (select id from public.organizations limit 1);
  v_l1 text[] := array['W','T','S','U','V','K','G','H','J','N'];
  v_l2 text[] := array['G','D','R','B','M','P','L','C','F','T'];
  v_l3 text[] := array['T','K','N','S','J','Z','X','Q','V','H'];
  v_ref text[] := array['Tractocamión 3S3','Camión sencillo','Doble troque','Turbo NPR',
                        'Volqueta 14 m³','Furgón refrigerado','Cama baja','Tractomula 2S3',
                        'Camión estacas','Furgón seco'];
  i int;
begin
  for i in 1..70 loop
    insert into public.vehicles(
      organization_id, plate, reference, model, operation_card, status,
      insurance_expires, emissions_expires, oil_change_date)
    values (
      v_org,
      v_l1[1 + (i * 3) % 10] || v_l2[1 + (i * 7) % 10] || v_l3[1 + (i * 11) % 10]
        || '-' || lpad(((i * 137 + 41) % 900 + 100)::text, 3, '0'),
      v_ref[1 + i % 10],
      -- Años entre 2008 y 2025: una flota real no se compra entera el mismo
      -- trienio, y el panel tiene que verse con unidades viejas y nuevas.
      (2008 + (i * 5) % 18)::text,
      'TO-' || (480000 + i * 137)::text, 'active',
      -- Vencimientos repartidos alrededor de hoy: algunos ya vencidos, otros a
      -- punto, la mayoría al día. Es lo que se ve en una flota en servicio.
      (current_date + ((i * 29) % 400) - 40)::date,
      (current_date + ((i * 37) % 380) - 30)::date,
      (current_date - ((i * 11) % 150))::date)
    on conflict (organization_id, plate) do nothing;
  end loop;
end $flota$;

-- ------------------------------------------------------------- borrón previo --
-- Sólo el historial de operación. Conductores y vehículos se conservan.
delete from public.issue_evidence;
delete from public.issues;
delete from public.inspection_answers;
delete from public.notifications;
delete from public.inspections;
delete from public.rounds;
delete from public.driver_claims;
update public.vehicles set admin_blocked=false, admin_block_reason='',
       blocked_at=null, blocked_by=null where status='active';

-- ------------------------------------------------------------- los turnos --
-- La ronda la abre administración; las inspecciones entran por el kiosco. La
-- ventana de vehículos rota para que la flota entera pase por la operación.
do $turnos$
declare v_admin text;
begin
  v_admin := (select id::text from public.profiles where role='superadmin' and active limit 1);
  if v_admin is null then raise exception 'Hace falta un superadministrador activo'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);

  perform app.qa_ronda_masiva('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3',       app.qa_hito(13,'06:00'), app.qa_hito(13,'09:30'),  1, 7, 101);
  perform app.qa_ronda_masiva('Turno Tarde','Marcela Ríos','Despachos a Cali y Palmira',              app.qa_hito(13,'14:00'), app.qa_hito(13,'17:00'),  8, 7, 102);
  perform app.qa_ronda_masiva('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3',       app.qa_hito(12,'06:00'), app.qa_hito(12,'09:30'), 15, 7, 103);
  perform app.qa_ronda_masiva('Turno Tarde','Marcela Ríos','Despachos a Buga y Tuluá',                app.qa_hito(12,'14:00'), app.qa_hito(12,'17:00'), 22, 7, 104);
  perform app.qa_ronda_masiva('Turno Único · Guardia','Rafael Guerrero','Operación reducida',         app.qa_hito(11,'07:00'), app.qa_hito(11,'10:00'), 29, 5, 105);
  perform app.qa_ronda_masiva('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3',       app.qa_hito(10,'06:00'), app.qa_hito(10,'09:30'), 34, 7, 106);
  perform app.qa_ronda_masiva('Turno Tarde','Marcela Ríos','Despachos a Cali y Palmira',              app.qa_hito(10,'14:00'), app.qa_hito(10,'17:00'), 41, 7, 107);
  perform app.qa_ronda_masiva('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3',       app.qa_hito(9,'06:00'),  app.qa_hito(9,'09:30'),  48, 7, 108);
  perform app.qa_ronda_masiva('Turno Tarde','Marcela Ríos','Despachos a Buenaventura centro',         app.qa_hito(9,'14:00'),  app.qa_hito(9,'17:00'),  55, 7, 109);
  perform app.qa_ronda_masiva('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3',       app.qa_hito(8,'06:00'),  app.qa_hito(8,'09:30'),  62, 7, 110);
  perform app.qa_ronda_masiva('Turno Tarde','Marcela Ríos','Despachos a Cali y Palmira',              app.qa_hito(8,'14:00'),  app.qa_hito(8,'17:00'),  69, 8, 111);
  perform app.qa_ronda_masiva('Turno Mañana · Fin de semana','Rafael Guerrero','Operación de sábado', app.qa_hito(7,'07:00'),  app.qa_hito(7,'10:00'),   3, 6, 112);
  perform app.qa_ronda_masiva('Turno Mañana','Julián Ospina','Retiro de contenedores refrigerados',   app.qa_hito(6,'06:00'),  app.qa_hito(6,'09:30'),  10, 7, 113);
  perform app.qa_ronda_masiva('Turno Tarde','Marcela Ríos','Despachos a Buga y Tuluá',                app.qa_hito(6,'14:00'),  app.qa_hito(6,'17:00'),  18, 7, 114);
  perform app.qa_ronda_masiva('Turno Único · Guardia','Rafael Guerrero','Operación reducida',         app.qa_hito(5,'07:00'),  app.qa_hito(5,'10:00'),  26, 5, 115);
  perform app.qa_ronda_masiva('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3',       app.qa_hito(4,'06:00'),  app.qa_hito(4,'09:30'),  32, 7, 116);
  perform app.qa_ronda_masiva('Turno Tarde','Marcela Ríos','Despachos a Cali y Palmira',              app.qa_hito(4,'14:00'),  app.qa_hito(4,'17:00'),  39, 7, 117);
  perform app.qa_ronda_masiva('Turno Mañana','Julián Ospina','Retiro de contenedores refrigerados',   app.qa_hito(3,'06:00'),  app.qa_hito(3,'09:30'),  46, 7, 118);
  perform app.qa_ronda_masiva('Turno Tarde','Marcela Ríos','Despachos a Buga y Tuluá',                app.qa_hito(3,'14:00'),  app.qa_hito(3,'17:00'),  53, 7, 119);
  perform app.qa_ronda_masiva('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3',       app.qa_hito(2,'06:00'),  app.qa_hito(2,'09:30'),  60, 7, 120);
  perform app.qa_ronda_masiva('Turno Tarde','Marcela Ríos','Despachos a Cali y Palmira',              app.qa_hito(2,'14:00'),  app.qa_hito(2,'17:00'),  67, 8, 121);
  perform app.qa_ronda_masiva('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3',       app.qa_hito(1,'06:00'),  app.qa_hito(1,'09:30'),   5, 7, 122);
  perform app.qa_ronda_masiva('Turno Tarde','Marcela Ríos','Despachos a Cali y Palmira',              app.qa_hito(1,'14:00'),  app.qa_hito(1,'17:00'),  12, 7, 123);

  -- Hoy: turno de noche ya cerrado.
  perform app.qa_ronda_masiva('Turno Noche','Rafael Guerrero','Retiro de contenedores refrigerados, muelle 1',
        app.qa_hito(0,'00:15'), app.qa_hito(0,'03:00'), 20, 6, 124);
  -- Hoy: turno de mañana EN CURSO. Las tres últimas siguen fuera. La ventana se
  -- cierra a las 08:30 para que ningún regreso caiga en el futuro.
  perform app.qa_ronda_masiva('Turno Mañana','Julián Ospina','Cargue de contenedores muelle 3 y despachos a Cali',
        app.qa_hito(0,'05:40'), app.qa_hito(0,'08:30'), 27, 8, 125, 3);
end $turnos$;

-- Mantenimiento cierra lo que lleva más de día y medio abierto, para que la
-- flota no aparezca con media plantilla retenida.
do $cierre$
declare r record;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub',(select id::text from public.profiles where role='superadmin' and active limit 1),
                      'role','authenticated')::text, true);
  for r in select id, created_at, severity from public.issues
            where status <> 'resolved' and created_at < now() - interval '36 hours' order by created_at loop
    perform public.set_issue_status(r.id, 'resolved'::app.issue_status,
      case when r.severity = 'bad'
        then 'Reparación ejecutada en taller y verificada antes de habilitar la unidad.'
        else 'Corregida durante el mantenimiento preventivo del turno.' end);
    -- Fecha de cierre plausible entre la apertura y ahora, en vez de estampar
    -- todas con la hora de esta ejecución.
    update public.issues
       set resolved_at = r.created_at + interval '1 hour' * (6 + (abs(hashtext(r.id::text)) % 20)),
           updated_at  = r.created_at + interval '1 hour' * (6 + (abs(hashtext(r.id::text)) % 20))
     where id = r.id;
  end loop;
end $cierre$;

-- Recordatorio de regreso para lo que sigue fuera: se ENCOLA, no se envía.
do $avisos$
declare r record;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub',(select id::text from public.profiles where role='operator' and active order by created_at limit 1),
                      'role','authenticated')::text, true);
  for r in select id, submitted_at from public.inspections where operation_status='open' loop
    perform public.enqueue_return_reminder(r.id);
    update public.notifications set created_at = r.submitted_at + interval '2 minutes' where inspection_id = r.id;
  end loop;
end $avisos$;

-- ------------------------------------------------- se retira el andamiaje --
drop function if exists app.qa_ronda_masiva(text,text,text,timestamptz,timestamptz,int,int,int,int);
drop function if exists app.qa_inspeccion(uuid,uuid,int,text,jsonb,text,timestamptz,int,text,timestamptz,text,text);
drop function if exists app.qa_respuestas(jsonb);
drop function if exists app.qa_ronda(text,text,text,timestamptz);
drop function if exists app.qa_pin(uuid);
drop function if exists app.qa_hito(int,text);

-- ------------------------------------------------------------ comprobación --
with ops as (
  select vehicle_id, submitted_at, closed_at, km_inicial, km_final,
         lag(km_final) over (partition by vehicle_id order by submitted_at) km_prev
  from public.inspections where status in ('authorized','closed'))
select 'un conductor repetido en la misma ronda' as comprobacion,
  (select coalesce(max(n),0)::text from (select count(*) n from public.inspections group by round_id, driver_id) x) as obtenido, '1' as esperado
union all select 'conductores distintos por vehículo en una ronda',
  (select coalesce(max(n),0)::text from (select count(distinct driver_id) n from public.inspections group by round_id, vehicle_id) x), '1'
union all select 'odómetro que retrocede',
  (select count(*) filter (where km_prev is not null and km_inicial < km_prev)::text from ops), '0'
union all select 'operaciones de menos de 5 minutos',
  (select count(*) filter (where closed_at is not null and closed_at - submitted_at < interval '5 minutes')::text from ops), '0'
union all select 'velocidad media por encima de 120 km/h',
  (select count(*) filter (where closed_at is not null and km_final is not null
     and (km_final-km_inicial)::numeric*3600/greatest(extract(epoch from (closed_at-submitted_at))::int,1) > 120)::text from ops), '0'
union all select 'marcas de tiempo en el futuro',
  (select count(*)::text from public.inspections where submitted_at > now() or closed_at > now()), '0'
union all select 'borradores huérfanos',
  (select count(*)::text from public.inspections where status='in_progress'), '0'
union all select 'inspecciones sembradas',
  (select count(*)::text from public.inspections), '170 aprox'
union all select 'vehículos / conductores',
  (select count(*) from public.vehicles)||' / '||(select count(*) from public.drivers), '77 / 77'
union all select 'conductores con nombre repetido',
  (select count(*)::text from (select full_name from public.drivers group by full_name having count(*)>1) x), '0';
