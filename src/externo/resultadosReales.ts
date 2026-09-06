/**
 * Lo que ha pasado de verdad en el campo, para no tener que deducirlo.
 *
 * Hasta ahora, «lo duro que es el rival» se calculaba desde las medias fantasy
 * de sus jugadores en Mister: si sus delanteros puntúan mucho, ataca bien. Es
 * un apaño razonable, pero es una sombra de la realidad — mide lo que Mister
 * paga, no lo que el equipo hace.
 *
 * Football-Data.co.uk publica un CSV por temporada con lo que ocurrió en cada
 * partido: goles, **xG**, tiros, tiros a puerta, córners, faltas y tarjetas de
 * los dos equipos. Es gratis, no pide cuenta ni clave, y su robots.txt dice
 * `Disallow:` a secas, o sea que permite todo.
 *
 * Y tiene una virtud que ninguna fuente de jugadores tiene: **es por equipo**.
 * Veinte nombres que se pueden verificar a mano, en vez de quinientos nombres
 * de jugador que pueden cruzarse mal en silencio y enseñar las estadísticas de
 * otro. Ese era el riesgo que había que evitar, y así no existe.
 */

const CSV = 'https://football-data.co.uk/mmz4281/2627/SP1.csv'

/**
 * Sus nombres a los ids de club de Mister. A mano y completo, a propósito.
 *
 * Emparejar por parecido —quitar acentos, comparar trozos— acertaría con
 * «Barcelona» y fallaría con «Sociedad», «Vallecano» o «La Coruna», y fallaría
 * en silencio. Son veinte: se escriben.
 */
export const CLUBES: Record<string, number> = {
  Alaves: 48,
  'Ath Bilbao': 1,
  'Ath Madrid': 2,
  Barcelona: 3,
  Betis: 4,
  Celta: 5,
  Elche: 23,
  Espanol: 8,
  Getafe: 9,
  'La Coruna': 6,
  Levante: 12,
  Malaga: 13,
  Osasuna: 50,
  'Real Madrid': 15,
  Santander: 1490,
  Sevilla: 17,
  Sociedad: 16,
  Valencia: 19,
  Vallecano: 14,
  Villarreal: 20,
}

export type Partido = {
  fecha: string
  local: number
  visitante: number
  golesLocal: number
  golesVisitante: number
  xgLocal: number | null
  xgVisitante: number | null
  tirosLocal: number
  tirosVisitante: number
  aPuertaLocal: number
  aPuertaVisitante: number
}

/** Lo que un club hace y concede por partido, ya promediado. */
export type FuerzaClub = {
  partidos: number
  xgAFavor: number | null
  xgEnContra: number | null
  tirosAFavor: number
  tirosEnContra: number
  aPuertaAFavor: number
  aPuertaEnContra: number
  golesAFavor: number
  golesEnContra: number
}

export class ClubDesconocidoError extends Error {
  constructor(nombres: string[]) {
    super(
      `Football-Data trae clubes que no sé traducir: ${nombres.join(', ')}. ` +
        'Habrá subido alguien nuevo o habrán cambiado un nombre. Hay que añadirlos a mano en CLUBES: ' +
        'adivinarlos sería enseñar las estadísticas de un equipo con el escudo de otro.',
    )
  }
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Traduce el CSV. Se rompe si aparece un club que no está en la tabla: es
 * justo el caso en el que seguir adelante daría datos de otro equipo.
 */
export function parsearCsv(csv: string): Partido[] {
  const lineas = csv.replace(/^﻿/, '').trim().split(/\r?\n/)
  if (lineas.length < 2) return []
  const cab = lineas[0]!.split(',')
  const col = (fila: string[], nombre: string) => fila[cab.indexOf(nombre)]

  const partidos: Partido[] = []
  const desconocidos = new Set<string>()

  for (const linea of lineas.slice(1)) {
    const f = linea.split(',')
    const local = col(f, 'HomeTeam')
    const visitante = col(f, 'AwayTeam')
    if (!local || !visitante) continue
    const idL = CLUBES[local]
    const idV = CLUBES[visitante]
    if (idL === undefined) desconocidos.add(local)
    if (idV === undefined) desconocidos.add(visitante)
    if (idL === undefined || idV === undefined) continue

    const gl = num(col(f, 'FTHG'))
    const gv = num(col(f, 'FTAG'))
    // Un partido sin resultado es uno que aún no se ha jugado.
    if (gl === null || gv === null) continue

    partidos.push({
      fecha: col(f, 'Date') ?? '',
      local: idL,
      visitante: idV,
      golesLocal: gl,
      golesVisitante: gv,
      xgLocal: num(col(f, 'HxG')),
      xgVisitante: num(col(f, 'AxG')),
      tirosLocal: num(col(f, 'HS')) ?? 0,
      tirosVisitante: num(col(f, 'AS')) ?? 0,
      aPuertaLocal: num(col(f, 'HST')) ?? 0,
      aPuertaVisitante: num(col(f, 'AST')) ?? 0,
    })
  }

  if (desconocidos.size > 0) throw new ClubDesconocidoError([...desconocidos])
  return partidos
}

/** Promedia por club lo que hace y lo que concede. */
export function fuerzaPorClub(partidos: Partido[]): Map<number, FuerzaClub> {
  const bruto = new Map<number, { n: number; xgF: number; xgC: number; nXg: number; tF: number; tC: number; pF: number; pC: number; gF: number; gC: number }>()
  const anotar = (id: number, xgF: number | null, xgC: number | null, tF: number, tC: number, pF: number, pC: number, gF: number, gC: number) => {
    const a = bruto.get(id) ?? { n: 0, xgF: 0, xgC: 0, nXg: 0, tF: 0, tC: 0, pF: 0, pC: 0, gF: 0, gC: 0 }
    a.n += 1
    // El xG puede faltar en un partido suelto sin que falte lo demás, así que
    // lleva su propio contador: promediarlo entre todos los partidos lo
    // hundiría cada vez que a la fuente le falte una casilla.
    if (xgF !== null && xgC !== null) { a.xgF += xgF; a.xgC += xgC; a.nXg += 1 }
    a.tF += tF; a.tC += tC; a.pF += pF; a.pC += pC; a.gF += gF; a.gC += gC
    bruto.set(id, a)
  }

  for (const p of partidos) {
    anotar(p.local, p.xgLocal, p.xgVisitante, p.tirosLocal, p.tirosVisitante, p.aPuertaLocal, p.aPuertaVisitante, p.golesLocal, p.golesVisitante)
    anotar(p.visitante, p.xgVisitante, p.xgLocal, p.tirosVisitante, p.tirosLocal, p.aPuertaVisitante, p.aPuertaLocal, p.golesVisitante, p.golesLocal)
  }

  return new Map(
    [...bruto].map(([id, a]) => [
      id,
      {
        partidos: a.n,
        xgAFavor: a.nXg ? a.xgF / a.nXg : null,
        xgEnContra: a.nXg ? a.xgC / a.nXg : null,
        tirosAFavor: a.tF / a.n,
        tirosEnContra: a.tC / a.n,
        aPuertaAFavor: a.pF / a.n,
        aPuertaEnContra: a.pC / a.n,
        golesAFavor: a.gF / a.n,
        golesEnContra: a.gC / a.n,
      },
    ]),
  )
}

/**
 * Baja el CSV. Sin `www`: con él su servidor contesta 503 desde hace tiempo, y
 * sin él va. No es un capricho, es dónde está el fichero.
 */
export async function descargar(fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<string> {
  const res = await fetchImpl(CSV, {
    headers: { 'User-Agent': 'liga-de-mister (uso personal, una descarga por pasada)' },
  })
  if (!res.ok) throw new Error(`Football-Data devolvió HTTP ${res.status}`)
  return await res.text()
}
