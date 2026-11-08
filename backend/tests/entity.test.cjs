const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {transition}=require('../services/entidad');
test('Transiciones de entidad: evidencia obligatoria, idempotencia, historial y rollback de archivos',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'puno-entity-test-'));
 let state='Reportado',history=[],files=[],snapshot,failHistory=false;
 const client={release(){},async query(sql,args){
  if(sql==='BEGIN'){snapshot={state,history:[...history],files:[...files]};return {rows:[]};}
  if(sql==='ROLLBACK'){({state,history,files}=snapshot);return {rows:[]};}
  if(sql==='COMMIT')return {rows:[]};
  if(sql.includes('FROM usuario_area'))return {rows:[{id_usuario:'2',id_area:'1'}]};
  if(sql.includes('FOR UPDATE'))return {rows:args[0]==='10'?[{id_reporte:'10',id_estado:state==='Reportado'?'1':state==='En proceso'?'2':'3',estado:state}]:[]};
  if(sql.includes('SELECT id_estado FROM estado_reporte'))return {rows:[{id_estado:args[0]==='En proceso'?'2':'3'}]};
  if(sql.startsWith('UPDATE reporte')){state=args[0]==='2'?'En proceso':'Solucionado';return {rows:[]};}
  if(sql.startsWith('INSERT INTO historial_estado')){if(failHistory)throw Error('Fallo de historial');history.push(args);return {rows:[]};}
  if(sql.startsWith('INSERT INTO archivo_reporte')){files.push({ruta_archivo:args[1],descripcion:args[3]});return {rows:[]};}
  if(sql.includes('SELECT ruta_archivo'))return {rows:files};
  if(sql.includes('SELECT id_archivo'))return {rows:files.filter(f=>f.ruta_archivo===args[0])};
  throw Error('SQL inesperado: '+sql);
 }};
 const pool={connect:async()=>client};
 const file={buffer:Buffer.from([255,216,255,4]),mimetype:'image/jpeg',originalname:'foto.jpg'};
 try{
  await assert.rejects(()=>transition(pool,'2','10','Solucionado',{file,root}),/No se permite/);
  await assert.rejects(()=>transition(pool,'2','99','En proceso',{root}),/no está asignado/);
  await transition(pool,'2','10','En proceso',{root});assert.equal(state,'En proceso');
  await transition(pool,'2','10','En proceso',{root});assert.equal(history.length,1);
  await assert.rejects(()=>transition(pool,'2','10','Solucionado',{root}),/fotografía/);
  failHistory=true;await assert.rejects(()=>transition(pool,'2','10','Solucionado',{file,root}),/historial/);failHistory=false;
  assert.equal(state,'En proceso');assert.equal(files.length,0);assert.deepEqual(await fs.readdir(path.join(root,'soluciones')),[]);
  await transition(pool,'2','10','Solucionado',{file,root});assert.equal(state,'Solucionado');assert.equal(files[0].descripcion,null);assert.equal(history.length,2);
  await transition(pool,'2','10','Solucionado',{file,root});assert.equal(files.length,1);assert.equal(history.length,2);
  await assert.rejects(()=>transition(pool,'2','10','En proceso',{root}),/No se permite/);
 }finally{if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('puno-entity-test-'))await fs.rm(root,{recursive:true,force:true});}
});

