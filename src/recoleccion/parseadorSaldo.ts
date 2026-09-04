/**
 * El libro de caja de Mister: cada euro que ha entrado y salido, con su motivo.
 *
 * `POST /ajax/sw/balance` es lo que alimenta la pantalla de saldo. Devuelve el
 * balance de hoy y el histórico entero de movimientos, cada uno con el balance
 * que dejó detrás.
 *
 * Esto **sustituye a reconstruir el saldo propio sumando el feed**, que era lo
 * que hacía el módulo. El feed no publica categorías enteras de movimiento:
 *
 *   · `Penalización` — lo que cuesta subirle la cláusula a un jugador. Solo en
 *     esta liga y en un mes van 5.263.619 €. Invisible en el feed.
 *   · `Bonificación` — los premios de cada jornada.
 *   · `Ajuste de balance por reinicio de liga` — el punto de partida real, que
 *     hasta ahora había que deducir.
 *   · Cesiones, rescisiones y trueques.
 *
 * Reconstruir el saldo sin eso obligaba a ajustar una constante por equipo para
 * que cuadrara, y volvía a descuadrar en cuanto alguien tocaba una cláusula:
 * fue lo que dejó la app sin poder actualizarse una noche entera.
 *
 * Solo sirve para el equipo propio. Los saldos de los rivales están ocultos
 * (`show_balances: 0`), así que esos hay que seguir reconstruyéndolos.
 */

/** Un apunte del libro de caja. */
export type Apunte = {
  /** Momento del apunte, en segundos. */
  cuando: number
  /** `YYYY-MM-DD HH:MM`, ya en hora local de Mister. */
  fecha: string
  /** Lo que dice Mister, sin el marcado que trae dentro. */
  motivo: string
  /** `Venta`, `Compra`, `Penalización`, `Bonificación`, `Compra por cláusula`… */
  tipo: string
  /** Con signo: negativo si salió dinero. */
  importe: number
  /** El saldo que quedó después de este apunte. */
  saldo: number
}

export type LibroDeCaja = {
  /** El saldo de ahora mismo, tal como lo publica Mister. */
  saldo: number
  /** De más reciente a más antiguo, como los manda Mister. */
  apuntes: Apunte[]
}

export class SaldoIlegibleError extends Error {
  constructor(motivo: string) {
    super(`no pude leer el libro de caja: ${motivo}`)
    this.name = 'SaldoIlegibleError'
  }
}

const num = (x: unknown, campo: string): number => {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  if (typeof x === 'string' && /^-?\d+$/.test(x)) return Number(x)
  throw new SaldoIlegibleError(`el campo ${campo} no es un número: ${JSON.stringify(x)}`)
}

/**
 * Traduce la respuesta.
 *
 * Se es estricto: aquí no hay adornos. Un apunte que no se entienda significa
 * un euro que no se sabe de dónde sale, y el módulo entero existe para no tener
 * ninguno de esos.
 */
export function parsearSaldo(cuerpo: string): LibroDeCaja {
  let json: { status?: unknown; data?: { balance?: unknown; history?: unknown } }
  try {
    json = JSON.parse(cuerpo) as typeof json
  } catch {
    throw new SaldoIlegibleError('la respuesta no es JSON válido')
  }
  if (json.status !== 'ok') throw new SaldoIlegibleError(`Mister respondió status ${JSON.stringify(json.status)}`)

  const historia = json.data?.history
  if (!Array.isArray(historia)) throw new SaldoIlegibleError('no trae la lista `data.history`')

  const apuntes = historia.map((x) => {
    const m = x as Record<string, unknown>
    return {
      cuando: num(m['ts'], 'ts'),
      // Mister lo da como «05/09/2026 – 00:13»; se guarda ordenable.
      fecha: aIso(typeof m['adate'] === 'string' ? m['adate'] : ''),
      // El motivo trae marcado dentro: «Fer Niño <span>a</span> Mister».
      motivo: String(m['reason'] ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      tipo: String(m['type'] ?? '').trim(),
      importe: num(m['amount'], 'amount'),
      saldo: num(m['balance'], 'balance'),
    }
  })

  return { saldo: num(json.data?.balance, 'balance'), apuntes }
}

/** `05/09/2026 – 00:13` → `2026-09-05 00:13`. Si no encaja, se deja como vino. */
function aIso(fecha: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\D+(\d{2}):(\d{2})/.exec(fecha.trim())
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}` : fecha.trim()
}

/**
 * De dónde parte la cuenta: el último ajuste por reinicio de liga.
 *
 * Mister reinicia la liga poniendo el balance a un número y dejando el apunte.
 * Ese número es el saldo inicial de verdad, y hasta ahora había que deducirlo
 * de `50.000.000 − valor del reparto`, que es lo que obligaba a llevar una
 * constante fabricada a mano por equipo en `liga.json`.
 */
export function reinicioDeLiga(libro: LibroDeCaja): Apunte | null {
  const enOrden = [...libro.apuntes].sort((a, b) => a.cuando - b.cuando)
  for (let i = enOrden.length - 1; i >= 0; i -= 1) {
    if (/reinicio de liga/i.test(enOrden[i]!.motivo)) return enOrden[i]!
  }
  return null
}
