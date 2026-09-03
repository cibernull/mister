import { describe, expect, it } from 'vitest'
import { extraerCabecera } from '../../src/sesion/importar.js'

// Un «Copy as cURL» de Chrome en Mac, recortado pero con la forma real.
const CURL_MAC = `curl 'https://mister.mundodeportivo.com/ajax/feed' \\
  -H 'accept: */*' \\
  -H 'content-type: application/x-www-form-urlencoded; charset=UTF-8' \\
  -H 'cookie: _fbp=fb.1.abc; PHPSESSID=xyz123; user=42' \\
  -H 'x-auth: TOKEN-DE-EJEMPLO-123' \\
  --data-raw 'offset=0&cardsPerPage=20'`

describe('extraerCabecera', () => {
  it('saca la cookie y el token de un pegado de Chrome', () => {
    expect(extraerCabecera(CURL_MAC, 'cookie')).toBe('_fbp=fb.1.abc; PHPSESSID=xyz123; user=42')
    expect(extraerCabecera(CURL_MAC, 'x-auth')).toBe('TOKEN-DE-EJEMPLO-123')
  })

  it('no le importa cómo esté escrito el nombre de la cabecera', () => {
    expect(extraerCabecera(`-H 'X-Auth: ABC'`, 'x-auth')).toBe('ABC')
    expect(extraerCabecera(`-H 'COOKIE: a=1'`, 'cookie')).toBe('a=1')
  })

  it('entiende también el entrecomillado de Windows', () => {
    expect(extraerCabecera(`-H "cookie: a=1; b=2"`, 'cookie')).toBe('a=1; b=2')
  })

  it('devuelve la cookie entera cuando lleva comillas escapadas dentro', () => {
    // Chrome escapa la comilla simple como '\'' . Cortar ahí guardaría una
    // credencial truncada, que falla más tarde y de forma confusa.
    expect(extraerCabecera(`-H 'cookie: a=uno'\\''dos; b=2' -H 'x-auth: T'`, 'cookie')).toBe("a=uno'dos; b=2")
  })

  it('devuelve null si la cabecera no está o viene vacía', () => {
    expect(extraerCabecera(CURL_MAC, 'authorization')).toBeNull()
    expect(extraerCabecera(`-H 'cookie: '`, 'cookie')).toBeNull()
  })

  it('no confunde una cabecera con otra que la contenga', () => {
    expect(extraerCabecera(`-H 'set-cookie: a=1' -H 'cookie: b=2'`, 'cookie')).toBe('b=2')
  })
})
