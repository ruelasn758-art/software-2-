"use strict";
// Alta explícita de una sola cuenta de pruebas. No cambia usuarios existentes.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomBytes}=require('node:crypto');
const pool=require('../config/database');
const {hashPassword}=require('../services/auth');
(async()=>{
 const client=await pool.connect();
 try{
  const info=(await client.query('SELECT current_database() AS database,current_user AS username')).rows[0];
  if(info.database!=='puno_reporta_prueba_ia'||info.username!=='puno_reporta_test_app')throw Error('ISOLATION');
  await client.query('BEGIN');
  const email='vias.prueba@municipalidad.test';
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[email]);
  if((await client.query('SELECT id_usuario FROM usuario WHERE lower(correo)=$1',[email])).rows.length)throw Error('ACCOUNT_EXISTS');
  const roles=(await client.query('SELECT id_rol FROM rol WHERE nombre=$1 AND activo',['Trabajador'])).rows;
  const areas=(await client.query(`SELECT DISTINCT a.id_area,a.nombre FROM categoria c JOIN categoria_area ca USING(id_categoria)
    JOIN area_entidad a USING(id_area) JOIN entidad e USING(id_entidad)
    WHERE c.nombre='Vías' AND c.activo AND ca.activo AND a.activo AND e.activo`)).rows;
  if(roles.length!==1||areas.length!==1)throw Error('AMBIGUOUS_ASSIGNMENT');
  const password=randomBytes(24).toString('base64url');
  const hash=await hashPassword(password);
  const user=(await client.query(`INSERT INTO usuario(id_rol,nombres,apellidos,correo,password_hash)
    VALUES($1,'Área de Vías','Prueba',$2,$3) RETURNING id_usuario`,[roles[0].id_rol,email,hash])).rows[0];
  await client.query('INSERT INTO usuario_area(id_usuario,id_area) VALUES($1,$2)',[user.id_usuario,areas[0].id_area]);
  // Credencial entregable fuera del proyecto; nunca se registra en consola.
  const filename=path.join(os.tmpdir(),'puno-vias-test-credentials.json');
  await fs.writeFile(filename,JSON.stringify({correo:email,password,id_usuario:user.id_usuario,area:areas[0].nombre},null,2),{flag:'wx',mode:0o600});
  await client.query('COMMIT');
  console.log({ok:true,correo:email,id_usuario:user.id_usuario,area:areas[0].nombre,credentialsFile:filename});
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
})().catch(e=>{console.error({ok:false,code:e.code||e.message});process.exitCode=1;}).finally(()=>pool.end());
