"use strict";

// Vista de solo lectura de la copia del reporte; nunca solicita geolocalización.
globalThis.ReportDetail = class ReportDetail {
  constructor(byId, showSolution = true) {
    this.byId = byId;
    this.showSolution = showSolution;
    this.solutionUrl = null;
    this.map = null;
    this.photoUrl = null;

  }

  close() {
    if (this.map) this.map.remove();
    this.map = null;
    if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
    this.photoUrl = null;
    this.byId("detail-photo").removeAttribute("src");
    if (this.solutionUrl) URL.revokeObjectURL(this.solutionUrl);
    this.solutionUrl = null;
  }

  show(report) {
    this.close();
    this.currentReport = report;
    const put = (id, value) => { this.byId(id).textContent = value; };
    put("detail-code", report.code);
    put("detail-category", report.categoryLabel);
    if (this.byId("detail-type")) put("detail-type", report.typeLabel || "Sin especificar");
    put("detail-status", report.status);
    this.byId("detail-status").setAttribute("data-status",report.status);
    put("detail-entity", report.entity);
    put("detail-date", new Intl.DateTimeFormat("es-PE", {
      dateStyle: "medium", timeStyle: "short", timeZone: "America/Lima",
    }).format(new Date(report.createdAt)));
    this.byId("detail-date").setAttribute("datetime", report.createdAt);
    this.byId("detail-description-block").hidden = !report.description;
    put("detail-description", report.description);
    this.photoUrl = !report.photo ? "" : typeof report.photo === "string" ? report.photo : URL.createObjectURL(report.photo);
    this.byId("detail-photo").src = this.photoUrl;
    this.byId("detail-photo").hidden = !report.photo;
    this.byId("detail-photo").onerror = () => {
      this.byId("detail-photo").hidden = true;
      if (this.byId("detail-photo-status")) this.byId("detail-photo-status").textContent = "La fotografía registrada no está disponible.";
    };
    if (this.byId("detail-photo-status")) this.byId("detail-photo-status").textContent = report.photo ? "" : "Este reporte no tiene fotografía disponible.";
    if (this.showSolution) {
      this.byId("detail-solution").hidden = report.status !== "Solucionado" || !report.solutionPhoto;
      this.byId("detail-solution-photo").removeAttribute("src");
      if (report.status === "Solucionado" && report.solutionPhoto) {
        this.solutionUrl = typeof report.solutionPhoto === "string" ? report.solutionPhoto : URL.createObjectURL(report.solutionPhoto);
        this.byId("detail-solution-photo").src = this.solutionUrl;
        put("detail-solution-note", report.solutionNote || "");
        this.byId("detail-solution-note").hidden = !report.solutionNote;
        put("detail-solution-date", new Date(report.solvedAt).toLocaleString("es-PE"));
        this.byId("detail-solution-date").setAttribute("datetime", report.solvedAt);
      }
    }
    const states = ["Reportado", "En proceso", "Solucionado"];
    const history=Array.isArray(report.history)?report.history:[];
    const historyBlock=this.byId("detail-history-block"), historyList=this.byId("detail-history");
    if(historyBlock) historyBlock.hidden=!history.length;
    if(historyList) historyList.replaceChildren();
    if(historyList) history.forEach(entry=>{
      const item=document.createElement("li"),label=document.createElement("strong"),date=document.createElement("time"),note=document.createElement("p");
      label.textContent=entry.estado||"Sin especificar";
      date.textContent=Number.isFinite(Date.parse(entry.fecha_cambio))?new Date(entry.fecha_cambio).toLocaleString("es-PE",{timeZone:"America/Lima"}):"Fecha sin especificar";
      note.textContent=entry.observacion||"";
      item.append(label,date,note);historyList.append(item);
    });
    const current = states.indexOf(report.status);
    states.forEach((state, index) => {
      const step = this.byId(`detail-progress-${index}`);
      step.setAttribute("data-active", String(index <= current));
      if (index === current) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    const { latitude, longitude } = report.location || {};
    put("detail-latitude", String(latitude));
    put("detail-longitude", String(longitude));
    put("detail-map-status", "");
    if (!Number.isFinite(latitude)||!Number.isFinite(longitude)) {
      put("detail-latitude","Sin especificar");put("detail-longitude","Sin especificar");
      put("detail-map-status","Ubicación sin especificar.");return;
    }
    if (!globalThis.L) {
      put("detail-map-status", "No se pudo cargar el mapa. Puedes consultar las coordenadas del reporte.");
      return;
    }
    this.map = L.map(this.byId("detail-map"), { scrollWheelZoom: false, zoomAnimation:false,fadeAnimation:false }).setView([latitude, longitude], 16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.map).on("tileerror", () => {
      put("detail-map-status", "No se pudo cargar parte del mapa. Las coordenadas guardadas siguen disponibles.");
    });
    L.marker([latitude, longitude], { draggable: false, alt: "Ubicación del incidente", title: "Ubicación confirmada del reporte" }).addTo(this.map);
    this.map.invalidateSize();
  }
};
