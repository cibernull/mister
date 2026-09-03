import type { CierreJornada, Evento, Parte, ResultadoEquipo, Transaccion } from '../dominio/eventos.js'

/**
 * Dos eventos comparten la clave de deduplicación (`idTransfer` o
 * `idJornada`) pero su carga difiere en algo que no puede diferir
 * legítimamente entre dos apariciones del mismo evento.
 *
 * La deduplicación existe porque el feed REPITE eventos al paginar, y una
 * repetición legítima sirve de nuevo el mismo dato. Si dos eventos con la
 * misma clave traen datos distintos, la clave ya no identifica una única
 * repetición: identifica dos cosas distintas que casualmente comparten
 * número (un dato corregido, una lectura mal hecha, o un choque de
 * identificadores). Elegir uno de los dos en silencio podría alterar la
 * contabilidad sin que nadie se entere; por eso esto lanza en vez de
 * resolver.
 */
export class DuplicadoConContenidoDistintoError extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'DuplicadoConContenidoDistintoError'
  }
}

function mismaParte(a: Parte, b: Parte): boolean {
  if (a.clase === 'mercado' && b.clase === 'mercado') return true
  if (a.clase === 'equipo' && b.clase === 'equipo') return a.idUc === b.idUc && a.nombre === b.nombre
  return false
}

/**
 * Dos apariciones de la MISMA transacción (mismo `idTransfer`) solo pueden
 * venir de que la paginación sirva de nuevo el mismo evento crudo, así que
 * deben ser idénticas en todo lo que lleva carga: quién vende, quién compra,
 * el jugador, el importe, el tipo de operación y hasta la fecha (a
 * diferencia de un cierre de jornada, aquí no hay ningún motivo legítimo
 * conocido para que la fecha cambie entre dos apariciones).
 */
function mismaTransaccion(a: Transaccion, b: Transaccion): boolean {
  return (
    a.fecha === b.fecha &&
    a.jugador === b.jugador &&
    a.idJugador === b.idJugador &&
    a.importe === b.importe &&
    a.operacion === b.operacion &&
    mismaParte(a.origen, b.origen) &&
    mismaParte(a.destino, b.destino)
  )
}

/**
 * Compara los resultados de dos apariciones del mismo cierre por `idUc`, no
 * por posición: el orden dentro de `resultados` no es una garantía del feed,
 * y comparar por posición podría lanzar por un simple reordenamiento sin
 * ningún cambio de contenido real.
 *
 * El nombre de equipo (`equipo`) queda fuera a propósito: la identidad
 * estable es `idUc` (hallazgo 3, `Parte.idUc`), y un `change_name` entre las
 * dos publicaciones del mismo cierre es un cambio legítimo, no una anomalía.
 */
function mismosResultados(a: ResultadoEquipo[], b: ResultadoEquipo[]): boolean {
  if (a.length !== b.length) return false
  const porIdUc = new Map(a.map((r) => [r.idUc, r]))
  return b.every((rb) => {
    const ra = porIdUc.get(rb.idUc)
    return (
      ra !== undefined &&
      ra.premio === rb.premio &&
      ra.puntos === rb.puntos &&
      ra.sinPuntuar === rb.sinPuntuar &&
      ra.valorPlantilla === rb.valorPlantilla
    )
  })
}

/**
 * Dos apariciones del MISMO cierre de jornada (mismo `idJornada`) pueden
 * legítimamente traer una `fecha` distinta: la segunda publicación es
 * cuando Mister repitió el pago, no cuando ocurrió la jornada. Lo que no
 * puede diferir son los premios y los resultados — si difieren, la
 * repetición ya no es una repetición: es una corrección o un error, y debe
 * detener el proceso en vez de que el motor elija una de las dos cifras a
 * ciegas.
 */
function mismoCierre(a: CierreJornada, b: CierreJornada): boolean {
  return a.jornada === b.jornada && mismosResultados(a.resultados, b.resultados)
}

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
 *
 * Antes de decidir cuál conservar (o de descartar sin más una transacción
 * repetida), se contrasta la carga de ambas apariciones: si dos eventos
 * comparten clave pero su contenido no coincide en lo que no puede variar,
 * eso es una anomalía y `deduplicar` lanza `DuplicadoConContenidoDistintoError`
 * en vez de elegir una de las dos en silencio.
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
      const previo = movimientos.get(evento.idTransfer)
      if (!previo) {
        movimientos.set(evento.idTransfer, evento)
        salida.push(evento)
      } else if (!mismaTransaccion(evento, previo)) {
        throw new DuplicadoConContenidoDistintoError(
          `dos movimientos comparten idTransfer=${evento.idTransfer} pero su contenido difiere: ` +
            `¿un dato corregido, o una lectura mal hecha? Anterior: ${JSON.stringify(previo)}. ` +
            `Nuevo: ${JSON.stringify(evento)}.`,
        )
      }
      continue
    }

    if (evento.tipo === 'cierreJornada') {
      const previo = cierres.get(evento.idJornada)
      if (!previo) {
        cierres.set(evento.idJornada, evento)
        huecos.push({ indice: salida.length, idJornada: evento.idJornada })
        salida.push(evento)
      } else {
        if (!mismoCierre(evento, previo)) {
          throw new DuplicadoConContenidoDistintoError(
            `dos cierres comparten idJornada=${evento.idJornada} pero sus premios o resultados difieren: ` +
              `¿un dato corregido, o una lectura mal hecha? Anterior: ${JSON.stringify(previo)}. ` +
              `Nuevo: ${JSON.stringify(evento)}.`,
          )
        }
        if (evento.fecha < previo.fecha) {
          // Aparición más antigua: sustituye a la ya guardada, en su misma posición.
          cierres.set(evento.idJornada, evento)
          const hueco = huecos.find((h) => h.idJornada === evento.idJornada)
          if (hueco) salida[hueco.indice] = evento
        }
      }
      continue
    }

    salida.push(evento)
  }

  return salida
}
