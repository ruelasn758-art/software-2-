"use strict";

// Validación y copia de los datos del formulario antes del guardado central.
globalThis.IncidenceData = (() => {
  function coordinates(latitude, longitude, accuracy = null, locationSource = "manual") {
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
        (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0))) {
      throw new RangeError("Coordenadas o precisión no válidas.");
    }
    if (!["gps", "manual"].includes(locationSource)) throw new RangeError("Origen de ubicación no válido.");
    return Object.freeze({ latitude, longitude, accuracy, locationSource });
  }
  function snapshot({ category, description = "", photo, location, categoryConfirmed, photoConfirmed }) {
    if (!location || location.locationConfirmed !== true) {
      throw new Error("Debes confirmar la ubicación del problema antes de enviar el reporte.");
    }
    const entity = IncidenceRouting.suggestEntity({ category });
    if (categoryConfirmed !== true || !entity) {
      throw new Error("Debes seleccionar una categoría para continuar.");
    }
    if (photoConfirmed !== true || !photo || !photo.type?.startsWith("image/")) {
      throw new Error("Debes adjuntar una fotografía del incidente para continuar.");
    }
    return Object.freeze({
      category,
      categoryConfirmed: true,
      photoConfirmed: true,
      description: description.trim(),
      photo,
      location: Object.freeze({ ...coordinates(location.latitude, location.longitude, location.accuracy, location.locationSource), locationConfirmed: true }),
      entity,
    });
  }
  return Object.freeze({ coordinates, snapshot });
})();
