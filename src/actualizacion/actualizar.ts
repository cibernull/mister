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
import {
  recolectarFeed,
  recolectarValores,
  recolectarPlantillas,
  recolectarUniverso,
  recolectarMercado,
  recolectarClasificacion,
  recolectarCaja,
  fundir,
} from './recolectar.js'
import type { JugadorMister } from '../recoleccion/parseadorUniverso.js'
import { verificar, verificarLiga } from './verificar.js'
import { podar, subidasDelMes, type Historico } from './historicoValores.js'
import type { FichaGuardada } from './fichas.js'
import { reinicioDeLiga } from '../recoleccion/parseadorSaldo.js'
import { detectarSubidas, gastoPorEquipo, subidasVivas, type Subida } from './clausulas.js'

const RAIZ = process.cwd()
const VOLCADO = join(RAIZ, 'datos', 'volcado-feed.json')
const DATOS = join(RAIZ, 'modulo', 'datos')
const CACHE_VALORES = join(DATOS, 'valores-ficha.json')
const CACHE_SLUGS = join(DATOS, 'slugs.json')
const HISTORICO = join(DATOS, 'historico-valores.json')
const FICHAS = join(DATOS, 'fichas.json')
const CAJA = join(DATOS, 'caja.json')
const HISTORICO_CL = join(DATOS, 'historico-clausulas.json')
const SUBIDAS = join(DATOS, 'subidas-clausula.json')

const paso = (t: string) => process.stderr.write(`${t}\n`)
const eur = (n: number) => `${Math.round(n).toLocaleString('es-ES')} €`
function leerJson<T>(ruta: string, sino?: T): T {
  if (sino !== undefined && !existsSync(ruta)) return sino
  return JSON.parse(readFileSync(ruta, 'utf8')) as T
}
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
  type EnCache = { valor: number; dia: string; nombre?: string; posicion?: number; subeDia?: number; subeMes?: number }
  const cache = existsSync(CACHE_VALORES)
    ? new Map(Object.entries(leerJson<Record<string, EnCache>>(CACHE_VALORES)))
    : new Map<string, EnCache>()
  const soloValores = () => new Map([...cache].map(([id, v]) => [id, v.valor]))

  paso('Leyendo las plantillas de los ocho equipos…')
  const leidas = await recolectarPlantillas(cliente, constantes.equipos)
  if (leidas.fallidos.length > 0) {
    return {
      ok: false,
      cuando,
      mensaje: 'No he podido leer la plantilla de todos los equipos, así que no he tocado nada.',
      detalle: [
        ...leidas.fallidos.map((f) => `${f.equipo}: ${f.motivo}`),
        'Sin todas las plantillas las cuentas saldrían cortas sin avisar.',
      ],
    }
  }
  escribirJson(CACHE_SLUGS, Object.fromEntries(leidas.slugs))

  // ── 3 bis. El censo de jugadores ───────────────────────────────────────────
  // Esto es lo que sabe Mister de cada jugador HOY: puntos, media, racha,
  // valor, cláusula y dueño. Antes se deducía del feed, y el feed solo publica
  // una foto del jugador en el instante de un evento y no la refresca nunca:
  // los puntos se quedaban congelados en el día del traspaso, y quien no había
  // pasado por ahí ni siquiera existía —de 523 jugadores de LaLiga, el feed
  // conocía 238—. Once peticiones cubren la competición entera.
  paso('Pidiendo el censo de jugadores…')
  const universo = await recolectarUniverso(cliente)
  const porId = new Map(universo.map((j) => [j.id, j]))
  paso(`${universo.length} jugadores.`)

  paso('Mirando quién está hoy en el mercado…')
  const enVenta = await recolectarMercado(cliente)
  paso(`${enVenta.length} a la venta.`)

  // ── Quién tiene a quién ────────────────────────────────────────────────────
  // Manda el censo, no la página del equipo. Las dos son de Mister, pero la
  // página va retrasada: al vender a Fer Niño el censo y la clasificación
  // decían 18 jugadores y 75.323.000 €, y su página del equipo seguía
  // enseñando 19 y 77.674.000 €. Con la página al mando la pasada no cuadraba
  // y no escribía nada, que es lo correcto pero deja la app congelada hasta que
  // Mister se pone de acuerdo consigo mismo.
  //
  // La página sigue haciendo falta para una cosa: los que ya no juegan en
  // LaLiga desaparecen del censo pero siguen en la plantilla, y Mister los
  // cuenta.
  const enCenso = new Set(universo.map((j) => j.id))
  const plantillas = new Map<string, string[]>()
  for (const e of constantes.equipos) {
    const delCenso = universo.filter((j) => j.duenio === e.nombre).map((j) => j.id)
    const soloEnLaPagina = (leidas.plantillas.get(e.nombre) ?? []).filter((id) => !enCenso.has(id))
    plantillas.set(e.nombre, [...delCenso, ...soloEnLaPagina])
  }

  const valoresUniverso = new Map(universo.map((j) => [j.id, j.valor]))
  // El censo pisa a la caché de fichas: es de hoy y cubre a todo el mundo. La
  // caché solo se queda con los que el censo ya no lista.
  const conUniverso = () => new Map([...soloValores(), ...valoresUniverso])

  let cuentas = reconstruir(hechos, constantes, conUniverso(), plantillas)

  // ── 3 ter. El histórico de valores ─────────────────────────────────────────
  // Lo que sube o baja un jugador EN UN MES no lo publica Mister en ningún
  // sitio: solo está en la gráfica de su ficha, de una en una. Guardando cada
  // día lo que vale cada uno, esa cifra sale de aquí para los 523 y gratis.
  // `npm run historico` lo rellena de golpe leyendo las fichas una vez.
  const hoy = new Date().toISOString().slice(0, 10)
  const historico = existsSync(HISTORICO) ? leerJson<Historico>(HISTORICO) : {}
  historico[hoy] = Object.fromEntries(universo.map((j) => [j.id, j.valor]))
  podar(historico)
  escribirJson(HISTORICO, historico)
  const delMes = subidasDelMes(historico, hoy)
  // Lo que solo está en la ficha de cada jugador —goles, tarjetas, media en
  // casa y fuera, titularidades, y si Mister lo da por titular el domingo—. Lo
  // rellena `npm run fichas`, que tarda nueve minutos y va aparte para que el
  // botón de Actualizar siga costando veinticinco segundos.
  const detalle = leerJson<Record<string, FichaGuardada>>(FICHAS, {})
  paso(`Histórico: ${Object.keys(historico).length} días, ${delMes.size} jugadores con tendencia del mes.`)

  // Qué fichas hay que pedir.
  //
  // Cada vez menos. El valor lo da el censo al día para los 523, y la
  // tendencia del mes la da el histórico en cuanto tiene recorrido. Solo
  // quedan los huecos:
  //
  //   · los míos de los que el histórico aún no sabe, porque son los que
  //     deciden el 📤 y el 🔒;
  //   · los que siguen en una plantilla pero ya no están en LaLiga, que el
  //     censo no lista y cuyo valor residual solo tiene su ficha.
  //
  // Eran ciento veintidós al día, dos minutos y medio. Con el histórico lleno
  // son cero.
  const enPlantilla = [...new Set(Object.values(cuentas.plantillas).flat())]
  const mios = cuentas.plantillas[constantes.equipos.find((e) => e.mio)?.nombre ?? ''] ?? []
  const fueraDelCenso = enPlantilla.filter((id) => !porId.has(id))
  const interesan = [...new Set([...mios.filter((id) => !delMes.has(id)), ...fueraDelCenso])]
  const faltan = interesan.filter((id) => cache.get(id)?.dia !== hoy)
  let fichasPedidas = 0
  if (faltan.length > 0) {
    // La ficha exige el slug del nombre; vino con la plantilla.
    const slugs = leidas.slugs

    paso(`Pidiendo la ficha de ${faltan.length} jugadores para saber su tendencia del mes…`)
    const { valores, fallidos } = await recolectarValores(cliente, faltan, slugs)
    fichasPedidas = valores.size
    for (const [id, v] of valores)
      cache.set(id, { valor: v.valor, dia: hoy, nombre: v.nombre, posicion: v.posicion, subeDia: v.dia, subeMes: v.mes })
    escribirJson(CACHE_VALORES, Object.fromEntries(cache))
    if (fallidos.length > 0) paso(`No pude con ${fallidos.length}: ${fallidos.map((f) => `${f.id} (${f.motivo})`).join(', ')}`)
    cuentas = reconstruir(hechos, constantes, conUniverso(), plantillas)
  }

  if (fueraDelCenso.length > 0) {
    const n = fueraDelCenso.length
    cuentas.avisos.push(
      `${n} jugador${n === 1 ? '' : 'es'} sigue${n === 1 ? '' : 'n'} en una plantilla pero ya no está${n === 1 ? '' : 'n'} en LaLiga ` +
        `(${fueraDelCenso.map((id) => cache.get(id)?.nombre ?? id).join(', ')}): cuentan por su valor residual`,
    )
  }

  // ── 4. Contrastar con lo que dice Mister ───────────────────────────────────
  paso('Comprobando las cuentas contra las cifras del propio Mister…')
  const mister = parsearFgUser(await cliente.pedirPagina('/'))
  const mio = cuentas.equipos.find((e) => e.mio)
  if (!mio) throw new Error('las constantes de la liga no marcan cuál es mi equipo')

  // Dos contrastes, no uno. `_FG_user` solo habla de mí; la clasificación
  // publica los jugadores, el valor de plantilla y los puntos de los ocho.
  const { clasificacion, clubes } = await recolectarClasificacion(cliente)

  // El saldo propio ya no se calcula: se lee del libro de caja de Mister, que
  // publica cada euro con su motivo. Reconstruirlo sumando el feed no podía
  // salir bien —el feed no publica las penalizaciones por subir cláusulas, y en
  // un mes van 5.263.619 €— y obligaba a llevar una constante fabricada a mano
  // que volvía a descuadrar en cuanto alguien tocaba una cláusula.
  const libro = await recolectarCaja(cliente)
  const reinicio = reinicioDeLiga(libro)
  const desdeElReinicio = reinicio === null ? libro.apuntes : libro.apuntes.filter((a) => a.cuando > reinicio.cuando)
  const invisible = desdeElReinicio
    .filter((a) => a.tipo === 'Penalización')
    .reduce((s, a) => s + a.importe, 0)
  const reconstruido = mio.saldo
  mio.saldo = libro.saldo

  // ── Quién sube cláusulas, y lo que le cuesta ───────────────────────────────
  // Mister cobra el 20 % del valor por cada modificación, y solo se puede leer
  // el libro de caja propio. Pero la cláusula se puede mirar: comparando la de
  // hoy con la de ayer se ve quién ha pagado, y cuánto. De aquí en adelante es
  // exacto; de lo de antes solo se sabe cuántas subidas siguen vivas.
  const clausulasDeHoy = Object.fromEntries(
    universo.filter((j) => j.duenio !== null && j.clausula !== null).map((j) => [j.id, j.clausula!]),
  )
  const histCl = existsSync(HISTORICO_CL) ? leerJson<Record<string, Record<string, number>>>(HISTORICO_CL) : {}
  const diasCl = Object.keys(histCl).sort()
  const ayer = diasCl.filter((d) => d < hoy).pop()
  const nuevasSubidas =
    ayer === undefined
      ? []
      : detectarSubidas(
          universo.map((j) => ({ id: j.id, duenio: j.duenio, valor: j.valor, clausula: j.clausula })),
          histCl[ayer] ?? {},
          hoy,
        )
  histCl[hoy] = clausulasDeHoy
  podar(histCl)
  escribirJson(HISTORICO_CL, histCl)

  const subidasVistas = existsSync(SUBIDAS) ? leerJson<Subida[]>(SUBIDAS) : []
  for (const s of nuevasSubidas) {
    if (!subidasVistas.some((v) => v.idJugador === s.idJugador && v.dia === s.dia)) subidasVistas.push(s)
  }
  escribirJson(SUBIDAS, subidasVistas)
  const gastoVisto = gastoPorEquipo(subidasVistas)

  const veredicto = verificar(mio, mister, libro.saldo)
  const dLiga = verificarLiga(cuentas.equipos, clasificacion)
  if (!veredicto.cuadra || dLiga.motivos.length > 0) {
    return {
      ok: false,
      cuando,
      mensaje: 'Las cuentas no cuadran con las de Mister, así que no he tocado nada.',
      detalle: [
        ...veredicto.motivos,
        ...dLiga.motivos,
        'Los datos que ves siguen siendo los de la última actualización buena.',
      ],
    }
  }
  cuentas.avisos.push(...dLiga.avisos)

  // Lo que el feed no ve, dicho con su número. A los rivales les pasa lo mismo
  // y de ellos no hay libro de caja —Mister oculta sus saldos—, así que su
  // dinero es un techo: el de verdad es ese o menos.
  if (invisible !== 0) {
    cuentas.avisos.push(
      `Llevas ${eur(-invisible)} en penalizaciones por subir cláusulas, que el feed no publica. ` +
        `Tu saldo sale del libro de caja de Mister, así que es exacto; el de los rivales es un techo.`,
    )
  }
  if (Math.abs(reconstruido - libro.saldo) > 1000) {
    cuentas.avisos.push(
      `Sumando el feed me salían ${eur(reconstruido)} y el libro de caja dice ${eur(libro.saldo)}: mando el libro.`,
    )
  }

  // Puntos y puesto salen de la clasificación oficial, no de sumar los cierres
  // de jornada del feed. Mister los revisa cuando llegan las estadísticas
  // oficiales —en una tarde bajó a Betico de 17 a 9 y subió a Niutin de 119 a
  // 134—, así que la suma del feed siempre iba a acabar desfasada, y con ella
  // la clasificación entera. Y el desempate entre dos equipos igualados también
  // es cosa suya.
  for (const c of clasificacion) {
    const e = cuentas.equipos.find((x) => x.n === c.equipo)
    if (e) {
      e.pts = c.puntos
      e.pos = c.puesto
    }
  }
  paso(
    `Cuadra: saldo ${Math.round(mio.saldo).toLocaleString('es-ES')} €, tope ${Math.round(veredicto.topeCalculado).toLocaleString('es-ES')} €, ` +
      `y los ${clasificacion.length} equipos coinciden con la clasificación en jugadores y valor de plantilla.`,
  )

  // ── 5. Escribir y regenerar ────────────────────────────────────────────────
  // Solo a partir de aquí, con el veredicto en la mano, se toca nada en disco.
  escribirJson(VOLCADO, fundido)
  escribirJson(join(DATOS, 'clubes.json'), Object.fromEntries(clubes))
  // El libro entero no: la página solo enseña lo reciente, y son 1255 apuntes.
  escribirJson(join(DATOS, 'caja.json'), { saldo: libro.saldo, apuntes: desdeElReinicio.slice(0, 60) })
  // Lo detectado se le resta al rival: es dinero que ya no tiene. Al propio no,
  // que su saldo sale del libro de caja y ahí ya está descontado.
  for (const e of cuentas.equipos) {
    const suyos = universo.filter((j) => j.duenio === e.n)
    e.subidas = suyos.reduce((n, j) => n + (j.clausula === null ? 0 : subidasVivas(j.valor, j.clausula)), 0)
    e.blindados = suyos.filter((j) => j.clausula !== null && subidasVivas(j.valor, j.clausula) > 0).length
    // Lo que costarían esas subidas al valor de hoy. Para el equipo propio se
    // enseña la cifra exacta del libro de caja, que es otra y es la buena.
    e.costeSubidas = suyos.reduce(
      (t, j) => t + (j.clausula === null ? 0 : subidasVivas(j.valor, j.clausula) * j.valor * 0.2),
      0,
    )
    e.gastoVisto = gastoVisto.get(e.n) ?? 0
    if (!e.mio && e.gastoVisto > 0) e.saldo -= e.gastoVisto
  }
  const mioExacto = cuentas.equipos.find((e) => e.mio)
  if (mioExacto) mioExacto.costeReal = -desdeElReinicio.filter((a) => a.tipo === 'Penalización').reduce((s, a) => s + a.importe, 0)

  escribirJson(join(DATOS, 'equipos.json'), cuentas.equipos)
  escribirJson(join(DATOS, 'plantillas.json'), cuentas.plantillas)
  escribirJson(join(DATOS, 'datos-liga.json'), construirDatosLiga(hechos, cuentas.valores))
  // Las cláusulas se reescriben enteras, no se acumulan. Acumularlas era lo
  // que hacía falta cuando la única fuente era el mercado del día —tres
  // jugadores cada vez—, y el precio de dejaba envejecer: de las 73 guardadas,
  // 63 estaban mal y 52 jugadores con dueño no tenían ninguna, así que la
  // pestaña de fichar les ponía su valor y se quedaba 78 M € corta. El censo
  // las trae todas y al día.
  const clausulas = universo.filter((j) => j.clausula !== null)
  escribirJson(join(DATOS, 'clausulas.json'), clausulas.map((j) => [Number(j.id), j.clausula! / 1000]))
  escribirJson(join(DATOS, 'jugadores-calc.json'), construirJugadores(universo, enVenta, cuentas, cache, delMes, detalle))
  escribirJson(
    join(DATOS, 'jornadas.json'),
    hechos.jornadas.map((j) => ({
      jornada: j.jornada,
      cuando: j.cuando.slice(0, 10),
      equipos: j.posiciones.map((p) => ({
        equipo: constantes.equipos.find((e) => e.idUc === p.idUc)?.nombre ?? String(p.idUc),
        puntos: p.puntos,
        puesto: p.puesto,
        premio: p.premio,
      })),
    })),
  )

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
): { jugadores: unknown[]; movimientos: unknown[]; porEquipo: Record<string, unknown> } {
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
  // El histórico también como lista única, en orden inverso: es lo que pide la
  // pestaña de movimientos, y reconstruirlo desde porEquipo sería lossy porque
  // cada traspaso está ahí dos veces, una por cada lado.
  const movimientos = [...hechos.traspasos]
    .reverse()
    .map((t) => ({ id: t.idJugador, nombre: t.nombre, de: t.idUcDe ? t.de : null, a: t.idUcA ? t.a : null, importe: t.importe, tipo: t.tipo, fecha: t.cuando, pos: t.posicion }))
  return { jugadores: [...jugadores.values()], movimientos, porEquipo }
}

/**
 * Lo que aporta la ficha, o huecos si esa ficha aún no se ha leído.
 *
 * Se devuelven las claves siempre, con `null` dentro, y no un objeto vacío: así
 * el generador puede preguntar por ellas sin distinguir «no lo sé» de «no
 * existe el campo», que es de donde salen los `undefined` en la página.
 */
function detalleDe(f: FichaGuardada | undefined): {
  gol: number | null
  tar: number | null
  mc: number | null
  mf: number | null
  tit: number | null
  sup: number | null
  once: 1 | 0 | null
} {
  return {
    gol: f?.goles ?? null,
    tar: f?.tarjetas ?? null,
    mc: f?.mediaCasa ?? null,
    mf: f?.mediaFuera ?? null,
    tit: f?.titularidades ?? null,
    sup: f?.suplencias ?? null,
    once: f === undefined || f.titular === null ? null : f.titular ? 1 : 0,
  }
}

/**
 * Los jugadores con sus estadísticas y los dos criterios de siempre.
 *
 * La lista es el censo entero de la competición, no solo los que han pasado
 * por el feed: los doce mejores de LaLiga estaban libres y ninguno aparecía.
 *
 * ⭐ y 💵 son percentiles sobre todos los jugadores, no umbrales fijos: así
 * siguen significando lo mismo cuando cambie el nivel de la liga.
 */
function construirJugadores(
  universo: JugadorMister[],
  enVenta: { id: string; precio: number; cedible: boolean }[],
  cuentas: ReturnType<typeof reconstruir>,
  fichas: Map<string, { valor: number; nombre?: string; posicion?: number; subeDia?: number; subeMes?: number; dia?: string }>,
  delMes: Map<string, number>,
  detalle: Record<string, FichaGuardada>,
): unknown[] {
  // El histórico manda en cuanto tiene recorrido; hasta entonces, la ficha, y
  // solo si se pidió hoy. Una cifra vieja del mes pasado no se enseña: era así
  // como se colaban los datos rancios que había que quitar de en medio.
  const hoy = new Date().toISOString().slice(0, 10)
  const mesDe = (id: string): number | null =>
    delMes.get(id) ?? (fichas.get(id)?.dia === hoy ? (fichas.get(id)?.subeMes ?? null) : null)
  const seVende = new Map(enVenta.map((v) => [v.id, v.precio]))
  const enCesion = new Set(enVenta.filter((v) => v.cedible).map((v) => v.id))

  const lista = universo.map((j) => ({
    id: j.id,
    nombre: j.nombre,
    valor: j.valor,
    puntos: j.puntos,
    media: j.media,
    partidos: j.partidos,
    /** Lo que ha cambiado su valor desde ayer. */
    semana: j.sube,
    mes: mesDe(j.id),
    mk: seVende.has(j.id) ? 1 : 0,
    /** Lo que pide quien lo vende. Solo si está en el mercado. */
    pv: seVende.get(j.id) ?? null,
    /** Su dueño lo ofrece en cesión, no en venta. */
    ced: enCesion.has(j.id) ? 1 : 0,
    pos: j.posicion,
    /** `injury`, `doubt`… o `null` si está sano. */
    est: j.estado,
    /** Su cláusula está blindada: no se le puede pagar. */
    bl: j.blindado ? 1 : 0,
    /** Veces que le han subido la cláusula, y sigue subida. */
    sub: j.clausula === null ? 0 : subidasVivas(j.valor, j.clausula),
    /** El club contra el que juega la próxima jornada, y si es en casa. */
    riv: j.rival,
    casa: j.enCasa === null ? null : j.enCasa ? 1 : 0,
    ...detalleDe(detalle[j.id]),
  }))

  // Los que siguen en una plantilla y ya no están en LaLiga. No los lista el
  // censo, pero el generador tiene que saber su nombre: si no, se encuentra
  // con un jugador de plantilla del que no sabe nada y lo pinta «sin datos».
  const censados = new Set(lista.map((j) => j.id))
  for (const id of new Set(Object.values(cuentas.plantillas).flat())) {
    if (censados.has(id)) continue
    const f = fichas.get(id)
    if (f?.nombre === undefined) continue
    lista.push({
      id,
      nombre: f.nombre,
      valor: f.valor,
      puntos: 0,
      media: 0,
      partidos: 0,
      semana: f.subeDia ?? 0,
      mes: mesDe(id),
      mk: 0,
      pv: null,
      ced: 0,
      pos: f.posicion ?? 0,
      est: 'out',
      bl: 0,
      sub: 0,
      riv: null,
      casa: null,
      ...detalleDe(detalle[id]),
    })
  }

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
