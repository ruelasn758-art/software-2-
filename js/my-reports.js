"use strict";
globalThis.MyReports = class MyReports {
  constructor({byId,openDetail}) {
    this.byId=byId; this.openDetail=openDetail; this.reports=[]; this.page=1; this.pageSize=5;
    for(const id of ["reports-search","reports-state","reports-category","reports-order"]) {
      byId(id).addEventListener(id==="reports-search"?"input":"change",()=>{this.page=1;this.render();});
    }
    byId("reports-prev").addEventListener("click",()=>{this.page--;this.render();});
    byId("reports-next").addEventListener("click",()=>{this.page++;this.render();});
    byId("reports-clear").addEventListener("click",()=>{
      for(const id of ["reports-search","reports-state","reports-category"])byId(id).value="";
      byId("reports-order").value="newest";this.page=1;this.render();
    });
  }
  setReports(reports) {
    this.reports=reports;
    const select=this.byId("reports-category"), previous=select.value;
    select.replaceChildren();
    const option=(value,label)=>{const node=document.createElement("option");node.value=value;node.textContent=label;select.append(node);};
    option("","Todas las categorías");
    [...new Set(reports.map(r=>r.categoryLabel).filter(Boolean))].sort().forEach(c=>option(c,c));
    select.value=reports.some(r=>r.categoryLabel===previous)?previous:"";
    this.render();
  }
  static filter(reports,{query="",state="",category="",order="newest"}={}) {
    const normalize=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
    const term=normalize(query.trim());
    return reports.filter(r=>(!state||r.status===state)&&(!category||r.categoryLabel===category)&&(!term||normalize(`${r.code} ${r.description} ${r.entity}`).includes(term)))
      .slice().sort((a,b)=>((Date.parse(a.createdAt)||0)-(Date.parse(b.createdAt)||0))*(order==="oldest"?1:-1)||String(a.code).localeCompare(String(b.code)));
  }
  render() {
    const get=this.byId;
    for(const [id,state] of [["total",null],["reported","Reportado"],["progress","En proceso"],["solved","Solucionado"]])get(`reports-count-${id}`).textContent=String(state?this.reports.filter(r=>r.status===state).length:this.reports.length);
    const filtered=MyReports.filter(this.reports,{query:get("reports-search").value,state:get("reports-state").value,category:get("reports-category").value,order:get("reports-order").value});
    const pages=Math.max(1,Math.ceil(filtered.length/this.pageSize));
    this.page=Math.max(1,Math.min(this.page,pages));
    const first=(this.page-1)*this.pageSize, list=get("temporary-report-list");list.replaceChildren();
    const make=(tag,text,className)=>{const node=document.createElement(tag);node.textContent=text; if(className)node.className=className;return node;};
    filtered.slice(first,first+this.pageSize).forEach(report=>{
      const item=make("li","","report-list-card");
      const code=make("strong",report.code,"report-list-code");
      const description=make("p",report.description?.trim()||"Descripción sin especificar","report-list-description");
      const entity=make("p",`${report.categoryLabel||"Sin especificar"} · ${report.entity||"Entidad sin especificar"}`,"report-list-entity");
      const button=make("button","Ver detalle →","button button-secondary report-list-open");button.type="button";
      button.setAttribute("aria-label",`Ver detalle del reporte ${report.code}`);
      button.addEventListener("click",()=>this.openDetail(report,button));
      const date=make("time",Number.isFinite(Date.parse(report.createdAt))?new Date(report.createdAt).toLocaleString("es-PE",{timeZone:"America/Lima",dateStyle:"medium",timeStyle:"short"}):"Fecha sin especificar","report-list-date");
      if(report.createdAt)date.setAttribute("datetime",report.createdAt);
      item.append(code,description,entity,button,date);
      const photo=make("div","","report-list-photo");
      const missing=make("span",report.photo?"Fotografía no disponible":"Sin fotografía");missing.hidden=!!report.photo;photo.append(missing);
      if(report.photo){const image=document.createElement("img");image.src=report.photo;image.alt=`Fotografía del reporte ${report.code}`;image.loading="lazy";image.width=150;image.height=120;image.addEventListener("error",()=>{image.hidden=true;missing.hidden=false;});photo.append(image);}
      const state=make("span",report.status||"Sin especificar","report-list-state");state.setAttribute("data-status",report.status);
      const point=report.location;
      const located=Number.isFinite(point?.latitude)&&Number.isFinite(point?.longitude);
      const location=make("p",located?`⌖ ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`:"Ubicación sin especificar","report-list-location");
      item.append(photo,state,location);list.append(item);
    });
    get("reports-empty").hidden=filtered.length>0;
    get("reports-empty-title").textContent=this.reports.length?"No encontramos coincidencias":"Aún no tienes reportes";
    get("reports-empty-text").textContent=this.reports.length?"Prueba con otro código, estado o categoría.":"Crea tu primera incidencia para comenzar.";
    get("reports-page-info").textContent=filtered.length?`Mostrando ${first+1}–${Math.min(first+this.pageSize,filtered.length)} de ${filtered.length} reportes`:"0 reportes";
    get("reports-page-number").textContent=`Página ${this.page} de ${pages}`;
    get("reports-prev").disabled=this.page===1;
    get("reports-next").disabled=this.page===pages;
  }
};
