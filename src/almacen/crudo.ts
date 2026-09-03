import Database from 'better-sqlite3'
import { ESQUEMA } from './esquema.js'

export type PaginaCruda = {
  offset: number
  nEventos: number
  cuerpo: string
  capturadaEn: string
}

export type Almacen = {
  guardarPagina(p: PaginaCruda): void
  leerPaginas(): PaginaCruda[]
  cerrar(): void
}

/**
 * Capa cruda del almacén: guarda las respuestas tal y como llegaron.
 *
 * Nunca se borra ni se transforma. Si mañana se descubre un dato que hoy se
 * ignora, se reprocesa el pasado sin volver a pedir nada al servidor.
 */
export function abrirAlmacen(ruta: string): Almacen {
  const db = new Database(ruta)
  db.pragma('journal_mode = WAL')
  db.exec(ESQUEMA)

  const insertar = db.prepare(
    `INSERT INTO paginas_crudas (offset_feed, n_eventos, cuerpo, capturada_en)
     VALUES (@offset, @nEventos, @cuerpo, @capturadaEn)
     ON CONFLICT(offset_feed) DO UPDATE SET
       n_eventos = excluded.n_eventos,
       cuerpo = excluded.cuerpo,
       capturada_en = excluded.capturada_en`,
  )

  const seleccionar = db.prepare(
    `SELECT offset_feed AS "offset", n_eventos AS nEventos,
            cuerpo, capturada_en AS capturadaEn
     FROM paginas_crudas ORDER BY offset_feed`,
  )

  return {
    guardarPagina(p) {
      insertar.run(p)
    },
    leerPaginas() {
      return seleccionar.all() as PaginaCruda[]
    },
    cerrar() {
      db.close()
    },
  }
}
