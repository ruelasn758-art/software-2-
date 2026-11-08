// Sesiones reales para las pruebas visuales. Credenciales fuera del repositorio.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
module.exports=async(cdp,role='citizen')=>{
 const credentials=JSON.parse(fs.readFileSync(path.join(os.tmpdir(),`puno-${role==='entity'?'vias':'citizen'}-test-credentials.json`),'utf8'));
 const response=await fetch('http://127.0.0.1:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({correo:credentials.correo,password:credentials.password})});
 if(!response.ok)throw Error('No se pudo iniciar la sesión de pruebas: '+response.status);
 const cookie=response.headers.get('set-cookie').split(';')[0];
 await cdp('Network.setCookie',{name:'puno_session',value:cookie.slice('puno_session='.length),url:'http://127.0.0.1:3001',path:'/',httpOnly:true,sameSite:'Strict'});
 return {headers:{Cookie:cookie}};
};
