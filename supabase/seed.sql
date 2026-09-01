-- =============================================================================
-- PREOPERATIONAL SYSTEM — SEED / DEMO DATA (idempotente)
-- -----------------------------------------------------------------------------
-- ⚠️  DATOS DE DEMOSTRACIÓN. El nombre de la organización es un CLIENTE ficticio
-- (no el nombre del producto) para que la demo se vea como un tenant real.
-- Diferénciar de datos reales. Credenciales demo (CAMBIAR en producción de inmediato):
--   admin@navierapacifico.com     / Preoperacional2026!  (rol: admin)
--   operador@navierapacifico.com  / Kiosco2026!          (rol: operator/kiosco)
-- PIN demo de conductores: ver tabla más abajo (1234, 2345, ...).
-- =============================================================================

do $$
declare
  v_org uuid; v_admin uuid; v_operator uuid; v_struct jsonb;
begin
  if exists (select 1 from public.organizations where slug='naviera-pacifico') then
    raise notice 'Seed demo ya aplicado; se omite.';
    return;
  end if;

  insert into public.organizations(name, slug, timezone)
    values ('Naviera del Pacífico S.A.','naviera-pacifico','America/Bogota') returning id into v_org;

  -- ---- Usuarios de autenticación (Supabase Auth) ----------------------------
  v_admin := gen_random_uuid();
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
    email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,
    confirmation_token,recovery_token,email_change_token_new,email_change,
    email_change_token_current,reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', v_admin,'authenticated','authenticated',
    'admin@navierapacifico.com', extensions.crypt('Preoperacional2026!', extensions.gen_salt('bf')),
    now(),now(),now(),'{"provider":"email","providers":["email"]}',
    '{"full_name":"Administrador"}','','','','','','');
  insert into auth.identities(provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
  values ('admin@navierapacifico.com', v_admin,
    jsonb_build_object('sub',v_admin::text,'email','admin@navierapacifico.com','email_verified',true),
    'email',now(),now(),now());

  v_operator := gen_random_uuid();
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
    email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,
    confirmation_token,recovery_token,email_change_token_new,email_change,
    email_change_token_current,reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', v_operator,'authenticated','authenticated',
    'operador@navierapacifico.com', extensions.crypt('Kiosco2026!', extensions.gen_salt('bf')),
    now(),now(),now(),'{"provider":"email","providers":["email"]}',
    '{"full_name":"Kiosco Planta"}','','','','','','');
  insert into auth.identities(provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
  values ('operador@navierapacifico.com', v_operator,
    jsonb_build_object('sub',v_operator::text,'email','operador@navierapacifico.com','email_verified',true),
    'email',now(),now(),now());

  insert into public.profiles(id,organization_id,role,full_name,email) values
    (v_admin,   v_org,'admin',   'Administrador',   'admin@navierapacifico.com'),
    (v_operator,v_org,'operator','Kiosco Planta',   'operador@navierapacifico.com');

  -- ---- Checklist: categorías -------------------------------------------------
  insert into public.checklist_categories(organization_id,key,name,icon,sort_order) values
    (v_org,'luces','Luces','bulb',1),
    (v_org,'cabina','Cabina','seat',2),
    (v_org,'llantas','Llantas','tire',3),
    (v_org,'mecanico','Estado mecánico y eléctrico','engine',4),
    (v_org,'emergencia','Equipo de carretera y emergencia','kit',5);

  -- ---- Checklist: ítems (is_safety_critical según reglas del prototipo) -------
  insert into public.checklist_items(organization_id,category_id,name,item_type,is_safety_critical,sort_order)
  select v_org, c.id, x.name, x.itype::app.item_type, x.crit, x.ord
  from (values
    ('luces','Luz alta','estado',true,1),
    ('luces','Luz baja','estado',true,2),
    ('luces','Luz antiniebla / media','estado',false,3),
    ('luces','Luz de freno (stop)','estado',true,4),
    ('luces','Luz de reversa','estado',false,5),
    ('luces','Luz de estacionamiento / parqueo','estado',false,6),
    ('luces','Direccional delantero derecho','estado',false,7),
    ('luces','Direccional delantero izquierdo','estado',false,8),
    ('luces','Direccional trasero derecho','estado',false,9),
    ('luces','Direccional trasero izquierdo','estado',false,10),
    ('cabina','Espejo central','estado',false,1),
    ('cabina','Espejos retrovisores','estado',false,2),
    ('cabina','Aire acondicionado','estado',false,3),
    ('cabina','Pito','estado',false,4),
    ('cabina','Freno de mano','estado',false,5),
    ('cabina','Cinturones de seguridad','estado',true,6),
    ('cabina','Puertas','estado',false,7),
    ('cabina','Vidrio frontal','estado',false,8),
    ('cabina','Limpiabrisas','estado',false,9),
    ('cabina','Sistema de perifoneo','estado',false,10),
    ('llantas','Sin cortaduras','estado',true,1),
    ('llantas','Presión de aire','estado',true,2),
    ('llantas','Labrado','estado',true,3),
    ('llantas','Llanta de repuesto','equipo',false,4),
    ('mecanico','Nivel líquido bomba de frenos','nivel',true,1),
    ('mecanico','Nivel de aceite motor','nivel',false,2),
    ('mecanico','Nivel de refrigerante','nivel',false,3),
    ('mecanico','Nivel de combustible','nivel',false,4),
    ('mecanico','Nivel de ácido de batería','nivel',false,5),
    ('mecanico','Dirección y suspensión','estado',true,6),
    ('mecanico','Batería','estado',false,7),
    ('mecanico','Bornes','estado',false,8),
    ('mecanico','Correas','estado',false,9),
    ('mecanico','Frenos','estado',true,10),
    ('mecanico','Caja de velocidades','estado',false,11),
    ('mecanico','Mangueras','estado',false,12),
    ('mecanico','Retenedores','estado',false,13),
    ('mecanico','Sistema eléctrico / encendido','estado',true,14),
    ('emergencia','Linterna','equipo',false,1),
    ('emergencia','Guantes','equipo',false,2),
    ('emergencia','Chaleco reflectivo','equipo',false,3),
    ('emergencia','Gato','equipo',false,4),
    ('emergencia','Cruceta','equipo',false,5),
    ('emergencia','Conos','equipo',false,6),
    ('emergencia','Tacos','equipo',false,7),
    ('emergencia','Herramientas','equipo',false,8),
    ('emergencia','Botiquín de primeros auxilios','equipo',true,9),
    ('emergencia','Extintor (carga / vencimiento)','equipo',true,10),
    ('emergencia','Cables de batería','equipo',false,11),
    ('emergencia','Correa de repuesto','equipo',false,12)
  ) as x(catkey,name,itype,crit,ord)
  join public.checklist_categories c on c.organization_id=v_org and c.key=x.catkey;

  -- ---- Checklist versión 1 (snapshot inmutable activo) -----------------------
  select jsonb_agg(cat order by cat_order) into v_struct from (
    select c.sort_order as cat_order, jsonb_build_object(
      'key',c.key,'name',c.name,'icon',c.icon,'sort_order',c.sort_order,
      'items',(select coalesce(jsonb_agg(jsonb_build_object(
                 'id',i.id,'name',i.name,'item_type',i.item_type,
                 'required',i.required,'is_safety_critical',i.is_safety_critical,
                 'sort_order',i.sort_order) order by i.sort_order),'[]'::jsonb)
               from public.checklist_items i where i.category_id=c.id and i.active)
    ) as cat
    from public.checklist_categories c where c.organization_id=v_org and c.active
  ) sub;
  insert into public.checklist_versions(organization_id,version_number,structure,active,note,created_by)
    values (v_org,1,coalesce(v_struct,'[]'::jsonb),true,'Versión inicial (seed)',v_admin);

  -- ---- Vehículos (flota demo) ------------------------------------------------
  insert into public.vehicles(organization_id,plate,reference,status) values
    (v_org,'ABC-123','Camión de carga','active'),
    (v_org,'DEF-456','Camión de carga','active'),
    (v_org,'GHI-789','Camión de carga','active'),
    (v_org,'JKL-012','Camión de carga','active'),
    (v_org,'MNO-345','Camión de carga','active'),
    (v_org,'PQR-678','Camión de carga','active'),
    (v_org,'STU-901','Camión de carga','active'),
    (v_org,'VWX-234','Camión de carga','active'),
    (v_org,'YZA-567','Camión de carga','active'),
    (v_org,'BCD-890','Camión de carga','active');

  -- ---- Conductores (PIN demo hasheado con bcrypt) ----------------------------
  insert into public.drivers(organization_id,full_name,pin_hash,pin_encrypted,created_by)
  select v_org, x.name,
         extensions.crypt(x.pin, extensions.gen_salt('bf')),
         extensions.pgp_sym_encrypt(x.pin, app.pin_key()),
         v_admin
  from (values
    ('Juan Pérez','1234'),
    ('Carlos Rodríguez','2345'),
    ('Ernesto Gómez','3456'),
    ('Luis Martínez','4567'),
    ('Jorge Ramírez','5678'),
    ('Andrés Morales','6789')
  ) as x(name,pin);

  -- ---- Ronda inicial abierta -------------------------------------------------
  insert into public.rounds(organization_id,round_number,label,status,started_by)
    values (v_org,1,'Ronda 1','open',v_admin);

  raise notice 'Seed demo aplicado. Org=%', v_org;
end $$;
