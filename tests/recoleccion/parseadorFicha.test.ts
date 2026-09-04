import { describe, expect, it } from 'vitest'
import { parsearFicha, FichaIlegibleError } from '../../src/recoleccion/parseadorFicha.js'

const ficha = (titulo: string, posicion?: string) =>
  `<html><head><title id="page-title">${titulo}</title></head><body>` +
  (posicion === undefined ? '' : `<div class='player-position pos--lg' data-position='${posicion}'></div>`) +
  '<div class="name">Oriol</div></body></html>'

describe('parsearFicha', () => {
  it('saca el nombre y la posición', () => {
    expect(parsearFicha(ficha('Oriol Rey | Mister', '3'))).toEqual({ nombre: 'Oriol Rey', posicion: 3 })
  })

  it('respeta tildes y eñes', () => {
    // Es la razón de leer el nombre de aquí y no derivarlo del slug: el slug
    // de Beñat Gerenabarrena es «benat-gerenabarrena» y de ahí no vuelve la ñ.
    expect(parsearFicha(ficha('Beñat Gerenabarrena | Mister', '3')).nombre).toBe('Beñat Gerenabarrena')
  })

  it('sin posición devuelve 0, que se pinta como dorsal gris', () => {
    expect(parsearFicha(ficha('Oriol Rey | Mister')).posicion).toBe(0)
  })

  it('un título sin la coletilla no es una ficha', () => {
    // Mister redirige al feed cuando la ruta no vale, y esa página también
    // tiene <title>. Aceptarla guardaría «Mister - Mánager de fútbol» como
    // nombre de un jugador.
    expect(() => parsearFicha(ficha('Mister - Mánager de fútbol'))).toThrow(FichaIlegibleError)
  })

  it('sin título es error, no un nombre vacío', () => {
    expect(() => parsearFicha('<html><body>nada</body></html>')).toThrow(/no tiene <title>/)
  })

  it('un título que solo tiene la coletilla tampoco vale', () => {
    expect(() => parsearFicha(ficha(' | Mister'))).toThrow(FichaIlegibleError)
  })
})
