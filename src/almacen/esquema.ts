export const ESQUEMA = `
CREATE TABLE IF NOT EXISTS paginas_crudas (
  offset_feed  INTEGER PRIMARY KEY,
  n_eventos    INTEGER NOT NULL,
  cuerpo       TEXT    NOT NULL,
  capturada_en TEXT    NOT NULL
);
`
