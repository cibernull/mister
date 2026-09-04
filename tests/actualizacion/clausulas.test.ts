import { describe, expect, it } from 'vitest'
import { subidasVivas, detectarSubidas, gastoPorEquipo, clausulaBase } from '../../src/actualizacion/clausulas.js'

describe('subidasVivas', () => {
  it('una cláusula en su base no es ninguna subida', () => {
    expect(subidasVivas(4_000_000, 6_000_000)).toBe(0)
  })

  it('cuenta los escalones de medio punto', () => {
    // Juan Foyth pagó tres veces —al 100 %, al 150 % y al 200 %— y quedó en
    // ×3,000 exacto. Es el caso con el que se comprobó la regla.
    expect(subidasVivas(3_214_000, 9_642_000)).toBe(3)
    expect(subidasVivas(5_661_000, 11_322_000)).toBe(1)
  })

  it('el suelo de un millón no cuenta como cláusula subida', () => {
    // Un suplente de 160.000 € tiene la cláusula en el mínimo, que es ×6,25 de
    // su valor. Sin esto salía «subida diez veces» sin que nadie pagara nada.
    expect(subidasVivas(160_000, 1_000_000)).toBe(0)
    expect(clausulaBase(160_000)).toBe(1_000_000)
  })

  it('una cláusula congelada al comprarla no se interpreta', () => {
    // Al pagar la cláusula de alguien, la suya queda en el importe pagado y ya
    // no cae en ningún escalón. De ahí no se puede deducir nada, así que 0.
    expect(subidasVivas(5_740_000, 12_342_000)).toBe(0)
  })
})

describe('detectarSubidas', () => {
  const jugador = (o: Partial<{ id: string; duenio: string | null; valor: number; clausula: number | null }> = {}) => ({
    id: '1', duenio: 'Betico1993', valor: 1_000_000, clausula: 1_500_000, ...o,
  })

  it('ve la subida y le pone precio: el 20 % del valor', () => {
    const r = detectarSubidas([jugador({ clausula: 2_000_000 })], { '1': 1_500_000 }, '2026-09-05')
    expect(r).toEqual([
      { idJugador: '1', equipo: 'Betico1993', dia: '2026-09-05', coste: 200_000, clausulaAntes: 1_500_000, clausulaDespues: 2_000_000 },
    ])
  })

  it('una cláusula que sube porque sube el valor no es una subida', () => {
    // La base se recalcula sola cada día. Confundirlo cobraría a un rival por
    // revalorizarse, que es lo contrario de lo que pasa.
    expect(detectarSubidas([jugador({ valor: 2_000_000, clausula: 3_000_000 })], { '1': 1_500_000 }, 'x')).toEqual([])
  })

  it('sin foto de ayer no se deduce nada', () => {
    // El primer día no hay con qué comparar. Inventar una subida ahí le
    // restaría dinero a un rival por haberla subido vete a saber cuándo.
    expect(detectarSubidas([jugador({ clausula: 9_000_000 })], {}, 'x')).toEqual([])
  })

  it('los jugadores libres no tienen a quién cobrarle', () => {
    expect(detectarSubidas([jugador({ duenio: null, clausula: 9_000_000 })], { '1': 1_500_000 }, 'x')).toEqual([])
  })

  it('el redondeo a millares no cuenta como subida', () => {
    expect(detectarSubidas([jugador({ clausula: 1_505_000 })], { '1': 1_500_000 }, 'x')).toEqual([])
  })
})

describe('gastoPorEquipo', () => {
  it('suma lo de cada uno', () => {
    const s = (equipo: string, coste: number) => ({ idJugador: 'x', equipo, dia: 'd', coste, clausulaAntes: 0, clausulaDespues: 0 })
    expect([...gastoPorEquipo([s('A', 100), s('B', 50), s('A', 25)])]).toEqual([['A', 125], ['B', 50]])
  })
})
