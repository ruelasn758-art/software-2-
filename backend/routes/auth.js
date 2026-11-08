"use strict";
const {Router}=require('express');
const service=require('../services/auth');
module.exports=(pool,session)=>{
  const router=Router(),attempts=new Map();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  function limit(req,res,next){
    const now=Date.now();
    for(const [key,value] of attempts)if(value.until<now)attempts.delete(key);
    const key=req.ip,entry=attempts.get(key)||{count:0,until:now+15*60*1000};
    attempts.set(key,entry);
    if(++entry.count>30)return res.status(429).json({ok:false,message:'Demasiados intentos. Espera unos minutos.'});
    next();
  }
  for(const [path,method,status] of [['login','login',200],['register','register',201]])router.post('/'+path,limit,async(req,res)=>{
    try{const usuario=await service[method](pool,req.body);session.issue(req,res,usuario);res.status(status).json({ok:true,usuario});}
    catch(error){res.status(error.status||503).json({ok:false,message:error.status?error.message:'No se pudo completar el acceso. Inténtalo nuevamente.'});}
  });
  router.get('/me',session.requireSession,(req,res)=>res.json({ok:true,usuario:req.user}));
  router.post('/logout',session.logout);
  return router;
};
