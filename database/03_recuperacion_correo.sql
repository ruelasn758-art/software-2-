BEGIN;
ALTER TABLE public.notificacion ADD COLUMN IF NOT EXISTS correo_recuperacion TEXT;
ALTER TABLE public.notificacion ADD COLUMN IF NOT EXISTS nombre_solicitante TEXT;
CREATE OR REPLACE VIEW compat.recuperaciones AS SELECT id_notificacion AS id,codigo,id_usuario AS usuario_id,estado_recuperacion AS estado,codigo_clave,fecha_creacion::text AS creado_en,resuelto_en::text AS resuelto_en,correo_recuperacion,nombre_solicitante
 FROM public.notificacion WHERE clase='RECUPERACION';
CREATE OR REPLACE FUNCTION compat.escribir_aviso() RETURNS trigger LANGUAGE plpgsql AS $$
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
   INSERT INTO public.notificacion(codigo,id_usuario,titulo,mensaje,clase,estado_recuperacion,codigo_clave,fecha_creacion,resuelto_en,correo_recuperacion,nombre_solicitante)
   VALUES(NEW.codigo,NEW.usuario_id,'Recuperacion de cuenta','Solicitud de recuperacion','RECUPERACION',NEW.estado,NEW.codigo_clave,NEW.creado_en::timestamp,NEW.resuelto_en::timestamp,NEW.correo_recuperacion,NEW.nombre_solicitante) RETURNING id_notificacion INTO NEW.id;
  ELSE
   UPDATE public.notificacion SET estado_recuperacion=NEW.estado,codigo_clave=NEW.codigo_clave,resuelto_en=NEW.resuelto_en::timestamp WHERE id_notificacion=OLD.id;
  END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
