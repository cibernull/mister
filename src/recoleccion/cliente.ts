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
  /** Pide una página HTML cualquiera, con el mismo regulador de ritmo. */
  pedirPagina(ruta: string): Promise<string>
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

  /**
   * Bucle común de ritmo, reintentos y 401. Devuelve el cuerpo como texto.
   *
   * Compartido por `pedirLote` y `pedirPagina`: vivía duplicado entre ambos y
   * esa duplicación fue la causa directa de un fallo crítico en la Fase 1.
   * Ahora solo hay una copia, así que el regulador de ritmo y el trato del
   * 401 se aplican igual sin importar qué se esté pidiendo.
   */
  async function pedir(descripcion: string, init: RequestInit, ruta: string): Promise<string> {
    let ultimoFallo: Error | undefined

    for (let intento = 0; intento < REINTENTOS; intento++) {
      if (intento > 0) await dormir(esperaMs * 2 ** intento)
      await respetarRitmo()

      let res: Response
      try {
        res = await hacerFetch(`${base}${ruta}`, init)
      } catch (causa) {
        ultimoFallo = new Error(`${descripcion} falló por red: ${(causa as Error).message}`)
        continue
      }

      if (res.status === 401) {
        throw new Error(
          'credenciales de Mister caducadas o no válidas. Vuelve a copiar la cookie y el token del navegador.',
        )
      }
      if (res.ok) return await res.text()

      ultimoFallo = new Error(`${descripcion} devolvió HTTP ${res.status}`)
    }

    throw ultimoFallo ?? new Error(`no se pudo completar ${descripcion}`)
  }

  return {
    async pedirLote(offset: number): Promise<string> {
      return pedir(`el offset ${offset}`, {
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
      }, '/ajax/feed')
    },

    async pedirPagina(ruta: string): Promise<string> {
      return pedir(`la página ${ruta}`, {
        method: 'GET',
        headers: {
          Cookie: opciones.credenciales.cookie,
          'X-Auth': opciones.credenciales.auth,
          Accept: 'text/html',
        },
      }, ruta)
    },
  }
}
