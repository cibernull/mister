/**
 * Antes de integrar nada: ¿sirve de verdad esta API para esta liga?
 *
 *   npx tsx src/externo/sondaApiFootball.ts
 *
 * Se escribe primero la sonda y no la integración porque hay tres cosas que
 * pueden tumbarla entera y ninguna se sabe sin una clave delante:
 *
 *   1. Que el plan gratuito no llegue a la temporada en curso. Es la más
 *      probable: estas APIs suelen dejar el histórico abierto y cobrar por lo
 *      reciente, que es justo lo único que aquí sirve.
 *   2. Que la cuota diaria no dé para una pasada completa de LaLiga.
 *   3. Que los nombres no casen con los de Mister lo bastante como para que
 *      el emparejamiento estricto —o casa del todo, o no casa— deje algo.
 *
 * No escribe nada ni toca la aplicación: solo mira y cuenta.
 *
 * ── RESULTADO, 6 de septiembre de 2026 ──────────────────────────────────────
 *
 * El plan gratuito NO sirve para esta liga, y de la forma más traicionera:
 *
 *     /leagues?id=140   →  devuelve 17 temporadas, de 2010 a 2026.
 *                          La 2026 aparece listada.
 *     /players?...      →  «Free plans do not have access to this season,
 *                          try from 2022 to 2024.»
 *
 * O sea, el catálogo dice que la temporada en curso existe y los datos dicen
 * que no son para ti. Quien mire solo lo primero —que es lo natural— se cree
 * que tiene acceso y descubre el muro después de escribir la integración.
 *
 * Se deja este fichero, y no se borra, por dos motivos: para no volver a
 * gastar una tarde en el mismo callejón, y porque si algún día se paga un plan
 * esto contesta en dos peticiones si merece la pena.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://v3.football.api-sports.io'
const LALIGA = 140
const CLAVE = () => {
  try {
    return readFileSync(join(process.cwd(), '.sesion', 'api-football'), 'utf8').trim()
  } catch {
    throw new Error(
      'no encuentro .sesion/api-football. Guarda ahí la clave (ver las instrucciones) y repite.',
    )
  }
}

type Respuesta = { response: unknown[]; results: number; paging?: { current: number; total: number }; errors?: unknown }

async function pedir(ruta: string, clave: string): Promise<{ r: Respuesta; restantes: string | null }> {
  const res = await fetch(`${BASE}${ruta}`, { headers: { 'x-apisports-key': clave } })
  if (!res.ok) throw new Error(`${ruta} devolvió HTTP ${res.status}`)
  const r = (await res.json()) as Respuesta
  // La cuota que queda viene en la cabecera, no en el cuerpo: sin mirarla se
  // gasta el día entero sin enterarse.
  return { r, restantes: res.headers.get('x-ratelimit-requests-remaining') }
}

const pegas = (e: unknown): string =>
  !e || (Array.isArray(e) && e.length === 0) ? '' : JSON.stringify(e)

async function main() {
  const clave = CLAVE()
  const anio = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1
  console.log(`Temporada que toca por calendario: ${anio}-${anio + 1}\n`)

  console.log('1. ¿Qué temporadas deja ver el plan?')
  const { r: temporadas, restantes } = await pedir(`/leagues?id=${LALIGA}`, clave)
  const liga = temporadas.response[0] as { seasons?: { year: number; coverage?: Record<string, unknown> }[] } | undefined
  const anios = (liga?.seasons ?? []).map((s) => s.year)
  console.log(`   devuelve ${anios.length} temporadas, de ${Math.min(...anios)} a ${Math.max(...anios)}`)
  const alcanza = anios.includes(anio)
  console.log(`   ${alcanza ? '✓' : '✗'} la temporada ${anio} ${alcanza ? 'está' : 'NO está: el plan no llega, y sin ella esto no sirve'}`)
  if (restantes) console.log(`   peticiones que te quedan hoy: ${restantes}`)
  if (!alcanza) {
    console.log('\nSe para aquí. No tiene sentido gastar cuota ni escribir integración.')
    return
  }

  console.log('\n2. ¿Cuánto cuesta una pasada completa de LaLiga?')
  const { r: p1 } = await pedir(`/players?league=${LALIGA}&season=${anio}&page=1`, clave)
  const mal = pegas(p1.errors)
  if (mal) { console.log(`   ✗ la API se queja: ${mal}`); return }
  const paginas = p1.paging?.total ?? 0
  console.log(`   ${p1.results} jugadores por página · ${paginas} páginas · ${paginas} peticiones al día`)

  console.log('\n3. ¿Qué trae de cada jugador?')
  const uno = p1.response[0] as any
  if (uno) {
    const e = uno.statistics?.[0] ?? {}
    console.log(`   ${uno.player?.name} (${uno.player?.age} años, ${e.team?.name})`)
    console.log(`   minutos ${e.games?.minutes} · titular ${e.games?.lineups} · nota ${e.games?.rating}`)
    console.log(`   goles ${e.goals?.total} · asistencias ${e.goals?.assists} · tiros ${e.shots?.total} (a puerta ${e.shots?.on})`)
    console.log(`   pases clave ${e.passes?.key} · regates ${e.dribbles?.success}/${e.dribbles?.attempts}`)
    console.log(`   ¿trae xG? ${'expected' in e ? 'sí' : 'no — esta API no publica xG'}`)
  }
}

main().catch((e: unknown) => {
  console.error(`\nno he podido: ${e instanceof Error ? e.message : 'error desconocido'}`)
  process.exit(1)
})
