"use strict";

const { Pool } = require("pg");
const environment = require("./test-environment");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: environment.database,
  user: environment.user,
  password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 5000,
  query_timeout: 10000,
});

// No registrar credenciales ni mensajes internos de PostgreSQL en la respuesta.
pool.on("error", (error) => {
  console.error("Error en una conexión inactiva de PostgreSQL:", error.code || "DB_ERROR");
});

module.exports = pool;
