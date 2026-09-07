import { describe, expect, it } from 'vitest'
import { aQuienFaltaFoto, LADO, MAXIMO_POR_PASADA } from '../../src/actualizacion/fotos.js'

describe('aQuienFaltaFoto', () => {
  it('solo pide las que no tenemos', () => {
    expect(aQuienFaltaFoto(['1', '2', '3'], new Set(['2']))).toEqual(['1', '3'])
  })

  it('a nadie, si ya están todas: una cara no cambia', () => {
    expect(aQuienFaltaFoto(['1', '2'], new Set(['1', '2']))).toEqual([])
  })

  it('nunca más del tope, y el resto en la siguiente pasada', () => {
    const muchos = Array.from({ length: 200 }, (_, i) => String(i))
    expect(aQuienFaltaFoto(muchos, new Set(), 60)).toHaveLength(60)
    expect(aQuienFaltaFoto(muchos, new Set(), 60)[0]).toBe('0')
  })

  it('se guardan al doble del tamaño en que se enseñan, por las pantallas finas', () => {
    expect(LADO).toBeGreaterThanOrEqual(96)
    expect(MAXIMO_POR_PASADA).toBeGreaterThan(0)
  })
})
