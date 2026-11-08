"use strict";

globalThis.ReportAssistance = class ReportAssistance {
  constructor({ byId, onChange }) {
    this.byId=byId; this.onChange=onChange; this.destinations=[]; this.recommended=null;
    this.version=0; this.analysisVersion=0; this.category=null;
    byId("destination").addEventListener("change", () => { if(this.analyzing) this.cancelAnalysis(); this.renderSelection(); });
    byId("restore-destination").addEventListener("click", () => {
      if (this.recommended) byId("destination").value=String(this.recommended);
      this.renderSelection();
    });
    byId("retry-destinations").addEventListener("click", () => this.load(this.category));
  }
  selected() { return this.destinations.find(d => String(d.id_area)===this.byId("destination").value) || null; }
  label(row) { return row ? `${row.entidad} — ${row.area}` : "Se asignará al identificar el problema"; }
  renderSelection() {
    this.byId("destination-description").textContent=this.selected()?.descripcion || "";
    this.byId("restore-destination").hidden=!this.recommended || String(this.recommended)===this.byId("destination").value;
    this.onChange();
  }
  async load(category) {
    const version=++this.version;
    const previous=category===this.category ? this.byId("destination").value : "";
    this.category=category;
    this.destinations=[]; this.recommended=null;
    const select=this.byId("destination"); select.disabled=true; select.value="";
    this.byId("destination-status").textContent="Cargando destinos disponibles…";
    this.byId("restore-destination").disabled=true;
    this.byId("retry-destinations").hidden=true;
    this.onChange();
    try {
      const response=await fetch(`http://127.0.0.1:3001/api/destinos${category ? `?categoria=${encodeURIComponent(category)}` : ""}`, {signal:AbortSignal.timeout(7000)});
      const result=await response.json();
      if (!response.ok || !Array.isArray(result.destinos) || result.destinos.some(d => !/^[1-9]\d*$/.test(String(d.id_area)) || typeof d.entidad!=="string" || typeof d.area!=="string")) throw new Error();
      if (version!==this.version) return;
      this.destinations=result.destinos;
      this.recommended=result.id_area_recomendada;
      select.replaceChildren();
      const blank=document.createElement("option"); blank.value=""; blank.textContent="Selecciona el destino"; select.append(blank);
      result.destinos.forEach(d => { const option=document.createElement("option"); option.value=String(d.id_area); option.textContent=this.label(d); option.setAttribute("data-description",d.descripcion || ""); option.setAttribute("data-recommended",String(String(d.id_area)===String(this.recommended))); select.append(option); });
      select.value=this.destinations.some(d=>String(d.id_area)===previous) ? previous : this.recommended ? String(this.recommended) : "";
      select.disabled=!this.destinations.length;
      this.byId("entity").textContent=this.recommended ? `Recomendación: ${this.label(this.destinations.find(d=>String(d.id_area)===String(this.recommended)))}` : "Selecciona el destino al que deseas enviar tu reporte.";
      this.byId("restore-destination").disabled=!this.recommended;
      this.byId("destination-status").textContent=this.destinations.length ? "" : "No hay destinos habilitados. Inténtalo más tarde.";
    } catch {
      if (version!==this.version) return;
      this.byId("retry-destinations").hidden=false;
      this.byId("entity").textContent="No se pudo obtener una recomendación.";
      this.byId("destination-status").textContent="No pudimos cargar los destinos. Tus datos se conservan; pulsa Actualizar destinos.";
    }
    this.renderSelection();
  }
  cancelAnalysis() {
    this.analysisVersion++;
    this.byId("ai-result").hidden=true;
    this.byId("change-identification").hidden=true;
    this.byId("ai-status").textContent="Puedes seleccionar la categoría manualmente o analizar tu fotografía.";
  }
  preparePhoto(available) {
    this.cancelAnalysis();
    this.byId("retry-analysis").hidden=!available;
    this.byId("retry-analysis").disabled=Boolean(this.analyzing);
    this.byId("ai-status").textContent=available ? "Fotografía lista. Puedes analizarla o identificar el problema manualmente." : "Sube una fotografía para identificar el problema.";
  }
  async analyze(file, apply) {
    if (this.analyzing) return;
    this.analyzing=true;
    const version=++this.analysisVersion;
    this.byId("retry-analysis").disabled=true;
    this.byId("ai-result").hidden=true;
    this.byId("change-identification").hidden=true;
    this.byId("ai-status").textContent="Analizando fotografía…";
    this.onChange();
    try {
      const data=new FormData(); data.append("archivo",file);
      const response=await fetch("http://127.0.0.1:3001/api/ia/analizar-incidencia", {method:"POST",body:data,signal:AbortSignal.timeout(35000)});
      const result=await response.json();
      if (version!==this.analysisVersion) return;
      const suggestion=result.analisis;
      if (!response.ok || !result.ok || !suggestion || typeof suggestion.categoria!=="string" || typeof suggestion.descripcion!=="string") throw new Error();
      await apply(suggestion, () => version===this.analysisVersion);
      if (version!==this.analysisVersion) return;
      this.byId("ai-original-type").textContent=suggestion.tipo || "Tipo no identificado";
      this.byId("ai-original-category").textContent=suggestion.categoria;
      this.byId("ai-original-area").textContent=suggestion.area_responsable || "Selecciona un destino disponible";
      this.byId("ai-original-description").textContent=suggestion.descripcion;
      this.byId("ai-result").hidden=false;
      this.byId("change-identification").hidden=false;
      this.byId("ai-status").textContent="Esta es nuestra recomendación. Revisa la categoría, el tipo y la descripción; puedes cambiarlos.";
    } catch {
      if (version!==this.analysisVersion) return;
      this.byId("ai-status").textContent="No pudimos identificar automáticamente el problema. Puedes seleccionarlo manualmente.";
    } finally {
      this.analyzing=false;
      this.byId("retry-analysis").disabled=false;
      this.onChange();
    }
  }
};
