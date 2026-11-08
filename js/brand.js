"use strict";

// Identidad visual independiente de la ciudad y de las claves internas del sistema.
globalThis.PlatformBrand = Object.freeze({
  name: "",
  logo: "assets/logo-symbol.png",
  alt: "Símbolo de la plataforma",
});

(() => {
  const brand = globalThis.PlatformBrand;
  document.documentElement.style.setProperty("--brand-symbol", `url("${new URL(brand.logo, document.baseURI).href}")`);
  document.querySelectorAll("[data-brand-logo]").forEach(image => {
    image.src = brand.logo;
    image.alt = brand.alt;
  });
  document.querySelectorAll("[data-brand-name]").forEach(element => {
    element.textContent = brand.name;
    element.hidden = !brand.name;
  });
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.href = brand.logo;
  if (brand.name) document.title += ` · ${brand.name}`;
})();
