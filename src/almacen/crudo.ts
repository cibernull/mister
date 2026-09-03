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

/** Una página auxiliar (plantilla de equipo o ficha de jugador), guardada cruda. */
export type PaginaGuardada = {
  ruta: string
  cuerpo: string
  capturadaEn: string
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
  /**
   * Guarda una captura de página auxiliar. Un refresco añade una versión
   * nueva junto a la vieja: solo colisiona si se guarda dos veces la misma
   * (ruta, capturadaEn).
   */
  guardarPagina(p: PaginaGuardada): void
  /** La captura más reciente de esa ruta, o `null` si no hay ninguna. */
  leerPagina(ruta: string): PaginaGuardada | null
  /**
   * TODAS las capturas guardadas de esa ruta, ordenadas cronológicamente
   * (de más antigua a más reciente). A diferencia de `leerPagina`, que solo
   * expone la más reciente, esta es la única forma de comprobar que un
   * refresco añade una captura nueva sin destruir las anteriores.
   */
  leerCapturasDePagina(ruta: string): PaginaGuardada[]
  /** Las rutas distintas guardadas, sin repetir aunque tengan varias capturas. */
  rutasGuardadas(): string[]
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

/** Se intentó guardar dos veces la misma (ruta, capturadaEn). */
export class PaginaDuplicadaError extends Error {
  readonly ruta: string

  constructor(ruta: string) {
    super(`la página ${ruta} ya está guardada. El crudo no se sobrescribe.`)
    this.name = 'PaginaDuplicadaError'
    this.ruta = ruta
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

  // Ver esViolacionDeUnicidad: comprueba semánticamente si la fila
  // (recoleccion, offset_feed) ya existía, en lugar de mirar el texto del
  // mensaje de SQLite.
  const existeCaptura = db.prepare(`SELECT 1 FROM capturas WHERE recoleccion = ? AND offset_feed = ?`)

  const insertarVeredicto = db.prepare(
    `INSERT INTO recolecciones (nombre, completa, marcada_en) VALUES (@nombre, @completa, @marcadaEn)`,
  )

  const seleccionarVeredicto = db.prepare(
    `SELECT nombre, completa, marcada_en AS marcadaEn FROM recolecciones WHERE nombre = ?`,
  )

  // Ver esViolacionDeUnicidad: misma técnica que existeCaptura, aplicada a la
  // restricción UNIQUE (nombre) de recolecciones.
  const existeVeredicto = db.prepare(`SELECT 1 FROM recolecciones WHERE nombre = ?`)

  const insertarPagina = db.prepare(
    `INSERT INTO paginas (ruta, cuerpo, capturada_en) VALUES (@ruta, @cuerpo, @capturadaEn)`,
  )
  // La más reciente de esa ruta.
  const seleccionarPagina = db.prepare(
    `SELECT ruta, cuerpo, capturada_en AS capturadaEn FROM paginas
     WHERE ruta = ? ORDER BY capturada_en DESC LIMIT 1`,
  )
  // TODAS las capturas de esa ruta, de más antigua a más reciente.
  const seleccionarCapturasDePagina = db.prepare(
    `SELECT ruta, cuerpo, capturada_en AS capturadaEn FROM paginas
     WHERE ruta = ? ORDER BY capturada_en ASC`,
  )
  const listarRutas = db.prepare(`SELECT DISTINCT ruta FROM paginas ORDER BY ruta`)

  // Ver esViolacionDeUnicidad: misma técnica que existeCaptura, aplicada a la
  // restricción UNIQUE (ruta, capturada_en) de paginas.
  const existePagina = db.prepare(`SELECT 1 FROM paginas WHERE ruta = ? AND capturada_en = ?`)

  return {
    guardarCaptura(c) {
      exigirEnteroNoNegativo(c.offset, 'offset')
      exigirEnteroNoNegativo(c.nEventos, 'nEventos')

      try {
        insertar.run(c)
      } catch (e) {
        if (esViolacionDeUnicidad(e, existeCaptura, c.recoleccion, c.offset)) {
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
        if (esViolacionDeUnicidad(e, existeVeredicto, nombre)) {
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
    guardarPagina(p) {
      try {
        insertarPagina.run(p)
      } catch (e) {
        // Solo colisiona si se guarda dos veces la MISMA ruta en el MISMO
        // instante; un refresco posterior añade una captura nueva sin chocar.
        if (esViolacionDeUnicidad(e, existePagina, p.ruta, p.capturadaEn)) {
          throw new PaginaDuplicadaError(p.ruta)
        }
        throw e
      }
    },
    leerPagina(ruta) {
      return (seleccionarPagina.get(ruta) as PaginaGuardada | undefined) ?? null
    },
    leerCapturasDePagina(ruta) {
      return seleccionarCapturasDePagina.all(ruta) as PaginaGuardada[]
    },
    rutasGuardadas() {
      return (listarRutas.all() as { ruta: string }[]).map((f) => f.ruta)
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
 * Distingue una violación de LA restricción UNIQUE que protege `existe` —sea
 * la de (recoleccion, offset_feed) en `capturas`, la de (nombre) en
 * `recolecciones`, o la de (ruta, capturada_en) en `paginas`— de cualquier
 * otra violación UNIQUE que el esquema pudiera adquirir, SIN mirar el texto
 * del mensaje de SQLite.
 *
 * Comparar subcadenas del mensaje es frágil por dos motivos: el formato del
 * mensaje no es un contrato estable de SQLite/better-sqlite3, y una
 * comparación por subcadena puede dar un falso positivo si alguna columna
 * futura se llama, por ejemplo, "recoleccion_legado" u "offset_feed_alt"
 * (ambas contienen las palabras buscadas sin ser la restricción real).
 *
 * En vez de eso, se comprueba directamente si ya existía una fila con esa
 * clave, mediante la sentencia `existe` (preparada por cada llamante con la
 * combinación de columnas de SU restricción) y los valores de esa fila
 * (`valores`, en el mismo orden que los parámetros posicionales de `existe`):
 * el INSERT solo pudo chocar con ELLA a través de la restricción real. Si no
 * existe tal fila, el fallo vino de otra restricción UNIQUE y debe
 * propagarse tal cual, no reinterpretarse como duplicado.
 *
 * Una única función genérica, en vez de una por tabla: cada tabla nueva con
 * restricción UNIQUE aporta su propia sentencia `existe` y su propia clave,
 * sin duplicar esta lógica de nuevo.
 */
function esViolacionDeUnicidad(e: unknown, existe: Database.Statement, ...valores: unknown[]): boolean {
  if (!esErrorConCodigo(e)) return false
  if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') return false
  return existe.get(...valores) !== undefined
}

function esErrorConCodigo(e: unknown): e is { code: string } {
  return typeof e === 'object' && e !== null && typeof (e as Record<string, unknown>).code === 'string'
}
