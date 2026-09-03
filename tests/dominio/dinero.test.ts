import { describe, expect, it } from 'vitest'
import { parsearImporte } from '../../src/dominio/dinero.js'

describe('parsearImporte', () => {
  it('convierte un importe con puntos de millar en entero', () => {
    expect(parsearImporte('1.602.440')).toBe(1602440)
  })

  it('acepta un importe sin separadores', () => {
    expect(parsearImporte('900000')).toBe(900000)
  })

  it('acepta el signo positivo de los premios de jornada', () => {
    expect(parsearImporte('+725.000')).toBe(725000)
  })

  it('acepta importes negativos', () => {
    expect(parsearImporte('-6.000')).toBe(-6000)
  })

  it('ignora el símbolo de euro y los espacios', () => {
    expect(parsearImporte(' € 5.712.300 ')).toBe(5712300)
  })

  it('lanza error ante un texto que no es un importe', () => {
    expect(() => parsearImporte('no puntuó')).toThrow(/importe no reconocido/i)
  })

  it('lanza error ante un importe con decimales', () => {
    expect(() => parsearImporte('1.602,44')).toThrow(/importe no reconocido/i)
  })

  it('lanza error ante texto vacío', () => {
    expect(() => parsearImporte('')).toThrow(/importe no reconocido/i)
  })
})
