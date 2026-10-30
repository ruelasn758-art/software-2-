-- Campos de continuidad: conservan funciones y datos del software existente.
-- Las tablas de negocio siguen siendo las 16 del esquema solicitado.
ALTER TABLE area_entidad ADD COLUMN codigo VARCHAR(30) UNIQUE;
ALTER TABLE area_entidad ADD COLUMN dependencia VARCHAR(20) NOT NULL DEFAULT 'municipal';
UPDATE area_entidad SET codigo=CASE id_area WHEN 1 THEN 'AR-OP' WHEN 2 THEN 'AR-LP' WHEN 3 THEN 'AR-AP' WHEN 4 THEN 'AR-SD' END,
 dependencia=CASE WHEN id_entidad=1 THEN 'municipal' ELSE 'externa' END;
ALTER TABLE categoria ADD COLUMN codigo VARCHAR(30) UNIQUE;
ALTER TABLE categoria ADD COLUMN nombre_formulario VARCHAR(80);
UPDATE categoria SET codigo=CASE id_categoria WHEN 1 THEN 'CAT-BCH' WHEN 2 THEN 'CAT-BSR' WHEN 3 THEN 'CAT-LUM' WHEN 4 THEN 'CAT-FUG' END,
 nombre_formulario=CASE id_categoria WHEN 1 THEN 'Bache' WHEN 2 THEN 'Basura' WHEN 3 THEN 'Luminaria' WHEN 4 THEN 'Fuga' END;
ALTER TABLE usuario ADD COLUMN codigo VARCHAR(30) UNIQUE;
ALTER TABLE usuario ADD COLUMN usuario VARCHAR(150) UNIQUE;
ALTER TABLE usuario ADD COLUMN dni_foto TEXT;
ALTER TABLE usuario ADD COLUMN direccion TEXT;
ALTER TABLE usuario ADD COLUMN referencia TEXT;
ALTER TABLE usuario ADD COLUMN estado_verificacion VARCHAR(20) NOT NULL DEFAULT 'Pendiente'
 CHECK (estado_verificacion IN ('Pendiente','Verificado','Rechazado','Suspendido'));
ALTER TABLE usuario ADD COLUMN motivo TEXT;
ALTER TABLE usuario ADD COLUMN verificado_en TIMESTAMP;
ALTER TABLE usuario ADD COLUMN id_entidad BIGINT REFERENCES entidad;
ALTER TABLE reporte ADD COLUMN ciudadano_nombre TEXT;
ALTER TABLE reporte ADD COLUMN ciudadano_contacto TEXT;
ALTER TABLE reporte ADD COLUMN referencia TEXT;
ALTER TABLE reporte ADD COLUMN direccion_mapa TEXT;
ALTER TABLE reporte ADD COLUMN verificado_sitio INTEGER NOT NULL DEFAULT 0 CHECK(verificado_sitio IN (0,1));
ALTER TABLE reporte ADD COLUMN operador_id BIGINT REFERENCES usuario;
ALTER TABLE archivo_reporte ADD COLUMN codigo VARCHAR(30) UNIQUE;
ALTER TABLE notificacion ADD COLUMN codigo VARCHAR(30) UNIQUE;
ALTER TABLE notificacion ADD COLUMN clase VARCHAR(20) NOT NULL DEFAULT 'ALERTA'
 CHECK (clase IN ('ALERTA','REPORTE','RECUPERACION'));
ALTER TABLE notificacion ADD COLUMN estado_envio VARCHAR(20) DEFAULT 'Enviada';
ALTER TABLE notificacion ADD COLUMN estado_recuperacion VARCHAR(20)
 CHECK (estado_recuperacion IN ('Pendiente','Aprobada','Usada','Rechazada'));
ALTER TABLE notificacion ADD COLUMN codigo_clave TEXT;
ALTER TABLE notificacion ADD COLUMN resuelto_en TIMESTAMP;
-- La categoria del tipo siempre coincide con la del reporte.
ALTER TABLE tipo_incidencia ADD CONSTRAINT uq_tipo_categoria UNIQUE(id_tipo_incidencia,id_categoria);
ALTER TABLE reporte ADD CONSTRAINT fk_tipo_categoria FOREIGN KEY(id_tipo_incidencia,id_categoria)
 REFERENCES tipo_incidencia(id_tipo_incidencia,id_categoria);
ALTER TABLE reporte ADD CONSTRAINT chk_precision CHECK(precision_metros IS NULL OR precision_metros>=0);
CREATE INDEX reporte_ubicacion_gist ON reporte USING gist(ubicacion);
CREATE INDEX reporte_usuario_idx ON reporte(id_usuario);
CREATE INDEX reporte_area_estado_idx ON reporte(id_area_responsable,id_estado);
CREATE INDEX notificacion_destino_idx ON notificacion(id_usuario,leida);
CREATE INDEX archivo_reporte_idx ON archivo_reporte(id_reporte);

-- Vistas de compatibilidad: no duplican datos ni crean tablas antiguas.
CREATE SCHEMA compat;
CREATE VIEW compat.areas AS SELECT id_area AS id,codigo,nombre,dependencia FROM public.area_entidad WHERE activo;
CREATE VIEW compat.categorias AS SELECT c.id_categoria AS id,c.codigo,COALESCE(c.nombre_formulario,c.nombre) AS nombre,'urbana'::text AS tipo,
 (SELECT ca.id_area FROM public.categoria_area ca WHERE ca.id_categoria=c.id_categoria AND ca.activo ORDER BY ca.prioridad,ca.id_categoria_area LIMIT 1) AS area_id
 FROM public.categoria c WHERE c.activo;
CREATE VIEW compat.usuarios AS SELECT u.id_usuario AS id,u.codigo,
 CASE r.nombre WHEN 'Ciudadano' THEN 'ciudadano' WHEN 'Trabajador' THEN 'operador' WHEN 'Administrador general' THEN 'administrador' ELSE 'administrador_entidad' END AS rol,
 COALESCE(u.usuario,u.correo) AS usuario,u.password_hash AS clave_hash,
 trim(u.nombres||' '||u.apellidos) AS nombre,u.dni,u.dni_foto,u.telefono,u.direccion,u.referencia,
 CASE WHEN NOT u.activo THEN 'Suspendido' ELSE u.estado_verificacion END AS estado,
 (SELECT ua.id_area FROM public.usuario_area ua WHERE ua.id_usuario=u.id_usuario AND ua.activo ORDER BY ua.id_usuario_area LIMIT 1) AS area_id,
 u.motivo,u.fecha_registro::text AS creado_en,u.verificado_en::text AS verificado_en
 FROM public.usuario u JOIN public.rol r USING(id_rol);
CREATE VIEW compat.reportes AS SELECT r.id_reporte AS id,r.codigo,
 (SELECT ruta_archivo FROM public.archivo_reporte a WHERE a.id_reporte=r.id_reporte AND tipo_archivo='INCIDENCIA' ORDER BY id_archivo LIMIT 1) AS foto,
 ST_Y(r.ubicacion::geometry) AS lat,ST_X(r.ubicacion::geometry) AS lng,r.descripcion,e.nombre AS estado,
 COALESCE(r.ciudadano_nombre,trim(u.nombres||' '||u.apellidos)) AS ciudadano_nombre,
 COALESCE(r.ciudadano_contacto,u.telefono,'') AS ciudadano_contacto,
 r.id_categoria AS categoria_id,r.id_area_responsable AS area_id,r.fecha_registro::text AS creado_en,
 r.id_usuario AS usuario_id,r.verificado_sitio,r.operador_id,r.referencia,r.direccion_mapa
 FROM public.reporte r JOIN public.estado_reporte e ON e.id_estado=r.id_estado JOIN public.usuario u ON u.id_usuario=r.id_usuario WHERE r.activo;
CREATE VIEW compat.evidencias AS SELECT id_archivo AS id,codigo,ruta_archivo AS fotografia,to_char(fecha_registro,'DD/MM/YYYY') AS fecha,id_reporte AS reporte_id
 FROM public.archivo_reporte WHERE tipo_archivo='SOLUCION';
CREATE VIEW compat.notificaciones AS SELECT id_notificacion AS id,codigo,mensaje,estado_envio AS estado,id_reporte AS reporte_id,fecha_creacion::text AS creado_en
 FROM public.notificacion WHERE clase='REPORTE';
CREATE VIEW compat.alertas AS SELECT id_notificacion AS id,id_usuario AS usuario_id,id_reporte AS reporte_id,mensaje,leida::integer AS leida,fecha_creacion::text AS creado_en
 FROM public.notificacion WHERE clase='ALERTA';
CREATE VIEW compat.recuperaciones AS SELECT id_notificacion AS id,codigo,id_usuario AS usuario_id,estado_recuperacion AS estado,codigo_clave,fecha_creacion::text AS creado_en,resuelto_en::text AS resuelto_en
 FROM public.notificacion WHERE clase='RECUPERACION';

CREATE FUNCTION compat.escribir_usuario() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid bigint; uid bigint;
BEGIN
 SELECT id_rol INTO STRICT rid FROM public.rol WHERE nombre=CASE NEW.rol WHEN 'ciudadano' THEN 'Ciudadano' WHEN 'operador' THEN 'Trabajador' WHEN 'administrador' THEN 'Administrador general' ELSE 'Administrador de entidad' END;
 IF TG_OP='INSERT' THEN
  INSERT INTO public.usuario(id_rol,nombres,apellidos,correo,password_hash,dni,telefono,codigo,usuario,dni_foto,direccion,referencia,estado_verificacion,motivo,fecha_registro,verificado_en,activo)
  VALUES(rid,NEW.nombre,'', 'legacy-'||gen_random_uuid()::text||'@puno.invalid',NEW.clave_hash,NEW.dni,NEW.telefono,NEW.codigo,NEW.usuario,NEW.dni_foto,NEW.direccion,NEW.referencia,NEW.estado,NEW.motivo,COALESCE(NEW.creado_en::timestamp,now()),NEW.verificado_en::timestamp,NEW.estado<>'Suspendido') RETURNING id_usuario INTO uid;
 ELSE
  uid=OLD.id;
  UPDATE public.usuario SET id_rol=rid,nombres=NEW.nombre,apellidos='',password_hash=NEW.clave_hash,dni=NEW.dni,telefono=NEW.telefono,codigo=NEW.codigo,usuario=NEW.usuario,dni_foto=NEW.dni_foto,direccion=NEW.direccion,referencia=NEW.referencia,estado_verificacion=NEW.estado,motivo=NEW.motivo,verificado_en=NEW.verificado_en::timestamp,activo=NEW.estado<>'Suspendido' WHERE id_usuario=uid;
 END IF;
 IF NEW.area_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.area_id IS DISTINCT FROM OLD.area_id) THEN
  UPDATE public.usuario_area SET activo=false WHERE id_usuario=uid;
  INSERT INTO public.usuario_area(id_usuario,id_area) VALUES(uid,NEW.area_id) ON CONFLICT(id_usuario,id_area) DO UPDATE SET activo=true;
 END IF;
 NEW.id=uid;
 RETURN NEW;
END $$;
CREATE TRIGGER usuarios_write INSTEAD OF INSERT OR UPDATE ON compat.usuarios FOR EACH ROW EXECUTE FUNCTION compat.escribir_usuario();

CREATE FUNCTION compat.escribir_reporte() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid bigint; tid bigint; rid bigint;
BEGIN
 SELECT id_estado INTO STRICT eid FROM public.estado_reporte WHERE nombre=NEW.estado;
 SELECT id_tipo_incidencia INTO STRICT tid FROM public.tipo_incidencia WHERE id_categoria=NEW.categoria_id AND activo ORDER BY id_tipo_incidencia LIMIT 1;
 IF TG_OP='INSERT' THEN
  INSERT INTO public.reporte(codigo,id_usuario,id_categoria,id_tipo_incidencia,id_area_responsable,id_estado,descripcion,ubicacion,origen_ubicacion,fecha_registro,ciudadano_nombre,ciudadano_contacto,referencia,direccion_mapa,verificado_sitio,operador_id)
  VALUES(NEW.codigo,NEW.usuario_id,NEW.categoria_id,tid,NEW.area_id,eid,NEW.descripcion,ST_SetSRID(ST_MakePoint(NEW.lng,NEW.lat),4326)::geography,'MANUAL',COALESCE(NEW.creado_en::timestamp,now()),NEW.ciudadano_nombre,NEW.ciudadano_contacto,NEW.referencia,NEW.direccion_mapa,COALESCE(NEW.verificado_sitio,0),NEW.operador_id) RETURNING id_reporte INTO rid;
  INSERT INTO public.archivo_reporte(id_reporte,tipo_archivo,ruta_archivo) VALUES(rid,'INCIDENCIA',NEW.foto);
 ELSE
  rid=OLD.id;
  UPDATE public.reporte SET id_categoria=NEW.categoria_id,id_tipo_incidencia=CASE WHEN NEW.categoria_id<>OLD.categoria_id THEN tid ELSE id_tipo_incidencia END,id_area_responsable=NEW.area_id,id_estado=eid,descripcion=NEW.descripcion,ubicacion=ST_SetSRID(ST_MakePoint(NEW.lng,NEW.lat),4326)::geography,referencia=NEW.referencia,direccion_mapa=NEW.direccion_mapa,verificado_sitio=NEW.verificado_sitio,operador_id=NEW.operador_id WHERE id_reporte=rid;
 END IF;
 NEW.id=rid; RETURN NEW;
END $$;
CREATE TRIGGER reportes_write INSTEAD OF INSERT OR UPDATE ON compat.reportes FOR EACH ROW EXECUTE FUNCTION compat.escribir_reporte();

CREATE FUNCTION compat.escribir_evidencia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.archivo_reporte(codigo,id_reporte,tipo_archivo,ruta_archivo,fecha_registro)
 VALUES(NEW.codigo,NEW.reporte_id,'SOLUCION',NEW.fotografia,to_date(NEW.fecha,'DD/MM/YYYY')) RETURNING id_archivo INTO NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER evidencias_write INSTEAD OF INSERT ON compat.evidencias FOR EACH ROW EXECUTE FUNCTION compat.escribir_evidencia();

CREATE FUNCTION compat.escribir_aviso() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid bigint; clase_n text;
BEGIN
 IF TG_TABLE_NAME='notificaciones' THEN
  SELECT id_usuario INTO STRICT uid FROM public.reporte WHERE id_reporte=NEW.reporte_id;
  INSERT INTO public.notificacion(codigo,id_usuario,id_reporte,titulo,mensaje,clase,estado_envio,fecha_creacion)
  VALUES(NEW.codigo,uid,NEW.reporte_id,'Actualizacion del reporte',NEW.mensaje,'REPORTE',NEW.estado,NEW.creado_en::timestamp) RETURNING id_notificacion INTO NEW.id;
 ELSIF TG_TABLE_NAME='alertas' THEN
  IF TG_OP='INSERT' THEN
   INSERT INTO public.notificacion(id_usuario,id_reporte,titulo,mensaje,clase,leida,fecha_creacion)
   VALUES(NEW.usuario_id,NEW.reporte_id,'Aviso de Puno Reporta',NEW.mensaje,'ALERTA',COALESCE(NEW.leida,0)<>0,NEW.creado_en::timestamp) RETURNING id_notificacion INTO NEW.id;
  ELSE
   UPDATE public.notificacion SET leida=NEW.leida<>0,fecha_lectura=CASE WHEN NEW.leida<>0 THEN now() ELSE NULL END WHERE id_notificacion=OLD.id;
  END IF;
 ELSE
  IF TG_OP='INSERT' THEN
   INSERT INTO public.notificacion(codigo,id_usuario,titulo,mensaje,clase,estado_recuperacion,codigo_clave,fecha_creacion,resuelto_en)
   VALUES(NEW.codigo,NEW.usuario_id,'Recuperacion de cuenta','Solicitud de recuperacion','RECUPERACION',NEW.estado,NEW.codigo_clave,NEW.creado_en::timestamp,NEW.resuelto_en::timestamp) RETURNING id_notificacion INTO NEW.id;
  ELSE
   UPDATE public.notificacion SET estado_recuperacion=NEW.estado,codigo_clave=NEW.codigo_clave,resuelto_en=NEW.resuelto_en::timestamp WHERE id_notificacion=OLD.id;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notificaciones_write INSTEAD OF INSERT ON compat.notificaciones FOR EACH ROW EXECUTE FUNCTION compat.escribir_aviso();
CREATE TRIGGER alertas_write INSTEAD OF INSERT OR UPDATE ON compat.alertas FOR EACH ROW EXECUTE FUNCTION compat.escribir_aviso();
CREATE TRIGGER recuperaciones_write INSTEAD OF INSERT OR UPDATE ON compat.recuperaciones FOR EACH ROW EXECUTE FUNCTION compat.escribir_aviso();

CREATE FUNCTION public.registrar_historial() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor bigint;
BEGIN
 actor=COALESCE(NULLIF(current_setting('puno.usuario_id',true),'')::bigint,NEW.id_usuario);
 IF TG_OP='UPDATE' THEN NEW.fecha_actualizacion=now(); END IF;
 IF TG_OP='INSERT' OR OLD.id_estado IS DISTINCT FROM NEW.id_estado THEN
  INSERT INTO public.historial_estado(id_reporte,id_estado_anterior,id_estado_nuevo,id_usuario,observacion)
  VALUES(NEW.id_reporte,CASE WHEN TG_OP='UPDATE' THEN OLD.id_estado ELSE NULL END,NEW.id_estado,actor,'Cambio registrado por el sistema');
 END IF;
 RETURN NEW;
END $$;
-- AFTER permite que la FK del historial vea el nuevo reporte.
CREATE TRIGGER reporte_historial AFTER INSERT OR UPDATE OF id_estado ON public.reporte FOR EACH ROW EXECUTE FUNCTION public.registrar_historial();
CREATE FUNCTION public.fecha_reporte() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.fecha_actualizacion=now(); RETURN NEW; END $$;
CREATE TRIGGER reporte_fecha BEFORE UPDATE ON public.reporte FOR EACH ROW EXECUTE FUNCTION public.fecha_reporte();
CREATE FUNCTION public.auditar_cambio() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE datos jsonb; actor bigint;
BEGIN
 datos=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 actor=NULLIF(current_setting('puno.usuario_id',true),'')::bigint;
 INSERT INTO public.auditoria(id_usuario,accion,tabla_afectada,id_registro,detalle,direccion_ip)
 VALUES(actor,TG_OP,TG_TABLE_NAME,(datos->>TG_ARGV[0])::bigint,'Operacion registrada; no se almacenan claves ni datos sensibles.',NULLIF(current_setting('puno.ip',true),''));
 RETURN NULL;
END $$;
DO $$ DECLARE t text; pk text; BEGIN
 FOREACH t IN ARRAY ARRAY['usuario','reporte','archivo_reporte','clasificacion_ia','comentario_reporte','notificacion'] LOOP
  pk=CASE t WHEN 'archivo_reporte' THEN 'id_archivo' WHEN 'clasificacion_ia' THEN 'id_clasificacion' WHEN 'comentario_reporte' THEN 'id_comentario' ELSE 'id_'||t END;
  EXECUTE format('CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.auditar_cambio(%L)',t,pk);
 END LOOP;
END $$;
