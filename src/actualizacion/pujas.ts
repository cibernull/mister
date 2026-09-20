/**
 * Recalibrar la caja de los rivales con lo único que Mister publica de ella:
 * las pujas.
 *
 * De un rival Mister no enseña nunca el saldo; se reconstruye desde el feed y
 * no hay con qué contrastarlo. Pero al resolverse una subasta sí publica lo
 * que pujó cada uno (`other_bids`), y una puja es un suelo firme: Mister no
 * deja pujar por encima del tope, así que ese día el equipo tenía **al menos**
 * eso. Si nosotros le calculábamos menos, la diferencia es dinero que tenía y
 * no veíamos, y se le suma desde ese momento.
 *
 * Dos cosas que hay que hacer bien o el mecanismo inventa dinero:
 *
 * 1. La puja se compara contra el **máximo** del tope mientras el jugador
 *    estuvo en el mercado, no contra el tope del último minuto. La puja se
 *    fija cuando se hace, y el equipo puede gastar después en otra cosa. Con
 *    Raphinha, Neky pujó 28,06 M teniendo 28,28 M esa mañana; de madrugada,
 *    tras fichar a Sergio Gómez, le quedaban 26,9 M. Compararla contra 26,9 M
 *    habría «encontrado» 1,15 M que no existen.
 *
 * 2. Un exceso se suma una sola vez. El ajuste acumulado de un equipo entra en
 *    la comparación de las pujas siguientes, así que dos subastas del mismo
 *    ciclo no cuentan dos veces la misma diferencia.
 *
 * Solo corrige hacia arriba: una puja demuestra lo que tenía como mínimo,
 * nunca que tuviera menos. Y al propio equipo no se le toca: su caja sale del
 * libro de Mister y es exacta; un exceso ahí sería un fallo de cálculo, y se
 * avisa como tal.
 */
import type { Traspaso } from './feed.js'
import { MARGEN_REDONDEO } from './verificar.js'

/** El tope de cada equipo en un instante, sin descontar pujas pendientes. */
export type FotoTopes = { cuando: string; topes: Record<string, number> }

/** Una puja contrastada contra lo que calculábamos. */
export type ResultadoPuja = {
  idTransfer: number
  cuando: string
  jugador: string
  equipo: string
  puja: number
  gana: boolean
  /** Máximo del tope calculado en la ventana; `null` si no había fotos que cubrieran la subasta. */
  topeMax: number | null
  /** Lo que la puja supera al tope corregido. Cero si no lo supera o no se pudo saber. */
  exceso: number
}

/** Lo que sobrevive entre pasadas: cuánto se ha sumado a cada equipo y qué subastas ya se miraron. */
export type EstadoPujas = {
  ajustes: Record<string, number>
  vistas: Record<string, ResultadoPuja[]>
}

/** Horas de topes que se guardan. Una subasta dura un día; con tres sobra. */
export const HORAS_DE_TOPES = 72
/** Cuánto antes de resolverse pudo hacerse la puja: lo que dura un jugador en el mercado, con margen. */
export const HORAS_DE_SUBASTA = 30
/** Sin una foto de al menos tantas horas antes de resolverse, la subasta no se puede juzgar. */
export const HORAS_DE_COBERTURA = 24
/** Cuántas subastas juzgadas se recuerdan. */
const VISTAS_GUARDADAS = 300

/**
 * Un instante de Mister («2026-09-20 05:00:27», hora de Madrid sin desfase)
 * pasado a milisegundos UTC. El desfase se saca de la propia zona horaria, así
 * que vale igual en verano y en invierno y no depende del reloj de la máquina.
 */
export function instanteDeMister(fecha: string): number | null {
  const suelto = Date.parse(`${fecha.replace(' ', 'T')}Z`)
  if (!Number.isFinite(suelto)) return null
  const enMadrid = new Date(suelto).toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' })
  const desfase = Date.parse(`${enMadrid.replace(' ', 'T')}Z`) - suelto
  return suelto - desfase
}

/** Lo que puede pujar un equipo sin descontar lo que ya tenga en pujas: saldo más el 25 % de la plantilla. */
export const topeLibre = (e: { saldo: number; pl: number }): number => e.saldo + 0.25 * e.pl

/** Añade la foto de esta pasada y tira las de hace más de `horas`. Devuelve un histórico nuevo. */
export function anotarTopes(
  historico: FotoTopes[],
  cuando: string,
  equipos: { n: string; saldo: number; pl: number }[],
  horas: number = HORAS_DE_TOPES,
): FotoTopes[] {
  const limite = Date.parse(cuando) - horas * 3_600_000
  const foto: FotoTopes = { cuando, topes: Object.fromEntries(equipos.map((e) => [e.n, topeLibre(e)])) }
  return [...historico.filter((f) => Date.parse(f.cuando) >= limite), foto].sort((a, b) => a.cuando.localeCompare(b.cuando))
}

const HORA_MS = 3_600_000
const eur = (n: number) => `${Math.round(n).toLocaleString('es-ES')} €`

/** Máximo del tope de un equipo entre `desde` y `hasta`; `null` si no hay ninguna foto ahí. */
function topeMaximo(historico: FotoTopes[], equipo: string, desde: number, hasta: number): number | null {
  let max: number | null = null
  for (const f of historico) {
    const t = Date.parse(f.cuando)
    if (t < desde || t > hasta) continue
    const v = f.topes[equipo]
    if (v === undefined) continue
    if (max === null || v > max) max = v
  }
  return max
}

/**
 * Contrasta cada puja no vista aún contra el tope que calculábamos, y devuelve
 * el estado nuevo con los ajustes que haga falta sumar. No modifica lo que
 * recibe.
 */
export function comprobarPujas(
  traspasos: Traspaso[],
  historico: FotoTopes[],
  estado: EstadoPujas,
  equipoPropio: string,
): { estado: EstadoPujas; resultados: ResultadoPuja[]; avisos: string[] } {
  const ajustes = { ...estado.ajustes }
  const vistas = { ...estado.vistas }
  const resultados: ResultadoPuja[] = []
  const avisos: string[] = []
  const masAntigua = historico.length ? Date.parse(historico[0]!.cuando) : null

  const pendientes = traspasos
    .filter((t) => vistas[String(t.idTransfer)] === undefined)
    .filter((t) => (t.otrasPujas?.length ?? 0) > 0 || (t.a !== null && t.idUcA !== 0))
    .sort((a, b) => a.cuando.localeCompare(b.cuando))

  for (const t of pendientes) {
    const instante = instanteDeMister(t.cuando)
    const pujas: { equipo: string; puja: number; gana: boolean }[] = []
    if (t.a !== null && t.idUcA !== 0) pujas.push({ equipo: t.a, puja: t.importe, gana: true })
    for (const p of t.otrasPujas ?? []) pujas.push({ equipo: p.equipo, puja: p.puja, gana: false })
    if (pujas.length === 0) continue

    const cubierta = instante !== null && masAntigua !== null && masAntigua <= instante - HORAS_DE_COBERTURA * HORA_MS
    const deEsta: ResultadoPuja[] = []
    for (const p of pujas) {
      const base = { idTransfer: t.idTransfer, cuando: t.cuando, jugador: t.nombre, equipo: p.equipo, puja: p.puja, gana: p.gana }
      if (!cubierta || instante === null) {
        deEsta.push({ ...base, topeMax: null, exceso: 0 })
        continue
      }
      const max = topeMaximo(historico, p.equipo, instante - HORAS_DE_SUBASTA * HORA_MS, instante)
      if (max === null) {
        deEsta.push({ ...base, topeMax: null, exceso: 0 })
        continue
      }
      const corregido = max + (ajustes[p.equipo] ?? 0)
      const exceso = p.puja - corregido > MARGEN_REDONDEO ? p.puja - corregido : 0
      deEsta.push({ ...base, topeMax: max, exceso })
      if (exceso === 0) continue
      if (p.equipo === equipoPropio) {
        avisos.push(
          `Puja del equipo propio por ${t.nombre} (${eur(p.puja)}) por encima del tope que calculaba (${eur(corregido)}): ${eur(exceso)} de diferencia. Es un fallo de cálculo, no se ajusta nada.`,
        )
        continue
      }
      ajustes[p.equipo] = (ajustes[p.equipo] ?? 0) + exceso
      avisos.push(
        `${p.equipo.replace(/\s*\(.*\)\s*/, '')} pujó ${eur(p.puja)} por ${t.nombre} y le calculaba como mucho ${eur(corregido)}: tenía al menos ${eur(exceso)} más. Se le suman a su caja.`,
      )
    }
    vistas[String(t.idTransfer)] = deEsta
    resultados.push(...deEsta)
  }

  // Se recuerdan las últimas: la clave es el id, así que hay que ordenar por fecha para podar.
  const claves = Object.keys(vistas).sort((a, b) => (vistas[a]![0]?.cuando ?? '').localeCompare(vistas[b]![0]?.cuando ?? ''))
  for (const k of claves.slice(0, Math.max(0, claves.length - VISTAS_GUARDADAS))) delete vistas[k]

  return { estado: { ajustes, vistas }, resultados, avisos }
}
