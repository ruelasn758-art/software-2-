"use strict";

// Caché separada por usuario; la API aplica la autorización real.
globalThis.ReportStore = (() => {
  const key = () => PunoAuth.current?.usuario ? `puno-reporta-reports-user-${PunoAuth.current.usuario.id_usuario}` : null;
  const citizenId = "ciudadano-local";
  const reports = [];
  let loadError = null;
  let remoteRequest = null;
  const apiOrigin = "http://127.0.0.1:3001";
  function fileUrl(file) {
    const route = file?.ruta_archivo;
    return typeof route === "string" && route.startsWith("/uploads/") && !route.includes("..") ? apiOrigin + route : "";
  }
  function fromApi(row) {
    const files = row.archivos || [];
    const photo = files.find(f => f.tipo_archivo === "INCIDENCIA");
    const solution = files.find(f => f.tipo_archivo === "SOLUCION");
    const category = String(row.categoria).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return { id: `api-${row.id_reporte}`, id_reporte: row.id_reporte, citizenId,
      code: row.codigo, codigo: row.codigo, id_categoria: row.id_categoria,
      category: category.startsWith("agua") ? "agua" : category, categoryLabel: row.categoria,
      id_tipo_incidencia: row.id_tipo_incidencia, typeLabel: row.tipo_incidencia,
      description: row.descripcion || "", status: row.estado, createdAt: row.fecha_registro,
      entity: row.area_responsable || "", id_area_responsable: row.id_area_responsable,
      photo: fileUrl(photo), archivo: photo, archivos: files,
      history: Array.isArray(row.historial) ? row.historial : [],
      location: { latitude: row.latitud, longitude: row.longitud, accuracy: row.precision_metros,
        locationSource: row.origen_ubicacion?.toLowerCase(), locationConfirmed: true },
      solutionPhoto: fileUrl(solution), solutionNote: solution?.descripcion || "", solvedAt: solution?.fecha_registro || null };
  }
  async function refreshReports() {
    if (remoteRequest) return remoteRequest;
    remoteRequest = (async () => {
      try {
        const response = await fetch(`${apiOrigin}/api/reportes`, { signal: AbortSignal.timeout(10000) });
        if(response.status===401||response.status===403){reports.length=0;throw new Error('ACCESS');}
        if (!response.ok) throw new Error();
        const rows = await response.json();
        if (!Array.isArray(rows) || rows.some(r => String(r.id_usuario) !== String(PunoAuth.current?.usuario.id_usuario) || !r.id_reporte || !r.codigo)) throw new Error();
        reports.splice(0, reports.length, ...rows.map(fromApi));
        let message = "";
        try { saveReports(); } catch { message = "Reportes actualizados. No se pudo guardar la caché en este navegador."; }
        return { ok: true, message };
      } catch {
        return { ok: false, message: reports.length
          ? "No se pudo conectar con el servidor. Se muestra el respaldo local, que puede estar desactualizado."
          : "No se pudieron cargar tus reportes. Comprueba la conexión e inténtalo nuevamente." };
      } finally { remoteRequest = null; }
    })();
    return remoteRequest;
  }
  function loadReports() {
    try {
      const parsed = JSON.parse(key() ? localStorage.getItem(key()) || "[]" : "[]");
      if (!Array.isArray(parsed) || parsed.some(r => !r.id || !r.code || !r.location || !["Reportado", "En proceso", "Solucionado"].includes(r.status))) throw new Error();
      const current = new Map(reports.map(r => [r.id, r]));
      reports.splice(0, reports.length, ...parsed.map(r => Object.assign(current.get(r.id) || {}, r)));
      loadError = null;
    } catch { loadError = "No se pudieron cargar los reportes guardados. No se sobrescribirán los datos existentes."; }
    return reports;
  }
  function saveReports(next = reports) {
    if (loadError) throw new Error(loadError);
    try { if(!key())throw Error('SESSION');localStorage.setItem(key(), JSON.stringify(next)); }
    catch { throw new Error("No se pudo guardar el reporte en este navegador. Puede faltar espacio; prueba con una foto más pequeña. Tus datos anteriores se conservan."); }
  }
  function photoData(photo) {
    if (typeof photo === "string" && photo.startsWith("data:image/")) return Promise.resolve(photo);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("No se pudo preparar la fotografía para guardarla."));
      reader.readAsDataURL(photo);
    });
  }
  async function createReport(input) {
    const photo = await photoData(input.photo);
    const number = reports.reduce((max, r) => Math.max(max, Number(r.code.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
    const report = { ...input, id: `local-${Date.now()}-${number}`, citizenId,
      code: `PR-${String(number).padStart(5, "0")}`, photo, status: "Reportado", createdAt: new Date().toISOString(),
      latitude: input.location.latitude, longitude: input.location.longitude, locationSource: input.location.locationSource,
      solutionPhoto: null, solutionNote: "", solvedAt: null };
    saveReports([...reports, report]);
    reports.push(report);
    return report;
  }
  async function updateReport(id, changes) {
    const report = getReportById(id);
    if (!report) throw new Error("No se encontró el reporte.");
    const previous = report.status;
    const valid = previous === "Reportado" && changes.status === "En proceso" || previous === "En proceso" && changes.status === "Solucionado";
    if (!valid) throw new Error("No se permite este cambio de estado.");
    const patch = { status: changes.status };
    if (changes.status === "Solucionado") {
      if (!changes.solutionPhoto) throw new Error("Debes adjuntar una fotografía de solución.");
      patch.solutionPhoto = await photoData(changes.solutionPhoto);
      patch.solutionNote = (changes.solutionNote || "").trim();
      patch.solvedAt = new Date().toISOString();
    }
    if (report.status !== previous) throw new Error("El estado cambió. Vuelve a abrir el reporte.");
    saveReports(reports.map(r => r === report ? { ...r, ...patch } : r));
    Object.assign(report, patch);
    return report;
  }
  // Respaldo de un registro ya confirmado por PostgreSQL; nunca genera otro código.
  async function cacheRemoteReport(input, receipt) {
    const report = { ...input, id: `api-${receipt.id_reporte}`, id_reporte: receipt.id_reporte,
      code: receipt.codigo, codigo: receipt.codigo, id_area_responsable: receipt.id_area_responsable,
      citizenId, status: receipt.estado, createdAt: new Date().toISOString(),
      solutionPhoto: null, solutionNote: "", solvedAt: null };
    let warning = "";
    try { report.photo = await photoData(input.photo); }
    catch { warning = "El reporte se registró, pero no se pudo conservar la foto localmente."; }
    reports.push(report);
    if (!warning) {
      try { saveReports(); }
      catch { warning = "El reporte se registró en PostgreSQL, pero no se pudo guardar el respaldo en este navegador."; }
    }
    return { report, warning };
  }
  function getReportById(id) { return reports.find(r => r.id === id); }
  loadReports();
  return { reports, citizenId, fromApi, loadReports, refreshReports, saveReports, createReport, cacheRemoteReport, updateReport, getReportById, getError: () => loadError };
})();
