import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { obtenerCredenciales } from '../../src/sesion/credenciales.js'

function dirCon(cookie: string | null, auth: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'mister-'))
  if (cookie !== null) writeFileSync(join(dir, 'cookie'), cookie)
  if (auth !== null) writeFileSync(join(dir, 'auth'), auth)
  return dir
}

describe('obtenerCredenciales', () => {
  it('lee la cookie y el token', () => {
    expect(obtenerCredenciales(dirCon('sesion=abc', 'tok123'))).toEqual({
      cookie: 'sesion=abc',
      auth: 'tok123',
    })
  })

  it('recorta espacios y saltos de línea', () => {
    expect(obtenerCredenciales(dirCon('  sesion=abc\n', ' tok123 \n\n'))).toEqual({
      cookie: 'sesion=abc',
      auth: 'tok123',
    })
  })

  it('lanza si falta la cookie', () => {
    expect(() => obtenerCredenciales(dirCon(null, 'tok123'))).toThrow(/cookie/i)
  })

  it('lanza si falta el token', () => {
    expect(() => obtenerCredenciales(dirCon('sesion=abc', null))).toThrow(/auth/i)
  })

  it('lanza si la cookie está vacía', () => {
    expect(() => obtenerCredenciales(dirCon('  \n', 'tok123'))).toThrow(/vací/i)
  })

  it('ningún mensaje de error revela el contenido de los ficheros', () => {
    const dir = dirCon('sesion=secretisima', null)
    try {
      obtenerCredenciales(dir)
      expect.unreachable('debería haber lanzado')
    } catch (e) {
      expect((e as Error).message).not.toContain('secretisima')
    }
  })
})
