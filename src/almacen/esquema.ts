export const ESQUEMA = `
CREATE TABLE IF NOT EXISTS capturas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  recoleccion  TEXT    NOT NULL,
  offset_feed  INTEGER NOT NULL,
  n_eventos    INTEGER NOT NULL,
  cuerpo       TEXT    NOT NULL,
  capturada_en TEXT    NOT NULL,
  UNIQUE (recoleccion, offset_feed)
);

-- Veredicto de completitud de una recolección: si su histórico llegó de
-- verdad al final del feed (ver comprobarCompletitud), para que la Fase 2
-- pueda elegir con qué recolección trabajar sin tener que releer y
-- reinterpretar sus capturas para adivinarlo. Como la capa cruda, no se
-- sobrescribe: una recolección se marca una sola vez.
CREATE TABLE IF NOT EXISTS recolecciones (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre       TEXT    NOT NULL,
  completa     INTEGER NOT NULL,
  marcada_en   TEXT    NOT NULL,
  UNIQUE (nombre)
);

-- Páginas auxiliares (plantillas de equipo y fichas de jugador), guardadas
-- crudas. La clave es (ruta, capturada_en), no solo ruta: un refresco añade
-- una captura nueva junto a la vieja en vez de sobrescribirla, igual que
-- capturas. leerPagina (ver crudo.ts) devuelve siempre la más reciente.
CREATE TABLE IF NOT EXISTS paginas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ruta         TEXT NOT NULL,
  cuerpo       TEXT NOT NULL,
  capturada_en TEXT NOT NULL,
  UNIQUE (ruta, capturada_en)
);
CREATE INDEX IF NOT EXISTS idx_paginas_ruta ON paginas (ruta, capturada_en DESC);
`
