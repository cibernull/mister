/**
 * Dos contrastes más contra cifras reales de Mister, para el dinero de los
 * rivales, que no tiene libro de caja con el que comprobarse.
 *
 * **Premios de jornada.** El cierre de jornada del feed trae el premio de los
 * ocho equipos en el mismo evento, y el propio se cobra en el libro de caja
 * con su cifra exacta. Si el del feed coincide al euro con el del libro, el
 * evento es de fiar, y con él los premios de los otros siete. Si no coincide,
 * o falta el cierre de una jornada que Mister da por terminada, es dinero
 * mal contado para los ocho, y hay que decirlo.
 *
 * **Cláusulas pagadas.** Al pagar una cláusula, el importe es la cláusula
 * exacta que tenía puesta el vendedor ese día. De ahí se lee cuántas veces la
 * había subido —cada subida es un escalón de ×0,5 sobre el valor—, y eso se
 * contrasta con lo que teníamos apuntado el día anterior. Lo que estimamos
 * que un rival ha gastado en subir cláusulas sale de esos escalones: si al
 * pagarse resulta que había más o menos de los que contábamos, su caja
 * estimada iba mal por ahí.
 */
import type { Jornada, Traspaso } from './feed.js'
import { subidasVivas } from './clausulas.js'

/** Un apunte del libro de caja, con lo que hace falta aquí. */
type Apunte = { fecha: string; motivo: string; tipo: string; importe: number }

/** Lo que se sabe de una jornada según Mister: número y estado. */
type JornadaMister = { jornada: number; estado: string }

const EQUIPOS_EN_LIGA = 8
const eur = (n: number) => `${Math.round(n).toLocaleString('es-ES')} €`

/**
 * Contrasta los premios de jornada del feed con el libro de caja propio y
 * con las jornadas que Mister da por terminadas. Devuelve avisos; ninguno
 * bloquea, porque el feed ya es lo que hay: lo que se puede es no callarlo.
 */
export function contrastarPremios(
  jornadas: Jornada[],
  apuntes: Apunte[],
  idUcPropio: number,
  jornadasMister: JornadaMister[],
): string[] {
  const avisos: string[] = []
  const cobradas = new Map<number, number>()
  for (const a of apuntes) {
    if (!/bonificaci/i.test(a.tipo)) continue
    const m = /^Jornada (\d+)$/i.exec(a.motivo.trim())
    if (m) cobradas.set(Number(m[1]), (cobradas.get(Number(m[1])) ?? 0) + a.importe)
  }

  const enFeed = new Map<number, Jornada>()
  for (const j of jornadas) enFeed.set(j.jornada, j)

  for (const j of jornadas) {
    if (j.posiciones.length !== EQUIPOS_EN_LIGA) {
      avisos.push(`El cierre de J${j.jornada} trae ${j.posiciones.length} equipos, no ${EQUIPOS_EN_LIGA}: es un cierre a medias y sus premios no son de fiar.`)
    }
    const mio = j.posiciones.find((p) => p.idUc === idUcPropio)
    const cobrado = cobradas.get(j.jornada)
    if (mio === undefined || cobrado === undefined) continue
    if (mio.premio !== cobrado) {
      avisos.push(
        `J${j.jornada}: el feed dice que cobré ${eur(mio.premio)} y el libro de caja ${eur(cobrado)}. Ese evento paga a los ocho equipos: los premios de esa jornada están mal contados para todos.`,
      )
    }
  }

  for (const g of jornadasMister) {
    if (g.estado === 'finished' && !enFeed.has(g.jornada)) {
      avisos.push(`Mister da por terminada la J${g.jornada} y no tengo su cierre en el feed: a los ocho les falta el premio de esa jornada.`)
    }
  }
  for (const [n, importe] of cobradas) {
    if (!enFeed.has(n)) avisos.push(`El libro de caja cobra ${eur(importe)} de la J${n} y no tengo su cierre en el feed: a los rivales les falta ese premio.`)
  }
  return avisos
}

/** El último día del histórico anterior a la fecha dada, o `null`. */
function diaAnterior(historico: Record<string, unknown>, cuando: string): string | null {
  const dia = cuando.slice(0, 10)
  const previos = Object.keys(historico).filter((d) => d < dia).sort()
  return previos.length ? previos[previos.length - 1]! : null
}

/**
 * Contrasta cada cláusula pagada con la que teníamos apuntada la víspera,
 * en escalones de subida y no en euros: el valor del jugador cambia cada
 * día y arrastra la cláusula con él, pero las subidas son las que son.
 */
export function contrastarClausulasPagadas(
  traspasos: Traspaso[],
  historicoClausulas: Record<string, Record<string, number>>,
  historicoValores: Record<string, Record<string, number>>,
): string[] {
  const avisos: string[] = []
  for (const t of traspasos) {
    if (t.tipo !== 'clause') continue
    const dia = diaAnterior(historicoClausulas, t.cuando)
    if (dia === null) continue
    const clausulaApuntada = historicoClausulas[dia]?.[t.idJugador]
    const valorApuntado = historicoValores[dia]?.[t.idJugador] ?? t.valor
    if (clausulaApuntada === undefined) continue
    const pagadas = subidasVivas(t.valor, t.importe)
    const apuntadas = subidasVivas(valorApuntado, clausulaApuntada)
    if (pagadas === apuntadas) continue
    const plural = (n: number) => `${n} subida${n === 1 ? '' : 's'}`
    avisos.push(
      `${t.a ?? 'Alguien'} pagó ${eur(t.importe)} por la cláusula de ${t.nombre}, que son ${plural(pagadas)}; la teníamos apuntada con ${plural(apuntadas)} (${eur(clausulaApuntada)} el ${dia}). Lo que se le estima gastado en cláusulas a ${t.de ?? 'su dueño'} iba mal por ahí.`,
    )
  }
  return avisos
}
