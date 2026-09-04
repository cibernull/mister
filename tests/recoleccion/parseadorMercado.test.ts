import { describe, expect, it } from 'vitest'
import { parsearMercado, MercadoVacioError } from '../../src/recoleccion/parseadorMercado.js'

const puesto = (id: number, precio: number, duenio = '0') =>
  `<li data-position="4" data-price="${precio}" data-owner="${duenio}" data-ends="1788577200">` +
  `<a class="btn player" href="players/${id}/fulano">` +
  `<div class="name">Fulano</div></a></li>`

const pagina = (...puestos: string[]) =>
  `<html><body><ul id="list-on-sale" class="player-list">${puestos.join('')}</ul></body></html>`

describe('parsearMercado', () => {
  it('saca a cada jugador con su precio', () => {
    expect(parsearMercado(pagina(puesto(20449, 12456358), puesto(56632, 11274226)))).toEqual([
      { id: '20449', precio: 12456358, idUcVendedor: null },
      { id: '56632', precio: 11274226, idUcVendedor: null },
    ])
  })

  it('distingue al que vende un rival del que ofrece el juego', () => {
    const [rival] = parsearMercado(pagina(puesto(364, 17456092, '12493763')))
    expect(rival!.idUcVendedor).toBe(12493763)
  })

  it('ignora los <li> del menú, que no llevan precio', () => {
    const menu = '<li class="btn" data-pag="market"><a href="https://mister.mundodeportivo.com/market"></a></li>'
    expect(parsearMercado(`${menu}${pagina(puesto(1, 100))}`)).toHaveLength(1)
  })

  it('un jugador repetido se cuenta una vez', () => {
    expect(parsearMercado(pagina(puesto(7, 100), puesto(7, 200)))).toEqual([
      { id: '7', precio: 100, idUcVendedor: null },
    ])
  })

  it('un mercado sin nadie se avisa, no se devuelve vacío en silencio', () => {
    // Vacío de verdad pasa al rotar el mercado, pero es indistinguible de que
    // el marcado haya cambiado. Quien llama decide; aquí no se calla.
    expect(() => parsearMercado('<html><body><ul id="list-on-sale"></ul></body></html>')).toThrow(MercadoVacioError)
  })
})
