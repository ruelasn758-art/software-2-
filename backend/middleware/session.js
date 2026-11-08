"use strict";
const {randomBytes,createHash}=require('node:crypto');
const {identity}=require('../services/auth');
const origins=new Set(['http://127.0.0.1:4174','http://localhost:4174']);
const name='puno_session';
const ttl=8*60*60*1000;
module.exports=function sessions(pool){
  const store=new Map();
  function token(req){return /(?:^|;\s*)puno_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];}
  const digest=t=>createHash('sha256').update(t).digest('hex');
  function revoke(req){const t=token(req);if(t)store.delete(digest(t));}
  function issue(req,res,user){
    revoke(req);
    for(const [key,value] of store)if(value.until<=Date.now())store.delete(key);
    const t=randomBytes(32).toString('hex');
    store.set(digest(t),{user:user.id_usuario,until:Date.now()+ttl});
    res.cookie(name,t,{httpOnly:true,sameSite:'strict',secure:req.secure,path:'/',maxAge:ttl});
  }
  async function requireSession(req,res,next){
    const t=token(req), entry=t && store.get(digest(t));
    if(!entry || entry.until<=Date.now()){revoke(req);return res.status(401).json({ok:false,message:'Inicia sesión para continuar.'});}
    try{req.user=await identity(pool,entry.user);res.set('Cache-Control','no-store');next();}
    catch(error){if(error.status)revoke(req);res.status(error.status||503).json({ok:false,message:error.status ? error.message : 'No se pudo verificar la sesión.'});}
  }
  const allow=(...roles)=>(req,res,next)=>roles.includes(req.user?.rol)?next():res.status(403).json({ok:false,message:'No tienes permiso para acceder a esta sección.'});
  function origin(req,res,next){
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin && !origins.has(req.headers.origin))return res.status(403).json({ok:false,message:'Origen no autorizado.'});
    next();
  }
  function logout(req,res){revoke(req);res.clearCookie(name,{httpOnly:true,sameSite:'strict',path:'/'});res.json({ok:true});}
  return {issue,requireSession,allow,origin,logout};
};
module.exports.origins=origins;
