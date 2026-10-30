CREATE EXTENSION IF NOT EXISTS postgis;

-- ==================================================
-- TABLA 1: ROL
-- ==================================================
CREATE TABLE rol (
    id_rol BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    descripcion VARCHAR(150),
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO rol (nombre, descripcion)
VALUES
('Ciudadano', 'Usuario que registra y consulta incidencias'),
('Trabajador', 'Personal que atiende reportes de un área'),
('Administrador de entidad', 'Administra usuarios y áreas de una entidad'),
('Administrador general', 'Administra la configuración general de PUNO REPORTA');



-- ==================================================
-- TABLA 2: ENTIDAD
-- ==================================================
CREATE TABLE entidad (
    id_entidad BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL UNIQUE,
    tipo_entidad VARCHAR(80),
    descripcion TEXT,
    correo_contacto VARCHAR(150),
    telefono VARCHAR(30),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO entidad (nombre, tipo_entidad, descripcion)
VALUES
('Municipalidad Provincial de Puno', 'Municipalidad', 'Entidad responsable de la gestión municipal de la ciudad de Puno'),
('Electro Puno S.A.A.', 'Empresa de servicios públicos', 'Entidad responsable de la distribución eléctrica y alumbrado público'),
('EMSAPUNO S.A.', 'Empresa de saneamiento', 'Entidad responsable de los servicios de agua potable y alcantarillado');



-- ==================================================
-- TABLA 3: CATEGORIA
-- ==================================================
CREATE TABLE categoria (
    id_categoria BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL UNIQUE,
    descripcion TEXT,
    icono VARCHAR(100),
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO categoria (nombre, descripcion)
VALUES
('Vías', 'Problemas relacionados con pistas, baches y deterioro vial'),
('Limpieza', 'Problemas relacionados con basura y residuos en espacios públicos'),
('Alumbrado', 'Problemas relacionados con luminarias y alumbrado público'),
('Agua / Saneamiento', 'Problemas relacionados con fugas de agua y alcantarillado');



-- ==================================================
-- TABLA 4: ESTADO_REPORTE
-- ==================================================

CREATE TABLE estado_reporte (
    id_estado BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    orden INTEGER NOT NULL,
    descripcion TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO estado_reporte (nombre, orden, descripcion)
VALUES
('Reportado', 1, 'Reporte registrado por el ciudadano'),
('En proceso', 2, 'Reporte que está siendo atendido por el área responsable'),
('Solucionado', 3, 'Reporte cuya incidencia ya fue atendida');



-- ==================================================
-- TABLA 5: USUARIO
-- ==================================================

CREATE TABLE usuario (
    id_usuario BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_rol BIGINT NOT NULL,
    nombres VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    dni VARCHAR(8) UNIQUE,
    correo VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    telefono VARCHAR(20),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ultimo_acceso TIMESTAMP NULL,

    CONSTRAINT fk_usuario_rol
        FOREIGN KEY (id_rol)
        REFERENCES rol(id_rol)
);





-- ==================================================
-- TABLA 6: AREA_ENTIDAD
-- ==================================================

CREATE TABLE area_entidad (
    id_area BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_entidad BIGINT NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_area_entidad
        FOREIGN KEY (id_entidad)
        REFERENCES entidad(id_entidad),

    CONSTRAINT uq_area_entidad
        UNIQUE (id_entidad, nombre)
);

INSERT INTO area_entidad (
    id_entidad,
    nombre,
    descripcion
)
VALUES
(
    1,
    'Sub Gerencia de Obras Públicas y Mantenimiento',
    'Área responsable de la atención de problemas relacionados con vías e infraestructura urbana'
),
(
    1,
    'Sub Gerencia de Limpieza Pública y Recolección',
    'Área responsable de la limpieza pública y recolección de residuos sólidos'
),
(
    2,
    'Área de Alumbrado Público',
    'Área responsable de la atención de incidencias relacionadas con alumbrado público'
),
(
    3,
    'Área de Operaciones de Agua y Alcantarillado',
    'Área responsable de la atención de incidencias relacionadas con agua potable y alcantarillado'
);



-- ==================================================
-- TABLA 7: TIPO_INCIDENCIA
-- ==================================================

CREATE TABLE tipo_incidencia (
    id_tipo_incidencia BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_categoria BIGINT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT fk_tipo_incidencia_categoria
        FOREIGN KEY (id_categoria)
        REFERENCES categoria(id_categoria),

    CONSTRAINT uq_tipo_incidencia
        UNIQUE (id_categoria, nombre)
);

INSERT INTO tipo_incidencia (
    id_categoria,
    nombre,
    descripcion
)
VALUES
(
    1,
    'Bache',
    'Hundimiento o deterioro localizado en la superficie de una vía'
),
(
    1,
    'Pista deteriorada',
    'Tramo de vía con deterioro considerable en su superficie'
),
(
    1,
    'Señalización dañada',
    'Señal de tránsito deteriorada, rota o ausente'
),
(
    2,
    'Basura acumulada',
    'Acumulación de residuos sólidos en espacios públicos'
),
(
    2,
    'Contenedor desbordado',
    'Contenedor de residuos que ha superado su capacidad'
),
(
    2,
    'Residuos en vía pública',
    'Presencia de residuos sólidos en calles o espacios públicos'
),
(
    3,
    'Luminaria apagada',
    'Luminaria de alumbrado público que no funciona'
),
(
    3,
    'Poste dañado',
    'Poste de alumbrado público deteriorado o con daños visibles'
),
(
    3,
    'Cableado expuesto',
    'Cableado eléctrico visible o expuesto en la vía pública'
),
(
    4,
    'Fuga de agua',
    'Pérdida visible de agua potable en la vía pública'
),
(
    4,
    'Desagüe colapsado',
    'Problema de desborde o bloqueo del sistema de alcantarillado'
),
(
    4,
    'Tapa de buzón dañada',
    'Tapa de buzón de alcantarillado deteriorada, rota o ausente'
);



-- ==================================================
-- TABLA 8: USUARIO_AREA
-- ==================================================

CREATE TABLE usuario_area (
    id_usuario_area BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_usuario BIGINT NOT NULL,
    id_area BIGINT NOT NULL,
    fecha_asignacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT fk_usuario_area_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuario(id_usuario),

    CONSTRAINT fk_usuario_area_area
        FOREIGN KEY (id_area)
        REFERENCES area_entidad(id_area),

    CONSTRAINT uq_usuario_area
        UNIQUE (id_usuario, id_area)
);



-- ==================================================
-- TABLA 9: CATEGORIA_AREA
-- ==================================================

CREATE TABLE categoria_area (
    id_categoria_area BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_categoria BIGINT NOT NULL,
    id_area BIGINT NOT NULL,
    prioridad INTEGER NOT NULL DEFAULT 1,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_categoria_area_categoria
        FOREIGN KEY (id_categoria)
        REFERENCES categoria(id_categoria),

    CONSTRAINT fk_categoria_area_area
        FOREIGN KEY (id_area)
        REFERENCES area_entidad(id_area),

    CONSTRAINT uq_categoria_area
        UNIQUE (id_categoria, id_area)
);

INSERT INTO categoria_area (
    id_categoria,
    id_area,
    prioridad
)
VALUES
(
    1,
    1,
    1
),
(
    2,
    2,
    1
),
(
    3,
    3,
    1
),
(
    4,
    4,
    1
);



-- ==================================================
-- TABLA 10: REPORTE
-- ==================================================

CREATE TABLE reporte (
    id_reporte BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo VARCHAR(30) NOT NULL UNIQUE,
    id_usuario BIGINT NOT NULL,
    id_categoria BIGINT NOT NULL,
    id_tipo_incidencia BIGINT NOT NULL,
    id_area_responsable BIGINT NOT NULL,
    id_estado BIGINT NOT NULL,
    descripcion TEXT,
    ubicacion GEOGRAPHY(POINT, 4326) NOT NULL,
    origen_ubicacion VARCHAR(20) NOT NULL,
    precision_metros NUMERIC(8,2),
    fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT fk_reporte_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuario(id_usuario),

    CONSTRAINT fk_reporte_categoria
        FOREIGN KEY (id_categoria)
        REFERENCES categoria(id_categoria),

    CONSTRAINT fk_reporte_tipo_incidencia
        FOREIGN KEY (id_tipo_incidencia)
        REFERENCES tipo_incidencia(id_tipo_incidencia),

    CONSTRAINT fk_reporte_area
        FOREIGN KEY (id_area_responsable)
        REFERENCES area_entidad(id_area),

    CONSTRAINT fk_reporte_estado
        FOREIGN KEY (id_estado)
        REFERENCES estado_reporte(id_estado),

    CONSTRAINT chk_reporte_origen_ubicacion
        CHECK (origen_ubicacion IN ('GPS', 'MANUAL'))
);



-- ==================================================
-- TABLA 11: ARCHIVO_REPORTE
-- ==================================================

CREATE TABLE archivo_reporte (
    id_archivo BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_reporte BIGINT NOT NULL,
    tipo_archivo VARCHAR(30) NOT NULL,
    ruta_archivo VARCHAR(255) NOT NULL,
    nombre_original VARCHAR(255),
    descripcion TEXT,
    fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_archivo_reporte
        FOREIGN KEY (id_reporte)
        REFERENCES reporte(id_reporte),

    CONSTRAINT chk_tipo_archivo
        CHECK (tipo_archivo IN ('INCIDENCIA', 'SOLUCION'))
);



-- ==================================================
-- TABLA 12: CLASIFICACION_IA
-- ==================================================

CREATE TABLE clasificacion_ia (
    id_clasificacion BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_reporte BIGINT NOT NULL,
    id_tipo_sugerido BIGINT NOT NULL,
    confianza NUMERIC(5,4) NOT NULL,
    modelo VARCHAR(100),
    version_modelo VARCHAR(50),
    aceptada_usuario BOOLEAN,
    fecha_clasificacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_clasificacion_reporte
        FOREIGN KEY (id_reporte)
        REFERENCES reporte(id_reporte),

    CONSTRAINT fk_clasificacion_tipo
        FOREIGN KEY (id_tipo_sugerido)
        REFERENCES tipo_incidencia(id_tipo_incidencia),

    CONSTRAINT chk_clasificacion_confianza
        CHECK (confianza >= 0 AND confianza <= 1)
);



-- ==================================================
-- TABLA 13: HISTORIAL_ESTADO
-- ==================================================

CREATE TABLE historial_estado (
    id_historial BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_reporte BIGINT NOT NULL,
    id_estado_anterior BIGINT,
    id_estado_nuevo BIGINT NOT NULL,
    id_usuario BIGINT NOT NULL,
    observacion TEXT,
    fecha_cambio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_historial_reporte
        FOREIGN KEY (id_reporte)
        REFERENCES reporte(id_reporte),

    CONSTRAINT fk_historial_estado_anterior
        FOREIGN KEY (id_estado_anterior)
        REFERENCES estado_reporte(id_estado),

    CONSTRAINT fk_historial_estado_nuevo
        FOREIGN KEY (id_estado_nuevo)
        REFERENCES estado_reporte(id_estado),

    CONSTRAINT fk_historial_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuario(id_usuario)
);



-- ==================================================
-- TABLA 14: COMENTARIO_REPORTE
-- ==================================================

CREATE TABLE comentario_reporte (
    id_comentario BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_reporte BIGINT NOT NULL,
    id_usuario BIGINT NOT NULL,
    contenido TEXT NOT NULL,
    visibilidad VARCHAR(20) NOT NULL,
    fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT fk_comentario_reporte
        FOREIGN KEY (id_reporte)
        REFERENCES reporte(id_reporte),

    CONSTRAINT fk_comentario_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuario(id_usuario),

    CONSTRAINT chk_comentario_visibilidad
        CHECK (visibilidad IN ('INTERNO', 'PUBLICO'))
);



-- ==================================================
-- TABLA 15: NOTIFICACION
-- ==================================================

CREATE TABLE notificacion (
    id_notificacion BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_usuario BIGINT NOT NULL,
    id_reporte BIGINT,
    titulo VARCHAR(150) NOT NULL,
    mensaje TEXT NOT NULL,
    leida BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_lectura TIMESTAMP,

    CONSTRAINT fk_notificacion_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuario(id_usuario),

    CONSTRAINT fk_notificacion_reporte
        FOREIGN KEY (id_reporte)
        REFERENCES reporte(id_reporte)
);



-- ==================================================
-- TABLA 16: AUDITORIA
-- ==================================================

CREATE TABLE auditoria (
    id_auditoria BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_usuario BIGINT,
    accion VARCHAR(100) NOT NULL,
    tabla_afectada VARCHAR(100),
    id_registro BIGINT,
    detalle TEXT,
    direccion_ip VARCHAR(45),
    fecha_evento TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_auditoria_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuario(id_usuario)
);

