const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {hashPassword,verifyPassword}=require('../services/auth');
let server,base,hash;
const users=[['1','Ciudadano'],['2','Trabajador'],['3','Administrador general'],['4','Administrador de entidad']];
const pool={async query(sql,args=[]){
 if(sql.includes('password_hash FROM usuario'))return {rows:users.filter(u=>args[0]===u[0]+'@test.invalid').map(u=>({id_usuario:u[0],password_hash:hash}))};
 if(sql.includes('r.nombre AS rol_nombre'))return {rows:users.filter(u=>u[0]===args[0]).map(u=>({id_usuario:u[0],rol_nombre:u[1],nombres:'Prueba',apellidos:'Acceso',correo:u[0]+'@test.invalid'}))};
 if(sql.includes('FROM usuario_area'))return {rows:[{id_usuario:args[0],id_area:'17',nombre:'Área asignada',area:'Área asignada',entidad:'Entidad de prueba'}]};
 if(sql.includes('SELECT c.nombre FROM categoria_area'))return {rows:[{nombre:'Vías'}]};
 if(sql.includes('FROM reporte r'))return {rows:[{id_reporte:'11',id_usuario:args[0],id_area_responsable:args[0]}]};
 if(sql.includes('SELECT id_reporte FROM reporte'))return {rows:[]};
 throw Error('Consulta no prevista');
}};
before(async()=>{
 hash=await hashPassword('test-password-only-123');
 const app=express();app.use(express.json());app.use('/api',require('../routes/api')(pool));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api`;
});
after(()=>new Promise(r=>server.close(r)));
async function login(id,password='test-password-only-123'){
 const response=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({correo:id+'@test.invalid',password})});
 return {response,cookie:response.headers.get('set-cookie')?.split(';')[0],body:await response.json()};
}
test('Hash aleatorio seguro y contraseña incorrecta',async()=>{
 assert.notEqual(hash,await hashPassword('test-password-only-123'));
 assert.equal(await verifyPassword('wrong',hash),false);assert.equal(await verifyPassword('test-password-only-123',hash),true);
 assert.equal(await verifyPassword('old','texto-plano'),false);
});
test('Sin sesión: reportes, entidad, admin y subida requieren 401',async()=>{
 for(const path of ['/reportes','/entidad/reportes','/admin/session','/ia/estado'])assert.equal((await fetch(base+path)).status,401);
 assert.equal((await fetch(base+'/reportes/11/archivos',{method:'POST'})).status,401);
});
test('Login rechaza usuario inexistente y contraseña incorrecta sin filtrar hash',async()=>{
 for(const [id,password] of [['9','test-password-only-123'],['1','incorrecta']]){
  const result=await login(id,password);assert.equal(result.response.status,401);assert.equal(result.cookie,undefined);assert.doesNotMatch(JSON.stringify(result.body),/hash|scrypt/);
 }
});
test('Ciudadano autenticado: cookie HttpOnly, identidad segura y acceso solo propio',async()=>{
 const result=await login('1');assert.equal(result.response.status,200);assert.equal(result.body.usuario.rol,'CIUDADANO');
 assert.match(result.response.headers.get('set-cookie'),/HttpOnly/);assert.match(result.response.headers.get('set-cookie'),/SameSite=Strict/);
 assert.doesNotMatch(JSON.stringify(result.body),/hash|password|scrypt/);
 const headers={Cookie:result.cookie};
 assert.equal((await fetch(base+'/auth/me',{headers})).status,200);
 assert.equal((await fetch(base+'/reportes?id_usuario=2',{headers})).status,403);
 assert.equal((await fetch(base+'/reportes',{headers})).status,200);
 assert.equal((await fetch(base+'/entidad/reportes',{headers})).status,403);
 assert.equal((await fetch(base+'/admin/session',{headers})).status,403);
 assert.equal((await fetch(base+'/reportes/99/archivos',{method:'POST',headers})).status,404);
});
test('Entidad: área de sesión, parámetros manipulados no cambian el área',async()=>{
 const result=await login('2');assert.equal(result.body.usuario.rol,'ENTIDAD');assert.equal(result.body.usuario.id_area_responsable,'17');
 const headers={Cookie:result.cookie};
 for(const path of ['/entidad/reportes?id_area_responsable=99','/entidad/otra-area/reportes']){
  const res=await fetch(base+path,{headers});assert.equal(res.status,200);const data=await res.json();assert.equal(data.area.id_area,'17');assert.equal(data.reportes[0].id_area_responsable,'17');
 }
 assert.equal((await fetch(base+'/reportes',{headers})).status,403);
 assert.equal((await fetch(base+'/admin/session',{headers})).status,403);
});
test('Admin general reconocido; administrador de entidad no obtiene permisos globales',async()=>{
 const admin=await login('3');assert.equal(admin.body.usuario.rol,'ADMIN');assert.equal((await fetch(base+'/admin/session',{headers:{Cookie:admin.cookie}})).status,200);
 const scoped=await login('4');assert.equal(scoped.body.usuario.rol,'ENTIDAD');assert.equal((await fetch(base+'/admin/session',{headers:{Cookie:scoped.cookie}})).status,403);
});
test('Registro público rechaza asignar rol/área y contraseñas cortas',async()=>{
 for(const extra of [{rol:'ADMIN'},{id_area:17},{password:'short'}]){
  const res=await fetch(base+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre:'Persona Prueba',correo:'nuevo@test.invalid',password:'test-password-only-123',...extra})});assert.equal(res.status,400);
 }
});
test('Logout invalida cookie; no permite reutilizar sesión ni sesión inventada',async()=>{
 const result=await login('1');const headers={Cookie:result.cookie};
 assert.equal((await fetch(base+'/auth/logout',{method:'POST',headers})).status,200);
 assert.equal((await fetch(base+'/auth/me',{headers})).status,401);
 assert.equal((await fetch(base+'/reportes',{headers:{Cookie:'puno_session='+'a'.repeat(64)}})).status,401);
});
test('Origen ajeno rechazado antes de iniciar sesión',async()=>{
 assert.equal((await fetch(base+'/auth/login',{method:'POST',headers:{Origin:'https://otro.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
});
