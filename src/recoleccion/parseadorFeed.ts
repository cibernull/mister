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
  /** El histórico se agota cuando el servidor devuelve `data` vacío. */
  agotado: boolean
}

/**
 * Categoría de feed no catalogada. Detiene la recolección a propósito:
 * descartarla produciría una contabilidad plausible y equivocada.
 */
export class CategoriaDesconocidaError extends Error {
  readonly categoria: string
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
  'player_transfer', // fichaje de LaLiga real, no de la liga Fantasy
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
  category?: string
  created?: string
  data?: unknown
}

export function parsearPaginaFeed(cuerpo: string): PaginaFeed {
  const respuesta = JSON.parse(cuerpo) as { data?: EventoBruto[] }
  const brutos = respuesta.data ?? []

  return {
    eventos: brutos.flatMap(parsearEvento),
    agotado: brutos.length === 0,
  }
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
  const fecha = bruto.created ?? ''

  if (categoria === 'transfer') {
    return comoLista(bruto.data).map((m) => parsearTransaccion(m, fecha))
  }

  if (categoria === 'gameweek_end') {
    return [parsearCierreJornada(bruto.data, fecha)]
  }

  if (CATEGORIAS_RUIDO.has(categoria)) {
    return [{ tipo: 'ruido', fecha, motivo: `categoría sin efecto contable: ${categoria}` }]
  }

  throw new CategoriaDesconocidaError(categoria, JSON.stringify(bruto))
}

function comoLista(valor: unknown): Record<string, unknown>[] {
  if (Array.isArray(valor)) return valor as Record<string, unknown>[]
  if (valor && typeof valor === 'object') return Object.values(valor as object)
  return []
}

/** `id_uc` 0 es el mercado de Mister, no un equipo. */
function parte(idUc: unknown, nombre: unknown): Parte {
  return Number(idUc) === 0
    ? { clase: 'mercado' }
    : { clase: 'equipo', nombre: String(nombre ?? '') }
}

function exigirEntero(valor: unknown, campo: string, crudo: unknown): number {
  if (!Number.isInteger(valor)) {
    throw new Error(`el campo ${campo} no es un entero: ${JSON.stringify(valor)} en ${JSON.stringify(crudo)}`)
  }
  return valor as number
}

function parsearTransaccion(m: Record<string, unknown>, fecha: string): Transaccion {
  const operacion = String(m['type'] ?? '')
  if (!OPERACIONES.has(operacion)) {
    throw new OperacionDesconocidaError(operacion, JSON.stringify(m))
  }

  return {
    tipo: 'transaccion',
    fecha,
    jugador: String(m['name'] ?? ''),
    origen: parte(m['id_uc_from'], m['from']),
    destino: parte(m['id_uc_to'], m['to']),
    importe: exigirEntero(m['price'], 'price', m),
    operacion: operacion as TipoOperacion,
  }
}

function parsearCierreJornada(datos: unknown, fecha: string): CierreJornada {
  const d = (datos ?? {}) as Record<string, unknown>
  const anidado = (d['ranking'] ?? {}) as Record<string, unknown>
  const interno = (anidado['ranking'] ?? {}) as Record<string, unknown>
  const posiciones = comoLista(interno['positions'])

  const resultados: ResultadoEquipo[] = posiciones.map((p) => {
    const usuario = (p['user'] ?? {}) as Record<string, unknown>

    return {
      equipo: String(usuario['name'] ?? ''),
      // `payment` viene null cuando el equipo no cobra; eso sí es cero.
      premio: p['payment'] === null ? 0 : exigirEntero(p['payment'], 'payment', p),
      puntos: exigirEntero(p['points'], 'points', p),
      sinPuntuar: Boolean(p['negative'] ?? false),
    }
  })

  return {
    tipo: 'cierreJornada',
    fecha,
    jornada: exigirEntero(d['gameweek'], 'gameweek', d),
    resultados,
  }
}
