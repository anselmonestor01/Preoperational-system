-- =============================================================================
-- PREOPERATIONAL SYSTEM — Pruebas de las reglas de negocio en PostgreSQL
-- =============================================================================
-- Estas son las reglas que protegen vidas: deciden si un vehículo puede salir.
-- Viven en la base de datos a propósito (manipular el navegador no las cambia),
-- así que hay que probarlas AQUÍ, no en el cliente.
--
-- Cómo se ejecuta:
--   psql "$DATABASE_URL" -f supabase/tests/rules.test.sql
--   o pegando el contenido en el editor SQL de Supabase.
--
-- Todo corre dentro de una transacción que se REVIERTE al final: no deja ni un
-- solo registro. Si una regla falla, el script aborta indicando cuál y por qué.
--
-- ESTA SUITE YA ENCONTRÓ UN FALLO REAL: detectó que NINGÚN ítem del checklist
-- estaba marcado como crítico de seguridad, de modo que el sistema autorizaba
-- la salida de un vehículo con los frenos en mal estado. Corregido en la
-- migración `safety_critical_catalog`.
-- =============================================================================

begin;

do $$
declare
  v_org uuid; v_admin uuid; v_drv uuid; v_round uuid;
  v_vA uuid; v_vB uuid; v_vC uuid; v_vD uuid; v_vE uuid;
  v_crit uuid; v_norm uuid;
  v_res jsonb; v_insp uuid; v_err text; v_other uuid;
  v_p int := 0; v_log text := '';
begin
  -- ---------------------------------------------------------------------
  -- Montaje
  -- ---------------------------------------------------------------------
  select id into v_admin from public.profiles where role in ('admin','superadmin') and active limit 1;
  if v_admin is null then raise exception 'PRUEBAS: no hay administrador para ejecutarlas'; end if;
  select organization_id into v_org from public.profiles where id = v_admin;

  -- Actuar como ese administrador (las funciones leen auth.uid()).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);

  -- Un vehículo con novedad abierta NO puede volver a inspeccionarse, así que
  -- cada escenario necesita el suyo.
  insert into public.vehicles(organization_id, plate, reference, status) values
    (v_org,'QA-AAA','Prueba','active'),
    (v_org,'QA-BBB','Prueba','active'),
    (v_org,'QA-CCC','Prueba','active');
  select id into v_vA from public.vehicles where plate='QA-AAA' and organization_id=v_org;
  select id into v_vB from public.vehicles where plate='QA-BBB' and organization_id=v_org;
  select id into v_vC from public.vehicles where plate='QA-CCC' and organization_id=v_org;

  insert into public.drivers(organization_id, full_name, pin_hash, created_by)
    values (v_org,'Conductor QA', extensions.crypt('9999', extensions.gen_salt('bf')), v_admin)
    returning id into v_drv;

  select id into v_crit from public.checklist_items
    where organization_id=v_org and is_safety_critical and active and name='Frenos' limit 1;
  select id into v_norm from public.checklist_items
    where organization_id=v_org and not is_safety_critical and active limit 1;
  if v_crit is null then
    raise exception 'PRUEBAS: "Frenos" no está marcado como crítico de seguridad. '
                    'Sin eso el sistema autorizaría un vehículo sin frenos.';
  end if;

  update public.rounds set status='closed', closed_at=now()
    where organization_id=v_org and status='open';
  insert into public.rounds(organization_id, round_number, label, status, started_by)
    values (v_org, 9001, 'RONDA QA', 'open', v_admin) returning id into v_round;

  -- =====================================================================
  -- REGLA 1 — Frenos en mal estado BLOQUEAN la salida.
  --           Es la regla que justifica que exista el sistema.
  -- =====================================================================
  v_res := public.submit_inspection(v_vA, v_drv,
    jsonb_build_array(jsonb_build_object('category_key','mecanico','item_id',v_crit::text,
      'item_name','Frenos','item_type','estado','value','malo')),
    10000,'lleno','QA','qa-critico-1');

  if (v_res->>'authorized')::boolean is not false then
    raise exception 'FALLO 1: frenos en mal estado NO bloquearon la salida: %', v_res;
  end if;
  if jsonb_array_length(v_res->'reasons') = 0 then
    raise exception 'FALLO 1b: bloqueó sin dejar constancia del motivo';
  end if;
  v_p := v_p+1; v_log := v_log || '1:BLOQUEA(' || (v_res->'reasons'->>0) || ') ';

  -- =====================================================================
  -- REGLA 2 — Todo en buen estado AUTORIZA la salida.
  -- =====================================================================
  v_res := public.submit_inspection(v_vB, v_drv,
    jsonb_build_array(jsonb_build_object('category_key','mecanico','item_id',v_crit::text,
      'item_name','Frenos','item_type','estado','value','bueno')),
    10000,'lleno','QA','qa-bueno-1');
  if (v_res->>'authorized')::boolean is not true then
    raise exception 'FALLO 2: sin hallazgos NO autorizó: %', v_res;
  end if;
  v_insp := (v_res->>'id')::uuid;
  v_p := v_p+1; v_log := v_log || '2:AUTORIZA ';

  -- =====================================================================
  -- REGLA 3 — El kilometraje de regreso no puede ser MENOR que el de salida.
  -- =====================================================================
  begin
    perform public.register_return(v_insp, 5000, 'medio');   -- salió con 10.000
    raise exception 'FALLO 3: aceptó un kilometraje de regreso menor al de salida';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err like 'FALLO 3%' then raise; end if;
    if v_err not like '%no puede ser menor%' then
      raise exception 'FALLO 3: rechazó por un motivo inesperado: %', v_err;
    end if;
  end;
  v_p := v_p+1; v_log := v_log || '3:KM ';

  v_res := public.register_return(v_insp, 10250, 'medio');
  if (v_res->>'recorrido')::int <> 250 then
    raise exception 'FALLO 3b: el recorrido debería ser 250, fue %', v_res->>'recorrido';
  end if;
  v_p := v_p+1; v_log := v_log || '3b:RECORRIDO ';

  -- =====================================================================
  -- REGLA 4 — Idempotencia: reenviar la MISMA inspección no la duplica.
  --           Es lo que hace seguro el modo sin conexión.
  -- =====================================================================
  perform public.submit_inspection(v_vC, v_drv,
    jsonb_build_array(jsonb_build_object('category_key','x','item_id',v_norm::text,
      'item_name','N','item_type','estado','value','bueno')),
    20000,'lleno','QA','qa-idem');
  perform public.submit_inspection(v_vC, v_drv, jsonb_build_array(), 20000,'lleno','QA','qa-idem');
  perform public.submit_inspection(v_vC, v_drv, jsonb_build_array(), 20000,'lleno','QA','qa-idem');
  if (select count(*) from public.inspections
        where organization_id=v_org and idempotency_key='qa-idem') <> 1 then
    raise exception 'FALLO 4: el reenvío duplicó la inspección';
  end if;
  v_p := v_p+1; v_log := v_log || '4:IDEMPOTENTE ';

  -- Esa inspección dejó al conductor con un vehículo en ruta. Se cierra aquí
  -- para que las reglas siguientes se comprueben por su propio motivo y no por
  -- la regla 14 (un conductor, una salida a la vez).
  perform public.register_return(
    (select id from public.inspections
      where organization_id=v_org and idempotency_key='qa-idem'), 20100, 'medio');

  -- =====================================================================
  -- REGLA 5 — Sólo puede haber UNA ronda abierta por organización.
  -- =====================================================================
  begin
    insert into public.rounds(organization_id, round_number, label, status, started_by)
      values (v_org, 9004, 'RONDA DUPLICADA', 'open', v_admin);
    raise exception 'FALLO 5: permitió dos rondas abiertas a la vez';
  exception when unique_violation then null;
  end;
  v_p := v_p+1; v_log := v_log || '5:RONDA_UNICA ';

  -- =====================================================================
  -- REGLA 6 — El PIN se verifica contra el hash, nunca en texto plano.
  -- =====================================================================
  if (public.verify_driver_pin(v_drv,'9999')->>'ok')::boolean is not true then
    raise exception 'FALLO 6: el PIN correcto fue rechazado';
  end if;
  if (public.verify_driver_pin(v_drv,'0000')->>'ok')::boolean is not false then
    raise exception 'FALLO 6: un PIN incorrecto fue aceptado';
  end if;
  v_p := v_p+1; v_log := v_log || '6:PIN ';

  -- =====================================================================
  -- REGLA 7 — Un vehículo con novedades abiertas no puede volver a operar
  --           hasta que alguien las resuelva.
  -- =====================================================================
  begin
    perform public.submit_inspection(v_vA, v_drv, jsonb_build_array(), 1,'lleno','QA','qa-bloqueado');
    raise exception 'FALLO 7: permitió inspeccionar un vehículo con novedades abiertas';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err like 'FALLO 7%' then raise; end if;
    -- Se comprueba el motivo: si rechazara por otra regla, esta prueba estaría
    -- pasando por casualidad y dejaría de vigilar lo que dice vigilar.
    if v_err not like '%novedades%' then
      raise exception 'FALLO 7: rechazó por un motivo distinto al esperado: %', v_err;
    end if;
  end;
  v_p := v_p+1; v_log := v_log || '7:NOVEDADES_BLOQUEAN ';

  -- =====================================================================
  -- REGLA 14 — Un conductor no puede sacar un segundo vehículo mientras no
  --            haya registrado el regreso del primero.
  --
  -- Sin esto, la misma persona figuraba conduciendo dos unidades a la vez, con
  -- kilometrajes que nunca cierran. La regla vive en un disparador de la tabla
  -- `inspections`, así que protege cualquier vía que abra una operación, no
  -- sólo `submit_inspection`.
  -- =====================================================================
  insert into public.vehicles(organization_id, plate, reference, status)
    values (v_org,'QA-DDD','Prueba','active'), (v_org,'QA-EEE','Prueba','active');
  select id into v_vD from public.vehicles where plate='QA-DDD' and organization_id=v_org;
  select id into v_vE from public.vehicles where plate='QA-EEE' and organization_id=v_org;

  v_res := public.submit_inspection(v_vD, v_drv,
    jsonb_build_array(jsonb_build_object('category_key','x','item_id',v_norm::text,
      'item_name','N','item_type','estado','value','bueno')),
    50000,'lleno','QA','qa-en-ruta-1');
  if (v_res->>'authorized')::boolean is not true then
    raise exception 'FALLO 14: la salida de referencia no quedó autorizada';
  end if;
  v_insp := (v_res->>'id')::uuid;

  begin
    perform public.submit_inspection(v_vE, v_drv,
      jsonb_build_array(jsonb_build_object('category_key','x','item_id',v_norm::text,
        'item_name','N','item_type','estado','value','bueno')),
      60000,'lleno','QA','qa-en-ruta-2');
    raise exception 'FALLO 14: permitió una segunda salida sin registrar el regreso';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err like 'FALLO 14%' then raise; end if;
    if v_err not like '%en ruta%' then
      raise exception 'FALLO 14: bloqueó por un motivo inesperado: %', v_err;
    end if;
  end;
  v_p := v_p+1; v_log := v_log || '14:UNA_SALIDA_POR_CONDUCTOR ';

  -- El PIN avisa antes de que el conductor rellene el checklist entero.
  if (public.claim_driver(v_drv,'9999','disp-qa','Tablet QA')->>'motivo') <> 'en_ruta' then
    raise exception 'FALLO 14b: el PIN no avisó de que ya tiene un vehículo en ruta';
  end if;
  v_p := v_p+1; v_log := v_log || '14b:AVISA_EN_EL_PIN ';

  -- Registrar el regreso lo libera.
  perform public.register_return(v_insp, 50120, 'medio');
  v_res := public.submit_inspection(v_vE, v_drv,
    jsonb_build_array(jsonb_build_object('category_key','x','item_id',v_norm::text,
      'item_name','N','item_type','estado','value','bueno')),
    60000,'lleno','QA','qa-en-ruta-3');
  if (v_res->>'authorized')::boolean is not true then
    raise exception 'FALLO 14c: tras registrar el regreso seguía bloqueado';
  end if;
  v_p := v_p+1; v_log := v_log || '14c:EL_REGRESO_LIBERA ';

  -- =====================================================================
  -- REGLA 8 — Borrar una ronda exige la contraseña del administrador, y el
  --           sistema debe DECIR que la contraseña está mal.
  --
  -- La contraseña se cambia sólo dentro de esta transacción, que se revierte
  -- al final: la clave real del administrador no se toca.
  -- =====================================================================
  update auth.users
    set encrypted_password = extensions.crypt('ClaveDePruebaQA#2026', extensions.gen_salt('bf'))
    where id = v_admin;

  begin
    perform public.delete_round(v_round, 'una-clave-que-no-es');
    raise exception 'FALLO 8: borró la ronda con una contraseña incorrecta';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err like 'FALLO 8%' then raise; end if;
    if v_err <> 'La contraseña no es correcta' then
      raise exception 'FALLO 8: el error no explica el problema real (dijo "%")', v_err;
    end if;
  end;
  v_p := v_p+1; v_log := v_log || '8:CLAVE_BORRADO ';

  -- =====================================================================
  -- REGLA 9 — Borrar una ronda arrastra TODO su rastro, incluidas las
  --           novedades que quedaron colgadas de la ronda sin inspección.
  --
  -- `issues.inspection_id` es ON DELETE SET NULL: al borrar una inspección
  -- suelta, su novedad sobrevive conservando `round_id`. Si el borrado de la
  -- ronda no las mira, quedan huérfanas para siempre en Novedades.
  -- =====================================================================
  insert into public.issues(organization_id, round_id, inspection_id, vehicle_id,
                            driver_id, item_name, severity, status)
    values (v_org, v_round, null, v_vC, v_drv, 'Novedad huerfana QA', 'bad', 'pending');

  v_res := public.delete_round(v_round, 'ClaveDePruebaQA#2026');

  if exists (select 1 from public.rounds where id = v_round) then
    raise exception 'FALLO 9: la ronda sigue existiendo';
  end if;
  if exists (select 1 from public.issues where round_id = v_round) then
    raise exception 'FALLO 9: quedaron novedades huérfanas apuntando a la ronda borrada';
  end if;
  if exists (select 1 from public.inspections where round_id = v_round) then
    raise exception 'FALLO 9: quedaron inspecciones de la ronda borrada';
  end if;
  v_p := v_p+1; v_log := v_log || '9:BORRADO_COMPLETO(' || (v_res->>'issues_deleted') || ' nov) ';

  -- =====================================================================
  -- REGLA 10 — Corregir el WhatsApp del conductor repara los avisos que
  --            todavía no han salido.
  --
  -- El aviso guarda una copia del número (debe conservar a dónde se envió).
  -- Mientras siga en cola no se ha enviado nada, así que un aviso creado
  -- cuando el conductor no tenía número tiene que quedar utilizable al
  -- registrarlo. Antes quedaba "sin destino" para siempre.
  -- =====================================================================
  insert into public.notifications(organization_id, canal, destinatario, mensaje,
                                   driver_id, estado, tipo)
    values (v_org, 'whatsapp', '', 'Aviso QA sin destino', v_drv, 'sin_destino', 'regreso');

  v_res := public.set_driver_whatsapp(v_drv, '+57 301 198 7446');

  if v_res->>'whatsapp' <> '573011987446' then
    raise exception 'FALLO 10: no normalizó el número (guardó "%")', v_res->>'whatsapp';
  end if;
  if not exists (select 1 from public.notifications
                 where driver_id = v_drv and estado = 'pendiente'
                   and destinatario = '573011987446') then
    raise exception 'FALLO 10: el aviso sin destino no se reparó al registrar el número';
  end if;
  v_p := v_p+1; v_log := v_log || '10:WHATSAPP_REPARA_COLA ';

  -- Un número imposible se rechaza en el servidor, no sólo en el navegador.
  begin
    perform public.set_driver_whatsapp(v_drv, '12');
    raise exception 'FALLO 10b: aceptó un número de dos dígitos';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err like 'FALLO 10b%' then raise; end if;
  end;
  v_p := v_p+1; v_log := v_log || '10b:NUMERO_VALIDADO ';

  -- =====================================================================
  -- REGLA 11 — Un mensaje personalizado se valida en el servidor.
  -- =====================================================================
  begin
    perform public.send_custom_message(v_drv, 'hey');
    raise exception 'FALLO 11: aceptó un mensaje de 3 caracteres';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err like 'FALLO 11%' then raise; end if;
  end;

  begin
    perform public.send_custom_message(v_drv, repeat('A', 1000));
    raise exception 'FALLO 11: aceptó un mensaje de 1000 caracteres';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err like 'FALLO 11%' then raise; end if;
  end;

  v_res := public.send_custom_message(v_drv, 'Pasa por el taller antes de salir, por favor.');
  if (v_res->>'con_destino')::boolean is not true then
    raise exception 'FALLO 11: no tomó el número recién registrado del conductor';
  end if;
  v_p := v_p+1; v_log := v_log || '11:MENSAJE_VALIDADO ';

  -- =====================================================================
  -- REGLA 12 — Un aviso no se puede marcar como enviado dos veces.
  --            (Antes el botón hacía un UPDATE directo que la RLS ignoraba
  --            en silencio: parecía funcionar y no hacía nada.)
  -- =====================================================================
  perform public.mark_notification_sent((v_res->>'id')::uuid);
  if not exists (select 1 from public.notifications
                 where id = (v_res->>'id')::uuid and estado = 'enviado' and enviado_at is not null) then
    raise exception 'FALLO 12: marcar como enviado no cambió nada';
  end if;
  begin
    perform public.mark_notification_sent((v_res->>'id')::uuid);
    raise exception 'FALLO 12: permitió marcar dos veces el mismo aviso';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err like 'FALLO 12%' then raise; end if;
  end;
  v_p := v_p+1; v_log := v_log || '12:ENVIO_UNICO ';

  -- =====================================================================
  -- REGLA 13 — Escribir a un conductor es cosa de administración.
  --            Un operador de kiosco no puede usar el sistema para mandar
  --            mensajes ni para cambiarle el número a nadie.
  -- =====================================================================
  select id into v_other from public.profiles
    where organization_id = v_org and role in ('operator','driver','auditor') and active limit 1;

  if v_other is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_other::text, 'role','authenticated')::text, true);

    begin
      perform public.send_custom_message(v_drv, 'Mensaje que no debería poder enviar');
      raise exception 'FALLO 13: un rol sin permisos pudo escribirle a un conductor';
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err like 'FALLO 13%' then raise; end if;
    end;

    begin
      perform public.set_driver_whatsapp(v_drv, '573000000000');
      raise exception 'FALLO 13: un rol sin permisos pudo cambiar un número';
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err like 'FALLO 13%' then raise; end if;
    end;

    -- Se vuelve a actuar como administrador para no dejar el contexto cambiado.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);
    v_p := v_p+1; v_log := v_log || '13:SOLO_ADMIN_ESCRIBE ';
  else
    v_log := v_log || '13:OMITIDA(sin rol no-admin en la base) ';
  end if;

  raise notice '=========================================';
  raise notice 'PRUEBAS PASADAS: %  →  %', v_p, v_log;
  raise notice '=========================================';
end $$;

-- Nada de lo anterior queda en la base.
rollback;
