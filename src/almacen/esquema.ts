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
`
