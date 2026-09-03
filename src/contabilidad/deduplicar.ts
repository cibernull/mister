import type { CierreJornada, Evento, Transaccion } from '../dominio/eventos.js'

/**
 * Quita los eventos repetidos que produce la paginación del feed.
 *
 * El feed crece por arriba mientras se pagina, así que el offset retrocede y
 * vuelve a servir eventos ya vistos. En el histórico real eso suponía 17 millones
 * contados de más y una jornada pagada dos veces.
 *
 * De un cierre de jornada repetido se conserva la aparición MÁS ANTIGUA: su
 * fecha es cuando se pagaron los premios de verdad, y quedarse con la tardía
 * los desplaza en el tiempo y genera saldos negativos falsos.
 */
export function deduplicar(eventos: Evento[]): Evento[] {
  const movimientos = new Map<number, Transaccion>()
  const cierres = new Map<number, CierreJornada>()
  const salida: Evento[] = []
  // Marcadores de posición para conservar el orden original de la lista.
  // Solo hacen falta para los cierres de jornada: es el único caso en el que
  // una aparición posterior (la más antigua) debe sustituir a una entrada ya
  // emitida, en su misma posición. Las transacciones repetidas simplemente
  // se descartan sin sustituir nada, así que registrar aquí un hueco por
  // cada una de las ~249 transacciones reales era trabajo y memoria que
  // nunca se leían.
  const huecos: { indice: number; idJornada: number }[] = []

  for (const evento of eventos) {
    if (evento.tipo === 'transaccion') {
      if (!movimientos.has(evento.idTransfer)) {
        movimientos.set(evento.idTransfer, evento)
        salida.push(evento)
      }
      continue
    }

    if (evento.tipo === 'cierreJornada') {
      const previo = cierres.get(evento.idJornada)
      if (!previo) {
        cierres.set(evento.idJornada, evento)
        huecos.push({ indice: salida.length, idJornada: evento.idJornada })
        salida.push(evento)
      } else if (evento.fecha < previo.fecha) {
        // Aparición más antigua: sustituye a la ya guardada, en su misma posición.
        cierres.set(evento.idJornada, evento)
        const hueco = huecos.find((h) => h.idJornada === evento.idJornada)
        if (hueco) salida[hueco.indice] = evento
      }
      continue
    }

    salida.push(evento)
  }

  return salida
}
