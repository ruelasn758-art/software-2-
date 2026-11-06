const PunoReporta = {
  textoSeguro(texto) {
    return String(texto).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  },
  colores: {
    Reportado: "#c45c26",
    "En proceso": "#e3b23c",
    Solucionado: "#1f7a4d",
  },
  lugares: [
    { nombre: "Plaza de Armas", lat: -15.8409, lng: -70.0219 },
    { nombre: "Parque Pino", lat: -15.8388, lng: -70.0264 },
    { nombre: "Catedral de Puno", lat: -15.8406, lng: -70.0215 },
    { nombre: "Mercado Laykakota", lat: -15.8438, lng: -70.0196 },
    { nombre: "Puerto de Puno", lat: -15.8324, lng: -70.013 },
    { nombre: "Malecón", lat: -15.8338, lng: -70.0136 },
    { nombre: "Estadio Enrique Torres", lat: -15.8489, lng: -70.021 },
    { nombre: "Terminal terrestre", lat: -15.8506, lng: -70.0256 },
    { nombre: "UNA Puno", lat: -15.8244, lng: -70.0161 },
    { nombre: "Mirador Kuntur Wasi", lat: -15.837, lng: -70.033 },
  ],
  mapaActivo: null,

  coloresCat: {
    Bache: "#6B7280",
    Basura: "#22A45A",
    Luminaria: "#E8A317",
    Fuga: "#1B4F8A",
  },

  pinIcon(color) {
    const tono = color || "#E8A317";
    return L.divIcon({
      className: "pin-wrap",
      html: `<div class="pin" style="background:${tono}"><i></i></div><div class="pin-pulse"></div>`,
      iconSize: [36, 46],
      iconAnchor: [18, 44],
      popupAnchor: [0, -40],
    });
  },

  mapaBase(id, zoom = 14) {
    const mapa = L.map(id, { zoomControl: true }).setView([window.PUNO.lat, window.PUNO.lng], zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
    }).addTo(mapa);
    setTimeout(() => mapa.invalidateSize(), 200);
    return mapa;
  },

  mapaInicio() {
    const el = document.getElementById("mapa-inicio");
    if (!el) return;
    const mapa = this.mapaBase("mapa-inicio");
    const capas = [];
    this.mapaActivo = { mapa, porCodigo: {} };

    fetch("/api/reportes")
      .then((r) => r.json())
      .then((reportes) => {
        reportes.forEach((item) => {
          const color = item.color || this.coloresCat[item.categoria] || this.colores[item.estado] || "#07344a";
          const marker = L.marker([item.lat, item.lng], { icon: this.pinIcon(color) }).addTo(mapa);
          const extra = item.referencia ? `<br><em>${this.textoSeguro(item.referencia)}</em>` : "";
          marker.bindPopup(
            `<strong>${item.codigo}</strong><br>${item.categoria} · ${item.estado}<br>${item.area}${extra}`
          );
          marker._estado = item.estado;
          marker._codigo = item.codigo;
          capas.push(marker);
          this.mapaActivo.porCodigo[item.codigo] = marker;
        });
      });

    document.querySelectorAll("[data-filtro]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const filtro = btn.dataset.filtro;
        document.querySelectorAll("[data-filtro]").forEach((b) => b.classList.remove("activo"));
        btn.classList.add("activo");
        capas.forEach((m) => {
          const ok = !filtro || m._estado === filtro;
          if (ok) {
            if (!mapa.hasLayer(m)) m.addTo(mapa);
          } else if (mapa.hasLayer(m)) {
            mapa.removeLayer(m);
          }
        });
      });
    });

    document.querySelectorAll("[data-pin]").forEach((nodo) => {
      nodo.addEventListener("mouseenter", () => {
        const m = this.mapaActivo.porCodigo[nodo.dataset.pin];
        if (!m) return;
        mapa.setView(m.getLatLng(), 16, { animate: true });
        m.openPopup();
      });
    });
  },

  mapaPunto(lat, lng, id) {
    if (!document.getElementById(id)) return;
    const mapa = this.mapaBase(id, 17);
    L.marker([lat, lng], { icon: this.pinIcon() }).addTo(mapa);
    mapa.setView([lat, lng], 17);
  },

  mapaFiltrado(opciones) {
    const id = opciones.id;
    const el = document.getElementById(id);
    if (!el) return;
    const mapa = this.mapaBase(id);
    this.mapaActivo = { mapa, porCodigo: {} };
    const params = new URLSearchParams();
    if (opciones.categoria) params.set("categoria", opciones.categoria);
    if (opciones.mios) params.set("mios", "1");
    const qs = params.toString();
    fetch("/api/reportes" + (qs ? `?${qs}` : ""))
      .then((r) => r.json())
      .then((reportes) => {
        reportes.forEach((item) => {
          const color = item.color || this.coloresCat[item.categoria] || "#1E7AE6";
          const marker = L.marker([item.lat, item.lng], { icon: this.pinIcon(color) }).addTo(mapa);
          const extra = item.referencia ? `<br><em>${this.textoSeguro(item.referencia)}</em>` : "";
          marker.bindPopup(
            `<strong>${item.codigo}</strong><br>${item.categoria} · ${item.estado}${extra}`
          );
          this.mapaActivo.porCodigo[item.codigo] = marker;
        });
        if (reportes.length === 1) {
          mapa.setView([reportes[0].lat, reportes[0].lng], 16);
        }
      });
    document.querySelectorAll("[data-pin]").forEach((nodo) => {
      nodo.addEventListener("mouseenter", () => {
        const m = this.mapaActivo.porCodigo[nodo.dataset.pin];
        if (!m) return;
        mapa.setView(m.getLatLng(), 16, { animate: true });
        m.openPopup();
      });
    });
  },

  iniciarReporte() {
    this.categoriasVivas();
    this.fotoPreview();
    this.contador();
    // Una descarga fallida del mapa no debe impedir analizar la fotografia.
    try { this.mapaRegistro(); }
    catch (error) {
      console.error("No se pudo iniciar el mapa", error);
      document.getElementById("coords-label").textContent = "No se pudo cargar el mapa. Recarga la página para ubicar el reporte.";
    }
  },

  categoriasVivas() {
    const hidden = document.getElementById("categoria_id");
    const hint = document.getElementById("area-hint");
    document.querySelectorAll(".cat-pick").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".cat-pick").forEach((b) => b.classList.remove("activo"));
        btn.classList.add("activo");
        hidden.value = btn.dataset.id;
        hint.textContent = `Se asignará a ${btn.dataset.area}.`;
        document.dispatchEvent(new CustomEvent("categoria-manual"));
      });
    });
  },

  fotoPreview() {
    const zona = document.getElementById("dropzone");
    const input = document.getElementById("foto");
    const preview = document.getElementById("foto-preview");
    if (!zona || !input) return;
    const analizador = window.ClasificadorFoto ? new window.ClasificadorFoto() : null;
    let versionFoto = 0;

    const mostrar = (file) => {
      const version = ++versionFoto;
      if (analizador) analizador.cancelar();
      if (!file) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
        if (analizador) analizador.mensaje("Selecciona una foto JPG, PNG o WEBP de hasta 10 MB.");
        preview.hidden = true;
        zona.classList.remove("con-foto");
        input.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (version !== versionFoto) return;
        preview.src = reader.result;
        preview.hidden = false;
        zona.classList.add("con-foto");
        if (analizador && document.getElementById("usar-ia")?.checked !== false) analizador.analizar(reader.result);
      };
      reader.onerror = () => {
        if (version === versionFoto && analizador) analizador.mensaje("No se pudo leer la foto. Elige otra imagen.");
      };
      reader.readAsDataURL(file);
    };

    input.addEventListener("change", () => mostrar(input.files[0]));
    zona.addEventListener("dragover", (e) => {
      e.preventDefault();
      zona.classList.add("sobre");
    });
    zona.addEventListener("dragleave", () => zona.classList.remove("sobre"));
    zona.addEventListener("drop", (e) => {
      e.preventDefault();
      zona.classList.remove("sobre");
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      mostrar(file);
    });
  },

  contador() {
    const area = document.getElementById("descripcion");
    const count = document.getElementById("desc-count");
    if (!area || !count) return;
    const sync = () => {
      count.textContent = area.value.length;
    };
    area.addEventListener("input", sync);
    sync();
  },

  mapaRegistro() {
    const el = document.getElementById("mapa-registro");
    if (!el) return;
    let mapa = null;
    try { mapa = this.mapaBase("mapa-registro", 15); }
    catch (error) {
      el.textContent = "El mapa no está disponible. Puedes usar el GPS para guardar las coordenadas.";
      console.error("Mapa no disponible", error);
    }
    const latInput = document.getElementById("lat");
    const lngInput = document.getElementById("lng");
    const label = document.getElementById("coords-label");
    const dirLabel = document.getElementById("dir-label");
    const dirInput = document.getElementById("direccion_mapa");
    const refInput = document.getElementById("referencia");
    const chips = document.getElementById("lugares-puno");
    const buscar = document.getElementById("buscar-lugar");
    const lista = document.getElementById("sugerencias");
    let marcador = null;
    let buscaTimer = null;
    let gpsWatch = null;
    let gpsSesion = 0;
    let direccionVersion = 0;
    let direccionTimer = null;
    let ultimaConsulta = 0;
    const detenerGPS = () => {
      gpsSesion++;
      if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
      gpsWatch = null;
    };

    this.lugares.forEach((lugar) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = lugar.nombre;
      chip.addEventListener("click", () => {
        document.querySelectorAll(".chip").forEach((c) => c.classList.remove("activo"));
        chip.classList.add("activo");
        pintar(lugar.lat, lugar.lng, lugar.nombre, true);
      });
      chips.appendChild(chip);
    });

    const pintar = (lat, lng, referencia, centrar = true, desdeGPS = false) => {
      if (!desdeGPS) detenerGPS();
      latInput.value = lat.toFixed(6);
      lngInput.value = lng.toFixed(6);
      label.textContent = "Pin colocado · puedes arrastrarlo";
      label.classList.add("ok");
      if (marcador) {
        marcador.setLatLng([lat, lng]);
      } else if (mapa) {
        marcador = L.marker([lat, lng], {
        icon: this.pinIcon(),
        draggable: true,
        autoPan: true,
      }).addTo(mapa);
      marcador.on("dragstart", detenerGPS);
      marcador.on("dragend", () => {
        detenerGPS();
        const p = marcador.getLatLng();
        latInput.value = p.lat.toFixed(6);
        lngInput.value = p.lng.toFixed(6);
        label.textContent = "Pin colocado · puedes arrastrarlo";
        reverse(p.lat, p.lng);
      });
      }
      if (centrar && mapa) mapa.setView([lat, lng], 17, { animate: true });
      if (referencia && refInput && !refInput.value) refInput.value = referencia;
      reverse(lat, lng, desdeGPS);
    };

    const reverse = (lat, lng, desdeGPS = false) => {
      const version = ++direccionVersion;
      clearTimeout(direccionTimer);
      const coordenadas = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      dirInput.value = coordenadas;
      dirLabel.textContent = coordenadas;
      // Limita la búsqueda de calles mientras el GPS actualiza el punto.
      const consultar = () => {
      ultimaConsulta = Date.now();
      dirLabel.textContent = "Leyendo la calle…";
      fetch(`/api/direccion?lat=${lat}&lng=${lng}`)
        .then((r) => {
          if (!r.ok) throw new Error("Dirección no disponible");
          return r.json();
        })
        .then((data) => {
          if (version !== direccionVersion) return;
          const texto = data.direccion || coordenadas;
          dirLabel.textContent = texto;
          dirInput.value = texto;
        })
        .catch(() => {
          if (version !== direccionVersion) return;
          dirLabel.textContent = coordenadas;
        });
      };
      const espera = desdeGPS ? Math.max(0, 10000 - (Date.now() - ultimaConsulta)) : 0;
      if (espera) direccionTimer = setTimeout(consultar, espera);
      else consultar();
    };

    if (latInput.value && lngInput.value) {
      pintar(parseFloat(latInput.value), parseFloat(lngInput.value), "", false);
    }

    if (mapa) mapa.on("click", (e) => pintar(e.latlng.lat, e.latlng.lng));

    const gps = document.getElementById("btn-gps");
    const iniciarGPS = () => {
        detenerGPS();
        label.classList.remove("ok");
        if (window.isSecureContext === false) {
          label.textContent = "Para usar tu ubicación, abre la aplicación con HTTPS o en localhost.";
          return;
        }
        if (!navigator.geolocation) {
          label.textContent = "Este navegador no permite GPS.";
          return;
        }
        label.textContent = "Buscando tu ubicación…";
        const sesion = gpsSesion;
        let primera = true;
        try {
        gpsWatch = navigator.geolocation.watchPosition(
          (pos) => {
            if (sesion !== gpsSesion) return;
            const { latitude, longitude, accuracy } = pos.coords;
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
            if (latInput.value !== latitude.toFixed(6) || lngInput.value !== longitude.toFixed(6) || primera) {
              pintar(latitude, longitude, "", primera, true);
            }
            primera = false;
            label.classList.add("ok");
            label.textContent = `Ubicación en tiempo real · precisión aproximada: ${Math.round(accuracy)} m · puedes ajustar el pin`;
          },
          (error) => {
            if (sesion !== gpsSesion) return;
            label.classList.remove("ok");
            const ultimo = marcador ? " Se conserva el último punto." : " Puedes marcar el punto en el mapa.";
            if (error.code === 1) {
              detenerGPS();
              label.textContent = "Ubicación bloqueada. Abre los permisos junto a la dirección de esta página, permite Ubicación y vuelve a pulsar Usar mi GPS. Activa también la ubicación del dispositivo." + ultimo;
            } else {
              label.textContent = "No se pudo actualizar tu ubicación. Comprueba la ubicación del dispositivo o pulsa Usar mi GPS." + ultimo;
            }
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
        } catch (error) {
          detenerGPS();
          label.textContent = "El navegador bloqueó la ubicación. Abre este enlace en Chrome o Edge y permite el acceso a Ubicación.";
        }
    };
    if (gps) gps.addEventListener("click", iniciarGPS);
    // Conserva el punto si el servidor devuelve el formulario con errores.
    if (!latInput.value || !lngInput.value) iniciarGPS();
    window.addEventListener("pagehide", () => {
      detenerGPS();
      clearTimeout(direccionTimer);
      direccionVersion++;
    });
    const form = el.closest("form");
    if (form) form.addEventListener("submit", detenerGPS);

    const pintarSugerencias = (items) => {
      lista.innerHTML = "";
      if (!items.length) {
        lista.hidden = true;
        return;
      }
      items.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item.nombre;
        li.addEventListener("click", () => {
          pintar(item.lat, item.lng, item.nombre.split(",")[0]);
          lista.hidden = true;
          buscar.value = item.nombre.split(",")[0];
        });
        lista.appendChild(li);
      });
      lista.hidden = false;
    };

    if (buscar) {
      buscar.addEventListener("input", () => {
        clearTimeout(buscaTimer);
        const q = buscar.value.trim();
        if (q.length < 3) {
          lista.hidden = true;
          return;
        }
        buscaTimer = setTimeout(() => {
          fetch(`/api/buscar-lugar?q=${encodeURIComponent(q)}`)
            .then((r) => r.json())
            .then(pintarSugerencias)
            .catch(() => {
              lista.hidden = true;
            });
        }, 280);
      });
    }

    document.addEventListener("click", (e) => {
      if (lista && !lista.contains(e.target) && e.target !== buscar) lista.hidden = true;
    });
  },
};

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".flash").forEach((el) => {
    setTimeout(() => el.classList.add("sale"), 4200);
  });
  document.querySelectorAll(".stat-btn span").forEach((el) => {
    const destino = Number(el.textContent);
    if (Number.isNaN(destino)) return;
    let n = 0;
    const paso = Math.max(1, Math.round(destino / 18));
    const tick = setInterval(() => {
      n += paso;
      if (n >= destino) {
        el.textContent = destino;
        clearInterval(tick);
      } else {
        el.textContent = n;
      }
    }, 30);
  });
});
