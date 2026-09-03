import { describe, expect, it } from 'vitest'
import { parsearPlantilla } from '../../src/recoleccion/parseadorPlantilla.js'

const pagina = (enlaces: string[]) =>
  `<html><body>${enlaces.map((h) => `<a href="${h}">x</a>`).join('')}</body></html>`

describe('parsearPlantilla', () => {
  it('extrae los identificadores de los enlaces a jugador', () => {
    expect(parsearPlantilla(pagina(['players/34/jose-gimenez', 'players/364/sergio-canales']))).toEqual([34, 364])
  })

  it('acepta rutas absolutas', () => {
    expect(parsearPlantilla(pagina(['https://mister.mundodeportivo.com/players/34/x']))).toEqual([34])
  })

  it('no repite un jugador que aparece en varios enlaces', () => {
    expect(parsearPlantilla(pagina(['players/34/x', 'players/34/x']))).toEqual([34])
  })

  it('ignora enlaces que no son de jugador', () => {
    expect(parsearPlantilla(pagina(['users/123/equipo', 'players/34/x', '/market']))).toEqual([34])
  })

  it('devuelve vacío si no hay jugadores', () => {
    expect(parsearPlantilla('<html><body>nada</body></html>')).toEqual([])
  })

  describe('la ruta players/ debe ir anclada al principio del camino', () => {
    it('acepta la ruta relativa players/{id}/slug', () => {
      expect(parsearPlantilla(pagina(['players/34/slug']))).toEqual([34])
    })

    it('acepta la ruta absoluta con el dominio real', () => {
      expect(
        parsearPlantilla(pagina(['https://mister.mundodeportivo.com/players/34/slug'])),
      ).toEqual([34])
    })

    it('rechaza un enlace de publicidad/seguimiento que contenga "players/" en un parámetro', () => {
      expect(
        parsearPlantilla(pagina(['https://ads.ejemplo.com/track?u=/players/99/x'])),
      ).toEqual([])
    })
  })
})
