"use strict";
globalThis.IncidenceMap = class IncidenceMap {
  constructor({byId,openDetail,refresh}) {
    this.byId=byId;this.openDetail=openDetail;this.reports=[];this.markers=[];this.map=null;this.selected=null;
    for(const id of ["map-filter-state","map-filter-category","map-filter-period"])byId(id).addEventListener("change",()=>this.render());
    byId("map-refresh").addEventListener("click",refresh);
    byId("map-center").addEventListener("click",()=>this.center());
    byId("map-panel-close").addEventListener("click",()=>this.closePanel());
    byId("map-open-detail").addEventListener("click",()=>{if(this.selected)this.openDetail(this.selected);});
  }
  static filter(reports,{state="",category="",period="all",now=Date.now()}={}) {
    const days=Number(period);
    return reports.filter(r=>(!state||r.status===state)&&(!category||r.categoryLabel===category)&&
      (period==="all" || (Number.isFinite(Date.parse(r.createdAt)) && Date.parse(r.createdAt)>=now-days*86400000 && Date.parse(r.createdAt)<=now)));
  }
  static located(report) { const p=report.location;return p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180; }
  setReports(reports) {
    this.reports=reports;
    const select=this.byId("map-filter-category"),old=select.value;select.replaceChildren();
    const add=(value,label)=>{const option=document.createElement("option");option.value=value;option.textContent=label;select.append(option);};
    add("","Todas las categorías");
    [...new Set(reports.map(r=>r.categoryLabel).filter(Boolean))].sort().forEach(c=>add(c,c));
    select.value=reports.some(r=>r.categoryLabel===old)?old:"";
    for(const [id,state] of [["total",null],["reported","Reportado"],["progress","En proceso"],["solved","Solucionado"]])this.byId(`map-count-${id}`).textContent=String(state?reports.filter(r=>r.status===state).length:reports.length);
    this.render();
  }
  render() {
    const get=this.byId;
    this.closePanel();
    this.visible=IncidenceMap.filter(this.reports,{state:get("map-filter-state").value,category:get("map-filter-category").value,period:get("map-filter-period").value||"all"});
    this.points=this.visible.filter(IncidenceMap.located);
    get("map-results").textContent=`${this.points.length} de ${this.visible.length} reportes filtrados con ubicación disponible.`;
    get("map-empty").hidden=this.points.length>0;
    get("map-center").disabled=!this.points.length;
    if(!globalThis.L){get("map-cartography-status").textContent="No se pudo cargar el mapa. Comprueba tu conexión e inténtalo nuevamente.";return;}
    if(!this.map){
      this.map=L.map(get("incidents-map"),{scrollWheelZoom:true,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false}).setView([-15.8402,-70.0219],13);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(this.map).on("tileerror",()=>{get("map-cartography-status").textContent="No se pudo cargar parte de la cartografía. Las coordenadas de los reportes se conservan.";});
    }
    this.markers.forEach(marker=>this.map.removeLayer(marker));this.markers=[];
    const styles={Reportado:["reported","!"],"En proceso":["progress","◷"],Solucionado:["solved","✓"]};
    this.points.forEach(report=>{
      const [style,symbol]=styles[report.status]||["unknown","•"];
      const icon=L.divIcon({className:`incident-marker ${style}`,html:`<span><b>${symbol}</b></span>`,iconSize:[36,44],iconAnchor:[18,44]});
      const marker=L.marker([report.location.latitude,report.location.longitude],{icon,draggable:false,keyboard:true,title:`${report.code} · ${report.status}`,alt:`${report.code} · ${report.status}`}).addTo(this.map);
      marker.on("click",()=>this.select(report,marker));this.markers.push(marker);
    });
    this.center();
  }
  center() {
    if(!this.map)return;
    this.map.invalidateSize({pan:false});
    if(this.points?.length)this.map.fitBounds(this.points.map(r=>[r.location.latitude,r.location.longitude]),{padding:[45,45],maxZoom:16,animate:false});
    else this.map.setView([-15.8402,-70.0219],13);
  }
  select(report,marker) {
    this.selected=report;
    this.markers.forEach(m=>m.getElement()?.classList.remove("selected"));
    marker.getElement()?.classList.add("selected");
    const get=this.byId,put=(id,value)=>{get(id).textContent=value;};
    get("map-report-panel").hidden=false;
    put("map-panel-code",report.code);put("map-panel-description",report.description?.trim()||report.typeLabel||"Descripción sin especificar");
    put("map-panel-category",report.categoryLabel||"Sin especificar");put("map-panel-entity",report.entity||"Sin especificar");
    put("map-panel-state",report.status);get("map-panel-state").setAttribute("data-status",report.status);
    put("map-panel-date",Number.isFinite(Date.parse(report.createdAt))?new Date(report.createdAt).toLocaleString("es-PE",{timeZone:"America/Lima"}):"Sin especificar");
    put("map-panel-location",`${report.location.latitude.toFixed(6)}, ${report.location.longitude.toFixed(6)}`);
    const image=get("map-panel-photo");image.hidden=!report.photo;get("map-photo-empty").hidden=!!report.photo;
    image.onerror=()=>{image.hidden=true;get("map-photo-empty").hidden=false;};
    if(report.photo)image.src=report.photo;else image.removeAttribute("src");
    this.map.invalidateSize({pan:false});this.map.panTo([report.location.latitude,report.location.longitude],{animate:false});
    get("map-panel-code").focus({preventScroll:true});
  }
  closePanel() {
    this.selected=null;this.byId("map-report-panel").hidden=true;
    this.markers.forEach(m=>m.getElement()?.classList.remove("selected"));
    this.map?.invalidateSize({pan:false});
  }
  close() {if(this.map)this.map.remove();this.map=null;this.markers=[];this.selected=null;this.byId("map-report-panel").hidden=true;}
};
