/* Sugerencias locales; la categoria final siempre la decide el ciudadano. */
window.ClasificadorFoto = class {
  constructor() {
    this.worker = null;
    this.version = 0;
    this.manual = 0;
    this.automatica = false;
    this.timer = null;
    this.imagen = null;
    this.estado = document.getElementById("foto-analisis");
    this.cambiar = document.getElementById("cambiar-categoria");
    this.categoria = document.getElementById("categoria_id");
    this.reintentar = document.getElementById("reintentar-analisis");
    this.reintentar?.addEventListener("click", () => {
      if (this.imagen) this.analizar(this.imagen);
    });
    this.botones = [...document.querySelectorAll(".cat-pick")];
    document.addEventListener("categoria-manual", () => {
      this.manual++;
      this.automatica = false;
      const boton = this.botones.find(b => b.dataset.id === this.categoria.value);
      this.mensaje(`Categoría elegida: ${boton.dataset.categoria}. Se guardará tu elección.`);
    });
    this.cambiar.addEventListener("click", () => {
      this.manual++;
      this.mensaje("Selecciona la categoría correcta en los botones de arriba.");
      document.getElementById("cat-grid").scrollIntoView({behavior: "smooth", block: "center"});
      (this.botones.find(b => b.dataset.id === this.categoria.value) || this.botones[0]).focus({preventScroll: true});
    });
    const detener = () => {
      this.version++;
      clearTimeout(this.timer);
      if (this.worker) this.worker.terminate();
      this.worker = null;
    };
    document.querySelector(".report-form").addEventListener("submit", detener);
    window.addEventListener("pagehide", detener);
  }

  mensaje(texto) { this.estado.textContent = texto; }

  cancelar() {
    this.version++;
    clearTimeout(this.timer);
    this.imagen = null;
    if (this.reintentar) this.reintentar.hidden = true;
    this.cambiar.hidden = true;
    if (this.automatica) {
      this.categoria.value = "";
      this.botones.forEach(b => b.classList.remove("activo"));
      document.getElementById("area-hint").textContent = "El área responsable aparece al elegir categoría.";
    }
    this.automatica = false;
    this.mensaje("Al subir una foto, se sugerirá el tipo de incidencia. Puedes cambiar la categoría si no es correcta.");
  }

  analizar(imagen) {
    clearTimeout(this.timer);
    this.imagen = imagen;
    if (this.reintentar) this.reintentar.hidden = true;
    const id = ++this.version;
    const manual = this.manual;
    this.mensaje("Preparando el análisis de la foto… La primera vez se descarga el modelo de IA y puede tardar; puedes elegir una categoría manualmente.");
    this.cambiar.hidden = false;
    const vigente = () => id === this.version && manual === this.manual;
    const fallo = () => {
      clearTimeout(this.timer);
      if (id !== this.version) return;
      if (this.worker) this.worker.terminate();
      this.worker = null;
      if (this.reintentar) this.reintentar.hidden = false;
      if (vigente()) this.mensaje("No se pudo analizar la foto en este dispositivo. Elige la categoría manualmente para continuar.");
    };
    try {
      if (!this.worker) this.worker = new Worker("/static/js/foto-worker.js?v=20261027", {type: "module"});
      this.worker.onerror = fallo;
      this.worker.onmessage = ({data}) => {
        if (data.id !== id || id !== this.version) return;
        if (data.tipo === "progreso") {
          clearTimeout(this.timer);
          this.timer = setTimeout(fallo, 300000);
          if (vigente()) this.mensaje(data.mensaje);
          return;
        }
        clearTimeout(this.timer);
        if (!vigente()) return;
        if (data.tipo === "error") { fallo(); return; }
        const boton = this.botones.find(b => b.dataset.categoria === data.categoria);
        if (!boton) {
          this.mensaje("No pude identificar con claridad una de las cuatro incidencias. Selecciona la categoría que corresponda.");
          return;
        }
        this.botones.forEach(b => b.classList.toggle("activo", b === boton));
        this.categoria.value = boton.dataset.id;
        this.automatica = true;
        document.getElementById("area-hint").textContent = `Se asignará a ${boton.dataset.area}.`;
        this.mensaje(`Posible incidencia detectada: ${data.categoria}. Se seleccionó automáticamente. Si no es correcta, pulsa Cambiar categoría. La foto por sí sola no confirma la falla ni su gravedad.`);
      };
      this.timer = setTimeout(fallo, 300000);
      this.worker.postMessage({id, imagen});
    } catch { fallo(); }
  }
};
