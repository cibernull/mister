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
import { parsearJugadores, type JugadorMister } from '../recoleccion/parseadorUniverso.js'
import { parsearMercado, MercadoVacioError, type EnVenta } from '../recoleccion/parseadorMercado.js'
import { parsearClasificacion, parsearClubes, type PuestoClasificacion } from '../recoleccion/parseadorClasificacion.js'
import { parsearSaldo, type LibroDeCaja } from '../recoleccion/parseadorSaldo.js'
import type { PaginaCruda, Volcado } from './feed.js'

/** Límite de páginas por pasada: una red de seguridad, no un objetivo. */
const MAX_LOTES = 200
/**
 * El tope cuando toca rellenar el hueco del principio.
 *
 * El feed entero de esta liga son unas doscientas cinco páginas, así que con el
 * tope normal el relleno se quedaría siempre a una página del final y volvería
 * a empezar desde cero en la pasada siguiente, sin terminar nunca. Es una
 * operación de una vez: unos minutos.
 */
const MAX_LOTES_COMPLETANDO = 500

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
/**
 * Baja del feed lo que falte.
 *
 * Normalmente para en cuanto toca terreno conocido: dos páginas enteras más
 * viejas que lo guardado y ya está, que son tres peticiones cada media hora.
 *
 * `completar` desactiva ese freno, y existe por un fallo real. El feed se pagina
 * de lo nuevo a lo viejo, así que parar al primer solape solo funciona si lo
 * guardado llega hasta el principio. Si tiene un hueco al fondo —porque la
 * caché se perdió, porque se empezó a medias— ese hueco no se rellena jamás:
 * cada pasada toca terreno conocido enseguida y se da por satisfecha. Así
 * estuvo el runner de GitHub con 238 traspasos donde había 275, y las cuentas
 * de los rivales salían con casi veinte millones de diferencia sin que nada
 * chirriara.
 */
export async function recolectarFeed(
  cliente: Cliente,
  hasta: string | null,
  ahora: () => string = cuandoEsHoy,
  completar = false,
): Promise<ResultadoFeed> {
  const nuevas: PaginaCruda[] = []
  let offset = 0
  let lotes = 0
  let solapadas = 0

  const tope = completar ? MAX_LOTES_COMPLETANDO : MAX_LOTES

  while (lotes < tope) {
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

    if (!completar && hasta !== null && paginaEnteraAnteriorA(cuerpo, hasta)) {
      solapadas += 1
      if (solapadas >= 2) return { nuevas, lotes, agotado: false }
    }
  }

  // Rellenando el hueco es normal llegar al tope sin agotar el feed: se para y
  // la pasada siguiente sigue donde esta lo dejó. Solo es un error cuando se
  // suponía que quedaba poco por bajar.
  if (completar) return { nuevas, lotes, agotado: false }
  throw new Error(`me planté en ${tope} lotes sin alcanzar lo ya guardado; algo va mal`)
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
 * Las plantillas de los ocho equipos, leídas de sus páginas.
 *
 * El feed no vale para esto: hay altas que Mister no publica como traspaso, y
 * reconstruir la plantilla sumando traspasos deja jugadores fuera.
 *
 * De paso salen los slugs de nombre. Ya no hacen falta para pedir una ficha
 * —`/players/{id}/x` la devuelve igual; lo que no vale es el id a secas, que
 * redirige a las noticias— pero se siguen guardando porque son la única forma
 * de enlazar a la página de un jugador en Mister.
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
export type DatosFicha = {
  valor: number
  nombre: string
  posicion: number
  /** Lo que ha cambiado su valor desde ayer. */
  dia: number
  /** Lo que ha cambiado en los últimos 30 días. */
  mes: number
}

export async function recolectarValores(
  cliente: Cliente,
  ids: string[],
  slugs: Map<string, string>,
): Promise<{ valores: Map<string, DatosFicha>; fallidos: { id: string; motivo: string }[] }> {
  const valores = new Map<string, DatosFicha>()
  const fallidos: { id: string; motivo: string }[] = []

  for (const id of ids) {
    // El slug es decorativo: cualquier cosa que no esté vacía vale. Antes se
    // dejaba fuera al jugador cuyo slug no se conocía, y eso descartaba justo a
    // los que no aparecen en ninguna página de equipo.
    const slug = slugs.get(String(id)) ?? 'x'
    try {
      const html = await cliente.pedirPagina(`/players/${id}/${slug}`)
      const serie = parsearSerieValores(html)
      const ultimo = serie[serie.length - 1]
      if (ultimo === undefined) throw new Error('la serie de valores vino vacía')
      const ficha = parsearFicha(html)
      // La serie diaria da gratis lo que antes venía de una captura a mano: lo
      // que sube o baja en un día y en un mes. Si la serie es corta se compara
      // con el punto más antiguo que haya, que es lo más honesto que se puede.
      const ayer = serie[serie.length - 2] ?? ultimo
      const haceUnMes = serie[Math.max(0, serie.length - 31)] ?? serie[0]!
      valores.set(id, {
        valor: ultimo.valor,
        nombre: ficha.nombre,
        posicion: ficha.posicion,
        dia: ultimo.valor - ayer.valor,
        mes: ultimo.valor - haceUnMes.valor,
      })
    } catch (e) {
      fallidos.push({ id, motivo: e instanceof Error ? e.message : String(e) })
    }
  }

  return { valores, fallidos }
}

/**
 * El censo entero de jugadores de la competición.
 *
 * Once peticiones y unos segundos, frente a las ciento veintidós fichas de una
 * en una que costaba antes saber solo los valores. Y a cambio se sabe de los
 * 523, no de los 238 que habían pasado alguna vez por el feed.
 *
 * Se recorre varias veces, y esto no es prudencia: es que **una sola pasada no
 * trae a todos**. El buscador de Mister reordena su lista entre peticiones, así
 * que al paginar hay quien sale dos veces —y se descarta— y quien no sale
 * ninguna. Tres pasadas seguidas, medidas el 7 de septiembre de 2026, dieron
 * 522, 495 y 523 jugadores sobre el mismo censo. Los que faltaban se perdían en
 * silencio: la página enseñaba menos jugadores de los que hay, y las plantillas
 * de los rivales salían cortas contra las cifras del propio Mister.
 *
 * La cura es unir pasadas hasta que una entera no aporte a nadie nuevo. Con eso
 * converge en dos o tres —cuesta unos segundos más y quita el azar de en medio—.
 *
 * Dentro de cada pasada se para al recibir una página corta, que es como el
 * buscador dice que ya no queda nada. El tope de páginas es una red por si eso
 * deja de cumplirse: sin él, un cambio en el servidor sería un bucle infinito.
 */
const MAX_PAGINAS_JUGADORES = 60
const JUGADORES_POR_PAGINA = 50

/**
 * Cuántas veces se recorre el censo como mucho.
 *
 * Converge en dos o tres. Cuatro deja margen para un día malo sin convertir la
 * actualización en algo que tarda un minuto.
 */
export const PASADAS_MAXIMAS = 4

export async function recolectarUniverso(cliente: Cliente): Promise<JugadorMister[]> {
  const todos: JugadorMister[] = []
  const vistos = new Set<string>()

  for (let pasada = 1; pasada <= PASADAS_MAXIMAS; pasada += 1) {
    const antes = vistos.size
    let acabo = false

    for (let pagina = 0; pagina < MAX_PAGINAS_JUGADORES; pagina += 1) {
      const leidos = parsearJugadores(await cliente.pedirJugadores(pagina * JUGADORES_POR_PAGINA))
      for (const j of leidos) {
        // El mismo jugador puede venir en dos pasadas; la primera lectura vale.
        if (vistos.has(j.id)) continue
        vistos.add(j.id)
        todos.push(j)
      }
      if (leidos.length < JUGADORES_POR_PAGINA) { acabo = true; break }
    }

    if (!acabo) throw new Error(`el buscador no se acabó en ${MAX_PAGINAS_JUGADORES} páginas; algo va mal`)
    // Una pasada entera sin nadie nuevo: ya están todos.
    if (vistos.size === antes) break
  }

  return todos
}

/**
 * Los jugadores que están hoy a la venta.
 *
 * Un mercado vacío se devuelve como lista vacía en vez de romper la pasada:
 * pasa de verdad durante la rotación, y no vale la pena tirar una
 * actualización buena por una etiqueta.
 */
export async function recolectarMercado(cliente: Cliente): Promise<EnVenta[]> {
  try {
    return parsearMercado(await cliente.pedirPagina('/market'))
  } catch (e) {
    if (e instanceof MercadoVacioError) return []
    throw e
  }
}

/**
 * La clasificación oficial, que es contra lo que se contrastan las cuentas.
 *
 * La misma página lleva dentro el diccionario de clubes reales, así que se
 * aprovecha el viaje: sin él la página enseñaría «rival 19» en vez de «Sevilla».
 */
export async function recolectarClasificacion(
  cliente: Cliente,
): Promise<{ clasificacion: PuestoClasificacion[]; clubes: Map<number, string> }> {
  const html = await cliente.pedirPagina('/standings')
  return { clasificacion: parsearClasificacion(html), clubes: parsearClubes(html) }
}

/** El libro de caja propio: la única fuente exacta del saldo. */
export async function recolectarCaja(cliente: Cliente): Promise<LibroDeCaja> {
  return parsearSaldo(await cliente.pedirSaldo())
}
