/**
 * La clasificación que publica Mister, que es la mejor piedra de toque que hay.
 *
 * `/standings` se renderiza en el servidor y da, por equipo y para los ocho:
 * puesto, puntos, **cuántos jugadores tiene y cuánto vale su plantilla**. Son
 * justo las tres cifras que el módulo calcula por su cuenta desde el histórico,
 * así que compararlas es una comprobación de verdad y no un apaño.
 *
 * Hasta ahora solo se contrastaba el saldo propio, que es lo único que Mister
 * publica del dinero. Con esto se contrastan también los siete rivales.
 */

export type PuestoClasificacion = {
  puesto: number
  equipo: string
  puntos: number
  jugadores: number
  valorPlantilla: number
}

export class ClasificacionIlegibleError extends Error {
  constructor(motivo: string) {
    super(`no pude leer la clasificación de Mister: ${motivo}`)
    this.name = 'ClasificacionIlegibleError'
  }
}

const cifra = (s: string): number => Number(s.replace(/\./g, ''))

/**
 * Lee el panel «General». El de «Jornada» tiene el mismo marcado pero con los
 * puntos de la última jornada, así que confundirlos daría una clasificación
 * entera equivocada sin que nada chirriara.
 */
export function parsearClasificacion(html: string): PuestoClasificacion[] {
  const desde = html.indexOf('panel-total')
  if (desde < 0) throw new ClasificacionIlegibleError('no encuentro el panel de la clasificación general')
  const hasta = html.indexOf('panel-gameweek')
  const panel = (hasta > desde ? html.slice(desde, hasta) : html.slice(desde)).replace(/\s+/g, ' ')

  const salida: PuestoClasificacion[] = []
  for (const trozo of panel.split('<li').slice(1)) {
    const puesto = /class="position"> (\d+) /.exec(trozo)
    const equipo = /class="name[^"]*"> (.+?) <\/div>/.exec(trozo)
    const plantilla = /class="played"> (\d+) jugadores · € ([\d.]+) /.exec(trozo)
    const puntos = /class="points"> ([\d.]+) /.exec(trozo)
    if (!puesto || !equipo || !plantilla || !puntos) {
      // Una fila a medias no se ignora: significaría que el marcado cambió, y
      // seguir con siete equipos de ocho dejaría a uno sin comprobar.
      throw new ClasificacionIlegibleError(`una fila no trae las cuatro cifras: ${trozo.slice(0, 160)}`)
    }
    salida.push({
      puesto: Number(puesto[1]),
      equipo: equipo[1]!.trim(),
      puntos: cifra(puntos[1]!),
      jugadores: Number(plantilla[1]),
      valorPlantilla: cifra(plantilla[2]!),
    })
  }

  if (salida.length === 0) throw new ClasificacionIlegibleError('el panel no trae ningún equipo')
  return salida
}
