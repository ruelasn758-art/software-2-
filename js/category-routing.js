"use strict";

globalThis.IncidenceRouting = (() => {
  const categoryRouting = Object.freeze({
    vias: "Área de Vías",
    limpieza: "Área de Limpieza",
    alumbrado: "Área responsable de alumbrado",
    agua: "Área responsable de agua y saneamiento",
  });

  // Punto de extensión para futuras reglas; actualmente solo se usa la categoría.
  function suggestEntity({ category }) {
    return Object.hasOwn(categoryRouting, category) ? categoryRouting[category] : null;
  }

  return Object.freeze({ categoryRouting, suggestEntity });
})();

// Solo las áreas habilitadas: comparten vista, filtros y transiciones.
globalThis.EntityAreas = Object.freeze({
  vias: Object.freeze({ key: "vias", category: "vias", name: "Área de Vías", entities: ["Área de Vías", "Área responsable de vías"], notePlaceholder: "Ej. Se realizó el parchado del bache." }),
  limpieza: Object.freeze({ key: "limpieza", category: "limpieza", name: "Área de Limpieza", entities: ["Área de Limpieza", "Área responsable de limpieza"], notePlaceholder: "Ej. Se retiraron los residuos y se limpió la zona." }),
});
