// Solo para pruebas unitarias de controladores; auth.test usa cookies reales.
module.exports={origin:(req,res,next)=>next(),requireSession:(req,res,next)=>{req.user={id_usuario:'1',rol:'CIUDADANO'};next();},allow:()=>((req,res,next)=>next()),logout:(req,res)=>res.json({ok:true}),issue:()=>{}};
