import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR_POR_DEFECTO = '.sesion'

export type Credenciales = {
  cookie: string
  auth: string
}

/**
 * Lee las dos credenciales que Mister exige.
 *
 * La cuenta usa login con Apple y la cookie es HttpOnly, así que ninguna de las
 * dos puede obtenerse programáticamente: se copian de un navegador autenticado.
 *
 * Ningún mensaje de error incluye su valor.
 */
export function obtenerCredenciales(dir: string = DIR_POR_DEFECTO): Credenciales {
  return {
    cookie: leer(join(dir, 'cookie'), 'cookie'),
    auth: leer(join(dir, 'auth'), 'auth'),
  }
}

function leer(ruta: string, nombre: string): string {
  let contenido: string
  try {
    contenido = readFileSync(ruta, 'utf8')
  } catch {
    throw new Error(`falta la credencial ${nombre}: no se encontró ${ruta}. Cópiala del navegador.`)
  }

  const valor = contenido.trim()
  if (valor === '') {
    throw new Error(`la credencial ${nombre} está vacía en ${ruta}. Vuelve a capturarla.`)
  }

  return valor
}
