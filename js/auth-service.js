"use strict";
globalThis.PunoAuth=(()=>{
  // Un único host en desarrollo evita mezclar cookies de localhost y 127.0.0.1.
  if(window.location.hostname==='localhost' && window.location.port==='4174'){
    const canonical=new URL(window.location.href);canonical.hostname='127.0.0.1';window.location.replace(canonical.href);
  }
  const base='http://127.0.0.1:3001/api';
  let current=null;
  const nativeFetch=globalThis.fetch.bind(globalThis);
  // Cookies solo para nuestra API, nunca para proveedores externos.
  globalThis.fetch=(resource,options={})=>{
    const url=typeof resource==='string' ? resource : resource.url;
    return nativeFetch(resource,url?.startsWith(base+'/') ? {...options,credentials:'include'} : options);
  };
  function clearCache(){
    current=null;
    try{sessionStorage.removeItem('puno-reporta-demo-session');
      for(const key of Object.keys(localStorage))if(key.startsWith('puno-reporta-reports-'))localStorage.removeItem(key);
    }catch{}
  }
  async function request(path,body){
    const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    const result=await response.json();
    if(!response.ok)throw Object.assign(Error(result.message||'No se pudo conectar con el servidor.'),{status:response.status});
    return result;
  }
  async function getSession(){
    try{const result=await request('/auth/me');current={isAuthenticated:true,usuario:result.usuario};return current;}
    catch(error){current=null;if(error.status===401||error.status===403)return null;throw error;}
  }
  async function authenticate(path,body){clearCache();const result=await request(path,body);current={isAuthenticated:true,usuario:result.usuario};return current;}
  function destination(){return current?.usuario.rol==='ADMIN'?'dashboard-admin.html':current?.usuario.rol==='ENTIDAD'?'nueva-incidencia.html#entidad':'nueva-incidencia.html#inicio';}
  async function logout(){await request('/auth/logout',{});clearCache();window.location.replace('iniciar-sesion.html');}
  async function requireSession(){
    try{const session=await getSession();if(session)return session;}catch{}
    window.location.replace('iniciar-sesion.html');return null;
  }
  return Object.freeze({getSession,requireSession,signIn:body=>authenticate('/auth/login',body),signUp:body=>authenticate('/auth/register',body),destination,logout,get current(){return current;}});
})();
