"use strict";
const {Router}=require("express");
const multer=require("multer");
const service=require("../services/entidad");
const {receive}=require("../controllers/archivos");
module.exports=(pool,root)=>{
  const router=Router();
  const error=(res,e)=>res.status(e.code==="LIMIT_FILE_SIZE"?413:e instanceof multer.MulterError?400:e.status||500).json({ok:false,message:e.code==="LIMIT_FILE_SIZE"?"La fotografía no debe superar 8 MB.":e instanceof multer.MulterError?"Envía una sola imagen en el campo archivo.":e.status?e.message:"No se pudo completar la operación. Tus datos se conservan; vuelve a intentarlo."});
  // Se conserva la URL anterior; :area es solo una etiqueta, no autoriza acceso.
  router.get(["/reportes","/:area/reportes"],async(req,res)=>{try{res.set("Cache-Control","no-store");res.json(await service.list(pool,req.user.id_usuario));}catch(e){error(res,e);}});
  router.post(["/reportes/:id/estado","/:area/reportes/:id/estado"],async(req,res)=>{
    try{
      if(req.body.estado!=="En proceso")throw Object.assign(Error("Usa Registrar solución con evidencia para solucionar el reporte."),{status:400});
      res.json({ok:true,reporte:await service.transition(pool,req.user.id_usuario,req.params.id,"En proceso",{root})});
    }catch(e){if(!e.status)console.error("ENTITY_STATE:",e.code||"ERROR");error(res,e);}
  });
  router.post(["/reportes/:id/solucion","/:area/reportes/:id/solucion"],(req,res)=>receive(req,res,async e=>{
    if(e)return error(res,e);
    try{res.json({ok:true,reporte:await service.transition(pool,req.user.id_usuario,req.params.id,"Solucionado",{root,file:req.file,note:req.body.observacion||""})});}
    catch(e){error(res,e);}
  }));
  return router;
};
