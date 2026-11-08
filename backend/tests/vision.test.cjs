const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const fs=require('node:fs');
const {analyze,fallback}=require('../services/vision');
const router=require('../routes/vision');
const file={mimetype:'image/jpeg',buffer:fs.readFileSync(require('node:path').join(__dirname,'../../assets/images/home/vias.jpg'))};
const env={GEMINI_API_KEY:'mock-key'};
const valid={categoria:'Vías',tipo:'Bache',descripcion:'Se observa un bache en la calzada.'};
function db(database='puno_reporta_prueba_ia',ambiguous=false){return {calls:[],async query(sql){this.calls.push(sql);assert.match(sql,/^SELECT/);
 if(sql.includes('current_database'))return {rows:[{database,username:'puno_reporta_test_app'}]};
 if(sql.includes('FROM categoria c'))return {rows:[{id_categoria:'1',categoria:'Vías',id_tipo_incidencia:'4',tipo:'Bache'},{id_categoria:'2',categoria:'Limpieza',id_tipo_incidencia:'5',tipo:'Basura'}]};
 return {rows:[{id_area:'8',area:'Área real',entidad:'Entidad real',prioridad:1},...(ambiguous?[{id_area:'9',area:'Otra área',prioridad:1}]:[])]};
}};}
const answer=result=>async()=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(result)}]}}]})});
test('Visión: imagen válida, esquema estricto, IDs del catálogo, descripción y destino SQL',async()=>{
 const pool=db(); const result=await analyze(pool,file,{env,fetchImpl:async(url,options)=>{
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent');const body=JSON.parse(options.body);
  assert.equal(options.headers['x-goog-api-key'],'mock-key');assert.equal(new URL(url).search,'');
  assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.generationConfig.candidateCount,1);
  assert.equal(body.contents[0].parts[1].inlineData.mimeType,'image/jpeg');
  assert.equal(body.contents[0].parts[1].inlineData.data,file.buffer.toString('base64'));
  assert.deepEqual(body.generationConfig.responseJsonSchema.properties.categoria.enum,['Vías','Limpieza',null]);
  assert.equal(body.generationConfig.responseJsonSchema.additionalProperties,false);
  assert.deepEqual(JSON.parse(body.contents[0].parts[0].text),[{categoria:'Vías',tipos:['Bache']},{categoria:'Limpieza',tipos:['Basura']}]);
  return answer(valid)();
 }});assert.equal(result.id_categoria,'1');assert.equal(result.id_tipo_incidencia,'4');assert.equal(result.descripcion,valid.descripcion);
 assert.equal(result.id_area_responsable,'8');assert.equal(result.area_responsable,'Área real');assert.equal(result.confianza,null);
});
test('Visión: sin clave, sin imagen y firma inválida no llaman al proveedor',async()=>{
 const fetchImpl=()=>{throw new Error('No debe llamarse');};
 for(const [image,config] of [[file,{}],[null,env],[{...file,buffer:Buffer.from('no es imagen')},env]]) await assert.rejects(analyze(db(),image,{env:config,fetchImpl}),e=>[400,503].includes(e.status));
});
test('Visión: aislamiento rechaza otra base antes de llamar al proveedor',async()=>{
 let called=false;await assert.rejects(analyze(db('puno_reporta'),file,{env,fetchImpl:()=>{called=true;}}));assert.equal(called,false);
});
test('Visión: categoría desconocida y no reconocimiento permiten fallback',async()=>{
 for(const categoria of ['Inventada',null]) await assert.rejects(analyze(db(),file,{env,fetchImpl:answer({...valid,categoria})}),e=>e.status===422);
});
test('Visión: tipo inexistente o de otra categoría se convierte a NULL',async()=>{
 for(const tipo of ['No existe','Basura',null]) {const result=await analyze(db(),file,{env,fetchImpl:answer({...valid,tipo})});assert.equal(result.tipo,null);assert.equal(result.id_tipo_incidencia,null);}
});
test('Visión: destino ambiguo nunca se inventa',async()=>{
 const result=await analyze(db(undefined,true),file,{env,fetchImpl:answer(valid)});assert.equal(result.id_area_responsable,null);
});
test('Visión: salida inválida, larga, rechazo, red y respuesta incompleta',async()=>{
 for(const fetchImpl of [answer({...valid,descripcion:'a'.repeat(301)}),answer({...valid,confianza:0.99}),async()=>{throw new Error('secret');},async()=>({ok:false}),async()=>({ok:true,json:async()=>({candidates:[{finishReason:'MAX_TOKENS'}]})}),async()=>({ok:true,json:async()=>({promptFeedback:{blockReason:'SAFETY'}})})]) await assert.rejects(analyze(db(),file,{env,fetchImpl}),e=>e.message===fallback);
});
test('Gemini: JSON inválido y texto fuera de JSON se rechazan',async()=>{
 for(const text of ['no JSON','```json\n'+JSON.stringify(valid)+'\n```','null','[]']) await assert.rejects(analyze(db(),file,{env,fetchImpl:async()=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]})})}),e=>e.message===fallback);
});
test('Gemini: cuota excedida o servicio caído hacen una sola petición sin exponer errores',async()=>{
 for(const status of [429,503]) {let calls=0;await assert.rejects(analyze(db(),file,{env,fetchImpl:async()=>{calls++;return {ok:false,status,json:async()=>({error:{message:'sensitive'}})};}}),e=>e.status===503 && e.message===fallback);assert.equal(calls,1);}
});
test('Gemini: modelo configurable sin cambiar el contrato',async()=>{
 let calls=0;await analyze(db(),file,{env:{...env,GEMINI_MODEL:'gemini-modelo-prueba'},fetchImpl:async url=>{calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-modelo-prueba:generateContent');return answer(valid)();}});assert.equal(calls,1);
});
test('Visión HTTP: multipart válido, alias, ausente, MIME/extensión/tamaño y falta de clave',async t=>{
 const app=express();app.use('/api/ia',router(db(),{env,fetchImpl:answer(valid)}));app.use('/missing',router(db(),{env:{},fetchImpl:()=>{throw new Error('No llamar');}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function send(path,name='foto.jpg',type='image/jpeg',bytes=file.buffer){const data=new FormData();if(name)data.append('archivo',new Blob([bytes],{type}),name);return fetch(base+path,{method:'POST',body:data});}
 for(const endpoint of ['/api/ia/analizar-incidencia','/api/ia/analizar']) {const response=await send(endpoint);assert.equal(response.status,200);assert.equal((await response.json()).analisis.id_categoria,'1');}
 for(const args of [[null],['foto.exe'],['foto.jpg','text/plain'],['foto.jpg','image/jpeg',Buffer.from('invalid')]]) assert.equal((await send('/api/ia/analizar-incidencia',...args)).status,400);
 assert.equal((await send('/api/ia/analizar-incidencia','grande.jpg','image/jpeg',Buffer.alloc(8*1024*1024+1))).status,413);
 const missing=await send('/missing/analizar-incidencia');assert.equal(missing.status,503);assert.equal((await missing.json()).message,fallback);
});
