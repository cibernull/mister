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

/** Hay más de una asignación real de `_FG_user` en la página: no se puede elegir sin adivinar. */
export class FgUserAmbiguoError extends Error {
  constructor() {
    super('la página contiene más de una asignación real de _FG_user: no se puede determinar cuál usar')
    this.name = 'FgUserAmbiguoError'
  }
}

/** Se localizó la asignación real de `_FG_user`, pero el bloque que la sigue está corrupto o incompleto. */
export class FgUserBloqueCorruptoError extends Error {
  constructor() {
    super('el bloque de _FG_user no se pudo interpretar: JSON corrupto o incompleto')
    this.name = 'FgUserBloqueCorruptoError'
  }
}

/**
 * Reconoce una asignación *real* de `_FG_user`: el nombre de la variable,
 * sin sufijo (no confundir con `_FG_userAlgo`), seguido de `=` y de `{`,
 * con cualquier cantidad de espacio en blanco alrededor del `=`.
 *
 * No basta con que el texto `_FG_user` aparezca en la página: podría estar
 * dentro de un comentario, de una cadena de JavaScript, o ser una
 * declaración obsoleta duplicada. Por eso se exige la forma sintáctica
 * completa de la asignación, y punto de partida es siempre la llave `{`
 * de la asignación encontrada.
 */
const RE_ASIGNACION_FG_USER = /(?<![A-Za-z0-9_$])_FG_user(?![A-Za-z0-9_$])\s*=\s*\{/g

/** Localiza la posición de la `{` de la única asignación real de `_FG_user`. */
function localizarLlaveDeAsignacion(html: string): number {
  const coincidencias = [...html.matchAll(RE_ASIGNACION_FG_USER)]
  if (coincidencias.length === 0) throw new FgUserNoEncontradoError()
  if (coincidencias.length > 1) throw new FgUserAmbiguoError()

  const unica = coincidencias[0]
  if (!unica) throw new FgUserNoEncontradoError()
  return unica.index + unica[0].length - 1
}

/**
 * Extrae el bloque `var _FG_user = {...}` que Mister incrusta en cada página.
 *
 * Ningún mensaje de error incluye el objeto crudo: contiene el correo y los
 * identificadores de Apple/Google del usuario.
 */
export function parsearFgUser(html: string): DatosUsuario {
  const llave = localizarLlaveDeAsignacion(html)

  const bruto = recortarObjeto(html, llave)
  let datos: Record<string, unknown>
  try {
    datos = JSON.parse(bruto) as Record<string, unknown>
  } catch {
    throw new FgUserBloqueCorruptoError()
  }

  const balance = datos['balance']
  if (Array.isArray(balance)) {
    throw new Error('el campo balance de _FG_user es un array, se esperaba un objeto')
  }
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
  throw new FgUserBloqueCorruptoError()
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
