"use strict";
// Una única llamada real, explícita: consume cuota del proyecto Gemini. Nunca se ejecuta con npm test.
const fs=require("node:fs");const path=require("node:path");
const pool=require("../config/database");const vision=require("../services/vision");
const {diagnosticFetch,sanitize}=require("./vision-diagnostics.cjs");
(async()=>{
 const envFile=path.join(__dirname,"../.env.test");
 const parsed=require("dotenv").parse(fs.readFileSync(envFile));
 console.log(JSON.stringify({stage:"local_check",envFile,geminiKeyConfigured:vision.isConfigured(),
   keyMatchesEnvTest:Boolean(parsed.GEMINI_API_KEY)&&parsed.GEMINI_API_KEY===process.env.GEMINI_API_KEY,
   model:process.env.GEMINI_MODEL?.trim()||"gemini-2.5-flash-lite",database:pool.options.database,
   image:"assets/images/home/vias.jpg"},null,2));
 if(!vision.isConfigured()) { console.log("Prueba real pendiente: configura GEMINI_API_KEY en backend/.env.test.");return; }
 const analisis=await vision.analyze(pool,{mimetype:"image/jpeg",buffer:fs.readFileSync(path.join(__dirname,"../../assets/images/home/vias.jpg"))},{fetchImpl:diagnosticFetch()});
 console.log(JSON.stringify({ok:true,model:process.env.GEMINI_MODEL||"gemini-2.5-flash-lite",analisis},null,2));
})().catch(error=>{console.error(JSON.stringify(sanitize({stage:"analysis_failed",status:error.status??null,code:error.code??null,message:error.message}),null,2));process.exitCode=1;}).finally(()=>pool.end());
