"use strict";
const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const options = { N:32768, r:8, p:3, maxmem:64*1024*1024 };
const failure = (message,status=400) => Object.assign(new Error(message),{status});
const roleNames = Object.freeze({ Ciudadano:'CIUDADANO', Trabajador:'ENTIDAD', 'Administrador de entidad':'ENTIDAD', 'Administrador general':'ADMIN' });
async function hashPassword(password) {
  const salt=randomBytes(16).toString('hex');
  const key=await derive(password,salt,64,options);
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}
async function verifyPassword(password,hash) {
  const match=typeof hash==='string' && /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(hash);
  // También se realiza el trabajo criptográfico para cuentas inexistentes/formatos antiguos.
  const key=await derive(password,match ? match[1] : '00000000000000000000000000000000',64,options);
  return Boolean(match && timingSafeEqual(key,Buffer.from(match[2],'hex')));
}
function credentials(body) {
  if (!body || typeof body.correo!=='string' || typeof body.password!=='string') throw failure('Ingresa correo y contraseña.');
  const correo=body.correo.trim().toLowerCase();
  if(correo.length>150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || body.password.length>128 || !body.password.length) throw failure('Revisa el correo y la contraseña.');
  return {correo,password:body.password};
}
async function identity(db,id) {
  const {rows}=await db.query(`SELECT u.id_usuario,u.nombres,u.apellidos,u.correo,r.nombre AS rol_nombre
    FROM usuario u JOIN rol r USING(id_rol) WHERE u.id_usuario=$1 AND u.activo AND r.activo`,[id]);
  const row=rows[0], rol=row && roleNames[row.rol_nombre];
  if(!rol) throw failure('La cuenta no tiene acceso habilitado.',403);
  const user={id_usuario:row.id_usuario,nombre:`${row.nombres} ${row.apellidos}`.trim(),correo:row.correo,rol,id_area_responsable:null,area_responsable:null};
  if(rol==='ENTIDAD') {
    const areas=await db.query(`SELECT a.id_area,a.nombre,e.nombre AS entidad FROM usuario_area ua
      JOIN area_entidad a USING(id_area) JOIN entidad e USING(id_entidad)
      WHERE ua.id_usuario=$1 AND ua.activo AND a.activo AND e.activo`,[id]);
    if(areas.rows.length!==1) throw failure('La cuenta debe tener una única área activa asignada.',403);
    Object.assign(user,{id_area_responsable:areas.rows[0].id_area,area_responsable:areas.rows[0].nombre,entidad:areas.rows[0].entidad});
    const categories=await db.query(`SELECT c.nombre FROM categoria_area ca JOIN categoria c USING(id_categoria)
      WHERE ca.id_area=$1 AND ca.activo AND c.activo ORDER BY c.id_categoria`,[user.id_area_responsable]);
    const label=categories.rows[0]?.nombre?.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    user.area_key=['vias','limpieza'].includes(label)?label:'asignada';
  }
  return user;
}
async function login(db,body) {
  const input=credentials(body);
  const {rows}=await db.query('SELECT id_usuario,password_hash FROM usuario WHERE lower(correo)=$1 AND activo',[input.correo]);
  if(!await verifyPassword(input.password,rows.length===1 ? rows[0].password_hash : null)) throw failure('Correo o contraseña incorrectos.',401);
  return identity(db,rows[0].id_usuario);
}
async function register(db,body) {
  const input=credentials(body);
  const name=typeof body.nombre==='string' ? body.nombre.trim().replace(/\s+/g,' ') : '';
  const parts=name.split(' '), apellidos=parts.length>1 ? parts.pop() : '', nombres=parts.join(' ');
  if(!nombres || nombres.length>100 || apellidos.length>100 || input.password.length<12) throw failure('Ingresa tu nombre y una contraseña de al menos 12 caracteres.');
  if(['rol','id_rol','id_area_responsable','id_area'].some(k=>Object.hasOwn(body,k))) throw failure('El registro público solo permite cuentas ciudadanas.');
  const hash=await hashPassword(input.password);
  const client=await db.connect();
  try {
    await client.query('BEGIN');
    // Serializa altas con el mismo correo sin cambiar los índices existentes.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.correo]);
    const existing=await client.query('SELECT id_usuario FROM usuario WHERE lower(correo)=$1',[input.correo]);
    if(existing.rows.length) throw failure('No se pudo crear la cuenta con ese correo.',409);
    const roles=await client.query('SELECT id_rol FROM rol WHERE nombre=$1 AND activo',['Ciudadano']);
    if(roles.rows.length!==1) throw failure('El registro no está disponible temporalmente.',503);
    const created=await client.query(`INSERT INTO usuario(id_rol,nombres,apellidos,correo,password_hash)
      VALUES($1,$2,$3,$4,$5) RETURNING id_usuario`,[roles.rows[0].id_rol,nombres,apellidos,input.correo,hash]);
    const user=await identity(client,created.rows[0].id_usuario);
    await client.query('COMMIT');
    return user;
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports={hashPassword,verifyPassword,identity,login,register,roleNames};
