// Inferencia dentro del navegador: ninguna foto se envia a Hugging Face.
const OPCIONES = [
  ["Bache", "a damaged road with potholes and broken pavement"],
  ["Basura", "a pile of garbage bags and litter dumped on a street"],
  ["Luminaria", "a damaged street light or a broken public lighting pole"],
  ["Fuga", "water leaking from a broken pipe and flooding a street"],
  [null, "a normal street with no visible damage or garbage"],
  [null, "a graphic logo with symbols and icons"],
  [null, "a drawing, cartoon or illustration"],
  [null, "a screenshot of a computer or phone screen"],
  [null, "a document or a page of text"],
  [null, "a person or an animal"],
  [null, "food or an indoor object"],
  [null, "a blurry or dark image with no recognizable objects"],
  [null, "a fire, a car accident or another kind of emergency"],
];
let modelo;
let pendiente;
let ocupado = false;
let actual;

async function cargar() {
  if (!modelo) {
    modelo = (async () => {
      const {pipeline, env} = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js");
      env.allowLocalModels = false;
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/";
      return pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch32", {
        quantized: true,
        progress_callback: evento => {
          if (actual && evento.status === "progress") {
            const avance = Number.isFinite(evento.progress) ? `${Math.round(evento.progress)}%` : `${Math.round((evento.loaded || 0) / 1048576)} MB`;
            self.postMessage({id: actual.id, tipo: "progreso", mensaje: `Preparando IA: descargando un componente (${avance}). La primera vez puede tardar varios minutos. Al terminar se analizará tu foto automáticamente. Puedes cambiar la categoría en cualquier momento.`});
          }
        },
      });
    })().catch(error => { modelo = null; throw error; });
  }
  return modelo;
}

self.onmessage = ({data}) => {
  pendiente = data;
  procesar();
};

async function procesar() {
  if (ocupado) return;
  ocupado = true;
  while (pendiente) {
    actual = pendiente;
    pendiente = null;
    const tarea = actual;
    try {
      const clasificador = await cargar();
      // Si se cambio la foto durante la descarga, analiza solo la mas reciente.
      if (pendiente) continue;
      self.postMessage({id: tarea.id, tipo: "progreso", mensaje: "Analizando el contenido de la foto…"});
      const resultados = await clasificador(tarea.imagen, OPCIONES.map(o => o[1]));
      resultados.sort((a, b) => b.score - a.score);
      const mejor = resultados[0];
      // Umbrales heuristicos de abstencion, no porcentajes de certeza calibrados.
      const clara = mejor.score >= 0.35 && mejor.score - resultados[1].score >= 0.10;
      const categoria = clara ? OPCIONES.find(o => o[1] === mejor.label)?.[0] : null;
      self.postMessage({id: tarea.id, tipo: "resultado", categoria: categoria || null});
    } catch (error) {
      console.error("Error del analisis de fotografia:", error);
      self.postMessage({id: tarea.id, tipo: "error"});
    }
  }
  ocupado = false;
}
