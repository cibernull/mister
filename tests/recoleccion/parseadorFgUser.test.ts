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
})
