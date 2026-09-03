export type PuntoValor = {
  /** ISO `YYYY-MM-DD`. */
  fecha: string
  /** Entero. Mister lo publica redondeado a millares. */
  valor: number
}

export class SerieVaciaError extends Error {
  constructor() {
    super('la ficha no contiene ninguna serie de valores')
    this.name = 'SerieVaciaError'
  }
}

const MESES: Record<string, string> = {
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12',
}

/**
 * Serie diaria de valor de un jugador, incrustada en el HTML de su ficha como
 * objetos `{"value":"...","date":"..."}`.
 *
 * Deduplica por fecha y ordena cronológicamente: el HTML trae entradas
 * repetidas y no viene en orden.
 */
export function parsearSerieValores(html: string): PuntoValor[] {
  const porFecha = new Map<string, number>()

  // La forma general acepta cualquier contenido entre comillas en "value"
  // (incluida la cadena vacía): si se exigiera `\d+` aquí, un punto con el
  // valor vacío, nulo o no numérico simplemente no haría match y
  // desaparecería de la serie sin que nadie se enterara — luego `valorEn`
  // devolvería `null` para ese día, indistinguible de "no hay dato".
  for (const m of html.matchAll(/\{"value":"([^"]*)","date":"([^"]+)"\}/g)) {
    const valorCrudo = m[1]!
    if (!/^\d+$/.test(valorCrudo)) {
      throw new Error(
        `valor no numérico en un punto de la serie: "value":${JSON.stringify(valorCrudo)}, "date":${JSON.stringify(m[2])}`,
      )
    }
    const fecha = aIso(m[2]!)
    const valor = Number(valorCrudo)
    const existente = porFecha.get(fecha)
    if (existente === undefined) {
      porFecha.set(fecha, valor)
    } else if (existente !== valor) {
      // Una repetición legítima del HTML trae el mismo valor. Dos valores
      // distintos para la misma fecha no es una repetición: es una anomalía
      // (dato corregido, o una lectura mal hecha), y quedarse con el primero
      // en silencio falsearía el valor del reparto inicial que sale de aquí.
      throw new Error(
        `la misma fecha trae dos valores distintos en la serie: fecha=${fecha}, valores ${existente} y ${valor}`,
      )
    }
  }

  if (porFecha.size === 0) throw new SerieVaciaError()

  return [...porFecha.entries()]
    .map(([fecha, valor]) => ({ fecha, valor }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/**
 * Exige exactamente tres partes (día, mes, año). Desestructurar un array no
 * añade `| undefined` bajo `noUncheckedIndexedAccess`, así que sin esta
 * comprobación una fecha sin año produciría `anio === undefined` y
 * `aIso` devolvería silenciosamente `"undefined-08-03"` en vez de lanzar.
 */
function aIso(fecha: string): string {
  const partes = fecha.trim().split(/\s+/)
  if (partes.length !== 3) {
    throw new Error(
      `fecha con forma inesperada (se esperaban tres partes: día, mes y año): ${JSON.stringify(fecha)}`,
    )
  }
  const [dia, mes, anio] = partes as [string, string, string]

  if (!/^\d{1,2}$/.test(dia)) {
    throw new Error(`día no numérico en la fecha ${JSON.stringify(fecha)}`)
  }
  if (!/^\d{4}$/.test(anio)) {
    throw new Error(`año inesperado (se esperaban cuatro cifras) en la fecha ${JSON.stringify(fecha)}`)
  }

  const mm = MESES[mes.toLowerCase()]
  if (!mm) throw new Error(`mes no reconocido en la fecha ${JSON.stringify(fecha)}`)
  return `${anio}-${mm}-${dia.padStart(2, '0')}`
}

/** Valor exacto en una fecha, o null si ese día no está en la serie. */
export function valorEn(serie: PuntoValor[], fechaIso: string): number | null {
  return serie.find((p) => p.fecha === fechaIso)?.valor ?? null
}
