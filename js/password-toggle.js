"use strict";

// Presentación únicamente: no cambia la validación ni el servicio de acceso.
(() => {
  const input = document.getElementById("password");
  const toggle = document.getElementById("password-toggle");
  function setVisible(visible) {
    input.type = visible ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(visible));
    toggle.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
  }
  toggle.addEventListener("click", () => setVisible(input.type === "password"));
  window.addEventListener("pagehide", () => setVisible(false));
  window.addEventListener("pageshow", () => setVisible(false));
})();
