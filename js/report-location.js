"use strict";

// Una ubicación candidata y una confirmación explícita; no hay seguimiento.
globalThis.ReportLocation = class ReportLocation {
  constructor({ byId, onChange }) {
    this.byId = byId;
    this.onChange = onChange;
    this.state = Object.freeze({ latitude: null, longitude: null, accuracy: null, locationSource: null, locationConfirmed: false });
    this.pending = false;
    this.requestVersion = 0;
    this.mode = null;
    this.map = null;
    this.marker = null;
    byId("use-location").addEventListener("click", () => this.useGPS());
    byId("use-manual-location").addEventListener("click", () => this.useManual());
    byId("confirm-location").addEventListener("click", () => this.confirm());
    byId("change-location").addEventListener("click", () => this.change());
    byId("report-map").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target === byId("report-map") && this.map) {
        event.preventDefault();
        this.selectManual(this.map.getCenter());
      }
    });
    this.render();
  }

  getState() { return this.state; }

  showMap() {
    if (!this.map) {
      if (!globalThis.L) {
        this.byId("map-status").textContent = "No se pudo cargar el mapa. Comprueba tu conexión y recarga la página. La ubicación por GPS sigue disponible.";
        return;
      }
      this.map = L.map("report-map", { scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false }).setView([-15.8402, -70.0219], 13);
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(this.map);
      tiles.on("tileerror", () => {
        this.byId("map-status").textContent = "No se pudo cargar parte de la cartografía. Comprueba tu conexión antes de seleccionar el lugar.";
      });
      this.map.on("click", (event) => this.selectManual(event.latlng));
      this.updateMarker(true);
    }
    this.map.invalidateSize();
  }

  updateMarker(center = false) {
    if (!this.map) return;
    if (this.state.latitude === null) {
      if (this.marker) this.map.removeLayer(this.marker);
      this.marker = null;
      return;
    }
    const point = [this.state.latitude, this.state.longitude];
    if (this.marker) this.marker.setLatLng(point);
    else {
      this.marker = L.marker(point, { draggable: true, alt: "Lugar del problema", title: "Ubicación del reporte" }).addTo(this.map);
      this.marker.on?.("dragend", () => {
        if (this.state.locationConfirmed) return;
        this.requestVersion++; this.pending = false; this.mode = "manual";
        this.selectManual(this.marker.getLatLng());
      });
    }
    if (this.state.locationConfirmed) this.marker.dragging?.disable();
    else this.marker.dragging?.enable();
    if (center) this.map.setView(point, 17);
  }

  render() {
    const { latitude, longitude, accuracy, locationConfirmed } = this.state;
    this.byId("location-values").hidden = latitude === null;
    if (latitude !== null) {
      this.byId("latitude-value").textContent = String(latitude);
      this.byId("longitude-value").textContent = String(longitude);
      this.byId("accuracy-value").textContent = accuracy === null ? "No disponible para una ubicación manual" : `± ${Math.ceil(accuracy)} metros`;
    }
    this.byId("use-location").disabled = locationConfirmed || this.pending;
    this.byId("use-location").setAttribute("aria-busy", String(this.pending));
    this.byId("use-manual-location").disabled = locationConfirmed;
    this.byId("use-manual-location").setAttribute("aria-pressed", String(this.mode === "manual"));
    this.byId("confirm-location").disabled = latitude === null || this.pending || locationConfirmed;
    this.byId("confirm-location").hidden = locationConfirmed;
    this.byId("change-location").hidden = !locationConfirmed;
    this.byId("location-required").hidden = locationConfirmed;
  }

  start(mode) {
    this.requestVersion += 1;
    this.mode = mode;
    this.pending = false;
    this.state = Object.freeze({ latitude: null, longitude: null, accuracy: null, locationSource: null, locationConfirmed: false });
    this.updateMarker();
    this.render();
    this.onChange();
  }

  useManual() {
    if (this.state.locationConfirmed) return;
    this.start("manual");
    this.showMap();
    this.byId("location-status").textContent = "Toca o haz clic en el lugar del problema y después confirma la ubicación.";
    this.byId("report-map").focus();
  }

  selectManual(point) {
    if (this.mode !== "manual" || this.state.locationConfirmed) return;
    // Normaliza la longitud si el mapa se ha desplazado a otra copia del mundo.
    const longitude = ((point.lng + 180) % 360 + 360) % 360 - 180;
    this.state = Object.freeze({ ...IncidenceData.coordinates(point.lat, longitude, null, "manual"), locationConfirmed: false });
    this.updateMarker();
    this.render();
    this.onChange();
    this.byId("location-status").textContent = "Ubicación manual seleccionada. Confirma que el marcador señale el lugar del problema.";
  }

  useGPS() {
    if (this.state.locationConfirmed || this.pending) return;
    this.start("gps");
    this.showMap();
    if (!window.isSecureContext) {
      this.byId("location-status").textContent = "No podemos obtener automáticamente tu ubicación en esta conexión. Puedes seleccionarla manualmente en el mapa.";
      return;
    }
    if (!navigator.geolocation) {
      this.byId("location-status").textContent = "No se pudo acceder a tu ubicación. Selecciona el lugar manualmente en el mapa.";
      return;
    }
    const version = this.requestVersion;
    this.pending = true;
    this.render();
    this.byId("location-status").textContent = "Esperando el permiso y una lectura de ubicación…";
    const fail = (error) => {
      if (version !== this.requestVersion || this.state.locationConfirmed) return;
      this.pending = false;
      this.render();
      this.byId("location-status").textContent = error.code === 1
        ? "No se pudo acceder a tu ubicación. Selecciona el lugar manualmente en el mapa."
        : "No pudimos obtener tu ubicación. Inténtalo nuevamente o selecciónala manualmente.";
    };
    try {
      navigator.geolocation.getCurrentPosition((position) => {
        if (version !== this.requestVersion || this.state.locationConfirmed) return;
        try {
          const { latitude, longitude, accuracy } = position.coords;
          this.state = Object.freeze({ ...IncidenceData.coordinates(latitude, longitude, accuracy, "gps"), locationConfirmed: false });
          this.pending = false;
          this.updateMarker(true);
          this.render();
          this.onChange();
          this.byId("location-status").textContent = "Ubicación detectada correctamente.";
        } catch { fail({ code: 2 }); }
      }, fail, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
    } catch { fail({ code: 2 }); }
  }

  confirm() {
    if (this.pending || this.state.latitude === null || this.state.locationConfirmed) return;
    this.requestVersion += 1;
    this.state = Object.freeze({ ...this.state, locationConfirmed: true });
    this.updateMarker();
    this.render();
    this.onChange();
    this.byId("location-status").textContent = "Ubicación del problema confirmada. Se conservará aunque te desplaces. Usa «Cambiar ubicación» si necesitas corregirla.";
    this.byId("change-location").focus();
  }

  change() {
    if (!this.state.locationConfirmed) return;
    this.requestVersion += 1;
    this.state = Object.freeze({ ...this.state, locationConfirmed: false });
    this.mode = this.state.locationSource;
    this.updateMarker();
    this.render();
    this.onChange();
    this.byId("location-status").textContent = "Elige GPS o selección manual para corregir el lugar y vuelve a confirmar la ubicación.";
    this.byId("use-location").focus();
  }

  reset() {
    this.start(null);
    if (this.map) this.map.setView([-15.8402, -70.0219], 13);
    this.byId("location-status").textContent = "Todavía no has seleccionado una ubicación.";
  }

  dispose() {
    this.requestVersion += 1;
    this.pending = false;
    if (this.map) this.map.remove();
    this.map = null;
    this.marker = null;
    this.state = Object.freeze({ latitude: null, longitude: null, accuracy: null, locationSource: null, locationConfirmed: false });
  }
};
