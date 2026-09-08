/**
 * Las alineaciones de las jornadas ya disputadas.
 *
 *     npm run alineaciones
 *
 * Es lo único que cuenta qué pusiste de verdad cada jornada. El once que
 * calcula esta aplicación es una recomendación de hoy: no sabe nada de lo que
 * alineaste hace tres semanas, ni de si acertaste.
 *
 * Una jornada terminada no vuelve a cambiar, así que solo se piden las que
 * faltan. La que está en curso sí cambia —los puntos suben mientras se juega—,
 * de modo que esa se vuelve a pedir siempre.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crearCliente, type Cliente } from '../recoleccion/cliente.js'
import { obtenerCredenciales } from '../sesion/credenciales.js'
import {
  parsearAlineacion,
  parsearEventosDeJornada,
  parsearJornadasConocidas,
  type AlineacionJornada,
  type EventoConMinuto,
  type JornadaConocida,
} from '../recoleccion/parseadorJornada.js'

const RAIZ = process.cwd()
const SALIDA = join(RAIZ, 'modulo', 'datos', 'alineaciones.json')
const EVENTOS = join(RAIZ, 'modulo', 'datos', 'eventos-jornada.json')

/**
 * Lo que hizo cada jugador de la competición en cada jornada, con el minuto.
 *
 * Viene en la misma respuesta que la alineación, así que no cuesta ni una
 * petición más. La ficha de Mister pinta los iconos pero no dice cuándo: ni el
 * minuto del gol, ni el del cambio. Y trae categorías que la ficha no
 * distingue —roja, gol en propia, penalti fallado—.
 */
export type EventosPorJornada = Record<string, Record<string, EventoConMinuto[]>>

/**
 * Los tres estados que usa Mister, comprobados contra su respuesta:
 * `finished` la que ya no cambia, `ongoing` la que se está jugando y
 * `unstarted` la que no ha empezado.
 */
export const TERMINADA = 'finished'
export const EN_JUEGO = 'ongoing'

/**
 * Cuáles hay que pedir: las que no tenemos y la que se está jugando.
 *
 * Una terminada no vuelve a cambiar, así que se pide una vez y ya. La que está
 * en juego sube de puntos mientras se juega, de modo que esa se repite siempre.
 * Y las que no han empezado no se piden: sin este filtro se traían las treinta
 * y ocho en cada pasada, con treinta y tres alineaciones que no existen todavía
 * y que además llegan rellenas con la plantilla de hoy, como si las hubieras
 * puesto tú.
 */
export function aQuePedir(
  conocidas: JornadaConocida[],
  tengo: Map<number, AlineacionJornada>,
  conEventos: Set<number> = new Set(),
): JornadaConocida[] {
  return conocidas.filter((g) => {
    if (g.estado === EN_JUEGO) return true
    if (g.estado !== TERMINADA) return false
    // Falta la alineación **o** faltan sus eventos. Sin lo segundo, las que ya
    // estaban guardadas de antes nunca llegaban a tener el minuto de nada: se
    // daban por hechas y no se volvían a pedir.
    return !tengo.has(g.jornada) || !conEventos.has(g.jornada)
  })
}

/** Baja las alineaciones que falten y devuelve todas, ordenadas por jornada. */
export async function recolectarAlineaciones(
  cliente: Cliente,
  guardadas: AlineacionJornada[],
  avisar: (t: string) => void = () => {},
  eventos: EventosPorJornada = {},
): Promise<AlineacionJornada[]> {
  const tengo = new Map(guardadas.map((a) => [a.jornada, a]))
  // La primera llamada vale para cualquier id: solo se le miran las jornadas.
  const conocidas = parsearJornadasConocidas(await cliente.pedirJornada())
  const pendientes = aQuePedir(conocidas, tengo, new Set(Object.keys(eventos).map(Number)))

  for (const g of pendientes) {
    try {
      const json = await cliente.pedirJornada(g.id)
      tengo.set(g.jornada, parsearAlineacion(json, g.jornada, g.id))
      // Del mismo viaje salen los eventos de toda la liga, con su minuto.
      const suyos = parsearEventosDeJornada(json)
      if (suyos.size > 0) eventos[String(g.jornada)] = Object.fromEntries(suyos)
    } catch (e) {
      avisar(`no pude con la jornada ${g.jornada}: ${e instanceof Error ? e.message : 'error'}`)
    }
  }
  // Solo salen las que se han jugado o se están jugando: si una vez se guardó
  // de más, no se arrastra.
  const juegan = new Set(conocidas.filter((g) => g.estado === TERMINADA || g.estado === EN_JUEGO).map((g) => g.jornada))
  return [...tengo.values()].filter((a) => juegan.has(a.jornada)).sort((a, b) => a.jornada - b.jornada)
}

async function main(): Promise<void> {
  const cliente = crearCliente({ credenciales: obtenerCredenciales(join(RAIZ, '.sesion')) })
  const guardadas = existsSync(SALIDA) ? (JSON.parse(readFileSync(SALIDA, 'utf8')) as AlineacionJornada[]) : []
  const eventos = existsSync(EVENTOS) ? (JSON.parse(readFileSync(EVENTOS, 'utf8')) as EventosPorJornada) : {}
  const paso = (t: string) => process.stderr.write(`${t}\n`)

  const todas = await recolectarAlineaciones(cliente, guardadas, paso, eventos)
  writeFileSync(SALIDA, `${JSON.stringify(todas, null, 1)}\n`)
  writeFileSync(EVENTOS, `${JSON.stringify(eventos)}\n`)
  const cuantos = Object.values(eventos).reduce((t, j) => t + Object.keys(j).length, 0)
  paso(`${cuantos} jugadores con eventos y minuto, en ${Object.keys(eventos).length} jornadas`)
  paso(
    `${todas.length} jornadas con alineación: ${todas
      .map((a) => `J${a.jornada} ${a.puntos ?? '—'} pts`)
      .join(' · ')}`,
  )
}

if (process.argv[1]?.endsWith('alineaciones.ts')) {
  main().catch((e: unknown) => {
    process.stderr.write(`No pude terminar: ${e instanceof Error ? e.message : 'error desconocido'}\n`)
    process.exit(1)
  })
}
