import { describe, expect, it, vi } from 'vitest'
import { crearCliente } from '../../src/recoleccion/cliente.js'

const credenciales = { cookie: 'sesion=x', auth: 'tok123' }
const respuesta = (cuerpo: string, status = 200) => new Response(cuerpo, { status })

const cliente = (fetchFalso: unknown) =>
  crearCliente({ credenciales, esperaMs: 0, fetch: fetchFalso as never })

describe('cliente del feed', () => {
  it('pide el offset indicado y devuelve el cuerpo', async () => {
    const f = vi.fn(async () => respuesta('{"data":[]}'))
    expect(await cliente(f).pedirLote(42)).toBe('{"data":[]}')

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/ajax/feed')
    expect(init.method).toBe('POST')
    const cuerpo = new URLSearchParams(String(init.body))
    expect(cuerpo.get('offset')).toBe('42')
    expect(cuerpo.get('cardsPerPage')).toBe('20')
  })

  it('envía la cookie y el token X-Auth', async () => {
    const f = vi.fn(async () => respuesta('{}'))
    await cliente(f).pedirLote(0)

    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    const h = init.headers as Record<string, string>
    expect(h['Cookie']).toBe('sesion=x')
    expect(h['X-Auth']).toBe('tok123')
    expect(h['X-Requested-With']).toBe('XMLHttpRequest')
  })

  it('reintenta ante un error del servidor y acaba devolviendo el cuerpo', async () => {
    const f = vi.fn().mockResolvedValueOnce(respuesta('', 500)).mockResolvedValueOnce(respuesta('{"ok":1}'))
    expect(await cliente(f).pedirLote(0)).toBe('{"ok":1}')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('no reintenta ante un 401 y avisa de las credenciales', async () => {
    const f = vi.fn(async () => respuesta('{"status":"error"}', 401))
    await expect(cliente(f).pedirLote(0)).rejects.toThrow(/credencial|sesión/i)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('el error de credenciales no revela la cookie ni el token', async () => {
    const f = vi.fn(async () => respuesta('', 401))
    const c = crearCliente({
      credenciales: { cookie: 'sesion=secretisima', auth: 'tokensecreto' },
      esperaMs: 0,
      fetch: f as never,
    })
    await expect(c.pedirLote(0)).rejects.toThrow(/^(?!.*secretisima)(?!.*tokensecreto).*$/s)
  })
})
