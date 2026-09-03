import type { Credenciales } from '../sesion/credenciales.js'

const BASE_POR_DEFECTO = 'https://mister.mundodeportivo.com'
const ESPERA_POR_DEFECTO_MS = 1000
const EVENTOS_POR_LOTE = 20
const REINTENTOS = 3

export type OpcionesCliente = {
  credenciales: Credenciales
  base?: string
  esperaMs?: number
  fetch?: typeof globalThis.fetch
}

export type Cliente = {
  pedirLote(offset: number): Promise<string>
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Cliente HTTP del feed. Solo pide y devuelve texto: no interpreta nada.
 *
 * Espacia las peticiones para no castigar el servidor de Mister y reintenta los
 * fallos transitorios, pero nunca un 401: eso significa credenciales caducadas
 * y reintentarlo solo añade ruido.
 */
export function crearCliente(opciones: OpcionesCliente): Cliente {
  const base = opciones.base ?? BASE_POR_DEFECTO
  const esperaMs = opciones.esperaMs ?? ESPERA_POR_DEFECTO_MS
  const hacerFetch = opciones.fetch ?? globalThis.fetch

  return {
    async pedirLote(offset: number): Promise<string> {
      let ultimoFallo: Error | undefined

      for (let intento = 0; intento < REINTENTOS; intento++) {
        if (intento > 0) await dormir(esperaMs * 2 ** intento)

        const res = await hacerFetch(`${base}/ajax/feed`, {
          method: 'POST',
          headers: {
            Cookie: opciones.credenciales.cookie,
            'X-Auth': opciones.credenciales.auth,
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            end: '0',
            loading: '0',
            offset: String(offset),
            cardsPerPage: String(EVENTOS_POR_LOTE),
          }).toString(),
        })

        if (res.status === 401) {
          throw new Error(
            'credenciales de Mister caducadas o no válidas. Vuelve a copiar la cookie y el token del navegador.',
          )
        }

        if (res.ok) {
          await dormir(esperaMs)
          return await res.text()
        }

        ultimoFallo = new Error(`el offset ${offset} devolvió HTTP ${res.status}`)
      }

      throw ultimoFallo ?? new Error(`no se pudo obtener el offset ${offset}`)
    },
  }
}
