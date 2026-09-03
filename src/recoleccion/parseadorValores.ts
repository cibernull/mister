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
    if (!porFecha.has(fecha)) porFecha.set(fecha, Number(valorCrudo))
  }

  if (porFecha.size === 0) throw new SerieVaciaError()

  return [...porFecha.entries()]
    .map(([fecha, valor]) => ({ fecha, valor }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
}

function aIso(fecha: string): string {
  const partes = fecha.trim().split(/\s+/)
  const [dia, mes, anio] = partes
  const mm = mes ? MESES[mes.toLowerCase()] : undefined
  if (!mm) throw new Error(`mes no reconocido en la fecha ${JSON.stringify(fecha)}`)
  return `${anio}-${mm}-${String(dia).padStart(2, '0')}`
}

/** Valor exacto en una fecha, o null si ese día no está en la serie. */
export function valorEn(serie: PuntoValor[], fechaIso: string): number | null {
  return serie.find((p) => p.fecha === fechaIso)?.valor ?? null
}
