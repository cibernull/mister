import type {
  CierreJornada,
  Evento,
  Parte,
  ResultadoEquipo,
  TipoOperacion,
  Transaccion,
} from '../dominio/eventos.js'

export type PaginaFeed = {
  eventos: Evento[]
  /** El histórico se agota cuando el servidor devuelve `status: "end"`. */
  agotado: boolean
}

/**
 * Categoría de feed no catalogada. Detiene la recolección a propósito:
 * descartarla produciría una contabilidad plausible y equivocada.
 */
export class CategoriaDesconocidaError extends Error {
  readonly categoria: string
  /**
   * Identificador seguro del evento (categoría y fecha), NO el evento
   * completo: al ser una categoría no catalogada, no se sabe qué trae su
   * `data` — podría llevar datos personales de algún miembro de la liga en
   * una categoría futura todavía no vista. El crudo íntegro ya queda guardado
   * en el almacén antes de parsear (ver recolectar.ts), así que no hace
   * falta repetirlo aquí para poder diagnosticarlo.
   */
  readonly crudo: string

  constructor(categoria: string, crudo: string) {
    super(`categoría de feed no catalogada: ${categoria}. Recolección detenida.`)
    this.name = 'CategoriaDesconocidaError'
    this.categoria = categoria
    this.crudo = crudo
  }
}

/** Tipo de movimiento no catalogado: su signo contable es desconocido. */
export class OperacionDesconocidaError extends Error {
  readonly operacion: string
  /** Identificador seguro del movimiento (ver nota de privacidad en `idMovimiento`). */
  readonly crudo: string

  constructor(operacion: string, crudo: string) {
    super(`tipo de operación no catalogado: ${operacion}. Recolección detenida.`)
    this.name = 'OperacionDesconocidaError'
    this.operacion = operacion
    this.crudo = crudo
  }
}

/** Categorías sin efecto contable, ignoradas a conciencia y de forma explícita. */
const CATEGORIAS_RUIDO = new Set([
  'post',
  'blog',
  'news_md',
  'pool_public',
  'porra',
  'gameweek_start',
  'admin',
  'change_name',
  'market_unified',
])

const OPERACIONES: ReadonlySet<string> = new Set<TipoOperacion>(['normal', 'clause', 'rescind'])

type EventoBruto = {
  id?: unknown
  category?: string
  created?: string
  data?: unknown
}

/**
 * Parsea una página del feed.
 *
 * El fin del histórico se decide por `status`, nunca por que `data` esté
 * vacío: una respuesta de error (401 por sesión caducada, p. ej.) tampoco
 * trae `data`, y confundirla con el final legítimo cortaría la recolección
 * en silencio, perdiendo todos los eventos restantes.
 */
export function parsearPaginaFeed(cuerpo: string): PaginaFeed {
  const respuesta = JSON.parse(cuerpo) as { status?: string; data?: unknown }

  if (respuesta.status === 'end') {
    return { eventos: [], agotado: true }
  }

  if (respuesta.status === 'ok') {
    if (!Array.isArray(respuesta.data)) {
      throw new Error(
        `la respuesta trae status "ok" pero no un array "data": ${JSON.stringify(cuerpo).slice(0, 200)}`,
      )
    }
    const brutos = respuesta.data as EventoBruto[]
    return { eventos: brutos.flatMap(parsearEvento), agotado: false }
  }

  throw new Error(`status de feed inesperado: ${JSON.stringify(respuesta.status)}`)
}

/**
 * Identifica un evento bruto de forma segura para mensajes de error: solo
 * `category` y `created`, nunca su `data` — una categoría no catalogada
 * podría traer datos personales en un campo todavía no visto (ver
 * `CategoriaDesconocidaError`).
 */
function contextoEvento(bruto: EventoBruto): string {
  return `category=${JSON.stringify(bruto.category ?? null)}, created=${JSON.stringify(bruto.created ?? null)}`
}

/**
 * Un evento bruto produce CERO O VARIOS eventos de dominio.
 *
 * Un `transfer` puede contener varios movimientos en su array `data`: en el
 * histórico real, 183 eventos contienen 252 movimientos. Devolver uno solo por
 * evento perdería transacciones en silencio.
 */
function parsearEvento(bruto: EventoBruto): Evento[] {
  const categoria = bruto.category ?? ''
  const fecha = exigirTexto(bruto.created, 'created', contextoEvento(bruto))

  if (categoria === 'transfer') {
    return exigirMovimientos(bruto.data, fecha, 'transfer').map((m) => parsearTransaccion(m, fecha, bruto.id))
  }

  if (categoria === 'gameweek_end') {
    return [parsearCierreJornada(bruto.data, fecha, bruto.id)]
  }

  if (categoria === 'player_transfer') {
    const idEvento = exigirEntero(bruto.id, 'id', contextoEvento(bruto))
    return exigirMovimientos(bruto.data, fecha, 'player_transfer').map((m) =>
      parsearMovimientoDeLaLiga(m, fecha, idEvento),
    )
  }

  if (CATEGORIAS_RUIDO.has(categoria)) {
    return [
      {
        tipo: 'ruido',
        idEvento: exigirEntero(bruto.id, 'id', contextoEvento(bruto)),
        fecha,
        motivo: `categoría sin efecto contable: ${categoria}`,
      },
    ]
  }

  throw new CategoriaDesconocidaError(categoria, JSON.stringify({ category: bruto.category, created: bruto.created }))
}

/**
 * Exige que `data` de un evento `transfer` o `player_transfer` sea una lista
 * de movimientos no vacía. Una forma inesperada (ausente, objeto, vacía) debe
 * lanzar: un evento sin ningún movimiento no es legítimo, y degradar a cero
 * movimientos perdería dinero (o una baja de plantilla) en silencio.
 */
function exigirMovimientos(valor: unknown, fecha: string, categoria: string): Record<string, unknown>[] {
  if (!Array.isArray(valor) || valor.length === 0) {
    throw new Error(
      `evento ${categoria} (${fecha}): "data" no es una lista de movimientos, o está vacía; ` +
        `un ${categoria} sin movimientos no es legítimo`,
    )
  }
  return valor as Record<string, unknown>[]
}

/** `id_uc` 0 es el mercado de Mister, no un equipo. */
function parte(idUc: unknown, nombre: unknown, campoIdUc: string, campoNombre: string, contexto: string): Parte {
  const idUcEntero = exigirEntero(idUc, campoIdUc, contexto)
  return idUcEntero === 0
    ? { clase: 'mercado' }
    : { clase: 'equipo', nombre: exigirTexto(nombre, campoNombre, contexto), idUc: idUcEntero }
}

function exigirEntero(valor: unknown, campo: string, contexto: string): number {
  if (!Number.isInteger(valor)) {
    throw new Error(`el campo ${campo} no es un entero: ${JSON.stringify(valor)} (${contexto})`)
  }
  return valor as number
}

/**
 * Exige que `valor` sea una cadena no vacía. Un texto ausente o de otro tipo
 * no debe degradarse a `''`: una fecha vacía rompe el orden temporal, un
 * nombre vacío es un dato falso, no un dato ausente marcado como tal.
 */
function exigirTexto(valor: unknown, campo: string, contexto: string): string {
  if (typeof valor !== 'string' || valor === '') {
    throw new Error(`el campo ${campo} no es una cadena no vacía: ${JSON.stringify(valor)} (${contexto})`)
  }
  return valor
}

/**
 * Exige que `valor` sea estrictamente `true` o `false`. `Boolean(x ?? false)`
 * degradaría en silencio cualquier forma inesperada a `false` — y además
 * `Boolean('false')` es `true`, así que ni siquiera es una degradación segura.
 */
function exigirBooleano(valor: unknown, campo: string, contexto: string): boolean {
  if (typeof valor !== 'boolean') {
    throw new Error(`el campo ${campo} no es un booleano: ${JSON.stringify(valor)} (${contexto})`)
  }
  return valor
}

/**
 * Identifica un movimiento de forma segura, sin volcar el objeto entero: un
 * movimiento real trae `fb_id1`/`fb_id2` (identificadores de Facebook de los
 * usuarios implicados, ver aviso de privacidad en docs/api-mister.md), además
 * de fotos de perfil. `id_transfer` es el identificador de la operación y
 * basta para localizarla en el crudo ya guardado en el almacén.
 */
function idMovimiento(m: Record<string, unknown>): string {
  return `id_transfer=${JSON.stringify(m['id_transfer'] ?? null)}`
}

function parsearTransaccion(m: Record<string, unknown>, fecha: string, idEventoCrudo: unknown): Transaccion {
  const operacion = String(m['type'] ?? '')
  if (!OPERACIONES.has(operacion)) {
    throw new OperacionDesconocidaError(operacion, idMovimiento(m))
  }

  const contexto = idMovimiento(m)

  return {
    tipo: 'transaccion',
    fecha,
    jugador: exigirTexto(m['name'], 'name', contexto),
    origen: parte(m['id_uc_from'], m['from'], 'id_uc_from', 'from', contexto),
    destino: parte(m['id_uc_to'], m['to'], 'id_uc_to', 'to', contexto),
    importe: exigirEntero(m['price'], 'price', contexto),
    operacion: operacion as TipoOperacion,
    idTransfer: exigirEntero(m['id_transfer'], 'id_transfer', contexto),
    idEvento: exigirEntero(idEventoCrudo, 'id', contexto),
    idJugador: exigirEntero(m['id'], 'id', contexto),
  }
}

/**
 * Un fichaje de LaLiga real. Si el jugador se queda sin equipo, abandona la
 * competición: eso sí afecta a las plantillas de la liga Fantasy.
 */
function parsearMovimientoDeLaLiga(
  m: Record<string, unknown>,
  fecha: string,
  idEvento: number,
): Evento {
  const idEquipo = m['id_team']
  const sinEquipo = idEquipo === null || idEquipo === undefined || Number(idEquipo) === 0

  if (!sinEquipo) {
    return { tipo: 'ruido', idEvento, fecha, motivo: 'fichaje de LaLiga entre clubes' }
  }

  const contexto = `idEvento=${idEvento}`
  return {
    tipo: 'bajaPlantilla',
    idEvento,
    fecha,
    idJugador: exigirEntero(m['id'], 'id', contexto),
    jugador: exigirTexto(m['name'], 'name', contexto),
  }
}

/** Interpreta `valor` como objeto plano (no array, no null); `undefined` si no lo es. */
function comoObjeto(valor: unknown): Record<string, unknown> | undefined {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Record<string, unknown>) : undefined
}

/**
 * Exige que `valor` sea un objeto: uno de los niveles de anidamiento de
 * `gameweek_end` (`data`, `data.ranking`, `data.ranking.ranking`, o el `user`
 * de una posición). Si falta cualquiera de ellos, lanza nombrando qué nivel
 * falta: un cierre de jornada sin equipos, o una posición sin usuario, nunca
 * es legítimo — sería perder los premios de una jornada entera, o atribuir
 * dinero a un equipo que no se puede identificar.
 */
function exigirNivel(valor: unknown, nivel: string, contexto: string): Record<string, unknown> {
  const objeto = comoObjeto(valor)
  if (!objeto) {
    throw new Error(`cierre de jornada (${contexto}): falta el nivel "${nivel}" en el evento gameweek_end`)
  }
  return objeto
}

/** Exige que `data.ranking.ranking.positions` sea una lista de equipos no vacía. */
function exigirPosiciones(valor: unknown, fecha: string): Record<string, unknown>[] {
  if (!Array.isArray(valor)) {
    throw new Error(
      `cierre de jornada (${fecha}): falta el nivel "data.ranking.ranking.positions" en el evento gameweek_end`,
    )
  }
  if (valor.length === 0) {
    throw new Error(
      `cierre de jornada (${fecha}): "data.ranking.ranking.positions" está vacío; ` +
        `un cierre de jornada sin equipos no es legítimo`,
    )
  }
  return valor as Record<string, unknown>[]
}

/**
 * Identifica una posición de forma segura, sin volcar el objeto entero: cada
 * posición trae un `user` con el correo electrónico y los identificadores de
 * Apple/Google/Facebook del equipo rival (ver aviso de privacidad en
 * docs/api-mister.md). `idUc` es la identidad estable y pública del equipo
 * dentro de la liga.
 */
function idPosicion(p: Record<string, unknown>, indice: number): string {
  return `idUc=${JSON.stringify(p['idUc'] ?? null)}, índice=${indice}`
}

function parsearCierreJornada(datos: unknown, fecha: string, idEventoCrudo: unknown): CierreJornada {
  const d = exigirNivel(datos, 'data', fecha)
  const anidado = exigirNivel(d['ranking'], 'data.ranking', fecha)
  const interno = exigirNivel(anidado['ranking'], 'data.ranking.ranking', fecha)
  const posiciones = exigirPosiciones(interno['positions'], fecha)

  const resultados: ResultadoEquipo[] = posiciones.map((p, indice) => {
    const contexto = idPosicion(p, indice)
    const usuario = exigirNivel(p['user'], 'user', contexto)

    return {
      equipo: exigirTexto(usuario['name'], 'name', contexto),
      idUc: exigirEntero(p['idUc'], 'idUc', contexto),
      // `payment` viene null cuando el equipo no cobra; eso sí es cero.
      premio: p['payment'] === null ? 0 : exigirEntero(p['payment'], 'payment', contexto),
      puntos: exigirEntero(p['points'], 'points', contexto),
      sinPuntuar: exigirBooleano(p['negative'], 'negative', contexto),
      valorPlantilla: exigirEntero(p['teamValue'], 'teamValue', contexto),
    }
  })

  return {
    tipo: 'cierreJornada',
    idEvento: exigirEntero(idEventoCrudo, 'id', `fecha=${fecha}`),
    fecha,
    jornada: exigirEntero(d['gameweek'], 'gameweek', `fecha=${fecha}`),
    idJornada: exigirEntero(d['id_gameweek'], 'id_gameweek', `fecha=${fecha}`),
    resultados,
  }
}
