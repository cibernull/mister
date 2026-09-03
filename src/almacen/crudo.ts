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

/** Veredicto de completitud de una recolección (ver `comprobarCompletitud`). */
export type VeredictoRecoleccion = {
  nombre: string
  completa: boolean
  marcadaEn: string
}

export type Almacen = {
  guardarCaptura(c: Captura): void
  leerCapturas(recoleccion: string): Captura[]
  recolecciones(): string[]
  /**
   * Registra si una recolección llegó de verdad al final del feed. Solo se
   * puede marcar una vez: una segunda llamada para el mismo nombre, aunque
   * lleve el mismo veredicto, lanza `VeredictoYaMarcadoError` en vez de
   * sobrescribir en silencio.
   */
  marcarCompletitud(nombre: string, completa: boolean, marcadaEn: string): void
  /** `undefined` si esa recolección todavía no tiene veredicto marcado. */
  leerCompletitud(nombre: string): VeredictoRecoleccion | undefined
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

/** Se intentó marcar el veredicto de completitud de una recolección que ya lo tenía. */
export class VeredictoYaMarcadoError extends Error {
  readonly nombre: string

  constructor(nombre: string) {
    super(
      `la recolección ${nombre} ya tiene un veredicto de completitud guardado. ` +
        `No se sobrescribe: si hace falta uno nuevo, usa un nombre de recolección distinto.`,
    )
    this.name = 'VeredictoYaMarcadoError'
    this.nombre = nombre
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

  const insertarVeredicto = db.prepare(
    `INSERT INTO recolecciones (nombre, completa, marcada_en) VALUES (@nombre, @completa, @marcadaEn)`,
  )

  const seleccionarVeredicto = db.prepare(
    `SELECT nombre, completa, marcada_en AS marcadaEn FROM recolecciones WHERE nombre = ?`,
  )

  // Ver esViolacionDeUnicidadDeVeredicto: misma técnica que existeCaptura,
  // aplicada a la restricción UNIQUE (nombre) de recolecciones.
  const existeVeredicto = db.prepare(`SELECT 1 FROM recolecciones WHERE nombre = ?`)

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
    marcarCompletitud(nombre, completa, marcadaEn) {
      try {
        insertarVeredicto.run({ nombre, completa: completa ? 1 : 0, marcadaEn })
      } catch (e) {
        if (esViolacionDeUnicidadDeVeredicto(e, nombre, existeVeredicto)) {
          throw new VeredictoYaMarcadoError(nombre)
        }
        throw e
      }
    },
    leerCompletitud(nombre) {
      const fila = seleccionarVeredicto.get(nombre) as
        | { nombre: string; completa: number; marcadaEn: string }
        | undefined
      if (!fila) return undefined
      return { nombre: fila.nombre, completa: fila.completa === 1, marcadaEn: fila.marcadaEn }
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
 * Mientras la tabla `capturas` (ver esquema.ts) siga teniendo una única
 * restricción UNIQUE, el código de error por sí solo ya bastaría —da igual
 * cuántas gane el resto del esquema, como la de `recolecciones` más abajo:
 * este INSERT solo escribe en `capturas`, así que solo puede chocar con una
 * restricción de esa tabla—; esta comprobación adicional documenta esa
 * suposición en código en vez de darla por sentada, y sigue siendo correcta
 * si `capturas` gana una restricción UNIQUE más.
 */
function esViolacionDeUnicidadDeCaptura(
  e: unknown,
  c: Pick<Captura, 'recoleccion' | 'offset'>,
  existeCaptura: Database.Statement,
): boolean {
  if (!esErrorConCodigo(e)) return false
  if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') return false
  return existeCaptura.get(c.recoleccion, c.offset) !== undefined
}

function esErrorConCodigo(e: unknown): e is { code: string } {
  return typeof e === 'object' && e !== null && typeof (e as Record<string, unknown>).code === 'string'
}

/**
 * Misma técnica que `esViolacionDeUnicidadDeCaptura`, aplicada a la
 * restricción UNIQUE (nombre) de `recolecciones`: comprueba semánticamente
 * si ya existía un veredicto para ese nombre, en lugar de mirar el texto del
 * mensaje de SQLite.
 */
function esViolacionDeUnicidadDeVeredicto(e: unknown, nombre: string, existeVeredicto: Database.Statement): boolean {
  if (!esErrorConCodigo(e)) return false
  if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') return false
  return existeVeredicto.get(nombre) !== undefined
}
