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

  // Ver esViolacionDeUnicidadDeCaptura: comprueba semánticamente si la fila
  // (recoleccion, offset_feed) ya existía, en lugar de mirar el texto del
  // mensaje de SQLite.
  const existeCaptura = db.prepare(`SELECT 1 FROM capturas WHERE recoleccion = ? AND offset_feed = ?`)

  return {
    guardarCaptura(c) {
      exigirEnteroNoNegativo(c.offset, 'offset')
      exigirEnteroNoNegativo(c.nEventos, 'nEventos')

      try {
        insertar.run(c)
      } catch (e) {
        if (esViolacionDeUnicidadDeCaptura(e, c, existeCaptura)) {
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

/**
 * Distingue una violación de la restricción UNIQUE (recoleccion, offset_feed)
 * de cualquier otra violación UNIQUE que el esquema pudiera adquirir en el
 * futuro — SIN mirar el texto del mensaje de SQLite.
 *
 * Comparar subcadenas del mensaje es frágil por dos motivos: el formato del
 * mensaje no es un contrato estable de SQLite/better-sqlite3, y una
 * comparación por subcadena puede dar un falso positivo si alguna columna
 * futura se llama, por ejemplo, "recoleccion_legado" u "offset_feed_alt"
 * (ambas contienen las palabras buscadas sin ser la restricción real).
 *
 * En vez de eso, se comprueba directamente si ya existía una fila con esa
 * (recoleccion, offset): el INSERT solo pudo chocar con ELLA a través de la
 * restricción real. Si no existe tal fila, el fallo vino de otra restricción
 * UNIQUE y debe propagarse tal cual, no reinterpretarse como duplicado.
 *
 * Mientras el esquema (ver esquema.ts) siga teniendo una única restricción
 * UNIQUE, el código de error por sí solo ya bastaría; esta comprobación
 * adicional documenta esa suposición en código en vez de darla por sentada,
 * y sigue siendo correcta si el esquema gana una restricción UNIQUE más.
 */
function esViolacionDeUnicidadDeCaptura(
  e: unknown,
  c: Pick<Captura, 'recoleccion' | 'offset'>,
  existeCaptura: Database.Statement,
): boolean {
  if (!isErrorWithCode(e)) return false
  if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') return false
  return existeCaptura.get(c.recoleccion, c.offset) !== undefined
}

function isErrorWithCode(e: unknown): e is { code: string } {
  return typeof e === 'object' && e !== null && typeof (e as Record<string, unknown>).code === 'string'
}
