/**
 * Recolección incremental: pedir solo lo nuevo.
 *
 * El feed se pagina de lo más reciente a lo más antiguo, así que para
 * ponerse al día basta con bajar desde arriba hasta pisar terreno conocido.
 * No hay que volver a recorrer el histórico entero cada vez.
 */
import type { Cliente } from '../recoleccion/cliente.js'
import { contarEventosBrutos } from '../recoleccion/pagina.js'
import { parsearSerieValores } from '../recoleccion/parseadorValores.js'
import { parsearPlantilla } from '../recoleccion/parseadorPlantilla.js'
import { parsearFicha } from '../recoleccion/parseadorFicha.js'
import type { PaginaCruda, Volcado } from './feed.js'

/** Límite de páginas por pasada: una red de seguridad, no un objetivo. */
const MAX_LOTES = 200

export type ResultadoFeed = {
  nuevas: PaginaCruda[]
  lotes: number
  /** true si se llegó al final del feed en vez de a terreno conocido. */
  agotado: boolean
}

const cuandoEsHoy = () => new Date().toISOString()

/**
 * Baja páginas del feed hasta reencontrar lo ya guardado.
 *
 * Se para en cuanto una página entera cae por debajo de `hasta`, el momento
 * del evento más reciente que ya se tenía. Se pide una página de más a
 * propósito: el feed reordena y agrupa eventos, y cortar en el primer solape
 * podría dejar fuera algo publicado con retraso.
 */
export async function recolectarFeed(
  cliente: Cliente,
  hasta: string | null,
  ahora: () => string = cuandoEsHoy,
): Promise<ResultadoFeed> {
  const nuevas: PaginaCruda[] = []
  let offset = 0
  let lotes = 0
  let solapadas = 0

  while (lotes < MAX_LOTES) {
    const cuerpo = await cliente.pedirLote(offset)
    lotes += 1

    const n = contarEventosBrutos(cuerpo)
    // Cero eventos brutos es el marcador de fin del feed. Ojo: `parsearPaginaFeed`
    // ya distingue el fin legítimo de un rechazo, y un 401 nunca llega hasta aquí
    // porque el cliente lo convierte en error.
    if (n === 0) return { nuevas, lotes, agotado: true }

    nuevas.push({ offset, cuerpo, capturadaEn: ahora() })
    // El offset avanza con los eventos BRUTOS que el feed dice haber servido,
    // no con los que uno haya sabido interpretar. Confundir ambas cifras dejó
    // inservible al recolector en la Fase 1.
    offset += n

    if (hasta !== null && paginaEnteraAnteriorA(cuerpo, hasta)) {
      solapadas += 1
      if (solapadas >= 2) return { nuevas, lotes, agotado: false }
    }
  }

  throw new Error(`me planté en ${MAX_LOTES} lotes sin alcanzar lo ya guardado; algo va mal`)
}

/** true si ningún evento de la página es posterior a `hasta`. */
function paginaEnteraAnteriorA(cuerpo: string, hasta: string): boolean {
  let datos: { data?: unknown }
  try {
    datos = JSON.parse(cuerpo)
  } catch {
    return false
  }
  const eventos = Array.isArray(datos.data) ? datos.data : []
  if (eventos.length === 0) return false
  return eventos.every((e) => {
    const creado = (e as Record<string, unknown>)['created']
    return typeof creado === 'string' && creado <= hasta
  })
}

/**
 * Añade las páginas nuevas al volcado, sin tirar las viejas.
 *
 * Un mismo evento puede quedar en varias páginas; deduplicarlo es tarea de
 * `extraerHechos`, que además se queda con la captura más reciente. Guardar
 * el crudo entero es lo que permite rehacer las cuentas si más adelante se
 * descubre que se estaba interpretando algo mal.
 */
export function fundir(volcado: Volcado, nuevas: PaginaCruda[]): Volcado {
  return { paginas: [...volcado.paginas, ...nuevas] }
}

/**
 * El slug de nombre de cada jugador, leído de las páginas de los equipos.
 *
 * La ficha de un jugador **exige** el slug: `/players/20449` redirige al feed
 * y solo `/players/20449/fer-nino` responde. El id suelto no basta, y el único
 * sitio donde están emparejados es la página del equipo que lo tiene.
 *
 * Son ocho peticiones, y como los slugs no cambian se guardan en caché: en las
 * siguientes pasadas no hace falta volver a pedirlas.
 */
export async function recolectarPlantillas(
  cliente: Cliente,
  equipos: { nombre: string; url: string }[],
): Promise<{
  plantillas: Map<string, string[]>
  slugs: Map<string, string>
  fallidos: { equipo: string; motivo: string }[]
}> {
  const plantillas = new Map<string, string[]>()
  const slugs = new Map<string, string>()
  const fallidos: { equipo: string; motivo: string }[] = []

  for (const e of equipos) {
    try {
      const jugadores = parsearPlantilla(await cliente.pedirPagina(e.url))
      plantillas.set(e.nombre, jugadores.map((j) => String(j.idJugador)))
      for (const j of jugadores) slugs.set(String(j.idJugador), j.slug)
    } catch (err) {
      // Sin la página de un equipo no se inventa su plantilla: se dice y se
      // deja fuera, que el resto de las cuentas siguen siendo buenas.
      fallidos.push({ equipo: e.nombre, motivo: err instanceof Error ? err.message : String(err) })
    }
  }

  return { plantillas, slugs, fallidos }
}

/**
 * Pide la ficha de cada jugador y se queda con su valor de hoy.
 *
 * Hace falta para los jugadores que siguen en la plantilla del reparto y por
 * los que nadie ha pujado nunca: no aparecen en el feed, así que su ficha es
 * el único sitio donde está su valor. Se piden una vez y se guardan; en las
 * siguientes pasadas solo se piden los que falten.
 *
 * Un fallo suelto no aborta la pasada: se devuelve aparte para poder decir de
 * quién no se sabe el valor, en vez de dar una plantilla corta sin avisar.
 */
export type DatosFicha = { valor: number; nombre: string; posicion: number }

export async function recolectarValores(
  cliente: Cliente,
  ids: string[],
  slugs: Map<string, string>,
): Promise<{ valores: Map<string, DatosFicha>; fallidos: { id: string; motivo: string }[] }> {
  const valores = new Map<string, DatosFicha>()
  const fallidos: { id: string; motivo: string }[] = []

  for (const id of ids) {
    const slug = slugs.get(String(id))
    if (slug === undefined) {
      fallidos.push({ id, motivo: 'no sé su slug, así que no puedo pedir su ficha' })
      continue
    }
    try {
      const html = await cliente.pedirPagina(`/players/${id}/${slug}`)
      const serie = parsearSerieValores(html)
      const ultimo = serie[serie.length - 1]
      if (ultimo === undefined) throw new Error('la serie de valores vino vacía')
      const ficha = parsearFicha(html)
      valores.set(id, { valor: ultimo.valor, nombre: ficha.nombre, posicion: ficha.posicion })
    } catch (e) {
      fallidos.push({ id, motivo: e instanceof Error ? e.message : String(e) })
    }
  }

  return { valores, fallidos }
}
