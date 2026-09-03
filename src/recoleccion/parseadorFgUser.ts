export type DatosUsuario = {
  idUsuario: number
  idUc: number
  idComunidad: number
  equipo: string
  saldo: number
  saldoFuturo: number
  /** `maxDebt`: saldo + 25 % del valor de plantilla. */
  topePuja: number
  creditos: number
}

export class FgUserNoEncontradoError extends Error {
  constructor() {
    super('la página no contiene var _FG_user: ¿sesión caducada o ruta equivocada?')
    this.name = 'FgUserNoEncontradoError'
  }
}

/**
 * Extrae el bloque `var _FG_user = {...}` que Mister incrusta en cada página.
 *
 * Ningún mensaje de error incluye el objeto crudo: contiene el correo y los
 * identificadores de Apple/Google del usuario.
 */
export function parsearFgUser(html: string): DatosUsuario {
  const inicio = html.indexOf('var _FG_user')
  if (inicio < 0) throw new FgUserNoEncontradoError()

  const llave = html.indexOf('{', inicio)
  if (llave < 0) throw new FgUserNoEncontradoError()

  const bruto = recortarObjeto(html, llave)
  let datos: Record<string, unknown>
  try {
    datos = JSON.parse(bruto) as Record<string, unknown>
  } catch {
    throw new FgUserNoEncontradoError()
  }

  const balance = datos['balance']
  if (!balance || typeof balance !== 'object') {
    throw new Error('_FG_user no trae el bloque balance')
  }
  const b = balance as Record<string, unknown>

  return {
    idUsuario: entero(datos['id'], 'id'),
    idUc: entero(datos['id_uc'], 'id_uc'),
    idComunidad: entero(datos['id_community'], 'id_community'),
    equipo: texto(datos['uc_name'], 'uc_name'),
    saldo: entero(b['current'], 'balance.current'),
    saldoFuturo: entero(b['future'], 'balance.future'),
    topePuja: entero(b['maxDebt'], 'balance.maxDebt'),
    creditos: entero(datos['credits'], 'credits'),
  }
}

/** Recorta el objeto JSON contando llaves, respetando las cadenas. */
function recortarObjeto(texto: string, desde: number): string {
  let nivel = 0, enCadena = false, escapado = false
  for (let i = desde; i < texto.length; i++) {
    const c = texto[i]
    if (escapado) { escapado = false; continue }
    if (c === '\\') { escapado = true; continue }
    if (c === '"') { enCadena = !enCadena; continue }
    if (enCadena) continue
    if (c === '{') nivel++
    else if (c === '}') { nivel--; if (nivel === 0) return texto.slice(desde, i + 1) }
  }
  throw new FgUserNoEncontradoError()
}

function entero(valor: unknown, campo: string): number {
  if (!Number.isInteger(valor)) {
    throw new Error(`el campo ${campo} de _FG_user no es un entero`)
  }
  return valor as number
}

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor === '') {
    throw new Error(`el campo ${campo} de _FG_user no es un texto`)
  }
  return valor
}
