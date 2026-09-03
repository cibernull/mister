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
  ahora?: () => number
}

export type Cliente = {
  pedirLote(offset: number): Promise<string>
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Cliente HTTP del feed. Solo pide y devuelve texto: no interpreta nada.
 *
 * Espacia las peticiones para no castigar el servidor de Mister y reintenta
 * los fallos transitorios —incluido un rechazo de `fetch` por un problema de
 * red (timeout, DNS, conexión rechazada)—, pero nunca un 401: eso significa
 * credenciales caducadas y reintentarlo solo añade ruido.
 *
 * El espaciado mínimo entre peticiones lo aplica un único regulador de ritmo
 * consultado justo antes de emitir cada petición HTTP. Al vivir en ese único
 * punto, se respeta en todos los caminos —éxito, 401, reintentos agotados— y
 * también entre llamadas separadas de quien use el cliente, sin depender de
 * acordarse de dormir en cada rama de salida.
 */
export function crearCliente(opciones: OpcionesCliente): Cliente {
  const base = opciones.base ?? BASE_POR_DEFECTO
  const esperaMs = opciones.esperaMs ?? ESPERA_POR_DEFECTO_MS
  const hacerFetch = opciones.fetch ?? globalThis.fetch
  const ahora = opciones.ahora ?? Date.now

  let ultimaPeticion: number | undefined

  async function respetarRitmo(): Promise<void> {
    if (ultimaPeticion !== undefined) {
      const faltante = esperaMs - (ahora() - ultimaPeticion)
      if (faltante > 0) await dormir(faltante)
    }
    ultimaPeticion = ahora()
  }

  return {
    async pedirLote(offset: number): Promise<string> {
      let ultimoFallo: Error | undefined

      for (let intento = 0; intento < REINTENTOS; intento++) {
        if (intento > 0) await dormir(esperaMs * 2 ** intento)
        await respetarRitmo()

        let res: Response
        try {
          res = await hacerFetch(`${base}/ajax/feed`, {
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
        } catch (causa) {
          const mensaje = causa instanceof Error ? causa.message : String(causa)
          ultimoFallo = new Error(`fallo de red al pedir el offset ${offset}: ${mensaje}`, { cause: causa })
          continue
        }

        if (res.status === 401) {
          throw new Error(
            'credenciales de Mister caducadas o no válidas. Vuelve a copiar la cookie y el token del navegador.',
          )
        }

        if (res.ok) {
          return await res.text()
        }

        ultimoFallo = new Error(`el offset ${offset} devolvió HTTP ${res.status}`)
      }

      throw ultimoFallo ?? new Error(`no se pudo obtener el offset ${offset}`)
    },
  }
}
