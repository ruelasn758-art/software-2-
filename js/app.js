"use strict";

(() => {
  const dialog = document.querySelector("#access-dialog");
  document.querySelectorAll("[data-open-access]").forEach((button) => {
    button.addEventListener("click", async () => {
      const session = await PunoAuth.getSession();
      if (session?.isAuthenticated) {
        window.location.assign(session.usuario.rol==='CIUDADANO'?'nueva-incidencia.html':PunoAuth.destination());
      } else if (!dialog.open) {
        dialog.showModal();
      }
    });
  });
})();
