"use strict";

// Recibe el mismo arreglo que utiliza Mis reportes; no almacena copias.
globalThis.CitizenDashboard = class CitizenDashboard {
  constructor({ byId, openDetail }) {
    this.byId = byId;
    this.openDetail = openDetail;
    this.photoUrls = [];
    this.map = null;
    byId("dashboard-empty-create").addEventListener("click", () => byId("dashboard-create").click());
  }

  close() {
    if (this.map) this.map.remove();
    this.map = null;
    this.photoUrls.forEach((url) => URL.revokeObjectURL(url));
    this.photoUrls = [];
    this.byId("dashboard-recent").replaceChildren();
    this.byId("dashboard-activity").replaceChildren();
  }

  render(reports) {
    this.close();
    const counts = { Reportado: 0, "En proceso": 0, Solucionado: 0 };
    reports.forEach((report) => { if (Object.hasOwn(counts, report.status)) counts[report.status] += 1; });
    this.byId("dashboard-total").textContent = String(reports.length);
    this.byId("dashboard-reported").textContent = String(counts.Reportado);
    this.byId("dashboard-progress").textContent = String(counts["En proceso"]);
    this.byId("dashboard-solved").textContent = String(counts.Solucionado);
    this.byId("dashboard-empty").hidden = reports.length > 0;
    const recent = [...reports].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5);
    const dateFormat = new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Lima" });
    recent.forEach((report) => {
      const row = document.createElement("li");
      row.className = "dashboard-report";
      const image = document.createElement("img");
      const photoUrl = !report.photo ? "" : typeof report.photo === "string" ? report.photo : URL.createObjectURL(report.photo);
      this.photoUrls.push(photoUrl);
      image.src = photoUrl;
      image.hidden = !report.photo;
      image.addEventListener("error", () => { image.hidden = true; });
      image.alt = `Fotografía del reporte ${report.code}`;
      image.width = 72;
      image.height = 72;
      const info = document.createElement("div");
      const code = document.createElement("strong");
      code.textContent = report.code;
      const category = document.createElement("p");
      category.textContent = report.categoryLabel;
      const date = document.createElement("time");
      date.setAttribute("datetime", report.createdAt);
      date.textContent = dateFormat.format(new Date(report.createdAt));
      info.append(code, category, date);
      if (report.typeLabel) {
        const type = document.createElement("p");
        type.className = "dashboard-type";
        type.textContent = report.typeLabel;
        info.append(type);
      }
      const description = document.createElement("p");
      description.className = "dashboard-description";
      description.textContent = report.description?.trim() || "Sin descripción";
      info.append(description);
      const entity = document.createElement("p");
      entity.className = "dashboard-entity";
      entity.textContent = report.entity;
      const status = document.createElement("span");
      status.className = "dashboard-status";
      status.setAttribute("data-status", report.status);
      status.textContent = report.status;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button-secondary";
      button.textContent = "Ver detalle";
      button.setAttribute("aria-label", `Ver detalle del reporte ${report.code}`);
      button.addEventListener("click", () => this.openDetail(report));
      row.append(image, info, entity, status, button);
      this.byId("dashboard-recent").append(row);
    });
    const activity = recent.filter(report => Number.isFinite(Date.parse(report.createdAt))).slice(0, 4);
    this.byId("dashboard-activity-panel").hidden = activity.length === 0;
    activity.forEach(report => {
      const item = document.createElement("li");
      const label = document.createElement("p");
      label.textContent = `Reporte ${report.code} registrado`;
      const date = document.createElement("time");
      date.setAttribute("datetime", report.createdAt);
      date.textContent = dateFormat.format(new Date(report.createdAt));
      item.append(label, date);
      this.byId("dashboard-activity").append(item);
    });
    this.renderMap(reports);
  }

  renderMap(reports) {
    const status = this.byId("dashboard-map-status");
    const container = this.byId("dashboard-map");
    const located = reports.filter(report => {
      const point = report.location;
      return point && typeof point.latitude === "number" && typeof point.longitude === "number" &&
        Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
        Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
    });
    container.hidden = true;
    if (!located.length) { status.textContent = "No hay reportes con ubicación disponible para mostrar."; return; }
    if (!globalThis.L) { status.textContent = "No se pudo cargar el mapa. Puedes consultar las coordenadas en Ver detalle."; return; }
    try {
      container.hidden = false;
      status.textContent = `${located.length} reportes con ubicación registrada. Selecciona un marcador para consultar su detalle.`;
      const first = located[0].location;
      this.map = L.map(container, { scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([first.latitude, first.longitude], 13);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(this.map).on("tileerror", () => {
        status.textContent = "No se pudo cargar parte del mapa. Las ubicaciones registradas siguen disponibles en el detalle.";
      });
      located.forEach(report => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "text-button";
        button.textContent = `${report.code} · ${report.status} · Ver detalle`;
        button.addEventListener("click", () => this.openDetail(report));
        const marker = L.marker([report.location.latitude, report.location.longitude], { draggable: false, title: report.code, alt: `Reporte ${report.code}` }).addTo(this.map);
        if (marker.bindPopup) marker.bindPopup(button);
      });
      if (this.map.fitBounds) this.map.fitBounds(located.map(r => [r.location.latitude, r.location.longitude]), { padding: [25,25], maxZoom: 15, animate: false });
      this.map.invalidateSize();
    } catch {
      if (this.map) this.map.remove();
      this.map = null;
      container.hidden = true;
      status.textContent = "No se pudo mostrar el mapa. Consulta las ubicaciones desde Ver detalle.";
    }
  }
};
