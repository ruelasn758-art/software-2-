"use strict";

(async () => {
  document.body.style.visibility='hidden';
  const session=await PunoAuth.requireSession();
  if(!session)return;
  if(session.usuario.rol==='ADMIN'){window.location.replace(PunoAuth.destination());return;}
  document.body.style.visibility='';
  ReportStore.loadReports();
  document.querySelector('.citizen-account-label').textContent=session.usuario.nombre;
  const logout=document.createElement('button');logout.type='button';logout.className='text-button';logout.textContent='Cerrar sesión';
  logout.addEventListener('click',()=>PunoAuth.logout().catch(()=>alert('No se pudo cerrar la sesión. Inténtalo nuevamente.')));
  document.querySelector('.header-content').append(logout);
  window.addEventListener('pagehide',()=>{document.body.style.visibility='hidden';});
  window.addEventListener('pageshow',async(event)=>{if(event.persisted){const verified=await PunoAuth.requireSession();if(verified)window.location.reload();}});
  // API aislada: no se utiliza la base principal ni como respaldo.
  const apiBase = "http://127.0.0.1:3001/api";
  const byId = (id) => document.getElementById(id);
  const form = byId("incidence-form");
  const category = byId("category");
  const description = byId("description");
  const photoInputs = [byId("photo-file"), byId("photo-camera")];
  const preview = byId("photo-preview");
  const photoImage = byId("photo-image");
  const photoStatus = byId("photo-status");
  const review = byId("report-review");
  const reportMessage = byId("report-message");
  let photo = null;
  let photoUrl = null;
  let photoVersion = 0;
  let photoPending = false;
  let generatedDescription = "";
  let aiIdentification = false;
  let submittedReport = null;
  // Conserva el registro ya creado para reintentar SOLO su fotografía.
  let pendingUpload = null;
  let requestKey = null;
  let uncertainPost = false;
  let assistance;
  const reports = ReportStore.reports;
  let submitting = false;
  let currentScreen = "form";
  const detailView = new ReportDetail(byId);
  let detailTrigger = null;
  const entityDashboard = new EntityDashboard({ byId, reports: reports, exit: ()=>logout.click() });
  byId('entity-exit').textContent='Cerrar sesión';
  function openEntity(key) {
    if(session.usuario.rol!=='ENTIDAD')return;
    if (!entityDashboard.setArea(key)) return;
    showScreen("entity");
    return entityDashboard.showList();
  }
  byId("open-entity-demo").hidden=true;
  byId("open-cleaning-demo").hidden=true;
  window.addEventListener("hashchange", () => {
    const key = window.location.hash.replace("#entidad-", "");
    if (Object.hasOwn(EntityAreas, key)) return openEntity(key);
  });
  const dashboard = new CitizenDashboard({ byId, openDetail: (report) => {
    detailTrigger = byId("my-reports-title");
    showScreen("detail");
    detailView.show(report);
    byId("detail-title").focus();
  } });
  let currentStep = 0;
  const incidenceMap = new IncidenceMap({byId,refresh:()=>showDashboard(true),openDetail:report=>{
    detailTrigger=byId("rf-map-link");showScreen("detail");detailView.show(report);byId("detail-title").focus();
  }});
  let locationPicker;
  const categoryKeys = Object.keys(IncidenceRouting.categoryRouting);
  const fallbackNames = { vias: "Vías", limpieza: "Limpieza", alumbrado: "Alumbrado", agua: "Agua" };
  let availableCategories = categoryKeys.map(key => ({ key, id_categoria: null, nombre: fallbackNames[key] }));
  let receivedCategories = [];
  let categorySource = "fallback";
  let categoryRequest = 0;
  let types = [];
  let typeRequest = 0;
  const typeSelect = byId("incidence-type");
  function selectedType() { return types.find(item => String(item.id_tipo_incidencia) === typeSelect.value); }
  function resetTypes() {
    typeRequest += 1;
    types = [];
    typeSelect.value = "";
    typeSelect.disabled = true;
    typeSelect.replaceChildren();
    const option = document.createElement("option"); option.value = ""; option.textContent = "No necesito precisar el tipo";
    typeSelect.append(option);
  }
  async function loadTypes() {
    resetTypes();
    const request = typeRequest;
    const selected = selectedCategory();
    byId("retry-types").hidden = true;
    updateValidation();
    if (!selected?.id_categoria) {
      byId("type-status").textContent = "Conecta con el servidor para cargar los tipos de incidencia.";
      byId("retry-types").hidden = false;
      return;
    }
    byId("type-status").textContent = "Cargando tipos de incidencia…";
    try {
      const response = await fetch(`${apiBase}/tipos-incidencia?categoria=${encodeURIComponent(selected.id_categoria)}`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error();
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.some(row => !/^[1-9]\d*$/.test(String(row.id_tipo_incidencia)) || typeof row.nombre !== "string")) throw new Error();
      if (request !== typeRequest) return;
      types = rows;
      rows.forEach(row => {
        const option = document.createElement("option"); option.value = String(row.id_tipo_incidencia); option.textContent = row.nombre; typeSelect.append(option);
      });
      typeSelect.disabled = !rows.length;
      byId("type-status").textContent = rows.length ? "Puedes especificar el tipo o dejarlo vacío." : "No hay tipos activos para esta categoría. Puedes continuar sin especificarlo.";
      byId("retry-types").hidden = rows.length > 0;
    } catch {
      if (request !== typeRequest) return;
      byId("type-status").textContent = "No se pudieron cargar los tipos. Tus datos se conservan; inténtalo nuevamente.";
      byId("retry-types").hidden = false;
    }
    updateValidation();
  }
  typeSelect.addEventListener("change", () => {
    assistance.cancelAnalysis(); aiIdentification=false;
    console.log("[PUNO REPORTA] Tipo seleccionado", selectedType());
    invalidateReview();
  });
  byId("retry-types").addEventListener("click", async () => {
    if (!selectedCategory()?.id_categoria) await loadCategories();
    else await loadTypes();
  });

  function selectedCategory() {
    const selected = availableCategories.find(item => item.key === category.value);
    return selected ? { id_categoria: selected.id_categoria, nombre: selected.nombre } : null;
  }

  async function loadCategories() {
    const request = ++categoryRequest;
    const aliases = { vias: "vias", limpieza: "limpieza", alumbrado: "alumbrado", agua: "agua", "agua / saneamiento": "agua", "agua/saneamiento": "agua" };
    try {
      const response = await fetch(`${apiBase}/categorias`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error("Respuesta de categorías no válida");
      const normalized = rows.map(row => {
        const name = typeof row.nombre === "string" ? row.nombre.trim() : "";
        const key = aliases[name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()];
        const validId = typeof row.id_categoria === "string"
          ? /^[1-9]\d*$/.test(row.id_categoria)
          : Number.isSafeInteger(row.id_categoria) && row.id_categoria > 0;
        if (!key || !validId) throw new Error("Categoría no compatible con el formulario actual");
        return { key, id_categoria: row.id_categoria, nombre: row.nombre };
      });
      if (new Set(normalized.map(item => item.key)).size !== normalized.length || new Set(normalized.map(item => String(item.id_categoria))).size !== normalized.length) throw new Error("Categorías duplicadas");
      if (request !== categoryRequest) return;
      receivedCategories = rows.map(row => ({ ...row }));
      availableCategories = normalized;
      categorySource = "api";
    } catch {
      if (request !== categoryRequest) return;
      receivedCategories = [];
      availableCategories = categoryKeys.map(key => ({ key, id_categoria: null, nombre: fallbackNames[key] }));
      categorySource = "fallback";
    }
    categoryKeys.forEach(key => {
      const item = availableCategories.find(entry => entry.key === key);
      const button = byId(`choose-${key}`);
      const option = category.querySelector(`option[value="${key}"]`);
      button.hidden = !item;
      button.disabled = !item;
      option.disabled = !item;
      option.hidden = !item;
      button.querySelector("strong").textContent = item?.nombre || fallbackNames[key];
      option.textContent = item?.nombre || fallbackNames[key];
      button.setAttribute("data-id-categoria", item?.id_categoria ?? "");
    });
    if (!availableCategories.some(item => item.key === category.value)) category.value = "";
    categoryKeys.forEach(key => byId(`choose-${key}`).setAttribute("aria-pressed", String(category.value === key)));
    category.setAttribute("data-source", categorySource);
    updateValidation();
    if (selectedCategory()) byId("review-category").textContent = selectedCategory().nombre;
    if (category.value) await loadTypes();
  }

  // Inspección de desarrollo sin exponer referencias mutables del formulario.
  window.PunoCategories = Object.freeze({
    loadCategories,
    getReceived: () => receivedCategories.map(row => ({ ...row })),
    getSelected: selectedCategory,
    getSource: () => categorySource,
    getSelectedType: () => selectedType() ? { ...selectedType() } : null,
    loadTypes,
  });
  const validation = { categoryConfirmed: false, photoConfirmed: false, locationConfirmed: false };
  const requiredMessages = [
    "Debes seleccionar una categoría para registrar el reporte.",
    "Debes adjuntar una fotografía del incidente para continuar.",
    "Debes confirmar la ubicación del incidente para continuar.",
    "Debes seleccionar un destino habilitado para enviar el reporte.",
  ];

  function renderDraft() {
    const location = locationPicker?.getState();
    byId("review-category").textContent = selectedCategory()?.nombre || "Por identificar";
    byId("review-type").textContent = selectedType()?.nombre || selectedCategory()?.nombre || "Por identificar";
    byId("review-photo").textContent = photo?.name || "Sin fotografía";
    byId("review-photo-image").hidden = !photo;
    if (photo && photoUrl) byId("review-photo-image").src = photoUrl;
    else byId("review-photo-image").removeAttribute("src");
    byId("review-description-row").hidden = !description.value.trim();
    byId("review-description").textContent = description.value.trim();
    byId("review-entity").textContent = assistance?.label(assistance.selected()) || "Se asignará al identificar el problema";
    byId("review-location").textContent = location?.locationConfirmed
      ? `${location.latitude}, ${location.longitude}\n${location.locationSource === "gps" ? `GPS · Precisión ± ${Math.ceil(location.accuracy)} m` : "Selección manual"}`
      : "Pendiente de confirmar";
    review.hidden = false;
  }

  async function applySuggestion(suggestion, isCurrent) {
    const item = availableCategories.find(c => String(c.id_categoria) === String(suggestion.id_categoria));
    if (!item || !isCurrent()) throw new Error("Categoría no disponible");
    category.value = item.key;
    aiIdentification=true;
    categoryKeys.forEach(key => byId(`choose-${key}`).setAttribute("aria-pressed", String(key === item.key)));
    await Promise.all([loadTypes(), assistance.load(item.id_categoria)]);
    if (!isCurrent()) return;
    typeSelect.value = types.some(t => String(t.id_tipo_incidencia) === String(suggestion.id_tipo_incidencia)) ? String(suggestion.id_tipo_incidencia) : "";
    if (typeof suggestion.descripcion === "string" && (!description.value.trim() || description.value===generatedDescription)) {
      generatedDescription=suggestion.descripcion.slice(0,300);
      description.value=generatedDescription;
    }
    aiIdentification=true;
    invalidateReview();
  }

  function updateValidation() {
    validation.categoryConfirmed = Boolean(selectedCategory()?.id_categoria);
    const selected = selectedCategory();
    category.setAttribute("data-id-categoria", selected?.id_categoria ?? "");
    category.setAttribute("data-nombre", selected?.nombre ?? "");
    validation.photoConfirmed = photo !== null && !photoPending;
    validation.locationConfirmed = locationPicker?.getState().locationConfirmed === true;
    const typeValid = !typeSelect.value || Boolean(selectedType());
    const confirmed = [validation.categoryConfirmed && typeValid, validation.photoConfirmed, validation.locationConfirmed, Boolean(assistance?.selected())];
    byId("next-step").disabled = currentStep < 3 && !confirmed[currentStep];
    byId("send-report").disabled = submitting || Boolean(assistance?.analyzing) || !confirmed.every(Boolean);
    byId("send-report").textContent = pendingUpload ? "Reintentar subir foto" : "Enviar reporte";
    byId("previous-step").disabled = submitting || Boolean(pendingUpload);
    byId("edit-report").disabled = submitting || Boolean(pendingUpload);
    byId("photo-required").hidden = validation.photoConfirmed;
    byId("report-input-fields").disabled = submitting || Boolean(pendingUpload) || uncertainPost;
    renderDraft();
    return confirmed;
  }

  function showStep(step, focus = true) {
    if (pendingUpload && step !== 3) return;
    currentStep = Math.max(0, Math.min(3, step));
    for (let index = 0; index < 4; index += 1) {
      byId(`step-${index}`).hidden = false;
      if (index === currentStep) byId(`progress-${index}`).setAttribute("aria-current", "step");
      else byId(`progress-${index}`).removeAttribute("aria-current");
    }
    byId("previous-step").hidden = true;
    byId("next-step").hidden = true;
    byId("review-report").hidden = true;
    byId("send-report").hidden = false;
    byId("step-status").textContent = `Paso ${currentStep + 1} de 4`;
    updateValidation();
    locationPicker?.showMap();
    if (focus) byId(`step-title-${currentStep}`).focus();
  }

  function showScreen(screen) {
    if(session.usuario.rol==='ENTIDAD' && screen!=='entity')return;
    if(session.usuario.rol==='CIUDADANO' && screen==='entity')return;
    currentScreen = screen;
    byId("citizen-shell").setAttribute("data-screen", screen);
    if (screen !== "entity") entityDashboard.close();
    byId("entity-dashboard").hidden = screen !== "entity";
    dashboard.close();
    incidenceMap.close();
    byId("incidence-map-view").hidden=screen!=="map";
    if (screen !== "detail") detailView.close();
    const isForm = screen === "form";
    form.hidden = !isForm;
    byId("incidence-heading").hidden = !isForm;
    byId("step-progress").hidden = !isForm;
    byId("step-status").hidden = !isForm;
    byId("report-confirmation").hidden = screen !== "confirmation";
    byId("my-reports").hidden = screen !== "reports";
    byId("report-detail").hidden = screen !== "detail";
    byId("citizen-dashboard").hidden = screen !== "dashboard";
    const activeNav = screen === "dashboard" ? "citizen-home" : screen === "map" ? "rf-map-link" : screen === "form" || screen === "confirmation" ? "citizen-report" : "citizen-reports";
    ["citizen-home", "citizen-report", "citizen-reports", "rf-map-link"].forEach((id) => {
      if (id === activeNav) byId(id).setAttribute("aria-current", "page");
      else byId(id).removeAttribute("aria-current");
    });
  }

  async function showDashboard(mapOnly = false) {
    const screen = mapOnly === true ? "map" : "dashboard";
    showScreen(screen);
    if(screen === "map") {
      byId("map-data-status").textContent="Cargando reportes…";
      byId("map-refresh").disabled=true;
      const result=await ReportStore.refreshReports();
      byId("map-refresh").disabled=false;
      if(currentScreen!=="map")return;
      incidenceMap.setReports(result.ok?reports.filter(r=>r.citizenId===ReportStore.citizenId):[]);
      byId("map-data-status").textContent=result.ok?result.message:"No pudimos consultar los reportes actuales. Comprueba tu conexión y pulsa Actualizar.";
      byId("incidence-map-title").focus();return;
    }
    byId("dashboard-data-status").textContent = "Cargando reportes…";
    byId("dashboard-empty").hidden = true;
    const result = await ReportStore.refreshReports();
    if (currentScreen !== screen) return;
    dashboard.render(reports.filter(report => report.citizenId === ReportStore.citizenId));
    byId("dashboard-data-status").textContent = result.message;
    if (!result.ok) byId("dashboard-empty").hidden = true;
    if (screen === "map") {
      byId("dashboard-map-title").setAttribute("tabindex", "-1");
      byId("dashboard-map-title").focus();
    } else byId("dashboard-title").focus();
  }

  function openForm() {
    if (submittedReport) createAnotherReport();
    else { showScreen("form"); showStep(currentStep); }
  }
  byId("citizen-home").addEventListener("click", showDashboard);
  byId("rf-map-link").addEventListener("click", () => showDashboard(true));
  byId("citizen-report").addEventListener("click", openForm);
  byId("dashboard-create").addEventListener("click", openForm);
  byId("citizen-reports").addEventListener("click", showReports);
  byId("dashboard-view-all").addEventListener("click", showReports);
  byId("dashboard-retry").addEventListener("click", showDashboard);
  byId("reports-retry").addEventListener("click", showReports);

  function createAnotherReport() {
    if (pendingUpload || submitting) { showScreen("form"); showStep(3); return; }
    submittedReport = null;
    requestKey = null;
    uncertainPost = false;
    form.reset();
    category.value = "";
    resetTypes();
    byId("type-status").textContent = "";
    description.value = "";
    clearPhoto();
    byId("photo-status").textContent = "";
    byId("review-photo-image").removeAttribute("src");
    categoryKeys.forEach((key) => byId(`choose-${key}`).setAttribute("aria-pressed", "false"));
    locationPicker.reset();
    void assistance.load(null);
    showScreen("form");
    showStep(0);
  }

  byId("create-another-report").addEventListener("click", createAnotherReport);
  byId("create-report-from-list").addEventListener("click", createAnotherReport);
  byId("view-my-reports").addEventListener("click", showReports);
  const myReports = new MyReports({byId, openDetail: (report, button) => {
    detailTrigger = button; showScreen("detail"); detailView.show(report); byId("detail-title").focus();
  }});
  async function showReports() {
    showScreen("reports");
    const list = byId("temporary-report-list");
    list.replaceChildren();
    byId("reports-data-status").textContent = "Cargando reportes…";
    const result = await ReportStore.refreshReports();
    if (currentScreen !== "reports") return;
    byId("reports-data-status").textContent = result.message || (reports.length ? "" : "Aún no tienes reportes. Crea tu primera incidencia para comenzar.");
    myReports.setReports(reports.filter(report => report.citizenId === ReportStore.citizenId));
    showScreen("reports");
    byId("my-reports-title").focus();
  }

  byId("detail-back").addEventListener("click", async () => {
    await showReports();
    detailTrigger?.focus();
  });

  function nextStep() {
    const confirmed = updateValidation();
    const missingStep = confirmed.findIndex((value, index) => index <= currentStep && !value);
    if (missingStep !== -1) {
      showStep(missingStep);
      reportMessage.textContent = requiredMessages[missingStep];
      return;
    }
    if (currentStep === 2) {
      const report = collectReport();
      if (!report) return;
      showStep(3);
      showReview(report, false, false);
      return;
    }
    showStep(currentStep + 1);
  }

  categoryKeys.forEach((key) => {
    byId(`choose-${key}`).addEventListener("click", async () => {
      if (!availableCategories.some(item => item.key === key)) return;
      category.value = key;
      aiIdentification=false;
      assistance.cancelAnalysis();
      categoryKeys.forEach((item) => byId(`choose-${item}`).setAttribute("aria-pressed", String(item === key)));
      invalidateReview();
      console.log("[PUNO REPORTA] Categoría seleccionada", selectedCategory());
      await Promise.all([loadTypes(), assistance.load(selectedCategory()?.id_categoria)]);
    });
  });
  category.addEventListener("change", () => {
    if(categoryKeys.includes(category.value)) byId(`choose-${category.value}`).click();
    else { resetTypes(); void assistance.load(null); invalidateReview(); }
  });
  byId("next-step").addEventListener("click", nextStep);
  byId("previous-step").addEventListener("click", () => showStep(currentStep - 1));

  function invalidateReview() {
    updateValidation();
    review.hidden = false;
    reportMessage.textContent = submittedReport
      ? "Hay cambios posteriores a la copia de prueba. Revisa el reporte de nuevo; no se ha enviado nada."
      : "";
  }

  function clearPhoto() {
    assistance?.preparePhoto(false);
    if (generatedDescription && description.value===generatedDescription) description.value="";
    generatedDescription="";
    if (aiIdentification) {
      category.value=""; resetTypes();
      categoryKeys.forEach(key=>byId(`choose-${key}`).setAttribute("aria-pressed","false"));
      void assistance.load(null); aiIdentification=false;
    }
    photoVersion += 1;
    photoPending = false;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = null;
    photo = null;
    preview.hidden = true;
    photoImage.removeAttribute("src");
    byId("photo-name").textContent = "";
    photoInputs.forEach((input) => { input.value = ""; });
    invalidateReview();
  }

  function selectPhoto(event) {
    if (submitting || pendingUpload || uncertainPost) return;
    const file = event.target.files[0];
    if (!file) return; // Cancelar el selector conserva la foto anterior.
    clearPhoto();
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || !/\.(jpe?g|png|webp)$/i.test(file.name) || file.size > 8 * 1024 * 1024) {
      photoStatus.textContent = "Selecciona una imagen JPG, JPEG, PNG o WEBP de hasta 8 MB.";
      return;
    }
    photoPending = true;
    photoStatus.textContent = "Preparando la previsualización…";
    const version = photoVersion;
    const candidateUrl = URL.createObjectURL(file);
    photoUrl = candidateUrl;
    const candidate = new Image();
    candidate.onload = () => {
      if (version !== photoVersion) return;
      photo = file;
      photoPending = false;
      photoImage.src = candidateUrl;
      byId("photo-name").textContent = file.name;
      preview.hidden = false;
      photoStatus.textContent = "Foto preparada para enviarla con el reporte.";
      updateValidation();
      assistance.preparePhoto(true);
    };
    candidate.onerror = () => {
      if (version !== photoVersion) return;
      clearPhoto();
      photoStatus.textContent = "El navegador no puede abrir esta imagen. Prueba con otra foto en JPEG o PNG.";
    };
    candidate.src = candidateUrl;
  }

  byId("choose-photo").addEventListener("click", () => photoInputs[0].click());
  byId("take-photo").addEventListener("click", () => photoInputs[1].click());
  byId("retry-analysis").addEventListener("click", () => { if (photo && !submitting && !pendingUpload && !uncertainPost) return assistance.analyze(photo, applySuggestion); });
  byId("change-identification").addEventListener("click", () => {
    byId("correct-information").hidden=false;
    byId("choose-vias").focus();
  });
  byId("photo-drop-zone").addEventListener("dragover", event => { event.preventDefault(); });
  byId("photo-drop-zone").addEventListener("drop", event => {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) selectPhoto({ target: { files: event.dataTransfer.files } });
  });
  photoInputs.forEach((input) => input.addEventListener("change", selectPhoto));
  byId("remove-photo").addEventListener("click", () => {
    clearPhoto();
    photoStatus.textContent = "Foto retirada.";
    byId("choose-photo").focus();
  });

  function collectReport() {
    if (pendingUpload) return pendingUpload.report;
    const location = locationPicker.getState();
    const missingStep = updateValidation().findIndex((value) => !value);
    if (missingStep !== -1) {
      showStep(missingStep);
      reportMessage.textContent = requiredMessages[missingStep];
      return null;
    }
    if (!form.checkValidity()) {
      showStep(2);
      form.reportValidity();
      return null;
    }
    if (locationPicker.pending || photoPending || assistance.analyzing) {
      reportMessage.textContent = "Espera a que termine la lectura de ubicación o la carga de la foto antes de continuar.";
      return null;
    }
    return { ...IncidenceData.snapshot({ category: category.value, description: description.value, photo, location, ...validation }),
      entity: assistance.label(assistance.selected()) };
  }

  function showReview(report, isSubmission, focus = true) {
    byId("review-type").textContent = selectedType()?.nombre || selectedCategory()?.nombre || "Por identificar";
    byId("review-category").textContent = category.selectedOptions[0].textContent;
    byId("review-photo").textContent = report.photo ? report.photo.name : "Sin fotografía";
    byId("review-photo-image").hidden = !report.photo;
    if (report.photo && photoUrl) byId("review-photo-image").src = photoUrl;
    else byId("review-photo-image").removeAttribute("src");
    byId("review-description-row").hidden = !report.description;
    byId("review-description").textContent = report.description;
    byId("review-entity").textContent = report.entity;
    byId("review-location").textContent = report.location
      ? `Latitud: ${report.location.latitude}\nLongitud: ${report.location.longitude}\nPrecisión aproximada: ${report.location.accuracy === null ? "no disponible (manual)" : `± ${Math.ceil(report.location.accuracy)} metros`}`
      : "Sin ubicación seleccionada";
    byId("review-note").textContent = isSubmission
      ? "Reporte de prueba guardado en este navegador. No se ha enviado a ninguna entidad real."
      : "Comprueba los datos antes de continuar. Puedes volver a editarlos; no se ha enviado nada.";
    review.hidden = false;
    if (focus) {
      showStep(3, false);
      byId("review-title").focus();
    }
  }

  byId("review-report").addEventListener("click", () => {
    const report = collectReport();
    if (report) showReview(report, false);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submittedReport || submitting) return;
    const report = collectReport();
    if (!report) return;
    submitting = true;
    byId("report-fields").disabled = true;
    byId("send-report").disabled = true;
    try {
      const selected = selectedCategory();
      const type = selectedType();
      const payload = {
        id_usuario: session.usuario.id_usuario, id_categoria: selected.id_categoria, id_tipo_incidencia: type?.id_tipo_incidencia ?? null,
        descripcion: report.description, latitud: report.location.latitude, longitud: report.location.longitude,
        origen_ubicacion: report.location.locationSource === "gps" ? "GPS" : "MANUAL",
        precision_metros: report.location.accuracy,
        id_area_destino: assistance.selected().id_area,
      };
      if (!pendingUpload) {
        console.log("[PUNO REPORTA] Ubicación", payload.latitud, payload.longitud);
        console.log("[PUNO REPORTA] JSON enviado", payload);
        const response = await fetch(`${apiBase}/reportes`, {
          method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey ||= globalThis.crypto?.randomUUID?.() || `report-${Date.now()}-${Math.random().toString(16).slice(2)}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
        });
        const result = await response.json();
        console.log("[PUNO REPORTA] Respuesta del backend", result);
        if (!response.ok || result.ok !== true) {
          uncertainPost = false;
          throw new Error(result.message || "El servidor no pudo registrar el reporte.");
        }
        const receipt = result.reporte;
        if (!receipt?.id_reporte || !receipt.codigo || receipt.estado !== "Reportado") throw new Error("El servidor devolvió una confirmación incompleta. Comprueba el registro antes de reenviar.");
        pendingUpload = { receipt, report, selected, payload };
        uncertainPost = false;
        console.log("[PUNO REPORTA] id_reporte creado", receipt.id_reporte);
      }
      const { receipt, report: savedReport, selected: savedCategory, payload: savedPayload } = pendingUpload;
      const formData = new FormData();
      formData.append("archivo", savedReport.photo);
      formData.append("tipo_archivo", "INCIDENCIA");
      console.log("[PUNO REPORTA] Archivo enviado", savedReport.photo.name);
      const uploadResponse = await fetch(`${apiBase}/reportes/${receipt.id_reporte}/archivos`, {
        method: "POST", body: formData, signal: AbortSignal.timeout(30000),
      });
      const uploaded = await uploadResponse.json();
      console.log("[PUNO REPORTA] Respuesta de archivos", uploaded);
      if (!uploadResponse.ok || uploaded.ok !== true || !uploaded.archivo?.ruta_archivo) {
        throw new Error(uploaded.message || "No se pudo subir la fotografía.");
      }
      // Desde este punto el reporte YA existe: un fallo del respaldo no debe provocar otro POST.
      submittedReport = { ...savedReport, archivo: uploaded.archivo, id_reporte: receipt.id_reporte, code: receipt.codigo, status: receipt.estado,
        categoryLabel: savedCategory.nombre, createdAt: new Date().toISOString() };
      pendingUpload = null;
      try {
        const cached = await ReportStore.cacheRemoteReport({ ...savedReport, archivo: uploaded.archivo, categoryLabel: savedCategory.nombre,
          id_categoria: savedPayload.id_categoria, id_tipo_incidencia: savedPayload.id_tipo_incidencia }, receipt);
        submittedReport = cached.report;
        byId("confirmation-warning").textContent = cached.warning;
      } catch {
        byId("confirmation-warning").textContent = "El reporte se registró, pero no pudo guardarse el respaldo local. Conserva su código.";
      }
    } catch (error) {
      if (!pendingUpload && ["TypeError","TimeoutError","SyntaxError"].includes(error.name)) uncertainPost = true;
      reportMessage.textContent = pendingUpload
        ? `El reporte ${pendingUpload.receipt.codigo} (ID ${pendingUpload.receipt.id_reporte}) está creado, pero no pudimos confirmar la subida de la foto. ${error.name === "Error" ? error.message : "Comprueba tu conexión."} Pulsa “Reintentar subir foto”. Conservamos los datos y la foto mientras mantengas esta página abierta.`
        : error.name === "TypeError" || error.name === "TimeoutError" || error.name === "SyntaxError"
        ? "No pudimos confirmar el registro. Tus datos se conservan. Comprueba la conexión y si el reporte se registró antes de reenviar."
        : error.message;
      return;
    } finally { submitting = false; byId("report-fields").disabled = false; updateValidation(); }
    byId("confirmation-category").textContent = submittedReport.categoryLabel;
    byId("confirmation-date").textContent = new Date(submittedReport.createdAt).toLocaleString("es-PE");
    byId("confirmation-entity").textContent = submittedReport.entity;
    byId("confirmation-code").textContent = submittedReport.code;
    byId("confirmation-status").textContent = submittedReport.status;
    showScreen("confirmation");
    byId("confirmation-title").focus();
  });
  [category, description].forEach((input) => input.addEventListener("input", invalidateReview));
  byId("edit-report").addEventListener("click", () => {
    review.hidden = true;
    showStep(0);
  });

  // Evita que una respuesta pendiente se aplique tras salir de esta pantalla.
  window.addEventListener("beforeunload", event => {
    if (pendingUpload || submitting || uncertainPost) { event.preventDefault(); event.returnValue = ""; }
  });
  window.addEventListener("pagehide", () => {
    incidenceMap.close();
    locationPicker.dispose();
    detailView.close();
    dashboard.close();
    photoVersion += 1;
    assistance.cancelAnalysis();
    entityDashboard.close();
    photoPending = false;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = null;
    photo = null;
    submittedReport = null;

  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });
  window.addEventListener("storage", event => {
    if (event.key !== `puno-reporta-reports-user-${session.usuario.id_usuario}`) return;
    ReportStore.loadReports();
    if (currentScreen === "dashboard" || currentScreen === "map") return showDashboard(currentScreen === "map");
    else if (currentScreen === "reports") return showReports();
    else if (currentScreen === "detail" && detailView.currentReport) {
      const report = ReportStore.getReportById(detailView.currentReport.id);
      if (report) detailView.show(report); else showReports();
    } else if (currentScreen === "entity") {
      const code = entityDashboard.selectedCode;
      if (code && entityDashboard.store.find(code)) entityDashboard.showDetail(code);
      else entityDashboard.showList(entityDashboard.mode);
    }
  });
  locationPicker = new ReportLocation({ byId, onChange: invalidateReview });
  assistance = new ReportAssistance({ byId, onChange: invalidateReview });
  assistance.preparePhoto(false);
  void assistance.load(null);
  byId("report-fields").disabled = false;
  showScreen("form");
  showStep(0, false);
  void loadCategories();
  if (ReportStore.getError()) reportMessage.textContent = ReportStore.getError();
  if (window.location.hash === "#inicio") showDashboard();
  if(session.usuario.rol==='ENTIDAD')openEntity(session.usuario.area_key);
})();
