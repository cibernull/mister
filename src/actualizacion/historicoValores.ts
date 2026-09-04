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
export function subidasDelMes(historico: Historico, hoy: string): Map<string, number> {
  const dias = Object.keys(historico).sort()
  const haceUnMes = new Date(`${hoy}T00:00:00Z`)
  haceUnMes.setUTCDate(haceUnMes.getUTCDate() - 30)
  const objetivo = haceUnMes.toISOString().slice(0, 10)

  // El primer día que llegue al mes; si no hay ninguno, el más antiguo que haya.
  const referencia = dias.find((d) => d >= objetivo) ?? dias[0]
  const antes = referencia === undefined ? undefined : historico[referencia]
  if (referencia === undefined || antes === undefined) return new Map()

  const dist = Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${referencia}T00:00:00Z`)) / 86400000)
  if (dist < DIAS_PARA_LLAMARLO_MES) return new Map()

  const ahora = historico[hoy] ?? {}
  const subidas = new Map<string, number>()
  for (const [id, v] of Object.entries(ahora)) {
    const previo = antes[id]
    // Un jugador que no estaba hace un mes no tiene subida del mes. Contarlo
    // como si hubiera subido su valor entero lo pondría el primero de la lista.
    if (previo !== undefined) subidas.set(id, v - previo)
  }
  return subidas
}
