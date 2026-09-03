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

  it('envía Content-Type, Accept y los campos end y loading en el cuerpo', async () => {
    const f = vi.fn(async () => respuesta('{}'))
    await cliente(f).pedirLote(5)

    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    const h = init.headers as Record<string, string>
    expect(h['Content-Type']).toBe('application/x-www-form-urlencoded; charset=UTF-8')
    expect(h['Accept']).toBe('application/json')

    const cuerpo = new URLSearchParams(String(init.body))
    expect(cuerpo.get('end')).toBe('0')
    expect(cuerpo.get('loading')).toBe('0')
  })

  it('reintenta ante un error del servidor y acaba devolviendo el cuerpo', async () => {
    const f = vi.fn().mockResolvedValueOnce(respuesta('', 500)).mockResolvedValueOnce(respuesta('{"ok":1}'))
    expect(await cliente(f).pedirLote(0)).toBe('{"ok":1}')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('agota los reintentos ante 5xx y el error final menciona el offset y el estado', async () => {
    const f = vi.fn(async () => respuesta('', 503))
    let error: Error | undefined
    try {
      await cliente(f).pedirLote(9)
    } catch (e) {
      error = e as Error
    }
    expect(error?.message).toMatch(/9/)
    expect(error?.message).toMatch(/503/)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('un rechazo de fetch se reintenta y, si el siguiente intento va bien, devuelve el cuerpo', async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(respuesta('{"ok":1}'))
    expect(await cliente(f).pedirLote(3)).toBe('{"ok":1}')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('si todos los intentos fallan por red, lanza un error que menciona el offset', async () => {
    const f = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    let error: Error | undefined
    try {
      await cliente(f).pedirLote(7)
    } catch (e) {
      error = e as Error
    }
    expect(error?.message).toMatch(/7/)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('un rechazo de fetch que NO es una instancia de Error también se reintenta, y el mensaje final sigue siendo útil', async () => {
    // `fetch` puede rechazar con cualquier valor, no solo un Error (p. ej. un
    // string, o incluso null): `(causa as Error).message` en ese caso da
    // `undefined` en vez de lanzar, y con causa `null` directamente lanza un
    // TypeError ajeno que rompería el reintento de una forma distinta a la
    // esperada. La coerción defensiva (`causa instanceof Error ? causa.message
    // : String(causa)`) cubre ambos casos.
    const f = vi.fn().mockRejectedValueOnce('ENOTFOUND mister.mundodeportivo.com').mockResolvedValueOnce(respuesta('{"ok":1}'))
    expect(await cliente(f).pedirLote(3)).toBe('{"ok":1}')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('si todos los intentos fallan por una causa que no es un Error, el mensaje final la incluye y encadena la causa original', async () => {
    const f = vi.fn().mockRejectedValue('ENOTFOUND mister.mundodeportivo.com')
    let error: Error | undefined
    try {
      await cliente(f).pedirLote(7)
    } catch (e) {
      error = e as Error
    }
    expect(error).toBeDefined()
    expect(error?.message).toMatch(/7/)
    expect(error?.message).toMatch(/ENOTFOUND/)
    expect(error?.cause).toBe('ENOTFOUND mister.mundodeportivo.com')
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('un rechazo de fetch con causa null no rompe el reintento con un TypeError ajeno', async () => {
    // `(causa as Error).message` con `causa === null` lanza un TypeError al
    // acceder a una propiedad de null — un fallo distinto del que el bucle de
    // reintentos espera manejar. La coerción defensiva evita ese TypeError.
    const f = vi.fn().mockRejectedValueOnce(null).mockResolvedValueOnce(respuesta('{"ok":1}'))
    expect(await cliente(f).pedirLote(3)).toBe('{"ok":1}')
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

  it('el error de fallo de red no revela la cookie ni el token', async () => {
    const f = vi.fn().mockRejectedValue(new Error('fallo de red'))
    const c = crearCliente({
      credenciales: { cookie: 'sesion=secretisima', auth: 'tokensecreto' },
      esperaMs: 0,
      fetch: f as never,
    })
    await expect(c.pedirLote(0)).rejects.toThrow(/^(?!.*secretisima)(?!.*tokensecreto).*$/s)
  })

  it('el regulador de ritmo espera lo que falta entre dos peticiones consecutivas', async () => {
    vi.useFakeTimers()
    try {
      let t = 0
      const ahora = () => t
      const f = vi.fn(async () => respuesta('{}'))
      const c = crearCliente({ credenciales, esperaMs: 1000, fetch: f, ahora })

      const p1 = c.pedirLote(0)
      await vi.runAllTimersAsync()
      await p1
      expect(f).toHaveBeenCalledTimes(1)

      t += 400 // solo han transcurrido 400 de los 1000 ms exigidos

      const p2 = c.pedirLote(1)

      await vi.advanceTimersByTimeAsync(599)
      expect(f).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      await p2
      expect(f).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('tras un 401 la siguiente petición sigue respetando el ritmo', async () => {
    vi.useFakeTimers()
    try {
      let t = 0
      const ahora = () => t
      const f = vi
        .fn()
        .mockResolvedValueOnce(respuesta('', 401))
        .mockResolvedValueOnce(respuesta('{}'))
      const c = crearCliente({ credenciales, esperaMs: 1000, fetch: f, ahora })

      await expect(c.pedirLote(0)).rejects.toThrow(/credencial|sesión/i)
      expect(f).toHaveBeenCalledTimes(1)

      t += 300 // solo han transcurrido 300 de los 1000 ms exigidos desde la petición del 401

      const p2 = c.pedirLote(1)

      await vi.advanceTimersByTimeAsync(699)
      expect(f).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      await p2
      expect(f).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
