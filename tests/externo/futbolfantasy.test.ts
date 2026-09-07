import { describe, expect, it } from 'vitest'
import { ClubDesconocidoError, emparejar, palabras, parsearEquipo } from '../../src/externo/futbolfantasy.js'

/** Un bloque como los que sirve FútbolFantasy: atributos, y el nombre en el alt. */
const bloque = (id: number, nombre: string, attrs: Record<string, string>) =>
  `<div class="jugador_${id} tipo_campo" ${Object.entries(attrs)
    .map(([k, v]) => `data-${k}="${v}"`)
    .join(' ')}>
     <a class="camiseta"><img alt="${nombre}"></a>
   </div>`

const pagina = [
  bloque(1, 'Pablo Ibáñez', { probabilidad: '90%', sancionado: '0', nodisponible: '0', totalMinutosJugados: '360' }),
  bloque(2, 'Facundo Garcés', { probabilidad: '0%', sancionado: '0', nodisponible: '1', totalMinutosJugados: '90' }),
  bloque(3, 'Un Sancionado', { probabilidad: '0%', sancionado: '1', nodisponible: '0', totalMinutosJugados: '270' }),
  '<div class="jugador_4 sin-datos"><a><img alt="Sin probabilidad"></a></div>',
].join('\n')

describe('parsearEquipo', () => {
  const l = parsearEquipo(pagina, 'alaves')

  it('saca a los que traen probabilidad, con su club de Mister', () => {
    expect(l).toHaveLength(3)
    expect(l[0]).toEqual({
      nombre: 'Pablo Ibáñez',
      idClub: 48,
      probabilidad: 90,
      sancionado: false,
      disponible: true,
      minutos: 360,
    })
  })

  it('se salta los bloques sin probabilidad en vez de inventarles un cero', () => {
    expect(l.map((p) => p.nombre)).not.toContain('Sin probabilidad')
  })

  it('marca al que no está disponible y al sancionado', () => {
    expect(l[1]).toMatchObject({ nombre: 'Facundo Garcés', disponible: false })
    expect(l[2]).toMatchObject({ nombre: 'Un Sancionado', sancionado: true })
  })

  it('un club que no sé traducir rompe la pasada, no deja un hueco callado', () => {
    expect(() => parsearEquipo(pagina, 'inventado')).toThrow(ClubDesconocidoError)
  })
})

describe('palabras', () => {
  it('quita tildes y signos, que es lo que impide comparar nombres', () => {
    expect(palabras('Álvaro Valles')).toEqual(['alvaro', 'valles'])
    expect(palabras("N'Golo Kanté")).toEqual(['golo', 'kante'])
  })
})

describe('emparejar', () => {
  const suyos = [
    { nombre: 'Álvaro Valles', idClub: 4, probabilidad: 90, sancionado: false, disponible: true, minutos: 360 },
    { nombre: 'Aitor Ruibal', idClub: 4, probabilidad: 0, sancionado: false, disponible: true, minutos: 20 },
    { nombre: 'Alfonso Herrero', idClub: 13, probabilidad: 90, sancionado: false, disponible: true, minutos: 360 },
  ]

  it('cruza por apellido dentro del mismo club', () => {
    const m = emparejar([{ id: '53111', nombre: 'Valles', eq: 4 }], suyos)
    expect(m.get('53111')?.probabilidad).toBe(90)
  })

  it('no cruza entre clubes distintos aunque el nombre se parezca', () => {
    // «Herrero» del Málaga no puede acabar puesto sobre un jugador del Betis.
    expect(emparejar([{ id: '9', nombre: 'Alfonso Herrero', eq: 4 }], suyos).size).toBe(0)
  })

  it('ante un empate no elige: media probabilidad mal puesta es peor que ninguna', () => {
    const dos = [
      { nombre: 'Diego Martínez', idClub: 4, probabilidad: 80, sancionado: false, disponible: true, minutos: 1 },
      { nombre: 'Iván Martínez', idClub: 4, probabilidad: 10, sancionado: false, disponible: true, minutos: 1 },
    ]
    expect(emparejar([{ id: '1', nombre: 'Martínez', eq: 4 }], dos).size).toBe(0)
  })

  it('a quien no aparece no se le inventa nada', () => {
    expect(emparejar([{ id: '99', nombre: 'Nadie Conocido', eq: 4 }], suyos).size).toBe(0)
  })
})
