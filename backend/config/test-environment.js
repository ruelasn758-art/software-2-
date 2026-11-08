"use strict";

const path = require("node:path");
// Esta etapa está limitada a la copia: nunca cargar .env ni sus credenciales.
require("dotenv").config({ path: path.join(__dirname, "../.env.test"), quiet: true });
const database = "puno_reporta_prueba_ia";
const user = "puno_reporta_test_app";
if (process.env.DB_NAME !== database || process.env.DB_USER !== user) {
  throw new Error("Entorno rechazado: se requiere la base y el usuario aislados de pruebas.");
}
if (Number(process.env.PORT || 3001) !== 3001) {
  throw new Error("El backend de pruebas debe usar el puerto 3001.");
}
module.exports = Object.freeze({ database, user, port: 3001,
  uploads: path.join(__dirname, "../uploads-test") });
