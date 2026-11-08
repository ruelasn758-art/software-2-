"use strict";
const { createHash } = require("node:crypto");

// Reintentos durante esta ejecución del backend. No sustituye persistencia duradera.
module.exports = function reportIdempotency() {
  const requests = new Map();
  return async (req, res, next) => {
    const supplied = req.get("Idempotency-Key");
    if (!supplied) return next();
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(supplied)) return res.status(400).json({ ok:false, message:"Identificador de envío no válido." });
    const key = `${req.user.id_usuario}:${supplied}`;
    const now = Date.now();
    for (const [k, entry] of requests) if (entry.done && now-entry.created > 12*60*60*1000) requests.delete(k);
    const hash = createHash("sha256").update(JSON.stringify(req.body)).digest("hex");
    const previous = requests.get(key);
    if (previous) {
      if (previous.hash !== hash) return res.status(409).json({ ok:false, message:"Este envío ya se inició con otros datos. Reintenta con los datos originales." });
      const result = await previous.promise;
      return res.status(result.status).json(result.body);
    }
    if (requests.size >= 2000) return res.status(503).json({ ok:false,message:"Hay muchos envíos en curso. Inténtalo más tarde." });
    let resolve;
    const entry = { hash, created:now, done:false, promise:new Promise(r => { resolve=r; }) };
    requests.set(key,entry);
    const original = res.json.bind(res);
    res.json = body => {
      entry.done = true;
      resolve({status:res.statusCode,body});
      if (res.statusCode >= 400) requests.delete(key);
      return original(body);
    };
    next();
  };
};
