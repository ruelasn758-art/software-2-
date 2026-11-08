"use strict";
const fs=require("node:fs/promises"),path=require("node:path"),{randomUUID}=require("node:crypto");
const {id,listReports}=require("./reportes");
const {validSignature,storedFileExists}=require("../controllers/archivos");
const fail=(status,message)=>Object.assign(new Error(message),{status});
// Identidad proporcionada por la sesión validada por el router.
async function context(db,key) {
  key=id(key,'usuario');
  const {rows}=await db.query(`SELECT ua.id_usuario,a.id_area,a.nombre AS area,e.nombre AS entidad
    FROM usuario_area ua JOIN usuario u USING(id_usuario)
    JOIN area_entidad a USING(id_area) JOIN entidad e USING(id_entidad)
    WHERE ua.id_usuario=$1 AND ua.activo AND u.activo AND a.activo AND e.activo`,[key]);
  if(rows.length!==1)throw fail(403,"No hay una asignación de área única y activa para este acceso.");
  return rows[0];
}
async function list(pool,key) {
  const area=await context(pool,key);
  return {area,reportes:await listReports(pool,area.id_area)};
}
async function transition(pool,key,reportId,target,{file,note="",root}={}) {
  reportId=id(reportId,"id_reporte");
  if(!["En proceso","Solucionado"].includes(target))throw fail(400,"Estado solicitado no válido.");
  if(typeof note!=="string"||note.length>4000)throw fail(400,"La observación debe tener como máximo 4000 caracteres.");
  if(target==="Solucionado"&&(!file||!validSignature(file)))throw fail(400,"Adjunta una fotografía JPG, PNG o WEBP de la solución.");
  const client=await pool.connect();let transaction=false,filename,created=false;
  try {
    await client.query("BEGIN");transaction=true;
    const area=await context(client,key);
    const {rows}=await client.query(`SELECT r.id_reporte,r.id_estado,e.nombre AS estado FROM reporte r
      JOIN estado_reporte e USING(id_estado)
      WHERE r.id_reporte=$1 AND r.id_area_responsable=$2 AND r.activo FOR UPDATE OF r`,[reportId,area.id_area]);
    if(!rows.length)throw fail(404,"El reporte no está asignado a tu área.");
    const report=rows[0];
    if(report.estado===target) {
      if(target==="Solucionado") {
        const saved=await client.query("SELECT ruta_archivo FROM archivo_reporte WHERE id_reporte=$1 AND tipo_archivo='SOLUCION' ORDER BY id_archivo DESC LIMIT 1",[reportId]);
        if(!saved.rows.length||!await storedFileExists(root,saved.rows[0].ruta_archivo))throw fail(409,"La evidencia guardada no está disponible. Solicita su revisión.");
      }
      await client.query("COMMIT");transaction=false;return {id_reporte:reportId,estado:target};
    }
    if(!(report.estado==="Reportado"&&target==="En proceso"||report.estado==="En proceso"&&target==="Solucionado"))throw fail(409,"No se permite este cambio de estado.");
    const states=await client.query("SELECT id_estado FROM estado_reporte WHERE nombre=$1 AND activo",[target]);
    if(states.rows.length!==1)throw fail(409,"El estado de destino no está configurado correctamente.");
    if(target==="Solucionado") {
      const relative=`soluciones/PR-${reportId}-${randomUUID()}${path.extname(file.originalname).toLowerCase()}`;
      await fs.mkdir(path.join(root,"soluciones"),{recursive:true});filename=path.join(root,relative);
      const handle=await fs.open(filename,"wx");created=true;
      try{await handle.writeFile(file.buffer);}finally{await handle.close();}
      if((await fs.stat(filename)).size!==file.buffer.length)throw Error("WRITE_INCOMPLETE");
      await client.query(`INSERT INTO archivo_reporte(id_reporte,tipo_archivo,ruta_archivo,nombre_original,descripcion)
        VALUES($1,'SOLUCION',$2,$3,$4)`,[reportId,`/uploads/${relative}`,path.basename(file.originalname).slice(0,255),note.trim()||null]);
    }
    await client.query("UPDATE reporte SET id_estado=$1,fecha_actualizacion=LOCALTIMESTAMP WHERE id_reporte=$2",[states.rows[0].id_estado,reportId]);
    await client.query(`INSERT INTO historial_estado(id_reporte,id_estado_anterior,id_estado_nuevo,id_usuario,observacion)
      VALUES($1,$2,$3,$4,$5)`,[reportId,report.id_estado,states.rows[0].id_estado,area.id_usuario,note.trim()||(target==="En proceso"?"Atención iniciada por el área responsable":"Solución registrada por el área responsable")]);
    await client.query("COMMIT");transaction=false;
    return {id_reporte:reportId,estado:target};
  } catch(error) {
    if(transaction)await client.query("ROLLBACK").catch(()=>{});
    if(created) {
      // Ante una respuesta perdida de COMMIT, nunca borrar evidencia que sí quedó registrada.
      try {
        const relative="/uploads/"+path.relative(root,filename).split(path.sep).join("/");
        const referenced=await client.query("SELECT id_archivo FROM archivo_reporte WHERE ruta_archivo=$1",[relative]);
        if(!referenced.rows.length)await fs.unlink(filename);
      } catch(cleanup){console.error("Revisar evidencia de solución:",cleanup.code||"CLEANUP_ERROR");}
    }
    throw error;
  } finally {client.release();}
}
module.exports={context,list,transition};
