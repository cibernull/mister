import { describe, expect, it } from 'vitest'
import { parsearFicha, FichaIlegibleError } from '../../src/recoleccion/parseadorFicha.js'

const ficha = (titulo: string, posicion?: string) =>
  `<html><head><title id="page-title">${titulo}</title></head><body>` +
  (posicion === undefined ? '' : `<div class='player-position pos--lg' data-position='${posicion}'></div>`) +
  '<div class="name">Oriol</div></body></html>'

describe('parsearFicha', () => {
  it('saca el nombre y la posición', () => {
    expect(parsearFicha(ficha('Oriol Rey | Mister', '3'))).toMatchObject({ nombre: 'Oriol Rey', posicion: 3 })
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

/** El cuadro de estadísticas de la cabecera, tal como lo pinta Mister. */
const cuadro = (pares: [string, string][]) =>
  pares.map(([l, v]) => `<div class="label">${l}</div>
<div class="value">${v}</div>`).join('\n')

describe('parsearFicha · lo que solo está en la ficha', () => {
  const base = (extra: string) =>
    `<html><head><title id="page-title">X | Mister</title></head><body>${extra}</body></html>`

  it('lee goles, tarjetas y las medias de casa y fuera', () => {
    const html = base(cuadro([['Goles', '5'], ['Tarjetas', '2'], ['Media en casa', '15,0'], ['Media fuera', '17,0'], ['Edad', '29']]))
    expect(parsearFicha(html)).toMatchObject({ goles: 5, tarjetas: 2, mediaCasa: 15, mediaFuera: 17, edad: 29 })
  })

  it('las medias vienen con coma decimal, no con punto', () => {
    // Leerlo como número inglés convertiría un 3,5 en 35.
    expect(parsearFicha(base(cuadro([['Media fuera', '3,5']]))).mediaFuera).toBe(3.5)
  })

  it('lo que la ficha no publica queda en null, no en cero', () => {
    // Cero goles y «no lo sé» no son lo mismo: uno ordena y el otro no.
    const f = parsearFicha(base(''))
    expect(f.goles).toBeNull()
    expect(f.mediaCasa).toBeNull()
  })

  it('distingue las jornadas de inicio de las de banquillo', () => {
    const jugada = (icono: string) =>
      `<div class="gw btn btn-player-gw gw-played"><div class="rival"><use href="#${icono}"></use></div></div>`
    const html = base(jugada('jersey') + jugada('jersey') + jugada('bench') +
      '<div class="gw btn btn-player-gw gw-pending"><div class="rival"><use href="#clock"></use></div></div>')
    expect(parsearFicha(html)).toMatchObject({ titularidades: 2, suplencias: 1 })
  })

  it('«posible titular» sale del botón del próximo partido', () => {
    expect(parsearFicha(base('<button class="btn btn-sw match starting ">x</button>')).titular).toBe(true)
    expect(parsearFicha(base('<button class="btn btn-sw match ">x</button>')).titular).toBe(false)
  })

  it('sin predicción es null, que no es lo mismo que ir al banquillo', () => {
    expect(parsearFicha(base('')).titular).toBeNull()
  })
})
