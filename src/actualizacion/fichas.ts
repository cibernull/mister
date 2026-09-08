/**
 * La pasada larga: leer la ficha de todos los jugadores, una vez al día.
 *
 *     npm run fichas
 *
 * La actualización normal tarda veinticinco segundos porque no pide fichas: se
 * apaña con el censo, que da valor, puntos, media, cláusula y dueño de los 523
 * en once peticiones. Pero hay cosas que **solo** están en la ficha de cada
 * jugador, y que son justo las que ayudan a decidir a quién fichar:
 *
 *   · los goles y las tarjetas;
 *   · la media en casa y la media fuera, que suelen no parecerse en nada;
 *   · cuántas veces ha salido de inicio y cuántas del banquillo;
 *   · si Mister lo da por titular en el próximo partido;
 *   · y la serie diaria de valor, de la que sale el «% este mes».
 *
 * Lo que NO hace falta pedir aquí es la serie de valores: la pasada normal ya
 * guarda el valor de los 523 cada día desde el censo, en once peticiones. Se
 * seguía pidiendo por inercia, y era la única razón por la que había que
 * visitar a todo el mundo todos los días.
 *
 * Porque el resto de campos —goles, tarjetas, medias, titularidades— solo
 * cambian **cuando el jugador juega**, y eso se sabe mirando el censo: si sus
 * partidos no han subido, su ficha es la misma que ayer y pedirla es gastar un
 * minuto para reescribir lo mismo.
 *
 * Así que se pide solo a quien le ha pasado algo, con un tope por pasada para
 * que esto no pueda volver a bloquear nada. El 7 de septiembre de 2026 una
 * pasada de estas se quedó cuarenta y nueve minutos colgada y congeló el saldo,
 * las cláusulas y el mercado detrás de ella.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { crearCliente } from '../recoleccion/cliente.js'
import { obtenerCredenciales } from '../sesion/credenciales.js'
import { parsearSerieValores } from '../recoleccion/parseadorValores.js'
import { parsearFicha, type Ficha } from '../recoleccion/parseadorFicha.js'
import { recolectarUniverso } from './recolectar.js'
import {
  extraerTemporadaAnterior,
  podar,
  type Historico,
  type SerieTemporadaAnterior,
} from './historicoValores.js'

const RAIZ = process.cwd()
const DATOS = join(RAIZ, 'modulo', 'datos')
const HISTORICO = join(DATOS, 'historico-valores.json')
const HISTORICO_ANTERIOR = join(DATOS, 'historico-valores-anterior.json')
const FICHAS = join(DATOS, 'fichas.json')

/**
 * Lo que se guarda de cada jugador, con el día en que se leyó y los partidos
 * que llevaba entonces. Los partidos son la clave de todo: mientras no suban,
 * la ficha guardada sigue valiendo.
 */
export type FichaGuardada = Omit<Ficha, 'jornadas'> & { dia: string; partidos?: number; jornadas?: Ficha['jornadas'] }

/**
 * Cuántas fichas se piden como mucho en una pasada.
 *
 * A un segundo por petición son unos dos minutos. Después de una jornada
 * pueden cambiar trescientas, y entonces se reparten entre las pasadas
 * siguientes: media hora después va la próxima tanda. Preferible ir al día en
 * hora y media que bloquear la liga durante cincuenta minutos.
 */
export const MAXIMO_POR_PASADA = 120

/** Cada cuántos días se refresca una ficha aunque su jugador no haya jugado. */
export const DIAS_ANTES_DE_REFRESCAR = 7

/**
 * A quién hay que pedirle la ficha, y en qué orden.
 *
 * Primero los que no tenemos, luego los que han jugado desde la última vez
 * —son los únicos cuyos datos han cambiado de verdad— y por último los que
 * llevan una semana sin refrescarse, para que el pronóstico de titularidad no
 * envejezca en silencio. Los míos van siempre delante: de ellos sale el once.
 */
export function aQuienPedir(
  universo: { id: string; partidos: number }[],
  fichas: Record<string, FichaGuardada>,
  hoy: string,
  mios: Set<string> = new Set(),
  tope = MAXIMO_POR_PASADA,
): string[] {
  const dias = (dia: string | undefined) =>
    dia === undefined ? Infinity : Math.round((Date.parse(hoy) - Date.parse(dia)) / 86400000)

  const motivo = (j: { id: string; partidos: number }): number | null => {
    const f = fichas[j.id]
    if (f === undefined) return 0                          // nunca leída
    if (f.partidos === undefined) return 1                 // guardada antes de saber esto
    // Guardada antes de que se leyeran las jornadas. Sin esto, una ficha que no
    // ha cambiado de partidos no se vuelve a pedir nunca y el dato nuevo no
    // llega jamás a los jugadores que ya estaban.
    if (f.jornadas === undefined) return 1
    if (f.partidos !== j.partidos) return 2                // ha jugado
    if (dias(f.dia) >= DIAS_ANTES_DE_REFRESCAR) return 3   // lleva una semana
    return null
  }

  return universo
    .map((j) => ({ id: j.id, m: motivo(j), mio: mios.has(j.id) ? 0 : 1, edad: dias(fichas[j.id]?.dia) }))
    .filter((x): x is { id: string; m: number; mio: number; edad: number } => x.m !== null)
    .sort((a, b) => a.mio - b.mio || a.m - b.m || b.edad - a.edad)
    .slice(0, tope)
    .map((x) => x.id)
}

const paso = (t: string) => process.stderr.write(`${t}\n`)
const leer = <T>(ruta: string, sino: T): T =>
  existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as T) : sino
const escribir = (ruta: string, x: unknown) => writeFileSync(ruta, `${JSON.stringify(x, null, 1)}\n`)

async function main(): Promise<void> {
  const cliente = crearCliente({ credenciales: obtenerCredenciales(join(RAIZ, '.sesion')) })

  paso('Pidiendo el censo…')
  const universo = await recolectarUniverso(cliente)

  const historico = leer<Historico>(HISTORICO, {})
  const anterior = leer<Record<string, SerieTemporadaAnterior>>(HISTORICO_ANTERIOR, {})
  const fichas = leer<Record<string, FichaGuardada>>(FICHAS, {})
  const hoy = new Date().toISOString().slice(0, 10)

  // Los míos van primero porque de ellos sale el once, y el pronóstico de
  // titularidad de la próxima jornada solo está en la ficha.
  const liga = leer<{ equipos?: { nombre: string; mio?: boolean }[]; inicioDeLiga?: string }>(join(DATOS, 'liga.json'), {})
  const inicioTemporada = liga.inicioDeLiga?.slice(0, 10) ?? `${hoy.slice(0, 4)}-08-01`
  const miEquipo = liga.equipos?.find((e) => e.mio)?.nombre
  const plantillas = leer<Record<string, (string | number)[]>>(join(DATOS, 'plantillas.json'), {})
  const mios = new Set((miEquipo ? (plantillas[miEquipo] ?? []) : []).map(String))
  const deFicha = aQuienPedir(universo, fichas, hoy, mios)
  // La serie anterior se incorpora progresivamente en las mismas pasadas. Los
  // jugadores propios van primero y nunca se vuelven a pedir si ya la tienen.
  const sinAnterior = universo
    .filter((j) => anterior[j.id] === undefined)
    .sort((a, b) => Number(mios.has(b.id)) - Number(mios.has(a.id)))
  const ids = [...new Set([...deFicha, ...sinAnterior.map((j) => j.id)])].slice(0, MAXIMO_POR_PASADA)
  const pendientes = new Set(ids)
  const porHacer = universo.filter((j) => pendientes.has(j.id))
  const totalesFicha = universo.filter((j) => aQuienPedir([j], fichas, hoy, mios, 1).length > 0).length
  const totales = new Set([
    ...universo.filter((j) => aQuienPedir([j], fichas, hoy, mios, 1).length > 0).map((j) => j.id),
    ...sinAnterior.map((j) => j.id),
  ]).size

  if (porHacer.length === 0) {
    paso(`${universo.length} jugadores y ninguna ficha que refrescar: todas al día.`)
    return
  }
  paso(
    `${universo.length} jugadores · ${totales} fichas por refrescar · pido ${porHacer.length} en esta pasada` +
      (totales > porHacer.length ? `, las ${totales - porHacer.length} restantes en las siguientes` : ''),
  )

  const fallidos: string[] = []
  let hechos = 0

  for (const j of porHacer) {
    try {
      // El slug del enlace es decorativo: `/players/{id}/x` devuelve la ficha
      // igual. Lo que no vale es el id a secas, que redirige a las noticias.
      const html = await cliente.pedirPagina(`/players/${j.id}/x`)
      const serie = parsearSerieValores(html)
      for (const p of serie) (historico[p.fecha] ??= {})[j.id] = p.valor
      const previa = extraerTemporadaAnterior(serie, inicioTemporada)
      if (previa !== null) anterior[j.id] = previa
      const f = parsearFicha(html)
      // Solo las jornadas jugadas: las 38 de la temporada, para 522 jugadores,
      // engordan el fichero y la página sin decir nada —las que no se han
      // disputado solo traen el rival, y eso ya está en el censo.
      fichas[j.id] = {
        ...f,
        jornadas: f.jornadas.filter((x) => x.puntos !== null || x.como !== null),
        dia: hoy,
        partidos: j.partidos,
      }
      hechos += 1
    } catch (e) {
      fallidos.push(`${j.nombre} (${j.id}): ${e instanceof Error ? e.message : String(e)}`)
    }
    // Se guarda sobre la marcha: si esto se corta a mitad, lo leído se queda.
    if (hechos % 25 === 0) {
      guardar(historico, anterior, fichas)
      paso(`  ${hechos}/${porHacer.length}…`)
    }
  }

  guardar(historico, anterior, fichas)
  const dias = Object.keys(historico).sort()
  paso(`Listo: ${hechos} fichas refrescadas (${totalesFicha} por datos actuales), ${dias.length} días actuales y ${Object.keys(anterior).length} series anteriores.`)
  if (fallidos.length > 0) paso(`No pude con ${fallidos.length}:\n  ${fallidos.join('\n  ')}`)
}

function guardar(
  historico: Historico,
  anterior: Record<string, SerieTemporadaAnterior>,
  fichas: Record<string, FichaGuardada>,
): void {
  podar(historico)
  escribir(HISTORICO, historico)
  escribir(HISTORICO_ANTERIOR, anterior)
  escribir(FICHAS, fichas)
}

main().catch((e: unknown) => {
  // El error entero no: por ahí podrían asomar las credenciales.
  process.stderr.write(`No pude terminar: ${e instanceof Error ? e.message : 'error desconocido'}\n`)
  process.exit(1)
})
