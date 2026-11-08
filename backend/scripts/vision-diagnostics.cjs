"use strict";
// Solo para el ejecutable de diagnóstico; las rutas públicas no importan este módulo.
function sanitize(value, env = process.env) {
  const secrets=Object.entries(env).filter(([key,val])=>val && /KEY|TOKEN|PASSWORD|SECRET|^DB_USER$|^DB_HOST$/i.test(key)).map(([,val])=>String(val)).sort((a,b)=>b.length-a.length);
  function clean(item) {
    if (typeof item === "string") {
      for(const secret of secrets) item=item.split(secret).join("[REDACTADO]");
      return item.replace(/AIza[\w-]+/g,"[REDACTADO]").replace(/([?&](?:key|api_key)=)[^&\s]+/gi,"$1[REDACTADO]").replace(/[A-Za-z0-9+/]{200,}={0,2}/g,"[DATOS OMITIDOS]");
    }
    if(Array.isArray(item)) return item.map(clean);
    if(item && typeof item==="object") return Object.fromEntries(Object.entries(item).map(([key,val])=>[key,/^(?:authorization|x-goog-api-key|api_?key|password|credentials|inlineData|data|contents|image|image_url)$/i.test(key)?"[REDACTADO]":clean(val)]));
    return item;
  }
  return clean(value);
}
function diagnosticFetch({fetchImpl=fetch,emit=value=>console.error(JSON.stringify(value,null,2)),env=process.env}={}) {
  const log=value=>emit(sanitize(value,env));
  return async (url,options) => {
    const request=JSON.parse(options.body);
    const model=decodeURIComponent(new URL(url).pathname.split('/models/')[1]?.replace(/:generateContent$/,''));
    const inline=request.contents?.[0]?.parts?.find(p=>p.inlineData)?.inlineData;
    log({stage:"gemini_request",model,url,method:options.method,apiKeyHeaderPresent:Boolean(options.headers['x-goog-api-key']),
      imageMimeType:inline?.mimeType,imageBytes:inline?Buffer.from(inline.data,'base64').length:0,
      responseMimeType:request.generationConfig?.responseMimeType,responseJsonSchema:request.generationConfig?.responseJsonSchema,
      usesOpenAIFormat:Boolean(request.input || request.text || request.max_output_tokens)});
    try {
      const response=await fetchImpl(url,options);
      if(!response.ok) {
        const raw=await response.clone().text();let body;try{body=JSON.parse(raw);}catch{body=raw;}
        log({stage:"gemini_error",model,httpCode:response.status,httpStatus:response.statusText,
          status:body?.error?.status ?? null,message:body?.error?.message ?? null,body});
      } else {
        const body=await response.clone().json().catch(()=>null);
        log({stage:"gemini_response",model,httpCode:response.status,httpStatus:response.statusText,
          finishReasons:body?.candidates?.map(c=>c.finishReason),blockReason:body?.promptFeedback?.blockReason ?? null});
      }
      return response;
    } catch(error) {
      log({stage:"gemini_transport_error",model,httpCode:null,status:error.name,message:error.message,
        cause:error.cause?{code:error.cause.code,message:error.cause.message}:null});
      throw error;
    }
  };
}
module.exports={sanitize,diagnosticFetch};
