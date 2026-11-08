"use strict";

globalThis.EntityDashboard = class EntityDashboard {
  constructor({ byId, reports, exit }) {
    this.byId = byId;
    this.store = new EntityReports([]);
    this.store.remote = true;
    this.detail = new ReportDetail(id => byId(`entity-${id}`), false);
    this.urls = [];
    this.version = 0;
    this.selectedCode = null;
    this.mode = "home";
    this.photo = null;
    this.page=1;
    ["entity-search","entity-filter-state","entity-filter-date"].forEach(id=>byId(id).addEventListener("input",()=>{this.page=1;this.showList(this.mode,false);}));
    byId("entity-refresh").addEventListener("click",()=>this.showList(this.mode));
    byId("entity-previous").addEventListener("click",()=>{this.page--;this.showList(this.mode,false);});
    byId("entity-next").addEventListener("click",()=>{this.page++;this.showList(this.mode,false);});
    byId("entity-remove-photo").addEventListener("click",()=>this.clearPhoto());
    ["home", "reports", "progress", "solved"].forEach(mode => {
      byId(`entity-nav-${mode}`).addEventListener("click", () => {this.page=1;byId("entity-filter-state").value="";return this.showList(mode);});
    });
    byId("entity-view-all").addEventListener("click", () => this.showList("reports"));
    byId("entity-detail-back").addEventListener("click", () => this.showList(this.mode));
    byId("entity-exit").addEventListener("click", exit);
    byId("entity-start").addEventListener("click", () => this.changeStatus("En proceso"));
    byId("entity-register").addEventListener("click", () => {
      if (this.store.find(this.selectedCode)?.status !== "En proceso") return;
      byId("entity-solution-form").hidden = false;
      byId("entity-register").hidden = true;
      byId("entity-select-photo").focus();
    });
    byId("entity-select-photo").addEventListener("click", () => byId("entity-photo-file").click());
    byId("entity-take-photo").addEventListener("click", () => byId("entity-photo-camera").click());
    ["entity-photo-file", "entity-photo-camera"].forEach(id => {
      byId(id).addEventListener("change", event => this.selectPhoto(event.target.files[0]));
    });
    byId("entity-solution-form").addEventListener("submit", event => {
      event.preventDefault();
      return this.changeStatus("Solucionado");
    });
  }

  url(file) { const url = typeof file === "string" ? file : URL.createObjectURL(file); this.urls.push(url); return url; }
  setArea(key) {
    const user=globalThis.PunoAuth?.current?.usuario;
    const area = user?.rol==='ENTIDAD' ? {...(EntityAreas[user.area_key]||EntityAreas.vias),key:user.area_key,name:user.area_responsable} : EntityAreas[key];
    if (!area || this.saving) return false;
    key = area.key;
    this.close();
    this.store.area = area;
    this.store.reports=[];this.page=1;
    ["entity-search","entity-filter-state","entity-filter-date"].forEach(id=>this.byId(id).value="");
    this.mode = "home";
    this.byId("entity-dashboard").setAttribute("data-area", area.key);
    this.byId("entity-dashboard").setAttribute("aria-label", area.name);
    this.byId("entity-navigation").setAttribute("aria-label", `Navegación de ${area.name}`);
    this.byId("entity-title").textContent = area.name;
    this.byId("entity-area-name").textContent = area.name;
    ["vias", "limpieza"].forEach(icon => {
      const element = this.byId(`entity-icon-${icon}`);
      if (icon === key) element.removeAttribute("hidden");
      else element.setAttribute("hidden", "");
    });
    this.byId("entity-solution-note").setAttribute("placeholder", area.notePlaceholder);
    return true;
  }
  release() {
    this.version += 1;
    this.photo = null;
    this.urls.forEach(url => URL.revokeObjectURL(url));
    this.urls = [];
    this.detail.close();
    this.byId("entity-preview").hidden = true;
    this.byId("entity-remove-photo").hidden = true;
    this.byId("entity-preview").removeAttribute("src");
    this.byId("entity-solved-photo").removeAttribute("src");
    this.byId("entity-solve").disabled = true;
    this.byId("entity-photo-file").value = "";
    this.byId("entity-photo-camera").value = "";
    this.byId("entity-solution-note").value = "";
  }
  close() { this.release(); this.selectedCode = null; }
  formatDate(value) {
    if(!value||!Number.isFinite(Date.parse(value)))return "Sin especificar";
    return new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Lima" }).format(new Date(value));
  }
  async showList(mode = "home",reload=true) {
    if(this.saving)return;
    this.release();
    this.selectedCode = null;
    this.mode = mode;
    this.byId("entity-overview").hidden = false;
    this.byId("entity-report-detail").hidden = true;
    const version=this.version;
    if(reload) {
      this.byId("entity-refresh").disabled=true;
      ["entity-total","entity-reported","entity-progress","entity-solved-count"].forEach(id=>this.byId(id).textContent="…");
      this.byId("entity-list-empty").hidden=true;
      this.byId("entity-load-status").textContent="Cargando incidencias asignadas…";
      this.byId("entity-report-list").replaceChildren();
      try {
        await this.store.load();
        if(version!==this.version)return;
        this.byId("entity-title").textContent=this.store.area.name;
        this.byId("entity-area-name").textContent=this.store.area.name;
        this.byId("entity-account").textContent=this.store.area.name;
        this.byId("entity-load-status").textContent="";
      } catch(error) {
        if(version!==this.version)return;
        this.store.reports=[];
        this.byId("entity-load-status").textContent="No pudimos cargar las incidencias. Pulsa Actualizar para reintentar.";
      } finally {if(version===this.version)this.byId("entity-refresh").disabled=false;}
    }
    ["home", "reports", "progress", "solved"].forEach(key => {
      const button = this.byId(`entity-nav-${key}`);
      if (key === mode) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const all = this.store.list();
    this.byId("entity-total").textContent = String(all.length);
    [["entity-reported", "Reportado"], ["entity-progress", "En proceso"], ["entity-solved-count", "Solucionado"]].forEach(([id, status]) => {
      this.byId(id).textContent = String(all.filter(report => report.status === status).length);
    });
    let rows = all.filter(report => mode === "progress" ? report.status === "En proceso" : mode === "solved" ? report.status === "Solucionado" : true)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const query=this.byId("entity-search").value.trim().toLocaleLowerCase("es"),state=this.byId("entity-filter-state").value,days=Number(this.byId("entity-filter-date").value);
    rows=rows.filter(r=>(!query||`${r.code} ${r.description}`.toLocaleLowerCase("es").includes(query))&&(!state||r.status===state)&&(!days||Date.parse(r.createdAt)>=Date.now()-days*86400000));
    const total=rows.length,pages=Math.max(1,Math.ceil(total/5));this.page=Math.min(Math.max(1,this.page),pages);
    rows=rows.slice((this.page-1)*5,this.page*5);
    this.byId("entity-page-label").textContent=`Mostrando ${rows.length} de ${total} incidencias · Página ${this.page} de ${pages}`;
    this.byId("entity-previous").disabled=this.page===1;
    this.byId("entity-next").disabled=this.page===pages;
    this.byId("entity-list-title").textContent = { home: "Incidencias asignadas", reports: "Reportes asignados", progress: "Reportes en proceso", solved: "Reportes solucionados" }[mode];
    this.byId("entity-view-all").hidden = true;
    this.byId("entity-list-empty").hidden = rows.length > 0;
    this.byId("entity-list-empty").textContent = all.length ? "No hay reportes en esta sección." : `No hay reportes asignados a ${this.store.area.name}.`;
    const list = this.byId("entity-report-list");
    list.replaceChildren();
    rows.forEach(report => {
      const item = document.createElement("li");
      const image = document.createElement("img");
      if(report.photo)image.src = this.url(report.photo);
      else image.hidden=true;
      image.onerror=()=>{image.hidden=true;};
      image.alt = `Fotografía del reporte ${report.code}`;
      const info = document.createElement("div");
      const code = document.createElement("strong"); code.textContent = report.code;
      const category = document.createElement("p"); category.textContent = report.categoryLabel+(report.typeLabel?` · ${report.typeLabel}`:"");
      const description = document.createElement("p"); description.className = "entity-excerpt"; description.textContent = report.description;
      description.hidden = !report.description;
      const date = document.createElement("time"); date.textContent = this.formatDate(report.createdAt); date.setAttribute("datetime", report.createdAt);
      info.append(code, category, description);
      const status = document.createElement("span"); status.className = "entity-badge"; status.textContent = report.status; status.setAttribute("data-status", report.status);
      const location = document.createElement("p"); location.className = "entity-coordinate";
      location.textContent = Number.isFinite(report.location?.latitude)&&Number.isFinite(report.location?.longitude)?`Lat. ${report.location.latitude.toFixed(5)} · Long. ${report.location.longitude.toFixed(5)}`:"Ubicación sin especificar";
      const button = document.createElement("button"); button.type = "button"; button.className = "button button-secondary"; button.textContent = "Ver detalle";
      button.setAttribute("aria-label", `Ver detalle del reporte ${report.code}`);
      button.addEventListener("click", () => this.showDetail(report.code));
      const incident=document.createElement("div");incident.className="entity-incident";incident.append(image,info);
      item.append(incident, location,date,status, button);
      if(this.store.area.key==="vias") {
        category.textContent=report.categoryLabel;category.className="roads-category";
        const type=document.createElement("p");type.className="roads-type";type.textContent=report.typeLabel||"—";type.setAttribute("aria-label",`Tipo: ${report.typeLabel||"no especificado"}`);
        description.className="roads-description entity-excerpt";description.hidden=false;description.textContent=report.description||"Sin descripción";
        item.append(category,type,description);
      }
      list.append(item);
    });
  }

  showDetail(code) {
    if(this.saving)return;
    const report = this.store.find(code);
    if (!report) return;
    this.release();
    this.selectedCode = code;
    this.byId("entity-overview").hidden = true;
    this.byId("entity-report-detail").hidden = false;
    this.detail.show(report);
    this.byId("entity-detail-status").setAttribute("data-status", report.status);
    this.byId("entity-start").hidden = report.status !== "Reportado";
    this.byId("entity-register").hidden = report.status !== "En proceso";
    this.byId("entity-solution-form").hidden = true;
    if(this.store.area.key==="vias"&&report.status==="En proceso") {
      this.byId("entity-solution-form").hidden=false;
      this.byId("entity-register").hidden=true;
    }
    this.byId("entity-solve").textContent=this.store.area.key==="vias"?"Registrar solución":"Marcar como solucionado";
    this.byId("entity-action-status").textContent = "";
    this.byId("entity-photo-status").textContent = "Debes adjuntar una foto de la solución.";
    this.byId("entity-solved").hidden = report.status !== "Solucionado";
    this.byId("entity-solved-photo").hidden=!report.solutionPhoto;
    if (report.status === "Solucionado") {
      if(report.solutionPhoto)this.byId("entity-solved-photo").src = this.url(report.solutionPhoto);
      this.byId("entity-solved-note").textContent = report.solutionNote;
      this.byId("entity-solved-note").hidden = !report.solutionNote;
      this.byId("entity-solved-date").textContent = report.solvedAt?this.formatDate(report.solvedAt):"Sin especificar";
      this.byId("entity-solved-date").setAttribute("datetime", report.solvedAt);
    }
    this.byId("entity-detail-title").focus();
  }

  selectPhoto(file) {
    if (!file || this.store.find(this.selectedCode)?.status !== "En proceso") return;
    const version = ++this.version;
    this.photo = null;
    this.byId("entity-solve").disabled = true;
    this.byId("entity-preview").hidden = true;
    this.byId("entity-preview").removeAttribute("src");
    const message = this.byId("entity-photo-status");
    if (!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>8*1024*1024) { message.textContent = "Selecciona una imagen JPG, PNG o WEBP de máximo 8 MB."; return; }
    message.textContent = "Preparando fotografía…";
    const url = this.url(file);
    const image = new Image();
    image.onload = () => {
      if (version !== this.version) return;
      this.photo = file;
      this.byId("entity-preview").src = url;
      this.byId("entity-preview").hidden = false;
      this.byId("entity-solve").disabled = false;
      this.byId("entity-remove-photo").hidden=false;
      message.textContent = "Evidencia preparada.";
    };
    image.onerror = () => {
      if (version === this.version) message.textContent = "No se pudo abrir la fotografía. Selecciona otra imagen.";
    };
    image.src = url;
  }

  async changeStatus(status) {
    if (this.saving) return;
    this.saving = true;
    this.byId("entity-action-status").textContent="Guardando en el servidor…";
    const controls=["entity-start","entity-solve","entity-detail-back","entity-select-photo","entity-take-photo","entity-remove-photo","entity-exit","entity-nav-home","entity-nav-progress","entity-nav-solved"];
    controls.forEach(id=>this.byId(id).disabled=true);
    try {
      const report = await this.store.transition(this.selectedCode, status, {
        photo: this.photo, photoConfirmed: this.photo !== null, note: this.byId("entity-solution-note").value,
      });
      this.saving=false;this.showDetail(report.code);
      this.byId("entity-action-status").textContent = `Estado actualizado: ${report.status}.`;
    } catch (error) { this.byId("entity-action-status").textContent = error.message; }
    finally { this.saving = false;controls.forEach(id=>this.byId(id).disabled=false);this.byId("entity-solve").disabled=!this.photo; }
  }
  clearPhoto() {
    this.version++;this.photo=null;
    this.byId("entity-preview").hidden=true;this.byId("entity-preview").removeAttribute("src");
    this.byId("entity-photo-file").value="";this.byId("entity-photo-camera").value="";
    this.byId("entity-solve").disabled=true;this.byId("entity-remove-photo").hidden=true;
    this.byId("entity-photo-status").textContent="Debes adjuntar una foto de la solución.";
  }
};
