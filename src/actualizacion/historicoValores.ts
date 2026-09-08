/**
 * El histórico de valores: qué vale cada jugador cada día, y qué se saca de ahí.
 *
 * Lo que sube o baja un jugador **en un mes** no lo publica Mister en ningún
 * sitio: solo está en la gráfica de su ficha, y las fichas se piden de una en
 * una. Guardando cada día lo que vale cada uno, esa cifra pasa a salir de aquí
 * —para los 523 y sin pedir nada—, que es lo que hace que una actualización
 * cueste segundos en vez de minutos.
 */

/** `{ 'YYYY-MM-DD': { idJugador: valor } }`. */
export type Historico = Record<string, Record<string, number>>

/** Serie compacta de la campaña anterior para una ficha de jugador. */
export type SerieTemporadaAnterior = {
  temporada: string
  desde: string
  hasta: string
  valores: number[]
}

/**
 * Separa de la gráfica anual de Mister la temporada competitiva anterior.
 * Mister entrega un año móvil que también incluye junio y julio: ese tramo ya
 * es pretemporada de la campaña nueva y provocaba que jugadores recién
 * llegados, como Canales, pareciesen haber disputado LaLiga el curso anterior.
 */
export function extraerTemporadaAnterior(
  serie: { fecha: string; valor: number }[],
  inicioTemporadaActual: string,
): SerieTemporadaAnterior | null {
  const anio = Number(inicioTemporadaActual.slice(0, 4))
  if (!Number.isFinite(anio)) return null
  const desdeTemporada = `${anio - 1}-08-01`
  const hastaTemporada = `${anio}-05-31`
  const anterior = serie.filter((p) => p.fecha >= desdeTemporada && p.fecha <= hastaTemporada)
  if (anterior.length < 3) return null
  return {
    temporada: `${anio - 1}/${String(anio).slice(-2)}`,
    desde: anterior[0]!.fecha,
    hasta: anterior.at(-1)!.fecha,
    valores: anterior.map((p) => p.valor),
  }
}

/** Días que se guardan. Con 40 sobra para mirar un mes atrás con holgura. */
export const DIAS_DE_HISTORICO = 40

/** A partir de cuántos días de recorrido la cifra ya se puede llamar «del mes». */
export const DIAS_PARA_LLAMARLO_MES = 21

/** Tira los días que sobran por delante. Modifica el objeto que recibe. */
export function podar(historico: Historico, dias = DIAS_DE_HISTORICO): void {
  for (const d of Object.keys(historico).sort().slice(0, -dias)) delete historico[d]
}

/**
 * Lo que ha subido cada jugador en el último mes.
 *
 * Se compara con la foto más antigua que haya, siempre que sea de hace al
 * menos tres semanas: con menos recorrido la cifra existiría pero significaría
 * otra cosa, y presentarla como «este mes» sería mentir por omisión. Hasta que
 * el histórico crezca se devuelve vacío, y quien llama tira de la ficha.
 */
/** Días que hacen falta de recorrido para poder hablar de una semana. */
export const DIAS_PARA_LLAMARLO_SEMANA = 5

/**
 * Lo que ha subido el valor de cada jugador en los últimos `dias`.
 *
 * Se pide un mínimo de recorrido —`minimo`— porque comparar con el día de
 * antes y llamarlo «el mes» es mentir: al principio de la temporada el
 * histórico solo tiene unos días y la cifra no significaría nada.
 */
export function subidasEn(historico: Historico, hoy: string, dias: number, minimo: number): Map<string, number> {
  const todos = Object.keys(historico).sort()
  const desde = new Date(`${hoy}T00:00:00Z`)
  desde.setUTCDate(desde.getUTCDate() - dias)
  const objetivo = desde.toISOString().slice(0, 10)

  // El primer día que llegue al plazo; si no hay ninguno, el más antiguo.
  const referencia = todos.find((d) => d >= objetivo) ?? todos[0]
  const antes = referencia === undefined ? undefined : historico[referencia]
  if (referencia === undefined || antes === undefined) return new Map()

  const dist = Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${referencia}T00:00:00Z`)) / 86400000)
  if (dist < minimo) return new Map()

  const ahora = historico[hoy] ?? {}
  const subidas = new Map<string, number>()
  for (const [id, v] of Object.entries(ahora)) {
    const previo = antes[id]
    // Un jugador que no estaba entonces no tiene subida. Contarlo como si
    // hubiera subido su valor entero lo pondría el primero de la lista.
    if (previo !== undefined) subidas.set(id, v - previo)
  }
  return subidas
}

export function subidasDelMes(historico: Historico, hoy: string): Map<string, number> {
  return subidasEn(historico, hoy, 30, DIAS_PARA_LLAMARLO_MES)
}

export function subidasDeLaSemana(historico: Historico, hoy: string): Map<string, number> {
  return subidasEn(historico, hoy, 7, DIAS_PARA_LLAMARLO_SEMANA)
}
