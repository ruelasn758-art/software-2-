const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const express=require('express'),{Client}=require('pg');
const env=require('../config/test-environment'),router=require('../routes/api');
test('Panel entidad real: aislamiento, asignación, transiciones, evidencia, historial y ciudadano',async()=>{
 const db=new Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:env.database,user:env.user,password:process.env.DB_PASSWORD});
 let server,root,failHistory=false;
 try {
  await db.connect();assert.equal((await db.query('SELECT current_database() AS db')).rows[0].db,'puno_reporta_prueba_ia');
  const before=(await db.query('SELECT count(*) AS n FROM reporte')).rows[0].n;
  await db.query('BEGIN');await fs.mkdir(env.uploads,{recursive:true});root=await fs.mkdtemp(path.join(env.uploads,'entity-integration-'));
  const adapter={release(){},query(sql,args){
   if(sql==='BEGIN')return db.query('SAVEPOINT entity_request');
   if(sql==='COMMIT')return db.query('RELEASE SAVEPOINT entity_request');
   if(sql==='ROLLBACK')return db.query('ROLLBACK TO SAVEPOINT entity_request');
   if(failHistory&&sql.startsWith('INSERT INTO historial_estado'))throw Error('FORCED_HISTORY_FAILURE');
   return db.query(sql,args);
  }};
  const pool={options:{database:env.database},query:(...args)=>db.query(...args),connect:async()=>adapter};
  const app=express();app.use(express.json());app.use('/api',router(pool,{uploadRoot:root}));app.use('/uploads',express.static(root));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
  const get=async url=>{const r=await fetch(base+url);assert.equal(r.status,200);return r.json();};
  const post=(url,body)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const areas=await get('/entidad/vias/reportes');assert.equal(areas.area.id_usuario,'2');
  assert.ok(areas.reportes.every(r=>r.id_area_responsable===areas.area.id_area));
  const expected=(await db.query('SELECT id_reporte FROM reporte WHERE activo AND id_area_responsable=$1',[areas.area.id_area])).rows.map(r=>r.id_reporte).sort();
  assert.deepEqual(areas.reportes.map(r=>r.id_reporte).sort(),expected);
  assert.equal((await fetch(base+'/entidad/otra/reportes')).status,403);
  const create=await post('/reportes',{id_usuario:1,id_categoria:1,descripcion:'Prueba reversible de entidad',latitud:-15.84,longitud:-70.02,origen_ubicacion:'MANUAL'});
  assert.equal(create.status,201);const {reporte}=await create.json();const id=reporte.id_reporte;
  const upload=()=>{const f=new FormData();f.append('archivo',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6sAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'evidencia.png');f.append('observacion','Trabajo terminado');return f;};
  const solve=(area='vias',data=upload())=>fetch(base+`/entidad/${area}/reportes/${id}/solucion`,{method:'POST',body:data});
  assert.equal((await solve()).status,409,'No se salta Reportado');
  assert.equal((await post(`/entidad/limpieza/reportes/${id}/estado`,{estado:'En proceso'})).status,404,'No puede operar otra área');
  assert.equal((await post(`/entidad/vias/reportes/${id}/estado`,{estado:'En proceso'})).status,200);
  assert.equal((await post(`/entidad/vias/reportes/${id}/estado`,{estado:'En proceso'})).status,200,'Reintento idempotente');
  assert.equal((await solve('vias',new FormData())).status,400,'Evidencia obligatoria');
  failHistory=true;assert.equal((await solve()).status,500);failHistory=false;
  assert.equal((await db.query("SELECT count(*)::int AS n FROM archivo_reporte WHERE id_reporte=$1",[id])).rows[0].n,0);
  assert.deepEqual(await fs.readdir(path.join(root,'soluciones')),[],'Sin archivo huérfano');
  assert.equal((await solve()).status,200);assert.equal((await solve()).status,200);
  assert.equal((await post(`/entidad/vias/reportes/${id}/estado`,{estado:'En proceso'})).status,409);
  const citizen=(await get('/reportes')).find(r=>r.id_reporte===id);
  assert.equal(citizen.estado,'Solucionado');assert.equal(citizen.historial.length,3);
  assert.deepEqual(citizen.historial.map(h=>h.estado),['Reportado','En proceso','Solucionado']);
  const files=citizen.archivos.filter(f=>f.tipo_archivo==='SOLUCION');assert.equal(files.length,1);assert.equal(files[0].descripcion,'Trabajo terminado');
  assert.equal((await fetch(base.replace('/api','')+files[0].ruta_archivo)).status,200);
  assert.equal((await db.query('SELECT id_usuario FROM historial_estado WHERE id_reporte=$1 ORDER BY id_historial DESC LIMIT 1',[id])).rows[0].id_usuario,'2');
  await db.query('ROLLBACK');assert.equal((await db.query('SELECT count(*) AS n FROM reporte')).rows[0].n,before);
 }finally{
  if(server)await new Promise(r=>server.close(r));await db.query('ROLLBACK').catch(()=>{});await db.end();
  if(root&&path.dirname(path.resolve(root))===path.resolve(env.uploads)&&path.basename(root).startsWith('entity-integration-'))await fs.rm(root,{recursive:true,force:true});
 }
});
