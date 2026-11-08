"use strict";
const { Router } = require("express");
const vision = require("../services/vision");
module.exports = function visionRouter(pool, options = {}) {
  const router = Router();
  const { receive, validSignature } = require("../controllers/archivos");
  let active = 0;
  router.get("/estado", (req,res) => res.json({ disponible:vision.isConfigured(options.env) }));
  router.post(["/analizar-incidencia","/analizar"], (req,res) => {
    if (active) return res.status(429).json({ok:false,message:vision.fallback});
    active++;
    receive(req,res,async error => {
      try {
        if (error) throw Object.assign(new Error(),{status:error.code==="LIMIT_FILE_SIZE"?413:400});
        if (!req.file || !validSignature(req.file)) throw Object.assign(new Error(),{status:400});
        const analisis=await vision.analyze(pool,req.file,options);
        res.json({ok:true,analisis,sugerencia:analisis});
      } catch (error) {
        const status=error.status || 503;
        res.status(status).json({ok:false,message:status===413 ? "La fotografía no debe superar 8 MB." : status===400 ? "Adjunta una fotografía válida JPG, JPEG, PNG o WEBP en el campo archivo." : vision.fallback});
      } finally { active--; }
    });
  });
  return router;
};
