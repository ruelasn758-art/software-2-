"use strict";
// Presentación del formulario; no cambia los datos, el envío ni la navegación existente.
(() => {
  const get = id => document.getElementById(id);
  document.querySelectorAll("[data-report-nav]").forEach(button => {
    button.addEventListener("click", () => get(button.dataset.reportNav).click());
  });
  const setText = (id, value) => { if(get(id).textContent !== value) get(id).textContent=value; };
  const signatures=new Map();
  function cards(selectId,containerId) {
    const select=get(selectId), container=get(containerId);
    const options=[...select.options].filter(o=>o.value || (selectId==="incidence-type"&&!select.disabled));
    const signature=JSON.stringify([select.disabled,options.map(o=>[o.value,o.textContent,o.dataset.description,o.dataset.recommended])]);
    if(signatures.get(selectId)!==signature) {
      signatures.set(selectId,signature);container.replaceChildren();
      options.forEach(option=>{
        const button=document.createElement("button");button.type="button";button.className="choice-card";button.dataset.value=option.value;
        const title=document.createElement("strong");title.textContent=option.value?option.textContent:"Sin tipo específico (opcional)";button.append(title);
        if(option.dataset.recommended==="true") {const badge=document.createElement("span");badge.className="choice-recommended";badge.textContent="✓ Recomendado";button.append(badge);}
        if(option.dataset.description) {const description=document.createElement("small");description.textContent=option.dataset.description;button.append(description);}
        button.addEventListener("click",()=>{select.value=option.value;select.dispatchEvent(new Event("change"));refresh();});
        container.append(button);
      });
    }
    container.querySelectorAll("button").forEach(b=>{b.disabled=select.disabled;b.setAttribute("aria-pressed",String(b.dataset.value===select.value));});
  }
  function refresh() {
    const category=get("review-category").textContent;
    const type=get("review-type").textContent;
    setText("rf-category",category);
    setText("rf-type",type);
    setText("rf-destination",get("review-entity").textContent);
    const photo=!get("photo-preview").hidden;
    const identified=Boolean(get("category").value);
    get("incidence-type").closest(".field").hidden=!identified;
    get("change-destination").closest(".report-destination-inline").hidden=!identified;
    get("rf-category").parentElement.hidden=!identified;
    get("rf-type").parentElement.hidden=!get("incidence-type").value;
    get("review-category").parentElement.hidden=!identified;
    get("review-type").parentElement.hidden=!get("incidence-type").value;
    get("review-entity").parentElement.hidden=!get("destination").value || !identified;
    get("rf-destination").hidden=!get("destination").value || !identified;
    get("rf-destination").previousElementSibling.hidden=get("rf-destination").hidden;
    cards("incidence-type","type-cards");cards("destination","destination-cards");
    get("rf-photo-empty").hidden=photo;
    const done=[photo,Boolean(get("category").value)&&Boolean(get("destination").value)&&!get("destination").disabled,get("confirm-location").hidden,false];
    const current=done.indexOf(false);
    done.forEach((complete,i)=>{
      const item=get(`rf-progress-${i}`);
      item.dataset.complete=String(complete);
      if(i===current) item.setAttribute("aria-current","step"); else item.removeAttribute("aria-current");
      const label=i===1 ? "Identificación del problema" : item.querySelector("strong").textContent;
      item.setAttribute("aria-label",`${label}: ${complete ? "completado" : i===current ? "pendiente" : "por completar"}`);
    });
    get("location-values").dataset.confirmed=String(get("confirm-location").hidden);
    get("location-confirmed-note").hidden=!get("confirm-location").hidden;
    get("location-source-value").textContent=get("accuracy-value").textContent.includes("manual") ? "Manual" : "GPS";
  }
  const observer=new MutationObserver(refresh);
  ["review-category","review-type","review-entity","review-location","photo-preview","confirm-location","destination","incidence-type"].forEach(id=>observer.observe(get(id),{childList:true,subtree:true,attributes:true,attributeFilter:["hidden","disabled"]}));
  get("destination").addEventListener("change",refresh);
  get("incidence-type").addEventListener("change",refresh);
  refresh();
})();
