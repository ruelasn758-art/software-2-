"use strict";
(async()=>{
  const session=await PunoAuth.requireSession();if(!session)return;
  if(session.usuario.rol!=='ADMIN'){window.location.replace(PunoAuth.destination());return;}
  document.getElementById('admin-name').textContent=session.usuario.nombre;
  document.body.style.visibility='';
  document.getElementById('admin-logout').addEventListener('click',()=>PunoAuth.logout().catch(()=>{document.getElementById('admin-status').textContent='No se pudo cerrar la sesión. Inténtalo nuevamente.';}));
  window.addEventListener('pagehide',()=>{document.body.style.visibility='hidden';});
  window.addEventListener('pageshow',event=>{if(event.persisted)window.location.reload();});
})();
