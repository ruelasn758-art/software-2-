const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const pool=require('../config/database');const {analyze}=require('../services/vision');
test('IA: catálogos y destino reales de la base aislada, proveedor mock, sin escrituras',async t=>{
 t.after(()=>pool.end());
 const {rows}=await pool.query('SELECT c.nombre AS categoria,t.nombre AS tipo FROM categoria c JOIN tipo_incidencia t ON t.id_categoria=c.id_categoria WHERE c.activo=TRUE AND t.activo=TRUE ORDER BY c.id_categoria,t.id_tipo_incidencia LIMIT 1');
 assert.ok(rows.length);
 const readonly={query(sql,args){assert.match(sql,/^SELECT/);return pool.query(sql,args);}};
 const result=await analyze(readonly,{mimetype:'image/jpeg',buffer:fs.readFileSync(path.join(__dirname,'../../assets/images/home/vias.jpg'))},{env:{GEMINI_API_KEY:'mock'},fetchImpl:async()=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...rows[0],descripcion:'Descripción de prueba no persistida.'})}]}}]})})});
 assert.ok(result.id_categoria);assert.ok(result.id_tipo_incidencia);assert.ok(result.id_area_responsable);assert.equal(result.confianza,null);
});
