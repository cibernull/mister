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
  parsearJornadasConocidas,
  type AlineacionJornada,
  type JornadaConocida,
} from '../recoleccion/parseadorJornada.js'

const RAIZ = process.cwd()
const SALIDA = join(RAIZ, 'modulo', 'datos', 'alineaciones.json')

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
export function aQuePedir(conocidas: JornadaConocida[], tengo: Map<number, AlineacionJornada>): JornadaConocida[] {
  return conocidas.filter((g) => {
    if (g.estado === EN_JUEGO) return true
    if (g.estado !== TERMINADA) return false
    return !tengo.has(g.jornada)
  })
}

/** Baja las alineaciones que falten y devuelve todas, ordenadas por jornada. */
export async function recolectarAlineaciones(
  cliente: Cliente,
  guardadas: AlineacionJornada[],
  avisar: (t: string) => void = () => {},
): Promise<AlineacionJornada[]> {
  const tengo = new Map(guardadas.map((a) => [a.jornada, a]))
  // La primera llamada vale para cualquier id: solo se le miran las jornadas.
  const conocidas = parsearJornadasConocidas(await cliente.pedirJornada())
  const pendientes = aQuePedir(conocidas, tengo)

  for (const g of pendientes) {
    try {
      tengo.set(g.jornada, parsearAlineacion(await cliente.pedirJornada(g.id), g.jornada, g.id))
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
  const paso = (t: string) => process.stderr.write(`${t}\n`)

  const todas = await recolectarAlineaciones(cliente, guardadas, paso)
  writeFileSync(SALIDA, `${JSON.stringify(todas, null, 1)}\n`)
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
