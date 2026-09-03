import Database from 'better-sqlite3'
import { ESQUEMA } from './esquema.js'

export type Captura = {
  /** Identifica el recorrido completo al que pertenece. */
  recoleccion: string
  /** Posición en el feed. Solo significa algo dentro de su recolección. */
  offset: number
  nEventos: number
  cuerpo: string
  capturadaEn: string
}

export type Almacen = {
  guardarCaptura(c: Captura): void
  leerCapturas(recoleccion: string): Captura[]
  recolecciones(): string[]
  cerrar(): void
}

/** Se intentó guardar dos veces el mismo offset de una recolección. */
export class CapturaDuplicadaError extends Error {
  readonly recoleccion: string
  readonly offset: number

  constructor(recoleccion: string, offset: number) {
    super(
      `la recolección ${recoleccion} ya tiene guardado el offset ${offset}. ` +
        `El crudo no se sobrescribe: revisa el recorrido.`,
    )
    this.name = 'CapturaDuplicadaError'
    this.recoleccion = recoleccion
    this.offset = offset
  }
}

/**
 * Capa cruda del almacén: guarda las respuestas tal y como llegaron.
 *
 * Nunca se sobrescribe ni se borra. Si mañana se descubre un campo que hoy se
 * ignora, se reprocesa el pasado sin volver a pedir nada al servidor.
 */
export function abrirAlmacen(ruta: string): Almacen {
  const db = new Database(ruta)
  db.pragma('journal_mode = WAL')
  db.exec(ESQUEMA)

  const insertar = db.prepare(
    `INSERT INTO capturas (recoleccion, offset_feed, n_eventos, cuerpo, capturada_en)
     VALUES (@recoleccion, @offset, @nEventos, @cuerpo, @capturadaEn)`,
  )

  const seleccionar = db.prepare(
    `SELECT recoleccion, offset_feed AS "offset", n_eventos AS nEventos,
            cuerpo, capturada_en AS capturadaEn
     FROM capturas WHERE recoleccion = ? ORDER BY offset_feed`,
  )

  const listarRecolecciones = db.prepare(
    `SELECT DISTINCT recoleccion FROM capturas ORDER BY recoleccion`,
  )

  return {
    guardarCaptura(c) {
      exigirEnteroNoNegativo(c.offset, 'offset')
      exigirEnteroNoNegativo(c.nEventos, 'nEventos')

      try {
        insertar.run(c)
      } catch (e) {
        if (esViolacionDeUnicidad(e)) {
          throw new CapturaDuplicadaError(c.recoleccion, c.offset)
        }
        throw e
      }
    },
    leerCapturas(recoleccion) {
      return seleccionar.all(recoleccion) as Captura[]
    },
    recolecciones() {
      return (listarRecolecciones.all() as { recoleccion: string }[]).map((f) => f.recoleccion)
    },
    cerrar() {
      db.close()
    },
  }
}

function exigirEnteroNoNegativo(valor: number, campo: string): void {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error(`${campo} debe ser un entero no negativo, y vale ${valor}`)
  }
}

function esViolacionDeUnicidad(e: unknown): boolean {
  return e instanceof Error && e.message.includes('UNIQUE constraint failed')
}
