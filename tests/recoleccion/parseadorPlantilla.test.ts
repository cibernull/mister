import { describe, expect, it } from 'vitest'
import { PlantillaVaciaError, parsearPlantilla } from '../../src/recoleccion/parseadorPlantilla.js'

const pagina = (enlaces: string[]) =>
  `<html><body>${enlaces.map((h) => `<a href="${h}">x</a>`).join('')}</body></html>`

describe('parsearPlantilla', () => {
  it('extrae identificador y slug de los enlaces a jugador', () => {
    expect(parsearPlantilla(pagina(['players/34/jose-gimenez', 'players/364/sergio-canales']))).toEqual([
      { idJugador: 34, slug: 'jose-gimenez' },
      { idJugador: 364, slug: 'sergio-canales' },
    ])
  })

  it('acepta rutas absolutas', () => {
    expect(parsearPlantilla(pagina(['https://mister.mundodeportivo.com/players/34/x']))).toEqual([
      { idJugador: 34, slug: 'x' },
    ])
  })

  it('no repite un jugador que aparece en varios enlaces', () => {
    expect(parsearPlantilla(pagina(['players/34/x', 'players/34/x']))).toEqual([{ idJugador: 34, slug: 'x' }])
  })

  it('ignora enlaces que no son de jugador', () => {
    expect(parsearPlantilla(pagina(['users/123/equipo', 'players/34/x', '/market']))).toEqual([
      { idJugador: 34, slug: 'x' },
    ])
  })

  it('lanza si no encuentra ningún jugador, en vez de devolver una plantilla vacía', () => {
    // Para la página de un equipo activo, una plantilla vacía no es un
    // resultado legítimo: significa que el marcado cambió y la extracción se
    // rompió. Devolver [] lo haría indistinguible de "este equipo no tiene
    // jugadores" y falsearía el reparto inicial de ese equipo.
    expect(() => parsearPlantilla('<html><body>nada</body></html>')).toThrow(PlantillaVaciaError)
  })

  it('lanza si el mismo idJugador aparece con dos slugs distintos', () => {
    // El mismo jugador no puede tener dos slugs distintos en una misma
    // página: si ocurre, el marcado no significa lo que se cree que
    // significa, y quedarse con el primer slug en silencio podría asociar
    // el jugador equivocado a ese id más adelante (Fase 3 busca por nombre).
    expect(() => parsearPlantilla(pagina(['players/34/jose-gimenez', 'players/34/otro-jugador']))).toThrow(
      /idJugador.*34/i,
    )
  })

  describe('la ruta players/ debe ir anclada al principio del camino', () => {
    it('acepta la ruta relativa players/{id}/slug', () => {
      expect(parsearPlantilla(pagina(['players/34/slug']))).toEqual([{ idJugador: 34, slug: 'slug' }])
    })

    it('acepta la ruta absoluta con el dominio real', () => {
      expect(
        parsearPlantilla(pagina(['https://mister.mundodeportivo.com/players/34/slug'])),
      ).toEqual([{ idJugador: 34, slug: 'slug' }])
    })

    it('rechaza un enlace de publicidad/seguimiento que contenga "players/" en un parámetro', () => {
      // Ningún enlace legítimo casa (el único presente es de seguimiento), así
      // que ahora lanza en vez de devolver una plantilla vacía: sigue
      // probando que el enlace de publicidad NO se aceptó como jugador (de
      // haberlo aceptado, no lanzaría y devolvería [{idJugador: 99, ...}]).
      expect(() =>
        parsearPlantilla(pagina(['https://ads.ejemplo.com/track?u=/players/99/x'])),
      ).toThrow(PlantillaVaciaError)
    })
  })
})
