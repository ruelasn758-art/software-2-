"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const form = byId("auth-form");
  const isRegistration = form.dataset.mode === "register";
  byId("auth-switch").href = isRegistration ? "iniciar-sesion.html" : "crear-cuenta.html";
  let busy = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true;
    byId("auth-submit").disabled = true;
    form.setAttribute("aria-busy", "true");
    byId("auth-status").textContent = "";
    try {
      const input={correo:byId('email').value,password:byId('password').value};
      if(isRegistration)input.nombre=byId('full-name').value;
      const session = await (isRegistration ? PunoAuth.signUp(input) : PunoAuth.signIn(input));
      if (!session?.isAuthenticated) throw new Error("ACCESS_FAILED");
      byId("password").value = "";
      window.location.assign(PunoAuth.destination());
    } catch(error) {
      byId("auth-status").textContent = error.status ? error.message : "No pudimos completar el acceso. Inténtalo nuevamente.";
    } finally {
      busy = false;
      byId("auth-submit").disabled = false;
      form.removeAttribute("aria-busy");
    }
  });

  // Evita retener contraseñas al navegar o restaurar la página desde el historial.
  window.addEventListener("pagehide", () => { byId("password").value = ""; });
  window.addEventListener("pageshow", () => { byId("password").value = ""; });
  byId("auth-fields").disabled = false;
  if(isRegistration){byId('password').minLength=12;byId('password').placeholder='Mínimo 12 caracteres';}
  byId('password').maxLength=128;
})();
