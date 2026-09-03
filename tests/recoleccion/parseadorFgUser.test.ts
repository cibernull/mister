import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FgUserNoEncontradoError, parsearFgUser } from '../../src/recoleccion/parseadorFgUser.js'

const objeto = readFileSync('fixtures/fg-user.json', 'utf8')
const paginaCon = (cuerpo: string) =>
  `<html><head><script>var _FG_cfg = {"a":1};\nvar _FG_user = ${cuerpo};\nvar otro = 2;</script></head><body>x</body></html>`

describe('parsearFgUser', () => {
  it('extrae los identificadores', () => {
    const d = parsearFgUser(paginaCon(objeto))
    expect(d.idUsuario).toBe(2445574)
    expect(d.idUc).toBe(12493763)
    expect(d.idComunidad).toBe(1890551)
  })

  it('extrae el nombre del equipo', () => {
    expect(parsearFgUser(paginaCon(objeto)).equipo).toBe('Niutin FC (Isaac)')
  })

  it('extrae saldo y tope de puja como enteros', () => {
    const d = parsearFgUser(paginaCon(objeto))
    expect(d.saldo).toBe(9209955)
    expect(d.saldoFuturo).toBe(9209955)
    expect(d.topePuja).toBe(28556455)
    expect(Number.isInteger(d.saldo)).toBe(true)
    expect(Number.isInteger(d.topePuja)).toBe(true)
  })

  it('lanza si la página no trae _FG_user', () => {
    expect(() => parsearFgUser('<html><body>nada</body></html>')).toThrow(FgUserNoEncontradoError)
  })

  it('lanza si falta el bloque balance', () => {
    expect(() => parsearFgUser(paginaCon('{"id":1,"id_uc":2,"id_community":3,"uc_name":"X"}'))).toThrow(/balance/i)
  })

  it('lanza si el saldo no es entero', () => {
    const malo = '{"id":1,"id_uc":2,"id_community":3,"uc_name":"X","balance":{"current":"x","future":0,"maxDebt":0}}'
    expect(() => parsearFgUser(paginaCon(malo))).toThrow(/current/i)
  })

  it('recorta bien el objeto cuando el nombre del equipo trae llave, comilla escapada y barra invertida', () => {
    const cuerpo =
      '{"id":1,"id_uc":2,"id_community":3,"uc_name":"Equipo } \\"raro\\" \\\\ fin","credits":0,"balance":{"current":0,"future":0,"maxDebt":0}}'
    const d = parsearFgUser(paginaCon(cuerpo))
    expect(d.equipo).toBe('Equipo } "raro" \\ fin')
  })

  it('no incluye el objeto crudo en los mensajes de error', () => {
    const malo = '{"id":1,"id_uc":2,"id_community":3,"uc_name":"X","email":"secreto@ejemplo.com","balance":{"current":"x","future":0,"maxDebt":0}}'
    try {
      parsearFgUser(paginaCon(malo))
      expect.unreachable('debería haber lanzado')
    } catch (e) {
      expect((e as Error).message).not.toContain('secreto@ejemplo.com')
    }
  })

  it('ignora una mención suelta de "var _FG_user" dentro de un comentario y toma la asignación real', () => {
    const html =
      `<html><head><script>\n` +
      `// nota interna: var _FG_user ya no se define aquí, ver más abajo\n` +
      `var _FG_cfg = {"a":1};\n` +
      `var _FG_user = ${objeto};\n` +
      `var otro = 2;\n` +
      `</script></head><body>x</body></html>`
    const d = parsearFgUser(html)
    expect(d.idUsuario).toBe(2445574)
    expect(d.saldo).toBe(9209955)
    expect(d.topePuja).toBe(28556455)
  })

  it('ignora una mención suelta de "var _FG_user" dentro de una cadena de JavaScript y toma la asignación real', () => {
    const html =
      `<html><head><script>\n` +
      `var mensaje = "recuerda: var _FG_user aparece citado aquí como ejemplo";\n` +
      `var _FG_cfg = {"a":1};\n` +
      `var _FG_user = ${objeto};\n` +
      `var otro = 2;\n` +
      `</script></head><body>x</body></html>`
    const d = parsearFgUser(html)
    expect(d.idUsuario).toBe(2445574)
    expect(d.equipo).toBe('Niutin FC (Isaac)')
  })

  it('lanza si hay más de una asignación real de var _FG_user en la página', () => {
    const viejo =
      '{"id":9,"id_uc":9,"id_community":9,"uc_name":"Viejo","credits":0,"balance":{"current":1,"future":1,"maxDebt":1}}'
    const html =
      `<html><head><script>\n` +
      `var _FG_user = ${viejo};\n` +
      `var _FG_user = ${objeto};\n` +
      `</script></head><body>x</body></html>`
    expect(() => parsearFgUser(html)).toThrow(/más de una/i)
  })

  it('no confunde var _FG_userExtra con var _FG_user y lanza el error de no encontrado', () => {
    const html = `<html><head><script>var _FG_userExtra = ${objeto};</script></head><body>x</body></html>`
    expect(() => parsearFgUser(html)).toThrow(FgUserNoEncontradoError)
  })

  it('reconoce la asignación aunque haya espacios extra alrededor del signo igual', () => {
    const html = `<html><head><script>var _FG_user   =   ${objeto} ;</script></head><body>x</body></html>`
    const d = parsearFgUser(html)
    expect(d.idUsuario).toBe(2445574)
    expect(d.idUc).toBe(12493763)
  })

  it('rechaza balance cuando es un array, con un mensaje que indica la causa real', () => {
    const cuerpo = '{"id":1,"id_uc":2,"id_community":3,"uc_name":"X","credits":0,"balance":[1,2,3]}'
    expect(() => parsearFgUser(paginaCon(cuerpo))).toThrow(/array/i)
  })
})
