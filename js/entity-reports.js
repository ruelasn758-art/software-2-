"use strict";

// Opera sobre el objeto compartido y guarda los cambios sin alterar
// la foto, categoría, código ni ubicación originales.
globalThis.EntityReports = class EntityReports {
  constructor(reports, area = EntityAreas.vias) { this.reports = reports; this.area = area; }
  async load() {
    this.remote=true;
    const key=this.area.key;
    const response=await fetch(`http://127.0.0.1:3001/api/entidad/${key}/reportes`,{signal:AbortSignal.timeout(10000)});
    const result=await response.json();
    if(!response.ok||!result.area||!Array.isArray(result.reportes))throw Error(result.message||"No se pudieron cargar las incidencias del área.");
    if(key!==this.area.key)return;
    if(result.reportes.some(r=>String(r.id_area_responsable)!==String(result.area.id_area)))throw Error("La respuesta no corresponde al área seleccionada.");
    this.area={...this.area,id:result.area.id_area,name:result.area.area,entity:result.area.entidad};
    this.reports=result.reportes.map(ReportStore.fromApi);
  }
  belongs(report) {
    if(this.remote)return String(report.id_area_responsable)===String(this.area.id);
    // Una categoría conocida de otra área nunca se muestra aquí, incluso
    // si un dato antiguo tiene una entidad inconsistente.
    if (Object.hasOwn(IncidenceRouting.categoryRouting, report.category) && report.category !== this.area.category) return false;
    return report.category === this.area.category || this.area.entities.includes(report.entity);
  }
  list() { return this.reports.filter(report => this.belongs(report)); }
  find(code) { return this.list().find(report => report.code === code); }
  async transition(code, status, evidence = {}) {
    const report = this.find(code);
    if (!report) throw new Error(`Este reporte no corresponde a ${this.area.name}.`);
    if(this.remote) {
      const base=`http://127.0.0.1:3001/api/entidad/${this.area.key}/reportes/${report.id_reporte}`;
      let url,options;
      if(status==="Solucionado") {
        if(!evidence.photoConfirmed||!evidence.photo)throw Error("Debes adjuntar una fotografía de solución.");
        const data=new FormData();data.append("archivo",evidence.photo);data.append("observacion",evidence.note||"");
        url=base+"/solucion";options={method:"POST",body:data};
      } else {url=base+"/estado";options={method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({estado:status})};}
      const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});const result=await response.json();
      if(!response.ok||!result.ok)throw Error(result.message||"No se pudo guardar el cambio.");
      await this.load();
      return this.find(code);
    }
    let next;
    if (report.status === "Reportado" && status === "En proceso") {
      next = { ...report, status };
    } else if (report.status === "En proceso" && status === "Solucionado") {
      if (!evidence.photoConfirmed || !evidence.photo?.type?.startsWith("image/")) {
        throw new Error("Debes adjuntar una fotografía válida de la solución.");
      }
      next = { ...report, status, solutionPhoto: evidence.photo,
        solutionNote: (evidence.note || "").trim(), solvedAt: new Date().toISOString() };
    } else throw new Error("No se permite este cambio de estado.");
    return ReportStore.updateReport(report.id, next);
  }
};
