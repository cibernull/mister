/**
 * Una pasada de actualización completa: bajar lo nuevo, rehacer las cuentas,
 * comprobarlas contra Mister y volver a generar el módulo.
 *
 * Uso: `npx tsx src/actualizacion/actualizar.ts`
 *
 * Escribe el progreso en stderr, línea a línea, y un JSON con el resultado en
 * stdout. El servidor lo lanza y le enseña ese JSON al botón.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { crearCliente } from '../recoleccion/cliente.js'
import { obtenerCredenciales } from '../sesion/credenciales.js'
import { parsearFgUser } from '../recoleccion/parseadorFgUser.js'
import { extraerHechos, type Volcado } from './feed.js'
import { reconstruir, type Constantes } from './reconstruir.js'
import { recolectarFeed, recolectarValores, fundir } from './recolectar.js'
import { verificar } from './verificar.js'

const RAIZ = process.cwd()
const VOLCADO = join(RAIZ, 'datos', 'volcado-feed.json')
const DATOS = join(RAIZ, 'modulo', 'datos')
const CACHE_VALORES = join(DATOS, 'valores-ficha.json')

const paso = (t: string) => process.stderr.write(`${t}\n`)
const leerJson = <T>(ruta: string): T => JSON.parse(readFileSync(ruta, 'utf8')) as T
const escribirJson = (ruta: string, x: unknown) => writeFileSync(ruta, `${JSON.stringify(x, null, 1)}\n`)

export type Resultado = {
  ok: boolean
  cuando: string
  mensaje: string
  detalle?: string[]
  /** Ruta a la que mandar al usuario para arreglarlo, si la hay. */
  irA?: string
  cambios?: { lotesNuevos: number; traspasosNuevos: number; fichasPedidas: number }
}

async function main(): Promise<Resultado> {
  const cuando = new Date().toISOString()

  // ── 1. Credenciales ────────────────────────────────────────────────────────
  let credenciales
  try {
    credenciales = obtenerCredenciales(join(RAIZ, '.sesion'))
  } catch (e) {
    return {
      ok: false,
      cuando,
      mensaje: 'Faltan las credenciales de la sesión de Mister.',
      irA: '/credenciales',
      detalle: ['Se arregla en un minuto y solo hay que hacerlo una vez.'],
    }
  }

  const cliente = crearCliente({ credenciales })

  // ── 2. Feed, solo lo nuevo ─────────────────────────────────────────────────
  const volcado = existsSync(VOLCADO) ? leerJson<Volcado>(VOLCADO) : { paginas: [] }
  const antes = extraerHechos(volcado)
  paso(`Tengo ${antes.traspasos.length} traspasos, hasta ${antes.hasta ?? 'el principio'}.`)

  paso('Bajando lo publicado desde entonces…')
  const bajada = await recolectarFeed(cliente, antes.hasta)
  const fundido = fundir(volcado, bajada.nuevas)
  const hechos = extraerHechos(fundido)
  const traspasosNuevos = hechos.traspasos.length - antes.traspasos.length
  paso(`${bajada.lotes} lotes, ${traspasosNuevos} traspasos nuevos.`)

  // ── 3. Rehacer las cuentas ─────────────────────────────────────────────────
  const constantes = leerJson<Constantes>(join(DATOS, 'liga.json'))
  const cache = existsSync(CACHE_VALORES)
    ? new Map(Object.entries(leerJson<Record<string, number>>(CACHE_VALORES)))
    : new Map<string, number>()

  let cuentas = reconstruir(hechos, constantes, cache)

  // Los que siguen sin valor no han pasado nunca por el feed: su ficha es el
  // único sitio donde está. Se piden una vez y quedan en la caché.
  const faltan = [...new Set(cuentas.equipos.flatMap((e) => e.sinValorar))]
  let fichasPedidas = 0
  if (faltan.length > 0) {
    paso(`Pidiendo la ficha de ${faltan.length} jugadores para saber lo que valen…`)
    const { valores, fallidos } = await recolectarValores(cliente, faltan)
    fichasPedidas = valores.size
    for (const [id, v] of valores) cache.set(id, v)
    escribirJson(CACHE_VALORES, Object.fromEntries(cache))
    if (fallidos.length > 0) paso(`No pude con ${fallidos.length}: ${fallidos.map((f) => f.id).join(', ')}`)
    cuentas = reconstruir(hechos, constantes, cache)
  }

  // ── 4. Contrastar con lo que dice Mister ───────────────────────────────────
  paso('Comprobando las cuentas contra las cifras del propio Mister…')
  const mister = parsearFgUser(await cliente.pedirPagina('/'))
  const mio = cuentas.equipos.find((e) => e.mio)
  if (!mio) throw new Error('las constantes de la liga no marcan cuál es mi equipo')

  const veredicto = verificar(mio, mister)
  if (!veredicto.cuadra) {
    return {
      ok: false,
      cuando,
      mensaje: 'Las cuentas no cuadran con las de Mister, así que no he tocado nada.',
      detalle: [...veredicto.motivos, 'Los datos que ves siguen siendo los de la última actualización buena.'],
    }
  }
  paso(`Cuadra: saldo ${Math.round(mio.saldo).toLocaleString('es-ES')} €, tope ${Math.round(veredicto.topeCalculado).toLocaleString('es-ES')} €.`)

  // ── 5. Escribir y regenerar ────────────────────────────────────────────────
  // Solo a partir de aquí, con el veredicto en la mano, se toca nada en disco.
  escribirJson(VOLCADO, fundido)
  escribirJson(join(DATOS, 'equipos.json'), cuentas.equipos)
  escribirJson(join(DATOS, 'plantillas.json'), cuentas.plantillas)
  escribirJson(join(DATOS, 'datos-liga.json'), construirDatosLiga(hechos, cuentas.valores))
  escribirJson(join(DATOS, 'clausulas.json'), [...cuentas.clausulas].map(([id, c]) => [Number(id), c / 1000]))
  escribirJson(join(DATOS, 'jugadores-calc.json'), construirJugadores(hechos, cuentas))

  const gen = spawnSync('node', [join(RAIZ, 'modulo', 'generar.cjs')], { encoding: 'utf8' })
  if (gen.status !== 0) throw new Error(`el generador falló: ${gen.stderr || gen.stdout}`)

  return {
    ok: true,
    cuando,
    mensaje:
      traspasosNuevos === 0
        ? 'Ya estaba al día: no ha habido movimientos nuevos.'
        : `Al día. ${traspasosNuevos} movimiento${traspasosNuevos === 1 ? '' : 's'} nuevo${traspasosNuevos === 1 ? '' : 's'}.`,
    detalle: cuentas.avisos,
    cambios: { lotesNuevos: bajada.lotes, traspasosNuevos, fichasPedidas },
  }
}

/** Movimientos por equipo y por jugador, como los espera el generador. */
function construirDatosLiga(
  hechos: ReturnType<typeof extraerHechos>,
  valores: Map<string, number>,
): { jugadores: unknown[]; porEquipo: Record<string, unknown> } {
  const jugadores = new Map<string, { id: string; nombre: string; valor: number }>()
  const porEquipo: Record<string, { movimientos: unknown[]; porJugador: Record<string, { nombre: string; compras: number; ventas: number; ops: number }> }> = {}

  const anotar = (equipo: string, t: (typeof hechos.traspasos)[number], tipo: 'compra' | 'venta') => {
    const e = (porEquipo[equipo] ??= { movimientos: [], porJugador: {} })
    e.movimientos.push({ j: t.nombre, id: t.idJugador, tipo, importe: t.importe, fecha: t.cuando.slice(0, 10), op: t.tipo })
    const p = (e.porJugador[t.idJugador] ??= { nombre: t.nombre, compras: 0, ventas: 0, ops: 0 })
    if (tipo === 'compra') p.compras += t.importe
    else p.ventas += t.importe
    p.ops += 1
  }

  for (const t of hechos.traspasos) {
    jugadores.set(t.idJugador, { id: t.idJugador, nombre: t.nombre, valor: valores.get(t.idJugador) ?? t.valor })
    if (t.idUcDe !== 0 && t.de) anotar(t.de, t, 'venta')
    if (t.idUcA !== 0 && t.a) anotar(t.a, t, 'compra')
  }
  for (const e of Object.values(porEquipo)) {
    ;(e.movimientos as { fecha: string }[]).sort((a, b) => b.fecha.localeCompare(a.fecha))
  }
  return { jugadores: [...jugadores.values()], porEquipo }
}

/**
 * Los jugadores con sus estadísticas y los dos criterios de siempre.
 *
 * ⭐ y 💵 son percentiles sobre todos los jugadores conocidos, no umbrales
 * fijos: así siguen significando lo mismo cuando cambie el nivel de la liga.
 */
function construirJugadores(
  hechos: ReturnType<typeof extraerHechos>,
  cuentas: ReturnType<typeof reconstruir>,
): unknown[] {
  const enMercado = new Set(hechos.mercado.map((m) => m.idJugador))
  const ficha = new Map<string, { id: string; nombre: string; valor: number; puntos: number; media: number; partidos: number; semana: number | null; mes: number | null; mk: number; pos: number }>()

  const cuenta = (racha: string) => racha.split(',').filter((x) => x !== '' && x !== '-').length

  for (const t of hechos.traspasos) {
    ficha.set(t.idJugador, {
      id: t.idJugador,
      nombre: t.nombre,
      valor: cuentas.valores.get(t.idJugador) ?? t.valor,
      puntos: t.puntos,
      media: t.media,
      partidos: cuenta(t.racha),
      semana: null,
      mes: null,
      mk: enMercado.has(t.idJugador) ? 1 : 0,
      pos: t.posicion,
    })
  }
  // El mercado del día manda: trae media, puntos y partidos de hoy.
  for (const m of hechos.mercado) {
    const previo = ficha.get(m.idJugador)
    ficha.set(m.idJugador, {
      id: m.idJugador,
      nombre: m.nombre,
      valor: m.valor,
      puntos: m.puntos,
      media: m.media,
      partidos: m.partidos,
      semana: m.valor - m.valorPrevio,
      mes: previo?.mes ?? null,
      mk: 1,
      pos: m.posicion,
    })
  }

  const lista = [...ficha.values()]
  const medias = lista.filter((j) => j.partidos >= 2).map((j) => j.media).sort((a, b) => b - a)
  const umbralPts = medias[Math.floor(medias.length / 3)] ?? Infinity
  const crece = (j: (typeof lista)[number]) => (j.mes != null && j.valor ? j.mes / j.valor : null)
  const crecs = lista.map(crece).filter((x): x is number => x != null).sort((a, b) => b - a)
  const umbralDin = crecs[Math.floor(crecs.length / 3)] ?? Infinity

  return lista.map((j) => {
    const c = crece(j)
    return {
      ...j,
      p: j.partidos >= 2 && j.media >= umbralPts ? 1 : 0,
      d: c != null && c >= umbralDin && (j.semana ?? 0) > 0 ? 1 : 0,
    }
  })
}

main()
  .then((r) => {
    process.stdout.write(JSON.stringify(r))
    process.exit(r.ok ? 0 : 1)
  })
  .catch((e: unknown) => {
    const r: Resultado = {
      ok: false,
      cuando: new Date().toISOString(),
      mensaje: 'La actualización se cortó por un error.',
      detalle: [e instanceof Error ? e.message : String(e)],
    }
    process.stdout.write(JSON.stringify(r))
    process.exit(1)
  })
