"use strict";
// Solo la navegación de la portada; el acceso conserva js/app.js.
(() => {
  const menu = document.querySelector(".home-menu");
  menu.querySelectorAll("a").forEach(link => link.addEventListener("click", () => { menu.open = false; }));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
})();
