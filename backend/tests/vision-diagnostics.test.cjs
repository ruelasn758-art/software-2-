const {test}=require('node:test');const assert=require('node:assert/strict');
const {diagnosticFetch}=require('../scripts/vision-diagnostics.cjs');
test('Diagnóstico local conserva error Gemini, oculta secretos y no consume la respuesta',async()=>{
 const logs=[];const env={GEMINI_API_KEY:'private-key-value',DB_PASSWORD:'private-db-password'};
 const body={error:{code:400,status:'INVALID_ARGUMENT',message:'Invalid schema private-key-value private-db-password',details:[{field:'schema'}],apiKey:'private-key-value'}};
 const run=diagnosticFetch({env,emit:x=>logs.push(x),fetchImpl:async()=>new Response(JSON.stringify(body),{status:400,statusText:'Bad Request'})});
 const response=await run('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',{method:'POST',headers:{'x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify({contents:[{parts:[{inlineData:{mimeType:'image/jpeg',data:'secret-image-bytes'}}]}],generationConfig:{responseMimeType:'application/json'}})});
 assert.deepEqual(await response.json(),body);assert.equal(logs[1].httpCode,400);assert.equal(logs[1].status,'INVALID_ARGUMENT');assert.deepEqual(logs[1].body.error.details,[{field:'schema'}]);
 const output=JSON.stringify(logs);for(const secret of [...Object.values(env),'secret-image-bytes']) assert.equal(output.includes(secret),false);
});
test('Diagnóstico de transporte no inventa un HTTP ni expone credenciales',async()=>{
 const logs=[];const run=diagnosticFetch({env:{GEMINI_API_KEY:'private-key'},emit:x=>logs.push(x),fetchImpl:async()=>{throw new Error('network private-key');}});
 await assert.rejects(run('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',{headers:{},body:'{}'}));
 assert.equal(logs[1].httpCode,null);assert.equal(logs[1].message,'network [REDACTADO]');
});
