#!/usr/bin/env node
// Genera el módulo (una página) a partir de los datos del motor contable.
//   node modulo/generar.cjs [salida.html]
//
// La página se organiza por preguntas, no por tablas:
//   Mi equipo   ¿cómo voy y qué hago con mi plantilla?
//   Fichar      ¿a quién puedo fichar, a qué precio, y quién me lo puede quitar?
//   Rivales     ¿qué tienen los demás?
//   Movimientos ¿qué ha pasado en la liga?
//   Números     ¿quién va ganando, en puntos y en dinero?
//   Guía        ¿qué significa todo esto?
'use strict'
const fs = require('fs')
const path = require('path')

const AQUI = __dirname
const DAT = path.join(AQUI, 'datos')
const SALIDA = process.argv[2] || path.join(AQUI, '..', 'datos', 'mercado.html')
const MI_EQUIPO = 'Niutin FC (Isaac)'
const NOMBRE_LIGA = 'Estadísticas Mister'
// Dónde se lanza a mano la actualización. Es la página del workflow de GitHub:
// desde el móvil son dos toques y tarda un minuto. Un botón que la dispare de
// verdad desde aquí necesitaría un token, y esta página es pública.
const LANZAR = 'https://github.com/cibernull/mister/actions/workflows/actualizar.yml'

// La dirección del lanzador de Cloudflare, el único que tiene el token con el
// que se le puede pedir a GitHub que actualice. Mientras esté vacía, el botón
// se conforma con abrir GitHub —que es lo que hacía— y hay que rematar la
// pasada a mano; en cuanto tenga valor, el botón actualiza de un toque.
// Aquí no hay nada secreto: quien abra la página verá esta dirección, y da
// igual, porque lo único que sabe hacer el lanzador es refrescar estos datos.
const LANZADOR = 'https://liga-de-mister.mmrb2mrvgm.workers.dev'

const leer = (n) => JSON.parse(fs.readFileSync(path.join(DAT, n), 'utf8'))
const J = leer('jugadores-calc.json')
const CL = new Map(leer('clausulas.json').map(([id, k]) => [String(id), k * 1000]))
const D = leer('datos-liga.json')
const PL = leer('plantillas.json')
const EQ = leer('equipos.json')
const JOR = leer('jornadas.json')
const opcional = (n, sino) => { try { return leer(n) } catch { return sino } }
const YO = opcional('yo.json', { formacion: '', tope: 0, generado: new Date().toISOString() })
const NOV = opcional('novedades.json', [])
const IDS_CAMBIADOS = new Set(NOV.map((n) => String(n.id)).filter(Boolean))
const MOVS = D.movimientos ?? []
// Los clubes reales, para poder decir «Sevilla» y no «rival 19». Es un
// adorno: si el fichero no está, la línea del próximo partido no se pinta.
// Los escudos van dentro del HTML como data URI: la página publicada no puede
// cargar imágenes del CDN de Mister —el visor solo deja pasar tipografías— y
// quedaría un hueco sin avisar. Los baja `python3 modulo/escudos.py`.
const ESCUDOS = (() => {
  try {
    return new Map(Object.entries(leer('escudos.json')))
  } catch {
    return new Map()
  }
})()
const CLUBES = (() => {
  try {
    return new Map(Object.entries(leer('clubes.json')))
  } catch {
    return new Map()
  }
})()

// Dueño actual de cada jugador. Un jugador solo puede estar en una plantilla:
// si aparece en dos, la captura está mal y prefiero enterarme a taparlo.
const DUENIO = new Map()
for (const [eq, ids] of Object.entries(PL)) {
  for (const id of ids) {
    const previo = DUENIO.get(String(id))
    if (previo) throw new Error(`El jugador ${id} está en dos plantillas: ${previo} y ${eq}`)
    DUENIO.set(String(id), eq)
  }
}

const VALOR = new Map()
for (const j of D.jugadores) VALOR.set(String(j.id), j.valor)
for (const j of J) VALOR.set(String(j.id), j.valor)

EQ.forEach((e) => {
  // Lo comprometido en pujas está en la caja pero ya no se puede gastar, y
  // Mister lo descuenta del tope. Solo se conoce el propio.
  e.tope = e.saldo - (e.comprometido || 0) + 0.25 * e.pl
  e.corto = e.n.replace(/\s*\(.*\)\s*/, '').trim()
  e.patrimonio = e.saldo + e.pl
  e.sobre50 = e.patrimonio - 50000000
})
const maxTope = Math.max(...EQ.map((e) => e.tope))
const MIO = EQ.find((e) => e.mio)
if (!MIO) throw new Error('No encuentro mi equipo en la tabla de equipos')
const RIVALES = EQ.filter((e) => !e.mio)
const POR_NOMBRE = new Map(EQ.map((e) => [e.n, e]))

// ── Lo que Mister ya sabe y no se estaba usando ──────────────────────────────
// Nada de esto viene de fuera: sale de la racha —la puntuación jornada a
// jornada, que el censo trae y hasta ahora solo servía para contar partidos— y
// del propio censo. Son indicadores calculados, no cifras de Mister, y la Guía
// dice cómo se calculan para que nadie los confunda con un dato suyo.

/** Las jornadas que jugó, sin los huecos. */
const jugadas = (j) => (Array.isArray(j.racha) ? j.racha : []).filter((p) => p !== null)

const JORNADAS_DE_FORMA = 3

/**
 * Forma: lo que saca últimamente frente a lo que saca de normal.
 *
 * Se compara con su propia media, no con la de la liga: la pregunta es si está
 * mejor o peor **que él mismo**, que es lo que decide si alinearlo. Hacen falta
 * al menos dos jornadas jugadas; con una, «la forma» sería la propia jornada.
 */
const formaDe = (j) => {
  const l = jugadas(j)
  if (l.length < 2) return null
  const ult = l.slice(-JORNADAS_DE_FORMA)
  const reciente = ult.reduce((a, b) => a + b, 0) / ult.length
  return reciente - j.media
}

/**
 * Regularidad: cuánto se aparta de su media, jornada a jornada.
 *
 * Dos jugadores de media 6 no valen lo mismo si uno hace 6, 6, 6 y el otro 0,
 * 0, 18. Cuanto más bajo, más de fiar. Se necesita más de una jornada.
 */
const regularidadDe = (j) => {
  const l = jugadas(j)
  if (l.length < 2) return null
  const m = l.reduce((a, b) => a + b, 0) / l.length
  return Math.sqrt(l.reduce((t, x) => t + (x - m) ** 2, 0) / l.length)
}

/**
 * Cómo de duro es el próximo rival, para su puesto.
 *
 * A un defensa le importa lo que ataca el rival; a un delantero, lo que
 * defiende. La pregunta es de dónde se saca eso.
 *
 * Se sacaba de las medias fantasy de Mister: si los delanteros de un club
 * puntúan mucho, ese club ataca bien. Era un apaño defendible, pero medía lo
 * que Mister paga y no lo que el equipo hace. Ahora, cuando hay resultados
 * reales de Football-Data, se mide con **xG**: los goles que ha merecido y los
 * que ha concedido por partido. Si esos resultados faltan —su servidor se cae
 * a veces— se vuelve al apaño, que sigue siendo mejor que nada.
 */
const FUERZA_REAL = opcional('fuerza-real.json', null)

const fuerzaFantasy = (() => {
  const acumular = (puestos) => {
    const m = new Map()
    for (const j of J) {
      if (!j.eq || !puestos.includes(j.pos) || !j.partidos) continue
      const a = m.get(j.eq) ?? { suma: 0, peso: 0 }
      a.suma += j.media * j.partidos
      a.peso += j.partidos
      m.set(j.eq, a)
    }
    return new Map([...m].map(([k, v]) => [k, v.suma / v.peso]))
  }
  return { ataque: acumular([3, 4]), defensa: acumular([1, 2]) }
})()

/**
 * La tabla de amenaza por puesto, y de dónde sale.
 *
 * Para portero y defensa, «amenaza» es lo que el rival genera: más xG a favor,
 * peor. Para medio y delantero es lo cerrado que está el rival, así que se
 * invierte el xG que concede — conceder poco es ser duro.
 */
const amenazaDe = (() => {
  const reales = FUERZA_REAL && FUERZA_REAL.clubes ? Object.entries(FUERZA_REAL.clubes) : []
  const conXg = reales.filter(([, f]) => f.xgAFavor !== null && f.xgEnContra !== null)
  if (conXg.length >= 15) {
    return {
      fuente: 'real',
      atras: new Map(conXg.map(([id, f]) => [Number(id), f.xgAFavor])),
      // Se niega para que «más alto = más duro» valga igual en las dos tablas.
      delante: new Map(conXg.map(([id, f]) => [Number(id), -f.xgEnContra])),
      detalle: new Map(conXg.map(([id, f]) => [Number(id), f])),
    }
  }
  return {
    fuente: 'fantasy',
    atras: fuerzaFantasy.ataque,
    delante: fuerzaFantasy.defensa,
    detalle: new Map(),
  }
})()

/** De 1 (rival blando) a 5 (rival duro), por quintiles entre los clubes. */
const durezaDe = (j) => {
  if (!j.riv) return null
  const tabla = j.pos <= 2 ? amenazaDe.atras : amenazaDe.delante
  const suyo = tabla.get(j.riv)
  if (suyo === undefined) return null
  const todos = [...tabla.values()].sort((a, b) => a - b)
  const pos = todos.filter((x) => x < suyo).length
  return Math.min(5, Math.floor((pos / todos.length) * 5) + 1)
}

/** Por qué ese rival es duro o blando, con la cifra delante. */
const porQueDuro = (j) => {
  const f = amenazaDe.detalle.get(j.riv)
  const club = esc(CLUBES.get(String(j.riv)) ?? 'el rival')
  if (!f) return 'Calculado con las medias de sus jugadores en Mister: aún no hay resultados reales.'
  return j.pos <= 2
    ? `${club} genera ${dec(f.xgAFavor)} goles esperados por partido (xG real, no fantasy).`
    : `${club} concede ${dec(f.xgEnContra)} goles esperados por partido (xG real, no fantasy).`
}

const pintarDureza = (n, j) =>
  n === null ? '' : `<span class="dur d${n}" title="Lo duro que es ese rival para su puesto, de 1 (blando) a 5 (duro). ${j ? porQueDuro(j) : ''}">${'●'.repeat(n)}${'○'.repeat(5 - n)}</span>`

const claseRacha = (p) => (p >= 8 ? 'alta' : p >= 4 ? 'media' : p > 0 ? 'baja' : 'cero')

const pintarRacha = (j, dentro) => {
  const l = Array.isArray(j.racha) ? j.racha.slice(-5) : []
  if (l.length === 0) return ''
  return `<span class="racha${dentro ? ' pegada' : ''}" title="Sus últimas jornadas; el hueco es que no jugó">${l
    .map((p) => (p === null ? '<i class="rj vacia">·</i>' : `<i class="rj ${claseRacha(p)}">${p}</i>`))
    .join('')}</span>`
}

/**
 * Los goles de una jornada, leyendo los eventos de su ficha.
 *
 * Cuenta la `g` y también la `p`: en la ficha de Mister un penalti marcado va
 * como evento aparte, pero suma en el total de goles. Sin contarlo, a Budimir
 * le salían cuatro goles arriba y un solo balón abajo.
 */
const golesDeJornada = (ev) => (ev || '').split('').filter((c) => c === 'g' || c === 'p').length

/**
 * La misma tira, con los balones encima de la jornada en que marcó.
 *
 * Antes los balones iban junto al nombre y eran los de toda la temporada,
 * porque yo daba por hecho que Mister no publicaba en qué jornada los metió.
 * Sí lo publica: están en los iconos de cada casilla de su ficha, que es de
 * donde salen los de la ventana del jugador.
 */
const rachaConGoles = (j) => {
  const l = Array.isArray(j.js) ? j.js.slice(-5) : []
  if (l.length === 0) return ''
  return `<span class="racha pegada golea" title="Sus últimas jornadas y los goles de cada una">${l
    .map(([n, pts, , , ev]) => {
      const g = golesDeJornada(ev)
      const bolas = g === 0 ? '' : g <= 3 ? '⚽'.repeat(g) : `⚽×${g}`
      const cuenta = pts == null ? 'no jugó' : `J${n}: ${pts} puntos${g ? ` y ${g} ${g === 1 ? 'gol' : 'goles'}` : ''}`
      return `<i class="rjg" title="${esc(cuenta)}"><u>${bolas}</u>${
        pts == null ? '<b class="rj vacia">·</b>' : `<b class="rj ${claseRacha(pts)}">${pts}</b>`
      }</i>`
    })
    .join('')}</span>`
}

/** Su media donde le toca jugar esta jornada. El punto de partida, sin retocar. */
/**
 * Cuántos partidos hacen falta para fiarse de una media.
 *
 * Se usa dos veces y las dos por lo mismo: acercar una media flaca a una
 * referencia más sólida. Aquí arriba porque `esperadoDe` la necesita.
 */
/**
 * La probabilidad de salir de titular, de FútbolFantasy.
 *
 * Mister publica un pronóstico de titularidad que es un sí/no y que viene vacío
 * casi siempre: de mis diecisiete jugadores solo sabía el de uno. FútbolFantasy
 * da un porcentaje para todos, y eso cambia decisiones —Rodri Hernández estaba
 * en el once con un 50 % de salir y la página no lo decía—.
 *
 * No se usa para retocar los puntos esperados. Multiplicar por la probabilidad
 * daría una cifra que parece un dato y es un modelo mío, y además un suplente
 * puede entrar y puntuar. Se usa para ordenar por tramos y, sobre todo, para
 * enseñarlo: la decisión sigue siendo tuya, pero con el dato delante.
 */
const PROBABLES = opcional('probables.json', { jugadores: {} }).jugadores || {}
const probabilidadDe = (j) => {
  const p = PROBABLES[String(j.id)]
  return p && typeof p.prob === 'number' ? p.prob : null
}

/** A partir de aquí se le da por titular y no se avisa de nada. */
const TRAMO_TITULAR = 70

/**
 * Para ordenar el once: lo que cabe esperar, por lo probable que es que juegue.
 *
 * Primero lo hice por tramos —titular, duda, improbable— y el once empeoró:
 * sacaba a Rodri Hernández, con 7,0 esperados y un 50 % de salir, para meter a
 * Oriol Rey, con 3,8 y un 70 %. En valor esperado eso es cambiar 3,5 por 2,7.
 * Multiplicar no es inventarse nada: es la definición de valor esperado, y un
 * tramo también es un modelo, solo que más tosco y que decide peor.
 *
 * La cifra que se enseña sigue siendo la de siempre —lo que haría si juega—,
 * porque es la que se puede comprobar. Esto solo ordena.
 */
const conProbabilidad = (j) => {
  const p = probabilidadDe(j)
  return esperadoTotal(j) * (p === null ? 1 : p / 100)
}

const PARTIDOS_DE_CONFIANZA = 3

const esperadoDe = (j) => {
  const donde = j.casa === 1 ? j.mc : j.casa === 0 ? j.mf : null
  if (donde == null) return j.media
  // La media de casa y la de fuera se reparten los partidos jugados: con
  // cuatro, cada una se apoya en dos. Tomarla tal cual hacía que medio punto
  // sacado de dos partidos decidiera quién juega —Valles promedia 7,0 y Herrero
  // 6,0, pero como Valles saca casi todo en casa y ese domingo jugaban los dos
  // fuera, salía elegido Herrero por su 5,5 contra 5,0—. Así que se acerca a su
  // propia media general en la proporción en que la muestra es floja, igual que
  // se hace al valorar a quien ha jugado poco.
  const n = Math.max(0, (j.partidos ?? 0) / 2)
  const peso = n / (n + PARTIDOS_DE_CONFIANZA)
  return peso * donde + (1 - peso) * j.media
}

// Cuánto pesan la forma y el rival sobre esa media. Son dos decisiones de
// criterio, no cifras de Mister, y por eso están aquí con nombre y a la vista
// en vez de repartidas por una fórmula:
//
//   forma   la mitad de lo que ha subido o bajado respecto a su media. La
//           mitad y no todo, porque la forma ya ES un promedio de jornadas
//           recientes: contarla entera sería contar dos veces lo mismo.
//   rival   cuatro décimas por escalón de dureza, con el rival medio (3) como
//           punto neutro. De un extremo a otro son 1,6 puntos, que mueve un
//           empate pero no le gana a medio punto de diferencia real.
const PESO_FORMA = 0.5
const PESO_RIVAL = 0.4

/**
 * Lo que cabe esperar de él el domingo, desglosado.
 *
 * Se devuelve por partes y no como un número suelto para poder enseñar en la
 * propia fila de dónde sale cada décima. Un criterio que no se puede auditar
 * de un vistazo no sirve para decidir una alineación.
 */
const esperadoConAjustes = (j) => {
  const base = esperadoDe(j)
  const f = formaDe(j)
  const d = durezaDe(j)
  const porForma = f === null ? 0 : f * PESO_FORMA
  const porRival = d === null ? 0 : (3 - d) * PESO_RIVAL
  return { base, porForma, porRival, total: base + porForma + porRival }
}
const esperadoTotal = (j) => esperadoConAjustes(j).total

/** No va a puntuar: o está lesionado, o su club no juega esta jornada. */
const noJuega = (j) => j.est === 'injury' || !j.riv

const eur = (n) => `${Math.round(n).toLocaleString('es-ES')} €`
const corto = (n) => {
  const m = Math.round(n)
  if (Math.abs(m) >= 1000000) return `${(m / 1000000).toFixed(Math.abs(m) >= 10000000 ? 0 : 1).replace('.', ',')} M`
  if (Math.abs(m) >= 1000) return `${Math.round(m / 1000)} K`
  return String(m)
}
const firma = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + eur(Math.abs(n))
const firmaCorta = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + corto(Math.abs(n))
const dec = (n) => (n || 0).toFixed(1).replace('.', ',')
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const dia = (f) => {
  const [a, m, d] = f.slice(0, 10).split('-')
  return `${Number(d)} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(m) - 1]}`
}
const NL = '\n'
const clase = (n) => (n > 0 ? 'sube' : n < 0 ? 'baja' : '')

/**
 * Lo que le ha cambiado el valor: hoy siempre, y el mes cuando se sabe.
 *
 * El diario iba escondido —solo salía si faltaba el del mes—, y es el que dice
 * si algo se está moviendo ahora mismo. Mister lo publica para los 529, así que
 * no hay razón para ocultarlo: 227 suben hoy, 280 bajan y 22 están quietos.
 *
 * Los 22 quietos se dicen, no se callan. Un hueco donde los demás llevan cifra
 * se lee como «no se sabe», y aquí sí se sabe: es que no se ha movido.
 */
const tendenciaDe = (j) => {
  const pct = j.subeMes != null ? Math.round(j.subeMes * 100) : null
  const trozos = []
  if (j.semana != null) {
    trozos.push(
      j.semana === 0
        ? '<span class="quieto" title="Su valor no ha cambiado desde ayer">igual hoy</span>'
        : `<span class="${clase(j.semana)}" title="Lo que le ha cambiado el valor desde ayer">${firmaCorta(j.semana)} hoy</span>`,
    )
  }
  if (pct != null) trozos.push(`<span class="${clase(pct)}">${pct > 0 ? '+' : ''}${pct} % este mes</span>`)
  return trozos.join(' ')
}

/**
 * Enlace a la ficha del jugador en Mister.
 *
 * El slug del enlace es decorativo —`/players/{id}/x` devuelve la misma ficha—
 * pero se usa el de verdad cuando se conoce, y si no se saca del nombre: así la
 * dirección se lee, y en el móvil la abre la app de Mister si está instalada.
 * Lo que no vale es el id a secas, que redirige a las noticias.
 */
const SLUGS = (() => {
  try {
    return new Map(Object.entries(leer('slugs.json')))
  } catch {
    return new Map()
  }
})()
const aSlug = (nombre) =>
  String(nombre)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'x'
const fichaEn = (id, nombre) =>
  `https://mister.mundodeportivo.com/players/${encodeURIComponent(id)}/${SLUGS.get(String(id)) ?? aSlug(nombre)}`
/** El nombre, enlazado a su ficha. Abre fuera para no perder el sitio. */
/**
 * El nombre abre su ficha **aquí dentro**, no en Mister.
 *
 * Era un enlace externo y sacaba de la aplicación cada vez que querías mirar a
 * alguien: perdías los filtros, la posición del scroll y lo que estuvieras
 * comparando. Ahora es un botón que abre una capa con todo lo suyo —lo de
 * Mister y lo nuestro— y se cierra donde estabas. El enlace a Mister sigue
 * estando, pequeño, dentro de la capa.
 */
const nombreEnlazado = (j) =>
  `<button type="button" class="jl" data-ficha="${j.id}" title="Ver su ficha completa">${esc(j.nombre)}</button>`

const PUESTOS = { 0: '—', 1: 'POR', 2: 'DEF', 3: 'MED', 4: 'DEL' }
const PUESTOS_LARGO = { 0: 'sin posición', 1: 'portero', 2: 'defensa', 3: 'centrocampista', 4: 'delantero' }
const dorsal = (p) => `<span class="dorsal p${p}" title="${PUESTOS_LARGO[p]}">${PUESTOS[p]}</span>`

// ── Jugadores ────────────────────────────────────────────────────────────────
for (const j of J) {
  j.clausula = CL.get(String(j.id)) ?? null
  j.duenio = DUENIO.get(String(j.id)) ?? null
  j.duenioCorto = j.duenio ? j.duenio.replace(/\s*\(.*\)\s*/, '').trim() : null
  j.mio = j.duenio === MI_EQUIPO ? 1 : 0
  // Lo que costaría de verdad llevárselo hoy, que son tres cosas distintas:
  //   · en el mercado, lo que pide quien lo vende;
  //   · de un rival, su cláusula;
  //   · libre y fuera del mercado, nada: no se puede fichar hasta que salga.
  //     Se enseña su valor como referencia, no como precio.
  j.precio = j.mk ? j.pv : (j.clausula ?? j.valor)
  // Si hoy hay una manera de pagarlo. Un libre que no está en el mercado no
  // tiene precio: no se le puede fichar hasta que salga, y enseñar su valor
  // como si fuera un precio hacía creer que Mbappé estaba a tiro.
  j.pagable = j.mk === 1 || (j.clausula != null && !j.bl) ? 1 : 0
  j.fichable = j.pagable && !j.mio ? 1 : 0
  j.a = j.fichable && j.precio <= MIO.tope ? 1 : 0
  // Quién llega a pagarlo. Su propio dueño no cuenta: no se ficha a sí mismo.
  // Vale también para los míos: es lo que dice si hay que blindar a alguno.
  j.compradores = j.pagable ? EQ.filter((e) => e.n !== j.duenio && e.tope >= j.precio) : []
  j.rivalesQuePueden = j.compradores.filter((e) => !e.mio).length
  j.subeMes = j.mes != null && j.valor ? j.mes / j.valor : null
  j.puesto = j.pos ?? 0
  // Lo que cabe esperar de él en su próximo partido: su media jugando donde le
  // toca jugar. Oyarzabal hace 6,0 en casa y 3,5 fuera, así que promediarlo
  // todo en una sola cifra esconde justo lo que hay que mirar.
  j.rival = j.riv != null ? CLUBES.get(String(j.riv)) ?? null : null
  const mediaSegunDonde = j.casa === 1 ? j.mc : j.casa === 0 ? j.mf : null
  j.mediaProxima = mediaSegunDonde != null ? mediaSegunDonde : j.media
  // Sin partido, o sin saber si es titular, no se le pone por delante de nadie.
  j.esperado = j.once === 1 ? j.mediaProxima : j.once === 0 ? 0 : j.mediaProxima * 0.5
}

// ── Recomendaciones sobre mi plantilla ───────────────────────────────────────
// 📤 Vender: capital parado. No puntúa y su valor ya no crece, así que ni da
//    puntos ni plusvalía; el dinero rinde más en caja (y sube el tope de puja).
// 🔒 Blindar: te lo pueden quitar barato. Rinde, media liga puede pagar su
//    cláusula, y esa cláusula es barata para lo que produce — o está en el
//    mínimo porque nunca la subiste.
/**
 * A partir de qué precio por punto una cláusula deja de ser barata.
 *
 * Era un 1.100.000 fijo con el comentario «≈ el cuartil bajo de la liga»: se
 * midió una vez y se escribió a mano. Si la liga se encarece —y se encarece
 * cada semana— deja de significar lo que dice, y con él el consejo de a quién
 * blindar. Ahora se calcula: el cuartil bajo de verdad, hoy.
 */
const UMBRAL_POR_PUNTO = (() => {
  const l = J.filter((j) => j.clausula && j.media > 0 && j.partidos >= 2)
    .map((j) => j.clausula / j.media)
    .sort((a, b) => a - b)
  return l.length >= 20 ? l[Math.floor(l.length * 0.25)] : 1_100_000
})()
const RATIO_MINIMO = 1.55 // cláusula = 1,5 × valor es el suelo de Mister

for (const j of J) {
  j.vender = 0
  j.blindar = 0
  j.razon = null
  j.remate = null
  if (!j.mio) continue

  const parado = j.subeMes != null && j.subeMes < 0.25
  const noRinde = j.partidos === 0 || j.media < 5
  if (noRinde && parado) {
    j.vender = 1
    // Un jugador puede llevar ⭐ y 📤 a la vez: la estrella dice que su media
    // está en el tercio alto de la liga, y 📤 dice que para lo que cuesta no
    // compensa tenerlo parado. No es contradicción, pero hay que decirlo.
    j.razon =
      j.partidos === 0
        ? 'no ha jugado ni un partido y su valor lleva un mes plano'
        : `${j.p ? 'aunque su media esté en el tercio alto de la liga, son ' : ''}${eur(j.valor)} inmovilizados para una media de ${dec(j.media)}, y su valor solo sube un ${Math.round(j.subeMes * 100)} % al mes`
    continue
  }

  const rinde = j.media >= 5 || j.puntos >= 20
  const porPunto = j.media > 0 && j.clausula ? j.clausula / j.media : null
  const ratio = j.clausula && j.valor ? j.clausula / j.valor : null
  const barato = porPunto != null && porPunto <= UMBRAL_POR_PUNTO
  const sinBlindar = ratio != null && ratio <= RATIO_MINIMO
  if (rinde && j.rivalesQuePueden >= 5 && (barato || sinBlindar)) {
    j.blindar = 1
    // No basta con decir «súbela»: lo que hace falta saber es cuánto cuesta y
    // qué se consigue. Mister cobra el 20 % del valor por escalón, y cada
    // escalón sube el multiplicador medio punto — comprobado contra el libro de
    // caja propio, siete de siete al 20,00 %.
    j.razon = barato
      ? `su cláusula sale a ${eur(porPunto)} por punto de media, una ganga para lo que rinde`
      : 'su cláusula está en el mínimo: nunca la has subido'

    const coste = Math.round(j.valor * 0.2)
    const nueva = Math.round(j.valor * (1.5 + 0.5 * ((j.sub ?? 0) + 1)))
    // A un jugador comprado pagando su cláusula se le queda congelada por
    // encima de su escalón, y entonces no se puede decir dónde quedaría: la
    // cuenta daría una cláusula más baja que la de ahora. En ese caso solo se
    // dice el precio, que ese sí se sabe.
    if (nueva <= j.precio) {
      j.remate = ` Subirla te cuesta <b>${eur(coste)}</b>.`
    } else {
      const seCaen = RIVALES.filter((e) => e.tope >= j.precio && e.tope < nueva).length
      j.remate =
        ` Subirla te cuesta <b>${eur(coste)}</b> y la deja en <b>${eur(nueva)}</b>: ` +
        (seCaen > 0
          ? `${seCaen === 1 ? 'un rival dejaría' : `${seCaen} rivales dejarían`} de poder pagarla, y quedarían ${j.rivalesQuePueden - seCaen}.`
          : `los ${j.rivalesQuePueden} que llegan hoy seguirían llegando, así que haría falta más de un escalón.`)
    }
  }
}

J.sort((a, b) => b.p + b.d - (a.p + a.d) || b.media - a.media || b.valor - a.valor)
const iconos = (j) => `${j.p ? '⭐' : ''}${j.d ? '💵' : ''}${j.vender ? '📤' : ''}${j.blindar ? '🔒' : ''}`

/**
 * Quién puede ficharlo, desplegable.
 *
 * Era la pregunta original del módulo —«pongo un futbolista y me dices quién
 * podría ficharlo»— y hasta ahora solo salía el recuento. Aquí están los
 * nombres y con cuánto margen se lo pueden permitir.
 */
// ── Hasta cuánto sale a cuenta pagar por alguien ────────────────────────────
//
// La pregunta es qué se paga en esta liga por alguien que rinde como él, y la
// respuesta sale de mirar a los que rinden parecido y ver cuánto valen.
//
// El primer intento comparaba contra la tarifa por punto del mercado del día, y
// tenía dos fallos que se vieron en pantalla. Uno: el jugador entraba en el
// conjunto con el que se le comparaba, así que el que caía en la mediana salía
// siempre «te sobran 0» — se comparaba consigo mismo. Y dos: esa tarifa la
// hundían jugadores de media 1,5, que no son alternativa a un delantero de
// media 11 porque no puedes alinear seis suplentes en su lugar.

/** Peso de la media de la liga mientras un jugador lleva pocos partidos. */
/** Cuántos parecidos hacen falta para que la referencia signifique algo. */
const COMPARABLES_MINIMOS = 8

const JUGADOS = J.filter((j) => j.partidos >= 2 && j.media > 0)
const MEDIA_LIGA = JUGADOS.length
  ? JUGADOS.reduce((t, j) => t + j.media * j.partidos, 0) / JUGADOS.reduce((t, j) => t + j.partidos, 0)
  : 0

/**
 * Su media, corregida por lo poco que ha jugado.
 *
 * Cuatro partidos no sostienen una media de 11: puede ser el jugador del año o
 * una racha. Se le da a la media de la liga el peso de tres partidos, así que
 * cuantos más juegue, menos pesa la corrección y más manda lo suyo. Sin esto,
 * cualquiera con dos buenas tardes salía valorado como un crack.
 */
const mediaFiable = (j) =>
  (j.media * j.partidos + MEDIA_LIGA * PARTIDOS_DE_CONFIANZA) / (j.partidos + PARTIDOS_DE_CONFIANZA)

const mediana = (l) => {
  const o = [...l].sort((a, b) => a - b)
  return o.length === 0 ? null : o[Math.floor(o.length / 2)]
}

/**
 * Lo que vale en esta liga alguien que rinde como él.
 *
 * Se buscan los que tienen una media parecida —**sin contarlo a él**, que era
 * el fallo— y se toma su valor mediano. La ventana se abre hasta encontrar
 * ocho; si con el 40 % no los hay, no se da cifra: a un jugador sin parecidos
 * no se le puede poner precio comparando, y decir un número sería inventarlo.
 */
const hastaCuanto = (j) => {
  if (j.partidos < 2 || !j.precio) return null
  const suya = mediaFiable(j)
  const otros = JUGADOS.filter((x) => x.id !== j.id)
  for (const w of [0.15, 0.25, 0.4]) {
    const g = otros.filter((x) => Math.abs(mediaFiable(x) - suya) <= Math.max(0.4, suya * w))
    if (g.length < COMPARABLES_MINIMOS) continue
    const ref = mediana(g.map((x) => x.valor))
    const techo = Math.min(ref, MIO.tope)
    return { ref, techo, loLimitaTuTope: MIO.tope < ref, margen: techo - j.precio, cuantos: g.length, media: suya }
  }
  return null
}

const bloqueRentable = (j) => {
  const r = hastaCuanto(j)
  if (r === null) {
    if (!j.precio) return ''
    return j.partidos < 2
      ? '<div class="rent nada">Sin dos partidos jugados no hay con qué comparar: lo que valga es una apuesta.</div>'
      : '<div class="rent nada">No hay bastantes jugadores que rindan como él para ponerle precio comparando.</div>'
  }
  const sale = r.margen >= 0
  return `<div class="rent ${sale ? 'buena' : 'mala'}" title="Lo que vale en esta liga alguien que rinde como él: la mediana de los ${r.cuantos} jugadores con media parecida a la suya (${dec(r.media)}, corregida por los partidos que lleva). Él no cuenta en esa mediana.">
        <b>Hasta ${corto(r.techo)}</b> sale a cuenta${r.loLimitaTuTope ? ' <i>(te lo limita tu tope)</i>' : ''} · piden ${corto(j.precio)} · <span>${sale ? `te sobran ${corto(r.margen)}` : `te pasas ${corto(-r.margen)}`}</span>
      </div>`
}

/**
 * ¿Merece la pena pagarle la cláusula?
 *
 * Lo primero es dejar de mirar la cláusula como el precio, porque no lo es: el
 * jugador entra en tu plantilla y, si lo revendes, recuperas su valor. Lo que
 * no vuelve nunca es la diferencia, y esa es la cifra sobre la que hay que
 * decidir. Con la base de Mister —cláusula = 1,5 × valor— la prima es medio
 * valor; con la cláusula subida, mucho más.
 *
 * Luego, tres condiciones, y hacen falta las tres. Una sola engaña: un suplente
 * con buena media es una casualidad esperando a deshacerse, y una prima barata
 * por un jugador que no juega sigue siendo dinero tirado.
 *
 * La cuarta no es del jugador sino de la partida, y por eso se dice aparte: si
 * su dueño le ha subido la cláusula, es que le importa; si está en la base, no
 * lo está defendiendo nadie.
 */
const primaPorPuntoDe = (j) =>
  j.clausula && j.media > 0 ? (j.clausula - j.valor) / j.media : null

// El listón de «prima barata» es la mediana de la liga, no una cifra puesta a
// dedo: lo que es caro depende de cómo esté el mercado ese día.
const MEDIANA_PRIMA = (() => {
  const l = J.map(primaPorPuntoDe).filter((x) => x !== null && x > 0).sort((a, b) => a - b)
  return l.length ? l[Math.floor(l.length / 2)] : null
})()

const clausulazo = (j) => {
  if (!j.clausula || !j.duenio || j.mio) return null
  const prima = j.clausula - j.valor
  const porPunto = primaPorPuntoDe(j)
  const jugados = (j.tit ?? 0) + (j.sup ?? 0)
  // Titular de verdad: no basta con haber salido. Dos de inicio y más veces de
  // inicio que desde el banquillo.
  const titular = (j.tit ?? 0) >= 2 && (j.tit ?? 0) > (j.sup ?? 0)
  const barata = porPunto !== null && MEDIANA_PRIMA !== null && porPunto <= MEDIANA_PRIMA
  // El partido, y solo el partido: dónde juega y contra quién. Aquí NO entra la
  // forma, aunque la cifra del once sí la lleve — si entrara, un jugador en
  // racha aparecería con «le viene bien el partido» aunque le tocara su peor
  // escenario, que es justo lo contrario de lo que dice el rótulo.
  const d = durezaDe(j)
  const delPartido = esperadoDe(j) + (d === null ? 0 : (3 - d) * PESO_RIVAL)
  const calendario = j.riv ? delPartido >= j.media : false
  const cumple = [titular, barata, calendario].filter(Boolean).length
  return {
    prima,
    porPunto,
    titular,
    barata,
    calendario,
    cumple,
    jugados,
    // ×1,5 es la base de Mister. Por encima, alguien ha pagado por protegerlo.
    defendido: j.clausula > j.valor * 1.55,
    dTope: -j.clausula + 0.25 * j.valor,
  }
}

const bloqueClausulazo = (j) => {
  const c = clausulazo(j)
  if (c === null) return ''
  const veredicto = c.cumple === 3 ? 'bueno' : c.cumple === 2 ? 'regular' : 'flojo'
  const rotulo = { bueno: 'Buen clausulazo', regular: 'Clausulazo dudoso', flojo: 'Mal clausulazo' }[veredicto]
  const marca = (bien, si, no) => `<span class="${bien ? 'si' : 'no'}">${bien ? '✓' : '✗'} ${bien ? si : no}</span>`
  // Plegado, con el veredicto y la prima en el resumen. Desplegado se llevaba
  // cien píxeles de cada ficha y dejaba una por pantalla en el móvil; lo que
  // hace falta para decidir de un vistazo es el veredicto, y el porqué está a
  // un toque para quien quiera comprobarlo.
  return `<details class="clz ${veredicto}">
        <summary title="Pagas la cláusula, pero si lo revendes recuperas su valor: lo que no vuelve es la prima."><b>${rotulo}</b><span class="cifra">prima real ${corto(c.prima)}${c.porPunto !== null ? ` · ${corto(c.porPunto)} por punto` : ''}</span></summary>
        <div class="pormenor">
          <span class="cifra">tu tope de puja quedaría en ${corto(MIO.tope + c.dTope)}</span>
          <span class="tres">${marca(c.titular, `titular (${c.jugados ? `${j.tit} de ${c.jugados}` : 'sí'})`, c.jugados ? `no es titular (${j.tit} de ${c.jugados})` : 'no ha jugado')}${marca(
            c.barata,
            'prima barata para lo que da',
            'prima cara para lo que da',
          )}${marca(c.calendario, 'le viene bien el partido', 'le viene mal el partido')}</span>
          <span class="def">${c.defendido ? '🛡 su dueño le ha subido la cláusula: lo está defendiendo' : 'cláusula sin subir: nadie lo está defendiendo'}</span>
        </div>
      </details>`
}

const quienPuede = (j) => {
  // A un libre que no está en el mercado no se le puede pagar nada hoy, así
  // que la barra de «quién puede» sobra: lo que hace falta es decir por qué.
  if (!j.pagable) {
    return `<div class="quien nohay">${
      j.bl
        ? 'Cláusula blindada: hoy no se le puede pagar.'
        : 'Libre, pero hoy no está en el mercado. Habrá que esperar a que salga.'
    }</div>`
  }
  const total = j.duenio ? EQ.length - 1 : EQ.length
  const n = j.compradores.length
  const tira = Array.from({ length: total }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')
  const chips = j.compradores.length
    ? [...j.compradores]
        .sort((a, b) => b.tope - a.tope)
        .map(
          (e) =>
            `<span class="chip${e.mio ? ' mio' : ''}">${esc(e.corto)}<em>le sobran ${corto(e.tope - j.precio)}</em></span>`,
        )
        .join('')
    : '<span class="chip nadie">Nadie de la liga llega a ese precio.</span>'
  return `<details class="quien">
        <summary><span class="tira">${tira}</span><span class="txt"><b>${n}</b> de ${total} pueden pagar ${corto(j.precio)}</span></summary>
        <div class="chips">${chips}</div>
      </details>`
}

/**
 * Lo que Mister dice del estado físico. `out` es de cosecha propia: los que
 * siguen en una plantilla pero ya no juegan en LaLiga.
 */
const ESTADOS = {
  injury: '<span class="et et-mal" title="lesionado">🏥 lesionado</span>',
  doubt: '<span class="et et-duda" title="duda para la próxima jornada">❓ duda</span>',
  double: '<span class="et et-duda" title="doble amarilla o sanción">🟨 sancionado</span>',
  other: '<span class="et et-duda" title="no disponible">⚠️ no disponible</span>',
  out: '<span class="et et-mal" title="ya no juega en LaLiga">✈️ fuera de LaLiga</span>',
}

/**
 * El escudo y el nombre del club real al que pertenece.
 *
 * El escudo va por CSS y no en un `<img src="data:…">` dentro de cada fila:
 * son treinta y tres imágenes y quinientas cuarenta filas, así que repetir el
 * data URI en cada una engordaba la página de 1,1 MB a 3,7 MB. Como regla de
 * hoja de estilos, cada escudo aparece una sola vez.
 */
const club = (idClub) => {
  const nombre = CLUBES.get(String(idClub))
  if (!nombre) return ''
  const hay = ESCUDOS.has(String(idClub))
  return `<span class="club">${hay ? `<i class="ec e${idClub}"></i>` : ''}${esc(nombre)}</span>`
}

/**
 * Solo el escudo, para donde no cabe el nombre del club.
 *
 * Va donde salga el nombre de un jugador: la plantilla desplegada de un equipo,
 * los movimientos y las tablas de Estadísticas. Saber de qué equipo real es
 * cambia lo que significa todo lo demás —quién juega el domingo, contra quién,
 * si va a rotar— y con el escudo se sabe sin leer.
 */
/**
 * La cara del jugador, para las listas.
 *
 * Sale del propio sitio (`fotos/{id}.webp`, 2,7 KB) y no del CDN de Mister,
 * donde el mismo PNG pesa 25 KB. `loading="lazy"` es lo que evita que doce
 * caras cuesten algo antes de que se llegue a ellas; `onerror` la quita si a
 * alguien le falta, y la lista queda como estaba.
 */
const caraDe = (id, nombre) =>
  `<img class="cara" loading="lazy" decoding="async" width="96" height="96" alt="" src="fotos/${id}.webp" onerror="this.remove()" title="${esc(nombre ?? '')}">`

/** Retrato y posición como una sola pieza visual en las tarjetas principales. */
const jugadorVisual = (j) =>
  `<div class="jugador-visual">${caraDe(j.id, j.nombre)}${dorsal(j.puesto)}</div>`

const escudoDe = (idJugador) => {
  const j = PORID_PRE.get(String(idJugador))
  const id = j && j.eq
  if (!id || !ESCUDOS.has(String(id))) return ''
  return `<i class="ec e${id}" title="${esc(CLUBES.get(String(id)) ?? '')}"></i>`
}

/** Las reglas con los escudos, una por club. */
const estiloEscudos = [...ESCUDOS]
  .map(([id, datos]) => `.e${id}{background-image:url(${datos})}`)
  .join(NL)

/**
 * La marca de cláusula subida, igual en todas partes.
 *
 * Sale en la pestaña Fichar, en Mi equipo y en la plantilla desplegada de cada
 * rival: es un estado del jugador, no un consejo, y tenerlo con la misma pinta
 * en los tres sitios es lo que hace que se lea sin pensar.
 */
const marcaBlindaje = (j, compacta) => {
  if (!j.sub) return ''
  const mult = (1.5 + 0.5 * j.sub).toFixed(1).replace('.', ',')
  const titulo = `Cláusula subida ${j.sub} ${j.sub === 1 ? 'vez' : 'veces'}: cuesta ${eur(j.sub * j.valor * 0.2)} al valor de hoy`
  return compacta
    ? `<b class="cx" title="${titulo}">×${mult}</b>`
    : `<span class="et et-sub" title="${titulo}">🛡 ×${mult}</span>`
}

/** La línea de detalle: lo que solo está en la ficha de cada jugador. */
/**
 * Un dato con su rótulo encima.
 *
 * Antes la ficha era una tira de fragmentos separados por puntos —«⚽ 5 · 🟨 2
 * · casa 14,0 · fuera 9,0 · 3/4 de inicio»— y había que adivinar qué era cada
 * cifra. Media ¿de qué? ¿Tres de cuatro qué? Con el rótulo delante no hay nada
 * que adivinar, y ocupa casi lo mismo porque va en dos líneas diminutas.
 */
const dato = (etiqueta, valor, titulo, clase) =>
  valor === null || valor === undefined || valor === ''
    ? ''
    : `<span class="dato${clase ? ` ${clase}` : ''}"${titulo ? ` title="${esc(titulo)}"` : ''}><i>${etiqueta}</i><b>${valor}</b></span>`

/** Un plazo del valor: verde si sube, rojo si baja, y nada si no se sabe. */
const plazo = (etiqueta, importe, titulo) =>
  importe === null || importe === undefined || importe === 0
    ? ''
    : dato(etiqueta, `<span class="${clase(importe)}">${firmaCorta(importe)}</span>`, titulo)

/** Quién es y contra quién juega: identidad, no rendimiento. */
const identidadDe = (j) => {
  const trozos = []
  if (j.eq) trozos.push(club(j.eq))
  if (j.rival) {
    trozos.push(
      `<span class="prox">${j.casa === 1 ? 'en casa' : 'fuera'} contra <b>${esc(j.rival)}</b>${pintarDureza(durezaDe(j), j)}</span>`,
    )
  }
  return trozos.length ? `<div class="jc">${trozos.join('')}</div>` : ''
}

/**
 * Cómo va su valor, en los tres plazos y de un vistazo.
 *
 * Va en línea suelta y no en un dato con caja: los tres juntos son anchos, se
 * llevaban una fila entera de chips y hacían la ficha más alta que el diseño
 * viejo, que era justo lo que había que arreglar. Y juntos se leen mejor que
 * separados, porque lo que dice algo es compararlos: sube hoy pero baja en el
 * mes es una historia distinta de sube en los tres.
 */
const valorDe = (j) => {
  // Cada cifra va pegada a su plazo: al saltar de línea se separaban y quedaba
  // un «este mes» huérfano debajo, sin número.
  const par = (importe, texto, formato) =>
    `<span class="par"><span class="${clase(importe)}">${formato}</span> ${texto}</span>`
  const l = [
    // El cero se dice. Callarlo dejaba a veintidós jugadores sin la cifra que
    // todos los demás llevan, y un hueco ahí se lee como «no se sabe».
    j.semana == null
      ? ''
      : j.semana === 0
        ? '<span class="par"><span class="quieto">igual</span> hoy</span>'
        : par(j.semana, 'hoy', firmaCorta(j.semana)),
    j.sem7 ? par(j.sem7, 'en 7 días', firmaCorta(j.sem7)) : '',
    j.subeMes != null
      ? par(j.subeMes, 'este mes', `${j.subeMes > 0 ? '+' : ''}${Math.round(j.subeMes * 100)} %`)
      : '',
  ].filter(Boolean)
  // La proyección va aquí y no arriba con los precios: sale de esta misma
  // línea —del ritmo de los últimos siete días— y allí hacía el bloque de
  // precios tan alto que dejaba un hueco muerto a su izquierda.
  const fin = enUnMes(j)
  if (fin !== null) {
    l.push(
      `<span class="par proy" title="Proyección, no dato de Mister: a cuánto llegaría si siguiera subiendo al ritmo de los últimos siete días.">~${corto(fin)} en un mes</span>`,
    )
  }
  return l.length ? `<div class="jv"><i>su valor</i>${l.join('<span class="sep">·</span>')}</div>` : ''
}

/** Cómo rinde, cada cifra con su nombre. */
const datosDe = (j) => {
  const casaYFuera =
    j.mc != null && j.mf != null && j.mc !== j.mf
      ? dato('en casa', dec(j.mc), 'Puntos de media jugando en casa') +
        dato('fuera', dec(j.mf), 'Puntos de media jugando fuera')
      : ''
  const trozos = [
    dato('media', dec(j.media), 'Puntos que saca de media por partido', 'clave'),
    dato('pts', `${j.puntos} en ${j.partidos}`, 'Puntos totales y partidos que ha jugado'),
    j.gol ? dato('goles', j.gol, 'Goles esta temporada') : '',
    j.tar ? dato('tarjetas', j.tar, 'Tarjetas esta temporada') : '',
    j.tit != null && j.tit + j.sup > 0
      ? dato('inicio', `${j.tit} de ${j.tit + j.sup}`, 'Veces que ha salido de titular, de las que ha jugado')
      : '',
    casaYFuera,
    // Los tres plazos del valor, cada uno con su nombre y su color. Antes solo
    // salía uno —el del mes si lo había y si no el del día— y no se decía cuál,
    // así que un «+58 %» podía ser de hoy o de hace un mes.
    Array.isArray(j.racha) && j.racha.length
      ? dato('últimas', pintarRacha(j, true), 'Lo que sacó en cada una de sus últimas jornadas', 'ancha')
      : '',
  ]
  return `<div class="jd">${trozos.join('')}</div>`
}

/**
 * A cuánto llegaría en un mes si siguiera al ritmo de la última semana.
 *
 * Es una **proyección**, no una cifra de Mister, y por eso lleva la tilde
 * delante y lo dice al pasar por encima. Se hace sobre los últimos siete días
 * y no sobre el mes entero porque lo que interesa es el ritmo al que va ahora:
 * un jugador que se disparó hace tres semanas y lleva diez días plano no va a
 * repetir aquella subida.
 *
 * No se enseña si no mueve al menos un 2 %: una proyección que dice lo mismo
 * que el valor de hoy es ruido con pinta de dato.
 */
const enUnMes = (j) => {
  if (j.sem7 === null || j.sem7 === undefined || !j.valor) return null
  const fin = j.valor + j.sem7 * (30 / 7)
  if (fin <= 0 || Math.abs(fin - j.valor) / j.valor < 0.02) return null
  return fin
}

/** Qué es la cifra grande de la derecha, que no siempre es lo mismo. */
const etiquetaPrecio = (j) => (j.mk ? 'lo piden' : j.clausula ? 'cláusula' : 'valor')

const filaJugador = (j) => {
  const cls = [
    'fj',
    j.mk ? 'mk' : 'nomk',
    j.fichable ? 'fich' : 'nofich',
    j.once === 1 ? 'once' : '',
    j.p ? 'tp' : '',
    j.d ? 'td' : '',
    j.a ? 'ta' : '',
    j.duenio ? (j.mio ? 'tmio' : 'triv') : 'tl',
    j.ced ? 'tced' : '',
    IDS_CAMBIADOS.has(String(j.id)) ? 'reciente' : '',
    `z${j.puesto}`,
  ]
    .filter(Boolean)
    .join(' ')
  // Aquí no hace falta `tendenciaDe`: esta fila enseña el valor con valorDe(),
  // que ya trae hoy, siete días y el mes.
  const rec = (j.p + j.d) * 1000 + j.media
  return `<div class="${cls}" data-busca="${esc(j.nombre)} ${esc(j.duenioCorto ?? 'libre')} ${PUESTOS_LARGO[j.puesto]}" data-rec="${rec.toFixed(2)}" data-precio="${j.precio}" data-media="${j.media}" data-puntos="${j.puntos}" data-sube="${(j.subeMes ?? -9).toFixed(4)}" data-hoy="${j.semana ?? -9e9}" data-prox="${j.esperado.toFixed(2)}" data-gol="${j.gol ?? 0}">
      ${jugadorVisual(j)}
      <div class="jn">${nombreEnlazado(j)}${j.mk ? `<span class="et et-mk">${j.ced ? 'se cede' : 'en el mercado'}</span>` : ''}${
        j.duenio
          ? `<span class="et et-eq${j.mio ? ' et-mio' : ''}">${esc(j.duenioCorto)}</span>`
          : '<span class="et et-libre">libre</span>'
      }${marcaBlindaje(j)}${j.once === 1 ? '<span class="et et-once" title="Mister lo da por titular en el próximo partido">👕 titular</span>' : ''}${ESTADOS[j.est] ?? ''}</div>
      <div class="jp">
        <div class="cifras">${
          j.precio !== j.valor
            ? `<span class="cif"><b>${eur(j.valor)}</b><i>vale hoy</i></span>`
            : ''
        }<span class="cif"><b class="${etiquetaPrecio(j) === 'cláusula' ? 'cl' : ''}">${eur(j.precio)}</b><i>${etiquetaPrecio(j)}</i></span></div><span class="ico">${iconos(j)}</span></div>
      ${identidadDe(j)}
      ${valorDe(j)}
      ${datosDe(j)}
      ${bloqueRentable(j)}${quienPuede(j)}${bloqueClausulazo(j)}
    </div>`
}

/**
 * Los datos de la capa, en una isla JSON y no repetidos en cada fila.
 *
 * Pintar la ficha entera de los quinientos treinta jugadores en el HTML serían
 * varios megas para enseñar una cada vez. Así va una sola vez, en claves de una
 * o dos letras, y la capa se construye al pulsar.
 */
// Los nombres de los clubes, para que la capa pueda escribirlos sin repetirlos
// en cada jugador.
/** La serie de valores de cada jugador, en miles y por orden de día. */
const HIST = opcional('historico-valores.json', {})

const SERIES = (() => {
  const dias = Object.keys(HIST).sort()
  const m = new Map()
  for (const d of dias) {
    for (const [id, v] of Object.entries(HIST[d])) {
      if (!m.has(id)) m.set(id, [])
      m.get(id).push(Math.round(v / 1000))
    }
  }
  // Menos de tres días no dibuja una línea, dibuja una raya.
  return new Map([...m].filter(([, l]) => l.length >= 3))
})()

const islaClubes = JSON.stringify(Object.fromEntries(CLUBES))

/**
 * Las referencias de la liga, para que un número se pueda leer.
 *
 * «De fiar: ±3,8» no dice nada si no se sabe cuánto se aparta la gente
 * normalmente. Con la mediana al lado, sí.
 */
const islaLiga = JSON.stringify({
  media: MEDIA_LIGA,
  // La mediana de regularidad, pero solo entre los que rinden.
  //
  // Con la liga entera salía ±1,3, y no porque sean constantes: es que
  // cuatrocientos suplentes hacen 0, 1, 2 todas las semanas y se apartan poco
  // de casi nada. Comparar contra eso decía que un delantero de media 11 es
  // «de los irregulares» por el simple hecho de puntuar.
  regular: (() => {
    const l = J.filter((j) => j.media >= 4)
      .map(regularidadDe)
      .filter((x) => x !== null)
      .sort((a, b) => a - b)
    return l.length >= 10 ? l[Math.floor(l.length / 2)] : null
  })(),
})

const islaFichas = JSON.stringify(
  Object.fromEntries(
    J.map((j) => {
      const c = clausulazo(j)
      const r = hastaCuanto(j)
      return [
        j.id,
        {
          n: j.nombre,
          p: j.puesto,
          eq: j.eq ?? null,
          d: j.duenioCorto ?? null,
          mio: j.mio ? 1 : 0,
          v: j.valor,
          cl: j.clausula ?? null,
          pr: j.precio ?? null,
          et: etiquetaPrecio(j),
          mk: j.mk ? 1 : 0,
          ced: j.ced ? 1 : 0,
          bl: j.bl ? 1 : 0,
          sub: j.sub ?? 0,
          est: j.est ?? null,
          pt: j.puntos,
          me: j.media,
          pj: j.partidos,
          g: j.gol ?? null,
          as: j.asis ?? null,
          t: j.tar ?? null,
          mc: j.mc ?? null,
          mf: j.mf ?? null,
          ed: j.edad ?? null,
          ti: j.tit ?? null,
          su: j.sup ?? null,
          on: j.once,
          // El porcentaje de salir de titular; null si no lo publican de él.
          pr: probabilidadDe(j),
          riv: j.riv ?? null,
          ca: j.casa,
          du: durezaDe(j),
          se: j.semana ?? null,
          s7: j.sem7 ?? null,
          mes: j.subeMes ?? null,
          fin: enUnMes(j),
          fo: formaDe(j),
          re: regularidadDe(j),
          esp: j.riv ? esperadoConAjustes(j).total : null,
          // Desglosado: un «3,5» a secas no dice de dónde sale ni si es bueno.
          espb: j.riv ? esperadoConAjustes(j) : null,
          js: j.js ?? [],
          // Su valor día a día, en miles para no arrastrar tres ceros por dato
          // quinientas veces. Es lo que Mister pinta en su ficha y aquí faltaba:
          // un «+58 % este mes» no distingue una subida sostenida de un pico.
          hv: SERIES.get(String(j.id)) ?? null,
          // Lo nuestro, ya calculado: repetir la fórmula en el navegador sería
          // tener dos sitios donde puede dejar de cuadrar.
          hc: r === null ? null : { t: r.techo, m: r.margen, c: r.cuantos },
          cz: c === null ? null : { v: c.cumple, pr: c.prima, pp: c.porPunto, ti: c.titular, ba: c.barata, ca: c.calendario, de: c.defendido, ju: c.jugados },
          qp: (j.compradores ?? []).filter((e) => !e.mio).length,
          qt: EQ.length - (j.duenio ? 1 : 0),
        },
      ]
    }),
  ),
)

const PORID_PRE = new Map(J.map((j) => [String(j.id), j]))
/**
 * La pestaña de jugadores, en dos mitades.
 *
 * El mercado es una lista corta y viva —hoy 32— que se mira entera; el resto
 * de LaLiga son quinientos, y enseñarlos todos de golpe convertía la pestaña
 * en un muro por el que había que filtrar antes de poder leer nada. Ahora el
 * mercado sale siempre y los demás aparecen solo cuando los buscas, que es
 * cuando se sabe a quién se busca.
 */
const enMercado = J.filter((j) => j.mk === 1)
const fueraDelMercado = J.filter((j) => j.mk !== 1)
const filasMercado = enMercado.map(filaJugador).join(NL)
const filasResto = fueraDelMercado.map(filaJugador).join(NL)

// ── Escaparate del mercado ──────────────────────────────────────────────────
// La lista completa sirve para investigar; estas tarjetas sirven para decidir.
// Solo entran jugadores que el usuario puede pagar hoy, ordenados por señales
// deportivas, margen de precio, próximo partido y tendencia de valor.
const candidatosEscaparate = J.filter((j) => j.a && !j.mio)
  .map((j) => ({ j, renta: hastaCuanto(j), forma: formaDe(j) }))
  .sort((a, b) =>
    (b.j.p + b.j.d) - (a.j.p + a.j.d) ||
    ((b.renta?.margen ?? -Infinity) - (a.renta?.margen ?? -Infinity)) ||
    b.j.esperado - a.j.esperado ||
    (b.forma ?? -Infinity) - (a.forma ?? -Infinity),
  )
  .slice(0, 4)

const tarjetaOportunidad = ({ j, renta, forma }, i) => {
  const etiqueta = i === 0 ? 'Mejor oportunidad' : renta && renta.margen >= 0 ? 'Precio con margen' : forma > 0 ? 'Llega en forma' : 'Para esta jornada'
  const motivo = renta && renta.margen >= 0
    ? `${corto(renta.margen)} por debajo de su techo estimado`
    : j.riv
      ? `${dec(j.esperado)} puntos esperados en su próximo partido`
      : `${dec(j.media)} puntos de media`
  return `      <article class="oportunidad" data-op-id="${j.id}" data-op-puntos="${j.esperado}" data-op-valor="${j.subeMes ?? -9}" data-op-equilibrio="${(j.p + j.d) * 1000 + j.media}">
        <div class="op-foto">${caraDe(j.id, j.nombre)}<span class="dorsal p${j.puesto}">${PUESTOS[j.puesto]}</span></div>
        <div class="op-cuerpo">
          <span class="op-etiqueta">${etiqueta}</span>
          <button type="button" class="op-nombre" data-ficha="${j.id}">${esc(j.nombre)}</button>
          <div class="op-club">${escudoDe(j.id)}${esc(j.duenioCorto ?? 'Libre')}${j.once === 1 ? '<span>· titular</span>' : ''}</div>
          <div class="op-metricas"><span><b>${dec(j.media)}</b> media</span><span><b>${corto(j.precio)}</b> precio</span><span class="${j.semana === 0 ? 'quieto' : clase(j.semana ?? 0)}"><b>${j.semana == null ? '—' : j.semana === 0 ? '=' : firmaCorta(j.semana)}</b> hoy</span><span class="${clase(j.subeMes ?? 0)}"><b>${j.subeMes == null ? '—' : `${j.subeMes > 0 ? '+' : ''}${Math.round(j.subeMes * 100)} %`}</b> mes</span></div>
          <p>${motivo}</p>
          <button type="button" class="op-cta" data-ficha="${j.id}">Analizar fichaje <span>→</span></button>
        </div>
      </article>`
}

const oportunidades = candidatosEscaparate.length
  ? `    <section class="escaparate">
      <div class="escaparate-cab"><div><span class="eyebrow">Selección inteligente</span><h2>Oportunidades para ti</h2><p>Jugadores que puedes pagar hoy, priorizados según tu objetivo.</p></div><span class="op-contador">${candidatosEscaparate.length} destacados</span></div>
      <div class="objetivos" aria-label="Objetivo de las recomendaciones"><span>Mi objetivo</span><button type="button" data-objetivo="equilibrio">Equilibrado</button><button type="button" data-objetivo="puntos">Ganar puntos</button><button type="button" data-objetivo="valor">Generar dinero</button></div>
      <div class="op-grid">
${candidatosEscaparate.map(tarjetaOportunidad).join(NL)}
      </div>
    </section>`
  : ''

// ── Marcador ─────────────────────────────────────────────────────────────────
const ico = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const marcador = `  <div class="marcador">
    <div><dt>${ico('<path d="M8 21h8M12 17v4M6 4h12v5a6 6 0 0 1-12 0V4Z"/><path d="M6 6H3v2a3 3 0 0 0 3 3M18 6h3v2a3 3 0 0 1-3 3"/>')} Tu puesto</dt><dd>${MIO.pos}º<small>de ${EQ.length} · ${MIO.pts} pts</small></dd></div>
    <div><dt>${ico('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>')} En caja</dt><dd class="oro">${eur(MIO.saldo)}</dd>${MIO.comprometido > 0 ? `<small class="retenido" title="Mister te reserva ese dinero mientras la puja siga puesta: no cuenta para el tope">${eur(MIO.comprometido)} retenidos en pujas</small>` : ''}</div>
    <div><dt>${ico('<path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h6v6"/>')} Tope de puja</dt><dd>${eur(MIO.tope)}</dd></div>
    <div><dt>${ico('<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>')} Sobre los 50 M</dt><dd class="${clase(MIO.sobre50)}">${firma(MIO.sobre50)}</dd></div>
  </div>`

// ── Cuentas de un equipo ─────────────────────────────────────────────────────
// Los que ya no juegan en LaLiga siguen en la plantilla, con un valor
// residual, aunque desaparezcan del censo de jugadores. Que Mister los cuenta
// está comprobado: su clasificación publica cuántos jugadores tiene cada
// equipo y cuánto vale su plantilla, y las dos cifras solo cuadran contándolos.
// Se dice de todas formas, porque un jugador que ya no juega no vale lo mismo
// que uno que sí.
const FUERA = new Map(
  EQ.map((e) => {
    const idos = (PL[e.n] ?? []).map((id) => PORID_PRE.get(String(id))).filter((j) => j && j.est === 'out')
    return [e.n, { n: idos.length, valor: idos.reduce((s, j) => s + j.valor, 0), nombres: idos.map((j) => j.nombre) }]
  }),
)

const avisoFuera = (e) => {
  const f = FUERA.get(e.n)
  if (!f || f.n === 0) return ''
  return `<p class="nota-fuera">De esa plantilla, ${eur(f.valor)} ${f.n === 1 ? 'son de 1 jugador que ya no juega' : `son de ${f.n} jugadores que ya no juegan`} en LaLiga: ${f.nombres.map(esc).join(', ')}. Cuentan para su tope de puja —Mister los suma— pero no le van a dar un punto.</p>`
}

/**
 * Lo que ha invertido en blindar.
 *
 * Para el equipo propio la cifra es exacta: sale del libro de caja de Mister.
 * Para un rival hay que deducirla, porque Mister oculta su saldo — se sabe
 * cuántas subidas tiene vivas, y se valoran al precio de hoy, que no es lo que
 * pagó pero se le acerca: en el equipo propio esa cuenta da 6.018.400 € contra
 * los 5.263.619 € reales.
 */
/**
 * Cuánto puede bailar la caja de un rival.
 *
 * Su saldo se reconstruye sumando el feed, y el feed no publica lo que Mister
 * cobra por mover una cláusula. De las subidas que tiene vivas sabemos lo que
 * costarían hoy, pero no cuánto de eso ya estaba descontado — ni si además ha
 * bajado alguna, que devuelve dinero. Así que no es un techo: es un margen, y
 * puede caer a los dos lados.
 */
const margenDe = (e) => (e.mio ? 0 : Math.max(0, (e.costeSubidas ?? 0) - (e.gastoVisto ?? 0)))

const avisoClausulas = (e) => {
  if (!e.subidas) return ''
  const cuantos = `${e.subidas} subida${e.subidas === 1 ? '' : 's'} de cláusula en ${e.blindados} jugador${e.blindados === 1 ? '' : 'es'}`
  return e.mio
    ? `<p class="nota-cl">Has pagado <b>${eur(e.costeReal)}</b> por subir cláusulas desde que empezó la liga — ${cuantos} siguen vivas. Sale de tu libro de caja, así que es exacto.</p>`
    : `<p class="nota-cl">${cuantos}. Le habrán costado <b>unos ${eur(e.costeSubidas)}</b>: Mister cobra el 20 % del valor por cada una. Es una estimación al valor de hoy, porque su saldo no lo publica.</p>`
}

/**
 * Las cuentas de un equipo.
 *
 * Las propias salen del libro de caja y cuadran al euro por construcción: el
 * inicio no se modela, se despeja restando del saldo de hoy todo lo apuntado
 * desde el reinicio. Enseñadas desde el feed no cuadraban —salían 22.726.239 €
 * donde el libro dice 20.652.320 €— porque faltaban las cláusulas y porque el
 * inicio calculado como «50 M menos el reparto» se equivocaba en cinco
 * millones. De los rivales no hay libro, así que siguen con el modelo y con su
 * margen, dicho al lado.
 */
const cuentasDe = (e) => e.libro
  ? `<div class="cuenta">
        <div class="l"><span>Le dejó el reinicio</span><span>${eur(e.libro.inicio)}</span></div>
        <div class="l"><span>Premios de las jornadas</span><span class="mas">+${eur(e.libro.premios)}</span></div>
        <div class="l"><span>Ha vendido por</span><span class="mas">+${eur(e.libro.ventas)}</span></div>
        <div class="l"><span>Ha fichado por</span><span class="menos">−${eur(-e.libro.compras)}</span></div>
        <div class="l"><span>Pagado por subir cláusulas</span><span class="menos">−${eur(-e.libro.pagadoPorClausulas)}</span></div>${
          e.libro.devueltoPorClausulas
            ? `<div class="l"><span>Devuelto por bajarlas</span><span class="mas">+${eur(e.libro.devueltoPorClausulas)}</span></div>`
            : ''
        }
        <div class="l tot caja"><span>Le queda en caja</span><span>${eur(e.saldo)}</span></div>
        <div class="l sub-caja"><span>Sale del libro de caja de Mister</span><span>cuadra al euro</span></div>
        <div class="l"><span>Más su plantilla, que vale</span><span>${eur(e.pl)}</span></div>
        <div class="l tot"><span>Patrimonio hoy</span><span>${eur(e.patrimonio)}</span></div>
        <div class="l"><span>Sobre los 50.000.000 € de salida</span><span class="${clase(e.sobre50)}">${firma(e.sobre50)}</span></div>
      </div>
      ${avisoFuera(e)}${avisoClausulas(e)}`
  : `<div class="cuenta">
        <div class="l"><span>Empezó con</span><span>${eur(e.ini)}</span></div>
        <div class="l"><span>Premios de las jornadas</span><span class="mas">+${eur(e.pre)}</span></div>
        <div class="l"><span>Ha vendido por</span><span class="mas">+${eur(e.ven)}</span></div>
        <div class="l"><span>Ha fichado por</span><span class="menos">−${eur(e.com)}</span></div>${
          e.gastoOculto ? `<div class="l"><span>Estimado en subir cláusulas</span><span class="menos">−${eur(e.gastoOculto)}</span></div>` : ''
        }
        <div class="l tot caja"><span>Le queda en caja</span><span>${eur(e.saldo)}</span></div>
        <div class="l sub-caja"><span>Estimado: de él no hay libro de caja</span><span>léelo como «no más de esto»</span></div>
        <div class="l"><span>Más su plantilla, que vale</span><span>${eur(e.pl)}</span></div>
        <div class="l tot"><span>Patrimonio hoy</span><span>${eur(e.patrimonio)}</span></div>
        <div class="l"><span>Sobre los 50.000.000 € de salida</span><span class="${clase(e.sobre50)}">${firma(e.sobre50)}</span></div>
      </div>
      ${avisoFuera(e)}${avisoClausulas(e)}`

/** La plantilla completa de un equipo, por posición y valor. */
const PORID = PORID_PRE
const plantillaDe = (e) => {
  const suyos = (PL[e.n] ?? [])
    .map((id) => PORID.get(String(id)) ?? { id, nombre: null, puesto: 0, valor: VALOR.get(String(id)) ?? null, clausula: null, media: null })
    .sort((a, b) => a.puesto - b.puesto || (b.valor ?? 0) - (a.valor ?? 0))
  if (!suyos.length) return '<p class="vacio2">No tengo su plantilla.</p>'
  return `<div class="mini">
${suyos
  .map(
    (j) => `        <div class="mj">${dorsal(j.puesto)}${caraDe(j.id, j.nombre ?? '')}${escudoDe(j.id)}<span class="n">${j.nombre ? nombreEnlazado(j) : `<a class="jl" href="${fichaEn(j.id, j.id)}" target="_blank" rel="noopener"><em class="desc">jugador ${esc(j.id)}</em></a>`}</span>
          <span class="v">${j.valor != null ? eur(j.valor) : '—'}</span>${
            j.clausula ? `<span class="c">cláusula ${corto(j.clausula)}${marcaBlindaje(j, true)}</span>` : '<span class="c">—</span>'
          }<span class="m">${j.media != null ? `media ${dec(j.media)}` : 'sin datos'}</span></div>`,
  )
  .join(NL)}
      </div>`
}

/** La barra que descompone el tope: sólido es caja, rayado el 25 % de plantilla. */
const barraPoder = (e) => `<div class="poder">
        <span class="barra"><span class="caja" style="width:${((e.saldo / maxTope) * 100).toFixed(1)}%"></span><span class="credito" style="width:${(((0.25 * e.pl) / maxTope) * 100).toFixed(1)}%"></span></span>
        <small>${corto(e.saldo)} en caja + ${corto(0.25 * e.pl)} de su plantilla</small>
      </div>`

const tablaMovimientos = (e) => {
  const d = (D.porEquipo || {})[e.n] || { porJugador: {} }
  const js = Object.entries(d.porJugador)
    .map(([id, x]) => {
      const loTiene = DUENIO.get(String(id)) === e.n
      const valeHoy = loTiene ? VALOR.get(String(id)) : null
      if (loTiene && valeHoy == null) throw new Error(`Sin valor de hoy para ${x.nombre} (${id}), que sigue en ${e.n}`)
      return {
        ...x,
        id,
        valeHoy,
        // Un fichaje que sigue en plantilla no es una pérdida: es dinero
        // convertido en jugador.
        balance: x.ventas + (valeHoy ?? 0) - x.compras,
        delReparto: x.compras === 0,
      }
    })
    .sort((a, b) => b.balance - a.balance)
  if (!js.length) return '<p class="vacio2">No ha hecho ningún movimiento.</p>'

  const tot = js.reduce(
    (s, j) => ({
      compras: s.compras + j.compras,
      ventas: s.ventas + j.ventas,
      valeHoy: s.valeHoy + (j.valeHoy ?? 0),
      balance: s.balance + j.balance,
    }),
    { compras: 0, ventas: 0, valeHoy: 0, balance: 0 },
  )
  const cel = (n) => (n ? eur(n) : '—')
  const hayReparto = js.some((j) => j.delReparto && j.ventas)
  return `<div class="tabla-scroll"><table class="jt"><thead><tr><th>Jugador</th><th>Pagó</th><th>Cobró</th><th>Vale hoy</th><th>Balance</th></tr></thead><tbody>
${js
  .map(
    (j) =>
      `<tr><td>${caraDe(j.id, j.nombre)}${escudoDe(j.id)}${esc(j.nombre)}${j.delReparto ? '<span class="et-rep">del reparto</span>' : ''}</td><td>${cel(j.compras)}</td><td>${cel(j.ventas)}</td><td>${cel(j.valeHoy)}</td><td class="${j.balance > 0 ? 'mas' : j.balance < 0 ? 'menos' : ''}">${firma(j.balance)}</td></tr>`,
  )
  .join(NL)}
<tr class="sum"><td>${js.length} jugador${js.length === 1 ? '' : 'es'}</td><td>${cel(tot.compras)}</td><td>${cel(tot.ventas)}</td><td>${cel(tot.valeHoy)}</td><td class="${tot.balance > 0 ? 'mas' : 'menos'}">${firma(tot.balance)}</td></tr>
</tbody></table></div>${hayReparto ? '<p class="pie">«Del reparto» son los que le tocaron al empezar: no pagó nada por ellos, así que aquí todo lo cobrado cuenta entero. Por eso este total supera la ganancia real de arriba: los del reparto ya valían dinero el día del reinicio.</p>' : ''}`
}

// ── 1. Mi equipo ─────────────────────────────────────────────────────────────
const MIOS = J.filter((j) => j.mio)
if (MIOS.length !== PL[MI_EQUIPO].length) {
  throw new Error(`Tengo ${PL[MI_EQUIPO].length} jugadores en plantilla pero solo ${MIOS.length} con datos`)
}
const MIS_MOVS = (D.porEquipo[MI_EQUIPO] || { porJugador: {} }).porJugador
// Vender sube el tope: la caja crece con el valor entero y la plantilla pierde
// ese valor, del que solo contaba el 25 %. Neto: +0,75 × valor.
const topeTrasVender = (v) => MIO.saldo + v + 0.25 * (MIO.pl - v)

const filaMia = (j, modo) => {
  const tendencia = tendenciaDe(j)
  const pago = MIS_MOVS[String(j.id)] ? MIS_MOVS[String(j.id)].compras : 0
  const grande = modo === 'clausula' ? j.clausula : j.valor
  const rotulo = modo === 'clausula' ? 'te lo quitan por' : modo === 'venta' ? 'te darían' : 'vale'
  const trato = pago
    ? `pagaste ${corto(pago)}, <b class="${clase(j.valor - pago)}">${firmaCorta(j.valor - pago)}</b>`
    : 'del reparto'
  return `<div class="fj">
      ${jugadorVisual(j)}
      <div class="jn">${nombreEnlazado(j)}${j.mk ? '<span class="et et-mk">en venta</span>' : ''}${marcaBlindaje(j)}${j.eq ? club(j.eq) : ''}<label class="sel" title="Simular que lo vendes"><input type="checkbox" class="vender" data-valor="${j.valor}" data-nombre="${esc(j.nombre)}"><span>vender</span></label></div>
      <div class="jp"><b class="${modo === 'clausula' ? 'cl' : ''}">${eur(grande)}</b><i>${rotulo}</i><span class="ico">${iconos(j)}</span></div>
      <div class="js">
        <span>media <b>${dec(j.media)}</b></span><span class="sep">·</span>
        <span>${j.puntos} pts en ${j.partidos} part.</span>${
          tendencia ? `<span class="sep">·</span>${tendencia}` : ''
        }<span class="sep">·</span><span>${trato}</span>
      </div>
      ${modo === 'clausula' ? quienPuede(j) + bloqueClausulazo(j) : ''}${
        j.razon
          ? `<div class="jr">${
              j.vender
                ? `📤 <b>Véndelo:</b> ${esc(j.razon)}. Solo con él, tu tope de puja pasaría a ${eur(topeTrasVender(j.valor))}.`
                : `🔒 <b>Súbele la cláusula:</b> ${esc(j.razon)}.${j.remate ?? ''}`
            }</div>`
          : ''
      }
    </div>`
}

const bloque = (icono, titulo, desc, lista, modo) =>
  lista.length
    ? `    <section class="sec" id="bloque-${modo}">
      <h2 class="sh">${icono ? `<span class="se">${icono}</span>` : ''}${titulo} <em>${lista.length}</em></h2>
      ${desc ? `<p class="sd">${desc}</p>` : ''}
      <div class="lista">
${lista.map((j) => filaMia(j, modo)).join(NL)}
      </div>
    </section>`
    : ''

const aVender = MIOS.filter((j) => j.vender).sort((a, b) => b.valor - a.valor)
const aBlindar = MIOS.filter((j) => j.blindar).sort((a, b) => a.clausula / a.media - b.clausula / b.media)
const resto = MIOS.filter((j) => !j.vender && !j.blindar).sort((a, b) => a.puesto - b.puesto || b.valor - a.valor)
const sumaVenta = aVender.reduce((s, j) => s + j.valor, 0)

// ── Qué ha cambiado desde ayer ───────────────────────────────────────────────
// El módulo enseña una foto, pero las decisiones se toman cuando algo cambia.
// Los fichajes salen del feed, que los da con su precio exacto; el resto —quién
// ha subido una cláusula, quién se ha lesionado, quién ha entrado al mercado—
// de comparar la foto de hoy con la de ayer.
// La ventana es hoy y ayer, y se calcula en hora de Madrid porque es la que
// usan las fechas de Mister: hacerlo en UTC movía el corte dos horas y metía
// en «ayer» cosas de anteayer.
const diaEn = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(d)
const HOY = diaEn(new Date())
const AYER = diaEn(new Date(Date.now() - 86400000))

const nombreDe = (id) => PORID_PRE.get(String(id))?.nombre ?? `jugador ${id}`
const esMio = (equipo) => equipo === MI_EQUIPO

const lineaNov = (icono, texto, tono) =>
  `        <li class="nov${tono ? ` ${tono}` : ''}"><span class="ni">${icono}</span><span>${texto}</span></li>`

const novedades = (() => {
  // Una bolsa por día, en vez de una lista única. Antes era una sola lista con
  // tres ventanas distintas dentro —los traspasos de tres días, el resto de
  // hasta siete— bajo un título que decía «desde ayer», y encima ordenada del
  // revés: lo más viejo arriba. Con el corte en la fila 25, lo de hoy no
  // llegaba a verse nunca.
  const dias = new Map([[HOY, []], [AYER, []]])
  const enVentana = (dia) => dias.has(dia)

  // Los traspasos, del más reciente al más antiguo. `MOVS` ya viene así, pero
  // se ordena aquí explícitamente para no depender de eso.
  const traspasos = MOVS.filter((m) => enVentana(m.fecha.slice(0, 10)))
    .slice()
    .sort((a, b) => b.fecha.localeCompare(a.fecha))

  for (const m of traspasos) {
    const de = m.de ? POR_NOMBRE.get(m.de)?.corto ?? m.de : 'mercado'
    const a = m.a ? POR_NOMBRE.get(m.a)?.corto ?? m.a : 'mercado'
    dias.get(m.fecha.slice(0, 10)).push(
      lineaNov(
        m.a ? '📥' : '📤',
        `<span class="hnov">${m.fecha.slice(11, 16)}</span>${caraDe(m.id, m.nombre)}${escudoDe(m.id)}<b>${esc(m.nombre)}</b> ${m.de ? 'de' : 'del'} ${esc(de)} ${m.a ? 'a' : 'al'} ${esc(a)} por ${eur(m.importe)}`,
        esMio(m.de) || esMio(m.a) ? 'mio' : '',
      ),
    )
  }

  // Un cambio de dueño que el feed no publicó como traspaso: una cesión, un
  // trueque, o algo que Mister se guardó. En el libro de caja propio hay 5
  // ventas por cesión, 2 compras y 1 trueque, y ninguna sale en el feed —solo
  // publica `normal`, `clause` y `rescind`—, así que habrá movido dinero que
  // nadie va a ver.
  const conTraspaso = new Set(traspasos.map((m) => String(m.id)))

  for (const n of NOV) {
    if (!enVentana(n.dia)) continue
    const bolsa = dias.get(n.dia)
    if (n.tipo === 'duenio' && !conTraspaso.has(String(n.id))) {
      const de = n.de ? POR_NOMBRE.get(n.de)?.corto ?? n.de : 'el mercado'
      const a = n.a ? POR_NOMBRE.get(n.a)?.corto ?? n.a : 'el mercado'
      bolsa.push(
        lineaNov(
          '❓',
          `${escudoDe(n.id)}<b>${esc(nombreDe(n.id))}</b> ha pasado de ${esc(de)} a ${esc(a)} sin traspaso en el feed: puede ser una cesión o un trueque, y entonces habrá movido un dinero que no se ve`,
          'malo',
        ),
      )
    }
    if (n.tipo === 'clausula') {
      const quien = esc(POR_NOMBRE.get(n.equipo)?.corto ?? n.equipo)
      bolsa.push(
        lineaNov(
          n.escalones > 0 ? '🛡' : '🔓',
          n.escalones > 0
            ? `${escudoDe(n.id)}<b>${esc(nombreDe(n.id))}</b>: ${quien} le subió la cláusula a ${eur(n.clausula)}, y le costó ${eur(n.coste)}`
            : `${escudoDe(n.id)}<b>${esc(nombreDe(n.id))}</b>: ${quien} le bajó la cláusula a ${eur(n.clausula)}, y le devolvieron ${eur(-n.coste)}`,
          esMio(n.equipo) ? 'mio' : '',
        ),
      )
    } else if (n.tipo === 'lesion') {
      bolsa.push(lineaNov('🏥', `${escudoDe(n.id)}<b>${esc(nombreDe(n.id))}</b> se ha lesionado`, esMio(n.equipo) ? 'malo' : ''))
    } else if (n.tipo === 'alta') {
      bolsa.push(lineaNov('✅', `${escudoDe(n.id)}<b>${esc(nombreDe(n.id))}</b> ya está disponible`, ''))
    } else if (n.tipo === 'mercado' && n.entra) {
      bolsa.push(lineaNov('🏷', `${escudoDe(n.id)}<b>${esc(nombreDe(n.id))}</b> ha salido al mercado`, ''))
    }
  }

  const deHoy = dias.get(HOY)
  const deAyer = dias.get(AYER)
  if (deHoy.length === 0 && deAyer.length === 0) return ''

  // La portada enseña solo lo que cabe escanear. El historial completo sigue
  // disponible, pero ya no empuja el once y las decisiones fuera de pantalla.
  const visiblesHoy = deHoy.slice(0, 5)
  const restoHoy = deHoy.slice(5)

  // Nada se esconde detrás de un «y 42 más» que no se puede abrir. Lo de hoy va
  // desplegado; lo de ayer, plegado pero completo y a un toque.
  return `    <section class="sec">
      <h2 class="sh"><span class="se">🔔</span>Lo que ha cambiado <em>${deHoy.length + deAyer.length}</em></h2>
${deHoy.length ? `      <h3 class="ndia">Hoy <em>${deHoy.length}</em></h3>
      <ul class="novs">
${visiblesHoy.join(NL)}
      </ul>
      ${restoHoy.length ? `<details class="novedades-extra"><summary>Ver ${restoHoy.length} cambios más de hoy</summary><ul class="novs">${restoHoy.join(NL)}</ul></details>` : ''}` : '      <p class="pie">Hoy todavía no se ha movido nada.</p>'}
${deAyer.length ? `      <details class="nayer">
        <summary>Ayer <em>${deAyer.length}</em></summary>
        <ul class="novs">
${deAyer.join(NL)}
        </ul>
      </details>` : ''}
    </section>
`
})()

// ── El once de la jornada ────────────────────────────────────────────────────
// Mister publica la formación elegida —«1-3-6-1»: un portero, tres defensas,
// seis medios y un delantero— y, de cada jugador, si lo da por titular en su
// próximo partido y cuánto promedia jugando en casa y fuera. Con eso se puede
// proponer un once en vez de dejar que lo elija uno a ojo el domingo por la
// mañana.
//
// Lo que se ordena no es la media general: es la media **donde le toca jugar**.
// Mbappé hace 15,0 en casa y 3,0 fuera; promediarlo esconde justo lo que hay
// que mirar.
const FORMACION = (YO.formacion || '').split('-').map(Number).filter((n) => Number.isFinite(n))
/**
 * Las formaciones que se pueden alinear en Mister.
 *
 * Las siete de siempre más las cinco que el juego vende por monedas, y esas
 * cinco no me las he inventado: aparecen en su propio HTML como
 * `add_formation_4_2_4`, `add_formation_4_6_0`, `add_formation_3_3_4`,
 * `add_formation_3_6_1` y `add_formation_5_5_0`. La tuya, 1-3-6-1, es una de
 * ellas, así que la tienes.
 *
 * De las otras cuatro de pago no hay forma de saber si las tienes, así que se
 * enseñan marcadas: mejor decirte que existe una alineación mejor y que cuesta
 * monedas, que ocultártela.
 */
const FORMACIONES = [
  { l: [1, 3, 4, 3], pago: false },
  { l: [1, 3, 5, 2], pago: false },
  { l: [1, 4, 3, 3], pago: false },
  { l: [1, 4, 4, 2], pago: false },
  { l: [1, 4, 5, 1], pago: false },
  { l: [1, 5, 3, 2], pago: false },
  { l: [1, 5, 4, 1], pago: false },
  { l: [1, 4, 2, 4], pago: true },
  { l: [1, 4, 6, 0], pago: true },
  { l: [1, 3, 3, 4], pago: true },
  { l: [1, 3, 6, 1], pago: true },
  { l: [1, 5, 5, 0], pago: true },
]

/**
 * El mejor once posible con una formación dada.
 *
 * Antes esto solo sabía rellenar la formación que tuvieras puesta, y por eso
 * nunca podía decirte que con otra sacarías más. El criterio de a quién elegir
 * no cambia: primero quien va a jugar, luego el pronóstico de titularidad, y
 * entre iguales el que más rinda en su partido.
 */
const onceCon = (formacion) => {
  if (formacion.length !== 4) return null
  const elegidos = []
  const banquillo = []
  let completo = true
  formacion.forEach((cuantos, i) => {
    const puesto = i + 1
    const candidatos = MIOS.filter((j) => j.puesto === puesto).sort(
      (a, b) => (noJuega(b) ? -1 : 1) - (noJuega(a) ? -1 : 1) || conProbabilidad(b) - conProbabilidad(a),
    )
    if (candidatos.length < cuantos) completo = false
    elegidos.push(...candidatos.slice(0, cuantos).map((j) => ({ ...j, hueco: cuantos > candidatos.length })))
    banquillo.push(...candidatos.slice(cuantos))
  })
  return {
    elegidos,
    banquillo: banquillo.sort((a, b) => esperadoTotal(b) - esperadoTotal(a)),
    completo,
    // Lo que cabe esperar del once entero. Quien no juega suma cero: contar su
    // media sería premiar una formación por llenarla con lesionados.
    total: elegidos.reduce((t, j) => t + (noJuega(j) ? 0 : esperadoTotal(j)), 0),
  }
}

const once = onceCon(FORMACION)

/** Todas las formaciones, ordenadas por lo que darían. */
const formacionesProbadas = FORMACIONES.map((f) => ({ ...f, nombre: f.l.join('-'), once: onceCon(f.l) }))
  .filter((f) => f.once !== null && f.once.completo)
  .sort((a, b) => b.once.total - a.once.total)

const filaOnce = (j) => `        <div class="mj">${dorsal(j.puesto)}${caraDe(j.id, j.nombre)}${escudoDe(j.id)}<span class="n">${nombreEnlazado(j)}${pintarRacha(j)}</span>
          <span class="v">${dec(esperadoConAjustes(j).total)}${(() => {
            const a = esperadoConAjustes(j)
            const partes = [
              `su media ${j.casa === 1 ? 'en casa' : j.casa === 0 ? 'fuera' : ''} ${dec(a.base)}`,
              // Solo si mueve algo visible: un «+0,0» no informa, y con once
              // filas llenas de él la línea deja de leerse.
              Math.abs(a.porForma) >= 0.05 ? `forma ${a.porForma > 0 ? '+' : '−'}${dec(Math.abs(a.porForma))}` : null,
              Math.abs(a.porRival) >= 0.05 ? `rival ${a.porRival > 0 ? '+' : '−'}${dec(Math.abs(a.porRival))}` : null,
            ].filter(Boolean)
            return partes.length > 1 ? `<small class="desg" title="De dónde sale la cifra">${partes.join(' · ')}</small>` : ''
          })()}</span><span class="c">${
            j.riv ? `${j.casa === 1 ? 'en casa' : 'fuera'} · ${esc(CLUBES.get(String(j.riv)) ?? '?')}${pintarDureza(durezaDe(j), j)}` : 'sin partido'
          }</span><span class="m">${
            j.est === 'injury' ? '🏥 lesionado' : j.once === 1 ? '👕 titular' : j.once === 0 ? 'suplente' : '—'
          }</span></div>`

/**
 * El once sobre el césped, como lo pinta Mister.
 *
 * Las mismas once fichas que la lista de debajo, pero colocadas por líneas:
 * el portero abajo y los delanteros arriba, que es como se mira una alineación
 * y como la enseña el juego. La lista sigue debajo porque es la que explica el
 * porqué de cada uno —su media donde le toca jugar, la forma, el rival—, y eso
 * en el campo no cabe.
 *
 * `once.elegidos` ya viene ordenado por puesto, así que las líneas se cortan
 * con la propia formación en vez de volver a agrupar por tu cuenta.
 */
const fichaEnCampo = (j) => {
  const fuera = noJuega(j)
  const pts = fuera ? null : esperadoTotal(j)
  // El apellido solo: en una ficha de sesenta píxeles el nombre entero no cabe
  // y Mister hace lo mismo. Si es de una sola palabra, se queda como está.
  const partes = j.nombre.trim().split(/\s+/)
  const mote = partes.length > 1 ? `${partes[0][0]}. ${partes.slice(1).join(' ')}` : j.nombre
  const prob = probabilidadDe(j)
  const porQue = fuera
    ? j.est === 'injury'
      ? 'lesionado'
      : 'su equipo no juega esta jornada'
    : `${dec(pts)} puntos que cabe esperar${prob === null ? '' : ` · ${prob} % de salir de titular`}`
  return `<button type="button" class="cj${fuera ? ' fuera' : ''}" data-ficha="${j.id}" title="${esc(`${j.nombre} · ${porQue}`)}">
          <span class="cj-cara">${caraDe(j.id, j.nombre)}${escudoDe(j.id)}${
    prob !== null && prob < TRAMO_TITULAR
      ? `<i class="cj-duda" title="${prob} % de salir de titular, según FútbolFantasy">${prob}%</i>`
      : j.once === 1
        ? '<i class="cj-tit" title="Mister lo da titular">👕</i>'
        : ''
  }</span>
          <span class="cj-n">${esc(mote)}</span>
          <span class="cj-p ${fuera ? 'no' : claseRacha(pts)}">${fuera ? (j.est === 'injury' ? '🏥' : '—') : dec(pts)}</span>
        </button>`
}

const campoOnce = (o, formacion) => {
  if (!o || formacion.length !== 4) return ''
  const lineas = []
  let i = 0
  for (const cuantos of formacion) {
    lineas.push(o.elegidos.slice(i, i + cuantos))
    i += cuantos
  }
  // El campo va tumbado, como se ve un partido: el portero a la izquierda y los
  // delanteros atacando hacia la derecha. En vertical las cuatro líneas se
  // apretaban unas contra otras y sobraba campo a los lados; así cada línea es
  // una columna y ocupan el ancho entero.
  return `<div class="campo" role="img" aria-label="El once del domingo en el campo">
        <div class="campo-hierba"></div>
        <svg class="campo-lineas" viewBox="0 0 300 190" preserveAspectRatio="none" aria-hidden="true">
          <rect x="3" y="3" width="294" height="184" rx="2"/>
          <line x1="150" y1="3" x2="150" y2="187"/>
          <rect x="3" y="47" width="42" height="96"/>
          <rect x="3" y="72" width="16" height="46"/>
          <rect x="255" y="47" width="42" height="96"/>
          <rect x="281" y="72" width="16" height="46"/>
        </svg>
        <span class="campo-centro"></span>
${lineas
  .filter((l) => l.length)
  .map((l) => `        <div class="campo-linea" data-n="${l.length}">${l.map(fichaEnCampo).join('')}</div>`)
  .join('\n')}
      </div>`
}

/**
 * El once ya pintado de cada formación, para poder cambiarlo de un toque.
 *
 * Las fichas de formación decían cuántos puntos daría cada una pero el campo
 * se quedaba siempre en la tuya: enseñaban un número sin poder ver de dónde
 * salía. Aquí va el campo de cada una, y el navegador solo cambia el bloque.
 *
 * Se manda el HTML hecho y no los datos: pintar la ficha de un jugador tiene
 * escudo, cara, eventos y colores, y tener esa misma lógica escrita dos veces
 * —aquí y en el navegador— es como se separan con el tiempo.
 */
const islaOnces = JSON.stringify(
  Object.fromEntries(
    formacionesProbadas.map((f) => [
      f.nombre,
      { t: Number(f.once.total.toFixed(2)), pago: f.pago ? 1 : 0, html: campoOnce(f.once, f.l) },
    ]),
  ),
)

/**
 * Tu plantilla entera, para armar el once a mano.
 *
 * El once que calculo es una opinión: elige por pronóstico de titularidad y por
 * lo que rinde cada uno en su partido. Pero el que sabe si alguien viene tocado
 * o si el rival se le da bien eres tú, y hasta ahora no había forma de decirlo:
 * o te tragabas mi once o hacías las cuentas en la cabeza.
 *
 * Va la ficha ya pintada, la misma que usa el campo, para que arrastrar a un
 * jugador no lo enseñe distinto de como sale en el once de arriba.
 */
const islaPlantilla = JSON.stringify(
  MIOS.map((j) => ({
    id: String(j.id),
    n: j.nombre,
    p: j.puesto,
    e: noJuega(j) ? 0 : Number(esperadoTotal(j).toFixed(2)),
    fuera: noJuega(j) ? 1 : 0,
    html: fichaEnCampo(j),
  })),
)

/** Las formaciones que se pueden armar, con su reparto por líneas. */
const islaFormaciones = JSON.stringify(FORMACIONES.map((f) => ({ n: f.l.join('-'), l: f.l, pago: f.pago ? 1 : 0 })))

/**
 * Las jornadas ya jugadas: qué once pusiste y qué hizo cada uno.
 *
 * Sale de Mister, no de un cálculo: es lo único que dice lo que alineaste de
 * verdad. El once de arriba es una recomendación de hoy y no sabe nada de lo
 * que hiciste hace tres semanas.
 */
const ALINEACIONES = opcional('alineaciones.json', [])

const fichaDeJornada = (j) => {
  const cara = caraDe(j.id, j.nombre)
  const pts = j.puntos
  const partes = String(j.nombre || '').trim().split(/\s+/)
  const mote = partes.length > 1 ? `${partes[0][0]}. ${partes.slice(1).join(' ')}` : j.nombre
  const clase = pts == null ? 'no' : claseRacha(pts)
  return `<button type="button" class="cj${j.jugo ? '' : ' fuera'}" data-ficha="${j.id}" title="${esc(`${j.nombre}: ${pts == null ? 'no jugó' : `${pts} puntos`}`)}">
          <span class="cj-cara">${cara}${escudoDe(j.id)}${j.capitan ? '<i class="cj-tit" title="Capitán">©</i>' : ''}</span>
          <span class="cj-n">${esc(mote)}</span>
          <span class="cj-p ${clase}">${pts == null ? '—' : pts}</span>
        </button>`
}

const campoDeJornada = (a) => {
  const lineas = []
  for (const j of a.once) {
    const i = j.puesto - 1
    ;(lineas[i] ??= []).push(j)
  }
  return `<div class="campo" role="img" aria-label="Tu once de la jornada ${a.jornada}">
        <div class="campo-hierba"></div>
        <svg class="campo-lineas" viewBox="0 0 300 190" preserveAspectRatio="none" aria-hidden="true">
          <rect x="3" y="3" width="294" height="184" rx="2"/>
          <line x1="150" y1="3" x2="150" y2="187"/>
          <rect x="3" y="47" width="42" height="96"/><rect x="3" y="72" width="16" height="46"/>
          <rect x="255" y="47" width="42" height="96"/><rect x="281" y="72" width="16" height="46"/>
        </svg>
        <span class="campo-centro"></span>
${lineas
  .filter(Boolean)
  .map((l) => `        <div class="campo-linea" data-n="${l.length}">${l.map(fichaDeJornada).join('')}</div>`)
  .join('\n')}
      </div>`
}

/** El campo de cada jornada jugada, listo para cambiarlo de un toque. */
const islaJornadas = JSON.stringify(
  Object.fromEntries(
    ALINEACIONES.filter((a) => a.once && a.once.length).map((a) => [
      String(a.jornada),
      {
        pts: a.puntos,
        puesto: a.puesto,
        form: a.formacion,
        html: campoDeJornada(a),
        banca: a.banquillo
          .map((j) => `<span class="jb${j.puntos == null ? ' no' : ''}">${esc(j.nombre)} <b>${j.puntos == null ? '—' : j.puntos}</b></span>`)
          .join(''),
      },
    ]),
  ),
)

const bloqueOnce = once === null || once.elegidos.length === 0
  ? ''
  : `    <section class="sec" id="once-jornada">
      <h2 class="sh"><span class="se">👕</span>El once del domingo <em>${YO.formacion}</em></h2>
      <p class="sd">Los que más deberían darte según Mister: su media <strong>donde les toca jugar</strong> esta jornada, y solo contando a los que da por titulares. La cifra grande es lo que cabe esperar de cada uno.${
        once.elegidos.filter((j) => j.est === 'injury').length
          ? ' <strong>Ojo:</strong> hay lesionados en el once porque no tienes recambio en su puesto.'
          : ''
      }</p>
      ${(() => {
        // Si otra formación da más, se dice. Era el punto ciego del once:
        // rellenaba la que tuvieras puesta y nunca podía decirte que con otra
        // sacarías más, aunque tuvieras tres delanteros de sobra.
        const mia = formacionesProbadas.find((f) => f.nombre === YO.formacion)
        const mejor = formacionesProbadas[0]
        if (!mejor || !mia) return ''
        const gana = mejor.once.total - mia.once.total
        // Callar cuando aciertas es desaprovecharlo: si tu formación ya es la
        // mejor, lo que hace falta saber es por cuánto y cuál sería la
        // siguiente, no que no aparezca nada.
        const acierta = mejor.nombre === mia.nombre || gana < 0.5
        const segunda = formacionesProbadas.find((f) => f.nombre !== mia.nombre)
        return `<div class="otraform${acierta ? ' bien' : mejor.pago ? ' depago' : ''}">
        <b>${
          acierta
            ? `Tu ${mia.nombre} es la que más te da`
            : `Con ${mejor.nombre} sacarías ${dec(gana)} puntos más`
        }</b>
        <span>${
          acierta
            ? `Probadas las doce formaciones con tus jugadores, ninguna la mejora${segunda ? `: la siguiente, ${segunda.nombre}, daría ${dec(mia.once.total - segunda.once.total)} puntos menos` : ''}.`
            : `Tu ${mia.nombre} da ${dec(mia.once.total)} y ${mejor.nombre} daría ${dec(mejor.once.total)}, con los mismos jugadores.${
                mejor.pago ? ' Esa formación Mister la vende por monedas: puede que no la tengas.' : ''
              }`
        }</span>
        <span class="alt">${formacionesProbadas
          .slice(0, 6)
          .map((f) => `<button type="button" data-formacion="${f.nombre}" class="${f.nombre === mia.nombre ? 'tuya' : ''}${f.pago ? ' pago' : ''}" title="${f.pago ? 'De pago en Mister · pincha para ver ese once' : 'De serie · pincha para ver ese once'}">${f.nombre} <b>${dec(f.once.total)}</b></button>`)
          .join('')}</span>
      </div>`
      })()}
      ${ALINEACIONES.filter((a) => a.once && a.once.length).length
        ? `<div class="jtabs" id="jtabs">
        <button type="button" class="on" data-jornada="proxima">Próxima</button>
${ALINEACIONES.filter((a) => a.once && a.once.length)
  .map((a) => `        <button type="button" data-jornada="${a.jornada}">J${a.jornada}<b>${a.puntos ?? 0}</b></button>`)
  .join(NL)}
      </div>`
        : ''}
      <p class="sd" id="once-que-ves" hidden></p>
      <p class="pie" id="pie-campo">La cifra de cada ficha <strong>no es su media</strong>: es lo que cabe esperar de él <strong>este domingo</strong>, con su media donde le toca jugar, su forma y el rival que le viene. Un jugador de más media puede salir por debajo si juega fuera y le toca un rival duro.</p>
      ${campoOnce(once, FORMACION)}
      <div class="jbanca" id="jbanca" hidden></div>
      <details class="mano">
        <summary><span class="txt">Probar un once a mano</span></summary>
        <p class="sd">Mi once es una opinión: elige por el pronóstico de titularidad de Mister y por lo que rinde cada uno en su partido. Tú sabes cosas que yo no —quién viene tocado, a quién se le da bien el rival—. Arrastra o toca para armar el tuyo y ver cuánto daría.</p>
        <div class="mano-cab">
          <label>Formación <select id="mano-formacion"></select></label>
          <span class="mano-total"><b id="mano-puntos">0,0</b> pts <i id="mano-cuantos">0 de 11</i></span>
          <button type="button" id="mano-mio">Poner el mío</button>
          <button type="button" id="mano-limpiar">Vaciar</button>
        </div>
        <div class="campo mano-campo" id="mano-campo"></div>
        <p class="sd" id="mano-aviso"></p>
        <div class="mano-banca" id="mano-banca"></div>
      </details>
      <div class="mini">
${once.elegidos.map(filaOnce).join(NL)}
      </div>
      ${
        once.banquillo.length
          ? `<details class="quien" style="grid-column:auto;grid-row:auto;margin-top:11px">
        <summary><span class="txt">Los ${once.banquillo.length} que se quedan fuera</span></summary>
        <div class="mini" style="margin-top:9px">
${once.banquillo.map(filaOnce).join(NL)}
        </div>
      </details>`
          : ''
      }
    </section>
`

const oportunidad = J.filter((j) => j.a && !j.mio)
  .sort((a, b) => (b.p + b.d) - (a.p + a.d) || b.media - a.media || (b.subeMes ?? -9) - (a.subeMes ?? -9))[0]

const centroMando = `    <section class="centro-mando" aria-labelledby="cm-titulo">
      <div class="cm-arriba">
        <div>
          <p class="cm-kicker">Centro de mando · jornada</p>
          <h2 id="cm-titulo">Hoy tienes ${aVender.length + aBlindar.length} decisiones claras</h2>
          <p class="cm-bajada">Tu ventaja no está en mirar más datos, sino en actuar antes: ajusta el once, libera caja y vigila la mejor oportunidad disponible.</p>
        </div>
        <div class="cm-proyeccion"><b>${once ? dec(once.total) : '—'} pts</b><span>proyección del mejor once</span></div>
      </div>
      <div class="cm-acciones">
        <button class="cm-accion" type="button" data-scroll="once-jornada"><span class="cm-ico">↗</span><b>Optimiza tu once</b><small>${YO.formacion || 'Formación'} · ${once ? `${once.elegidos.length} jugadores elegidos` : 'sin datos suficientes'}</small></button>
        <button class="cm-accion" type="button" data-scroll="${aVender.length ? 'bloque-venta' : 'bloque-clausula'}"><span class="cm-ico">${aVender.length ? '€' : '◆'}</span><b>${aVender.length ? `Vende ${aVender.length}` : `Blinda ${aBlindar.length}`}</b><small>${aVender.length ? `liberarías ${corto(sumaVenta)} para competir` : 'protege el valor de tu plantilla'}</small></button>
        <button class="cm-accion" type="button" data-tab="t2"><span class="cm-ico">＋</span><b>${oportunidad ? `Ficha a ${esc(oportunidad.nombre)}` : 'Explora el mercado'}</b><small>${oportunidad ? `${dec(oportunidad.media)} de media · ${corto(oportunidad.precio)}` : 'ordena por recomendaciones'}</small></button>
      </div>
    </section>
`

const miEquipo = `${centroMando}${bloqueOnce}${novedades}${bloque(
  '📤',
  'Deberías vender',
  aVender.length
    ? `Dinero parado: ni te dan puntos ni les sube el valor. Vendiendo los ${aVender.length} entrarían <strong>${eur(sumaVenta)}</strong> en caja y tu tope de puja pasaría de ${eur(MIO.tope)} a <strong>${eur(topeTrasVender(sumaVenta))}</strong>.`
    : '',
  aVender,
  'venta',
)}
${bloque(
  '🔒',
  'Deberías blindar',
  'Rinden, y su cláusula es barata para lo que producen: cualquier rival puede llevárselos pagándola. Despliega para ver quiénes.',
  aBlindar,
  'clausula',
)}
${bloque('', 'El resto de tu plantilla', 'Ni urge venderlos ni están especialmente expuestos.', resto, 'valor')}
    <section class="sec">
      <h2 class="sh">Tus cuentas</h2>
      <p class="sd">De dónde sale cada euro, desde el reinicio de la liga.</p>
      <div class="ficha">${cuentasDe(MIO)}</div>
    </section>`

// ── 2. Rivales ───────────────────────────────────────────────────────────────
const fichaEquipo = (e) => `<details class="eq${e.mio ? ' yo' : ''}">
    <summary>
      <span class="puesto">${e.pos}º</span>
      <div class="eqn">${esc(e.corto)}${e.mio ? '<span class="et et-eq et-mio">tú</span>' : ''}</div>
      <div class="eqp"><b>${eur(e.tope)}</b><i>puede gastar</i></div>
      ${barraPoder(e)}
    </summary>
    <div class="cuerpo">
      <p class="frase">Va <strong>${e.pos}º con ${e.pts} puntos</strong>. Tiene <strong>${eur(e.saldo)}</strong> en caja y una plantilla de ${(PL[e.n] ?? []).length} jugadores que vale ${eur(e.pl)}.</p>
      <h3 class="sub">Su plantilla</h3>
      ${plantillaDe(e)}
      <h3 class="sub">Sus cuentas</h3>
      ${cuentasDe(e)}
      <h3 class="sub">Jugador a jugador</h3>
      ${tablaMovimientos(e)}
    </div>
  </details>`

const rivales = `    <p class="intro">Ordenados por lo que pueden gastar hoy. La parte sólida de cada barra es dinero en caja; la rayada, el crédito que le da su plantilla.</p>
${[...EQ]
  .sort((a, b) => b.tope - a.tope)
  .map(fichaEquipo)
  .join(NL)}`

// ── 3. Movimientos ───────────────────────────────────────────────────────────
const OPS = { normal: '', clause: 'cláusula', rescind: 'rescisión' }

const filaMov = (m) => {
  const eqDe = m.de ? POR_NOMBRE.get(m.de) : null
  const eqA = m.a ? POR_NOMBRE.get(m.a) : null
  const mio = (eqDe && eqDe.mio) || (eqA && eqA.mio) ? ' mio' : ''
  const tipo = m.a ? 'compra' : 'venta'
  return `<div class="mv ${tipo}${mio}" data-busca="${esc(m.nombre)} ${esc(eqDe ? eqDe.corto : 'mercado')} ${esc(eqA ? eqA.corto : 'mercado')}">
      <span class="fecha">${dia(m.fecha)}</span>
      ${dorsal(m.pos ?? 0)}
      <div class="mn">${caraDe(m.id, m.nombre)}${escudoDe(m.id)}${nombreEnlazado(m)}${OPS[m.tipo] ? `<span class="et et-op">${OPS[m.tipo]}</span>` : ''}</div>
      <div class="mr"><span class="${eqDe && eqDe.mio ? 'yo' : eqDe ? '' : 'mercado'}">${esc(eqDe ? eqDe.corto : 'Mercado')}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg><span class="${eqA && eqA.mio ? 'yo' : eqA ? '' : 'mercado'}">${esc(eqA ? eqA.corto : 'Mercado')}</span></div>
      <div class="mi">${eur(m.importe)}</div>
    </div>`
}

// Actividad por día: 32 días de mercado en una sola tira.
const porDia = new Map()
for (const m of MOVS) {
  const d = m.fecha.slice(0, 10)
  porDia.set(d, (porDia.get(d) ?? 0) + 1)
}
const dias = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0]))
const maxDia = Math.max(...dias.map(([, n]) => n))
const totalGastado = MOVS.reduce((s, m) => s + m.importe, 0)

const movimientos = `    <div class="tarjeta">
      <h2 class="sh">Actividad del mercado</h2>
      <p class="sd"><strong>${MOVS.length} movimientos</strong> desde el 3 de agosto, ${eur(totalGastado)} en total. El día más movido fueron ${maxDia}.</p>
      <div class="pulso">
${dias
  .map(
    ([d, n]) =>
      `        <span class="d" style="--alto:${Math.max(6, (n / maxDia) * 100).toFixed(0)}%" title="${dia(d)}: ${n} movimiento${n === 1 ? '' : 's'}"></span>`,
  )
  .join(NL)}
      </div>
      <div class="pulso-pie"><span>${dia(dias[0][0])}</span><span>${dia(dias[dias.length - 1][0])}</span></div>
    </div>

    <div class="mando">
      <div class="buscar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="qm" type="search" placeholder="Buscar por jugador o equipo…" autocomplete="off" spellcheck="false">
        <span class="cuenta-res" id="cuenta-mov"></span>
      </div>
      <div class="grupos">
        <div class="grupo">
          <span>Qué enseño</span>
          <div class="ops">
            <label for="m1">Todo</label>
            <label for="m2">Solo compras</label>
            <label for="m3">Solo ventas al mercado</label>
            <label for="m4">Solo lo mío</label>
          </div>
        </div>
      </div>
    </div>

    <div class="lista" id="lista-mov">
${MOVS.map(filaMov).join(NL)}
      <p class="vacio" id="sin-mov" hidden>Ningún movimiento cumple eso.</p>
    </div>`

// ── 4. Números ───────────────────────────────────────────────────────────────
const maxPts = Math.max(...EQ.map((e) => e.pts))
const maxPatrimonio = Math.max(...EQ.map((e) => e.patrimonio))

const clasificacion = [...EQ]
  .sort((a, b) => b.pts - a.pts)
  .map(
    (e) => `        <div class="ranking${e.mio ? ' mio' : ''}">
          <span class="pos">${e.pos}º</span><span class="nom">${esc(e.corto)}</span>
          <span class="bar"><i style="width:${((e.pts / maxPts) * 100).toFixed(1)}%"></i></span>
          <span class="val">${e.pts}</span>
        </div>`,
  )
  .join(NL)

/**
 * La barra de patrimonio, con la deuda a la vista.
 *
 * Se pintaba `width: saldo / máximo`, y con la caja en negativo eso sale
 * negativo: el navegador lo recorta a cero y un equipo endeudado se veía igual
 * que uno sin un euro. El total sí lo restaba —Neky marcaba 99 M teniendo una
 * plantilla de 113— pero la deuda no aparecía por ningún lado, que es
 * justamente lo que más dice de cómo va alguien.
 *
 * Ahora la barra mide el patrimonio, que es la cifra de al lado, y lo que debe
 * se dibuja detrás en rojo: lo que tendría de más si no debiera nada. Las dos
 * piezas juntas suman lo que vale su plantilla.
 */
const barraRiqueza = (e) => {
  const ancho = (n) => `${((n / maxPatrimonio) * 100).toFixed(1)}%`
  if (e.saldo >= 0) {
    return `<i class="caja" style="width:${ancho(e.saldo)}" title="caja ${eur(e.saldo)}"></i><i class="plant" style="width:${ancho(e.pl)}" title="plantilla ${eur(e.pl)}"></i>`
  }
  return `<i class="plant" style="width:${ancho(Math.max(0, e.patrimonio))}" title="plantilla ${eur(e.pl)} menos lo que debe"></i><i class="deuda" style="width:${ancho(-e.saldo)}" title="debe ${eur(-e.saldo)}"></i>`
}

const riqueza = [...EQ]
  .sort((a, b) => b.patrimonio - a.patrimonio)
  .map(
    (e) => `        <div class="ranking${e.mio ? ' mio' : ''}">
          <span class="pos">${e.pos}º</span><span class="nom">${esc(e.corto)}</span>
          <span class="bar doble">${barraRiqueza(e)}</span>
          ${(() => {
            // La cuenta solo si mueve la cifra: a Saiyans, que debe 76 K sobre
            // 81 M, le salía «81 M − 76 K que debe → 81 M», que es escribir una
            // resta para no restar nada.
            const cambia = e.saldo < 0 && corto(e.pl) !== corto(e.patrimonio)
            return `<span class="val${cambia ? ' conDeuda' : ''}">${
            cambia
              // La resta escrita, que es como se entiende sin pensar. Con solo
              // el total y la deuda al lado, lo natural es preguntarse si hay
              // que volver a restarla — y eso preguntó Isaac.
              ? `<em class="cuentita" title="Su plantilla vale ${eur(e.pl)} y debe ${eur(-e.saldo)}. Mister deja quedarse en números rojos."><span>${corto(e.pl)}</span><span class="menos">− ${corto(-e.saldo)} que debe</span></em><b>${corto(e.patrimonio)}</b>`
              : `${corto(e.patrimonio)}${e.saldo < 0 ? `<em class="debechico" title="Debe ${eur(-e.saldo)}, ya restado">debe ${corto(-e.saldo)}</em>` : ''}`
          }</span>`
          })()}
        </div>`,
  )
  .join(NL)

// Quién blinda: subir una cláusula cuesta el 20 % del valor del jugador, y es
// dinero que no se ve venir en ningún sitio. Lo que se enseña son las subidas
// que siguen vivas hoy, no las que se pagaron sobre jugadores ya vendidos.
const blindaje = [...EQ].filter((e) => e.subidas > 0).sort((a, b) => b.costeSubidas - a.costeSubidas)
const maxBlindaje = Math.max(1, ...blindaje.map((e) => e.costeSubidas))
const filasBlindaje = blindaje
  .map(
    (e) => `        <div class="ranking${e.mio ? ' mio' : ''}">
          <span class="pos">${e.subidas}×</span><span class="nom">${esc(e.corto)}</span>
          <span class="bar"><i style="width:${((e.costeSubidas / maxBlindaje) * 100).toFixed(1)}%"></i></span>
          <span class="val">${e.mio ? eur(e.costeReal) : `~${corto(e.costeSubidas)}`}</span>
        </div>`,
  )
  .join(NL)
const sinBlindar = EQ.filter((e) => !e.subidas)

// Quién comercia mejor: lo cobrado más lo que conserva, menos lo pagado, y
// descontando lo que valía su reparto — así el que vendió gratis no gana de más.
const comercio = [...EQ]
  .map((e) => ({ ...e, negocio: e.sobre50 - e.pre }))
  .sort((a, b) => b.negocio - a.negocio)
const maxNeg = Math.max(...comercio.map((e) => Math.abs(e.negocio)))

const tablaTop = (titulo, nota, filas) => `      <div class="tarjeta">
        <h3 class="sub2">${titulo}</h3>
        ${nota ? `<p class="sd">${nota}</p>` : ''}
        <ol class="top">
${filas.join(NL)}
        </ol>
      </div>`

const lineaTop = (j, valor) =>
  `          <li><span class="d">${dorsal(j.puesto)}</span><span class="n">${caraDe(j.id, j.nombre)}${escudoDe(j.id)}${esc(j.nombre)}</span><span class="e">${esc(j.duenioCorto ?? 'libre')}</span><span class="v">${valor}</span></li>`

/**
 * Cuántos entran en cada lista de Estadísticas.
 *
 * Estaban en ocho, y en una liga de ocho equipos con quinientos jugadores eso
 * deja fuera a gente que interesa: la lista se acaba justo donde empieza a
 * haber opciones asequibles. Doce caben igual de bien en la tarjeta.
 */
const CUANTOS_EN_CADA_TOP = 12

const conPartidos = J.filter((j) => j.partidos >= 2)
const conForma = J.map((j) => ({ ...j, forma: formaDe(j), regul: regularidadDe(j) })).filter((j) => j.forma !== null)
const topForma = [...conForma].sort((a, b) => b.forma - a.forma).slice(0, CUANTOS_EN_CADA_TOP)
// Entre los que rinden: al que promedia 1 punto le sobra regularidad y no
// interesa a nadie.
const topFiar = [...conForma].filter((j) => j.media >= 4).sort((a, b) => a.regul - b.regul).slice(0, CUANTOS_EN_CADA_TOP)
const topMedia = [...conPartidos].sort((a, b) => b.media - a.media).slice(0, CUANTOS_EN_CADA_TOP)
const topPuntos = [...J].sort((a, b) => b.puntos - a.puntos).slice(0, CUANTOS_EN_CADA_TOP)
const topSube = [...J].filter((j) => j.subeMes != null).sort((a, b) => b.subeMes - a.subeMes).slice(0, CUANTOS_EN_CADA_TOP)
const topCaros = [...J].sort((a, b) => b.valor - a.valor).slice(0, CUANTOS_EN_CADA_TOP)
const topHoy = [...J].filter((j) => j.semana != null && j.semana !== 0).sort((a, b) => b.semana - a.semana).slice(0, CUANTOS_EN_CADA_TOP)
// Lo que cuesta cada punto de media: la forma más directa de ver qué sale a cuenta.
/**
 * Los mejores clausulazos y las mejores compras del mercado.
 *
 * No son dos formas de decir lo mismo. Fichar del mercado es pagar lo que pide
 * su dueño —o su valor, si está libre—; clausular es pagar la cláusula, que es
 * más cara, sin que el otro pueda negarse. La pregunta buena no es cuál es más
 * barato sino cuál compensa, y cada uno se mide con su propio rasero.
 */

// Para clausular: solo los que cumplen las tres condiciones —titular de
// verdad, prima barata para lo que rinde y partido favorable—, y solo si
// llegas a pagarla. Ordenados por lo que cuesta la prima por punto de media,
// que es lo que de verdad se paga por llevárselo.
const topClausulazo = J.map((j) => ({ j, c: clausulazo(j) }))
  .filter((x) => x.c !== null && x.c.cumple === 3 && x.c.porPunto !== null && x.j.pagable && x.j.precio <= MIO.tope)
  .sort((a, b) => a.c.porPunto - b.c.porPunto)
  .slice(0, CUANTOS_EN_CADA_TOP)

// Para el mercado: los que están en venta hoy y a los que llegas, ordenados
// por lo que te sobra sobre lo que vale alguien de su rendimiento.
const topMercado = J.filter((j) => !j.mio && j.mk && j.pv && j.precio <= MIO.tope)
  .map((j) => ({ j, r: hastaCuanto(j) }))
  .filter((x) => x.r !== null && x.r.margen > 0)
  .sort((a, b) => b.r.margen - a.r.margen)
  .slice(0, CUANTOS_EN_CADA_TOP)

const topGanga = [...conPartidos].filter((j) => j.media > 0).sort((a, b) => a.precio / a.media - b.precio / b.media).slice(0, CUANTOS_EN_CADA_TOP)

// Récords del mercado, sacados del histórico completo.
const masCaro = [...MOVS].sort((a, b) => b.importe - a.importe)[0]
const porJugador = new Map()
for (const [eq, d] of Object.entries(D.porEquipo)) {
  for (const [id, x] of Object.entries(d.porJugador)) {
    const loTiene = DUENIO.get(String(id)) === eq
    const bal = x.ventas + (loTiene ? VALOR.get(String(id)) ?? 0 : 0) - x.compras
    if (x.compras > 0) porJugador.set(`${eq}|${id}`, { id, equipo: POR_NOMBRE.get(eq), nombre: x.nombre, bal })
  }
}
const negocios = [...porJugador.values()].sort((a, b) => b.bal - a.bal)
const mejorNegocio = negocios[0]
const peorNegocio = negocios[negocios.length - 1]

const record = (etiqueta, titular, pie, tono) =>
  `        <div class="record${tono ? ` ${tono}` : ''}"><dt>${etiqueta}</dt><dd>${titular}</dd><p>${pie}</p></div>`

const numeros = `    <div class="tarjeta">
      <h2 class="sh">Clasificación</h2>
      <div class="rankings">
${clasificacion}
      </div>
    </div>

    <div class="tarjeta">
      <h2 class="sh">Quién es más rico</h2>
      <p class="sd">Patrimonio = caja + plantilla. La parte <span class="clave caja">llena</span> es dinero disponible; la <span class="clave plant">clara</span>, jugadores. Todos empezasteis en 50 M. Quien debe dinero lleva la deuda <b class="clave debe">rayada en rojo</b> al final de su barra: la barra entera es lo que vale su plantilla, y solo lo de antes del corte es suyo. <b>Esa deuda ya está restada de la cifra</b>, no hay que volver a restarla.</p>
      <p class="sd aviso">${(() => {
        // La caja de un rival es un techo, no una cifra, y conviene decirlo
        // donde se le pone el número al lado. El valor de plantilla sí está
        // verificado contra la clasificación; lo que se estima es el dinero.
        const oculto = MIO.gastoOculto ?? 0
        return `Tu plantilla y la de todos está verificada contra la clasificación de Mister, al euro. <b>La caja de los rivales es una estimación</b>, y siempre por arriba: Mister no publica lo que cuesta subir una cláusula —el 20 % del valor por escalón— y eso solo se puede estimar. Se descuenta lo estimado${oculto ? `, que en tu caso son ${eur(oculto)}` : ''}, pero contra tu libro de caja este cálculo se queda corto en un par de millones. Léelo como «no más de esto».`
      })()}</p>
      <div class="rankings">
${riqueza}
      </div>
    </div>

    <div class="tarjeta">
      <h2 class="sh">Quién blinda a los suyos</h2>
      <p class="sd">Subir una cláusula cuesta el <b>20 % del valor</b> del jugador. La tuya sale de tu libro de caja y es exacta. La de los rivales se estima sumando dos cosas: lo que les hemos <b>visto</b> subir o bajar desde que se vigila —eso queda apuntado el día que pasa, así que no se pierde aunque luego vendan al jugador— y las subidas que ya estaban puestas antes, valoradas a día de hoy. Lo que no se puede ver: lo que pagaron por blindar a alguien y vendieron <b>antes</b> de que empezáramos a mirar. Así que estas cifras son un suelo, no un techo.</p>
      <div class="rankings">
${filasBlindaje || '        <p class="vacio2">Nadie ha tocado ninguna cláusula.</p>'}
      </div>
      ${sinBlindar.length ? `<p class="pie">Sin blindar a nadie: ${sinBlindar.map((e) => esc(e.corto)).join(', ')}. Sus jugadores se pueden fichar pagando 1,5 veces su valor.</p>` : ''}
    </div>

    <div class="tarjeta">
      <h2 class="sh">Quién comercia mejor</h2>
      <p class="sd">Lo ganado solo en el mercado, sin contar los premios: patrimonio de hoy menos los 50 M de salida, menos lo cobrado por jornadas.</p>
      <div class="rankings">
${comercio
  .map(
    (e) => `        <div class="ranking${e.mio ? ' mio' : ''}">
          <span class="pos">${e.pos}º</span><span class="nom">${esc(e.corto)}</span>
          <span class="bar centro"><i class="${e.negocio >= 0 ? 'pos' : 'neg'}" style="width:${((Math.abs(e.negocio) / maxNeg) * 50).toFixed(1)}%;${e.negocio >= 0 ? 'left:50%' : `right:50%`}"></i></span>
          <span class="val ${clase(e.negocio)}">${firmaCorta(e.negocio)}</span>
        </div>`,
  )
  .join(NL)}
      </div>
    </div>

    <div class="tarjeta">
      <h2 class="sh">Récords de la liga</h2>
      <div class="records">
${record('Fichaje más caro', `${caraDe(masCaro.id, masCaro.nombre)}${escudoDe(masCaro.id)}${esc(masCaro.nombre)} · ${eur(masCaro.importe)}`, `Lo fichó ${esc(POR_NOMBRE.get(masCaro.a)?.corto ?? masCaro.a ?? 'el mercado')} el ${dia(masCaro.fecha)}.`, '')}
${record('El mejor negocio', `${caraDe(mejorNegocio.id, mejorNegocio.nombre)}${escudoDe(mejorNegocio.id)}${esc(mejorNegocio.nombre)} · ${firma(mejorNegocio.bal)}`, `De ${esc(mejorNegocio.equipo?.corto ?? '—')}, contando lo que vale hoy.`, 'bien')}
${record('El peor negocio', `${caraDe(peorNegocio.id, peorNegocio.nombre)}${escudoDe(peorNegocio.id)}${esc(peorNegocio.nombre)} · ${firma(peorNegocio.bal)}`, `De ${esc(peorNegocio.equipo?.corto ?? '—')}, contando lo que vale hoy.`, 'mal')}
${record('Movimientos', `${MOVS.length} en ${dias.length} días`, `${eur(totalGastado)} han cambiado de manos desde el reinicio.`, '')}
      </div>
    </div>

    <div class="tarjeta">
      <h2 class="sh">El mercado en cifras</h2>
      <div class="records">
${record('Precio medio de un fichaje', eur(totalGastado / MOVS.length), `Sobre ${MOVS.length} movimientos en ${dias.length} días.`, '')}
${record('Lo que vale la liga', eur(EQ.reduce((s, e) => s + e.pl, 0)), `Sumando las ocho plantillas, ${Object.values(PL).flat().length} jugadores.`, '')}
${record('Dinero parado en caja', eur(EQ.reduce((s, e) => s + e.saldo, 0)), `El ${Math.round((EQ.reduce((s, e) => s + e.saldo, 0) / EQ.reduce((s, e) => s + e.patrimonio, 0)) * 100)} % del patrimonio de la liga está sin invertir.`, '')}
${record('Cuánto ha crecido todo', firma(EQ.reduce((s, e) => s + e.sobre50, 0)), `Entre los ocho, sobre los ${corto(50000000 * EQ.length)} de salida.`, EQ.reduce((s, e) => s + e.sobre50, 0) > 0 ? 'bien' : 'mal')}
      </div>
    </div>

    <div class="tarjeta">
      <h2 class="sh">Cómo está repartida la liga por posiciones</h2>
      <p class="sd">Cuántos jugadores tiene cada equipo en cada línea. Un hueco es una posición sin cubrir.</p>
      <div class="tabla-scroll"><table class="jt"><thead><tr><th>Equipo</th><th>POR</th><th>DEF</th><th>MED</th><th>DEL</th><th>Total</th><th>Valor medio</th></tr></thead><tbody>
${[...EQ]
  .sort((a, b) => b.pl - a.pl)
  .map((e) => {
    const suyos = (PL[e.n] ?? []).map((id) => PORID.get(String(id))).filter(Boolean)
    const porLinea = [1, 2, 3, 4].map((p) => suyos.filter((j) => j.puesto === p).length)
    const medio = suyos.length ? e.pl / suyos.length : 0
    return `<tr class="${e.mio ? 'mio' : ''}"><td>${esc(e.corto)}</td>${porLinea.map((n) => `<td>${n || '—'}</td>`).join('')}<td><b>${suyos.length}</b></td><td>${eur(medio)}</td></tr>`
  })
  .join(NL)}
</tbody></table></div>
    </div>

    <div class="rejilla">
${tablaTop('Mejor media', 'Con dos partidos o más.', topMedia.map((j) => lineaTop(j, dec(j.media))))}
${tablaTop('Más puntos', '', topPuntos.map((j) => lineaTop(j, String(j.puntos))))}
${tablaTop('Los que más suben', 'Crecimiento del valor en el último mes.', topSube.map((j) => lineaTop(j, `+${Math.round(j.subeMes * 100)} %`)))}
${tablaTop('Los más valiosos', '', topCaros.map((j) => lineaTop(j, corto(j.valor))))}
${tablaTop('Los que más suben hoy', 'Lo que ha cambiado su valor desde ayer.', topHoy.map((j) => lineaTop(j, firmaCorta(j.semana))))}
${tablaTop('Gangas', 'Los más baratos por punto de media, con dos partidos o más.', topGanga.map((j) => lineaTop(j, `${corto(j.precio / j.media)}/pt`)))}
${topClausulazo.length ? tablaTop('Los mejores para clausular', 'Cumplen las tres condiciones —es titular, la prima es barata para lo que rinde y le viene bien el partido— y llegas a pagar su cláusula. Ordenados por lo que cuesta la prima por punto de media.', topClausulazo.map((x) => lineaTop(x.j, `${corto(x.c.porPunto)}/pt`))) : ''}
${topMercado.length ? tablaTop('Los mejores del mercado de hoy', 'De los que están en venta ahora y puedes pagar, los que más lejos quedan de lo que vale alguien que rinde como ellos.', topMercado.map((x) => lineaTop(x.j, `+${corto(x.r.margen)}`))) : ''}
      <h2 class="sh" style="grid-column:1/-1">Los mejores por puesto</h2>
      <p class="sd" style="grid-column:1/-1">Los doce con más media de cada línea, con dos partidos o más. La tira de la derecha es lo que sacó en cada una de sus últimas cinco jornadas, la más reciente a la derecha, con un balón encima por cada gol que marcó ese día. Los penaltis marcados cuentan como gol, que es como los cuenta Mister.</p>
${(() => {
  // Los doce mejores de cada puesto, con lo que sacó cada jornada y los goles
  // de ese día encima.
  //
  // Aquí ponía que Mister solo publica el total de goles y no en qué jornada
  // los metió. Era falso: la casilla de cada jornada trae sus iconos, y de ahí
  // salen los balones de la ventana del jugador. Lo escribí cuando mi lectura
  // de la ficha cortaba el bloque antes de los iconos, y me lo creí.
  const PUESTOS = [
    [1, 'Porteros'],
    [2, 'Defensas'],
    [3, 'Medios'],
    [4, 'Delanteros'],
  ]
  // Junto al nombre va el total de la temporada, que puede ser mayor que los
  // balones de la tira: la tira solo enseña las cinco últimas jornadas.
  const balones = (n) =>
    !n
      ? ''
      : `<span class="goles" title="${n} ${n === 1 ? 'gol' : 'goles'} en toda la temporada">${
          n <= 6 ? '⚽'.repeat(n) : `⚽<b>×${n}</b>`
        }</span>`

  const grupo = ([puesto, titulo]) => {
    const l = J.filter((j) => j.pos === puesto && j.partidos >= 2)
      .sort((a, b) => b.media - a.media || b.puntos - a.puntos)
      .slice(0, CUANTOS_EN_CADA_TOP)
    if (l.length === 0) return ''
    return `      <div class="tarjeta">
        <h3 class="sub2">${titulo}</h3>
        <ol class="mejores">
${l
  .map(
    (j, n) => `          <li>
            <span class="p">${n + 1}</span>
            <span class="n">${caraDe(j.id, j.nombre)}${escudoDe(j.id)}${nombreEnlazado(j)}${balones(j.gol ?? 0)}</span>
            <span class="e">${esc(j.duenioCorto ?? 'libre')}</span>
            <span class="m" title="Puntos de media por partido">${dec(j.media)}</span>
            ${rachaConGoles(j) || pintarRacha(j, true)}
          </li>`,
  )
  .join(NL)}
        </ol>
      </div>`
  }
  return PUESTOS.map(grupo).filter(Boolean).join(NL)
})()}
${tablaTop('Llegan en forma', `Sus últimas ${JORNADAS_DE_FORMA} jornadas comparadas con su propia media. Con dos jornadas o más.`, topForma.map((j) => lineaTop(j, `${j.forma > 0 ? '+' : '−'}${dec(Math.abs(j.forma))}`)))}
${tablaTop('Los más de fiar', 'Los que menos se apartan de su media jornada a jornada, entre los que promedian 4 o más. Un 6, 6, 6 vale más que un 0, 0, 18.', topFiar.map((j) => lineaTop(j, `±${dec(j.regul)}`)))}
    </div>

    <div class="tarjeta">
      <h2 class="sh">Jornada a jornada</h2>
${(() => {
  // Las columnas y el total NO salen del mismo sitio, y ponerlos juntos sin
  // decirlo hacía que pareciera una suma que no cuadra. Las columnas son lo que
  // Mister publicó al cerrar cada jornada; el total es lo que dice hoy, y lo
  // revisa cuando llegan las estadísticas oficiales —a Niutin lo movió de 119 a
  // 166 en una tarde—. Encima, su feed solo publica cuatro cierres: J1, J2, J3
  // y J6. La J4 y la J5 no están ahí, así que no se inventan: se dice que
  // faltan.
  const numeros = JOR.map((j) => j.jornada)
  const ultima = Math.max(...numeros, 0)
  const ausentes = []
  for (let n = 1; n <= ultima; n += 1) if (!numeros.includes(n)) ausentes.push(n)
  const listar = (l) => (l.length === 1 ? `la J${l[0]}` : `las J${l.slice(0, -1).join(', J')} y J${l[l.length - 1]}`)
  return `      <p class="sd">Cada columna es lo que Mister publicó <strong>al cerrar</strong> esa jornada. El total es lo que dice <strong>hoy</strong>, y no tiene por qué ser la suma: lo revisa cuando llegan las estadísticas oficiales.${
    ausentes.length
      ? ` Además, de ${listar(ausentes)} no publicó cierre en su feed, así que ${ausentes.length === 1 ? 'esa jornada no está' : 'esas jornadas no están'} — y no se rellena a ojo.`
      : ''
  }</p>`
})()}
      <div class="tabla-scroll"><table class="jt jornadas"><thead><tr><th>Equipo</th>${JOR.map((j) => `<th>J${j.jornada}</th>`).join('')}<th>Suma</th><th>Total</th><th>Premios</th></tr></thead><tbody>
${[...EQ]
  .sort((a, b) => b.pts - a.pts)
  .map((e) => {
    const suyas = JOR.map((j) => j.equipos.find((x) => x.equipo === e.n))
    const suma = suyas.reduce((t, s) => t + (s ? s.puntos : 0), 0)
    const dif = e.pts - suma
    return `<tr class="${e.mio ? 'mio' : ''}"><td>${esc(e.corto)}</td>${suyas.map((s) => `<td>${s ? s.puntos : '—'}</td>`).join('')}<td class="tenue">${suma}</td><td><b>${e.pts}</b>${
      dif !== 0 ? `<small class="revis" title="Lo que Mister ha añadido o quitado al revisar, o lo que aportan las jornadas que no publicó">${dif > 0 ? '+' : '−'}${Math.abs(dif)}</small>` : ''
    }</td><td class="mas">+${corto(e.pre)}</td></tr>`
  })
  .join(NL)}
</tbody></table></div>
    </div>`

// ── 5. Guía ──────────────────────────────────────────────────────────────────
const def = (marca, clase2, termino, texto) =>
  `<div class="def"><span class="marca-def${clase2 ? ` ${clase2}` : ''}">${marca}</span><dt>${termino}</dt><dd>${texto}</dd></div>`

const guia = `    <div class="tarjeta">
      <h2 class="sh">Qué es esto</h2>
      <p class="sd">Un panel de la liga privada de Mister, reconstruido movimiento a movimiento desde que empezó. Responde a una pregunta: <strong>¿quién puede fichar a quién, y a qué precio?</strong></p>
      <div class="formula">
Todos empezasteis con <b>50.000.000 €</b> menos lo que valía la plantilla que os tocó.<br>
<b>caja</b> = eso + premios + lo vendido − lo fichado<br>
<b>tope de puja</b> = caja + 25 % del valor de tu plantilla
      </div>
      <p class="sd" style="margin-top:13px">Ese 25 % es crédito que Mister fía contra tus jugadores: por eso alguien con poca caja pero buena plantilla puede pujar más de lo que tiene.</p>
    </div>

    <div class="tarjeta">
      <h2 class="sh">Dónde está cada cosa</h2>
      <div class="defs">
        ${def('🛡️', '', 'Mi equipo', 'Lo que ha cambiado desde ayer, el once que deberías poner el domingo, y tu plantilla partida en los que deberías vender, los que deberías blindar y el resto. Marca <strong>vender</strong> en cualquiera y abajo te dice hasta dónde llegarías.')}
        ${def('🔎', '', 'Fichar', 'Los ' + J.length + ' jugadores que conozco, con buscador y filtros. Despliega el <strong>x de y pueden pagar</strong> de cualquiera para ver qué equipos concretos llegan a su precio y con cuánto margen.')}
        ${def('👥', '', 'Rivales', 'Los ocho equipos por capacidad de compra. Al abrir uno: su plantilla entera, sus cuentas y qué ha ganado o perdido con cada jugador.')}
        ${def('⇄', '', 'Movimientos', 'Los ' + MOVS.length + ' fichajes y ventas de la liga en orden, filtrables por compras, ventas o solo los tuyos.')}
        ${def('📊', '', 'Estadísticas', 'Clasificación, quién es más rico, quién blinda a los suyos, quién comercia mejor, récords y los mejores por media, puntos, subida y valor.')}
      </div>
    </div>

    <div class="tarjeta">
      <h2 class="sh">Los iconos</h2>
      <p class="sd">Los dos primeros pueden salir en cualquier jugador. Los dos últimos, solo en los tuyos.</p>
      <div class="defs">
        ${def('⭐', '', 'Va a darte puntos', 'Su media por partido está en el tercio alto de la liga y ha jugado al menos dos partidos.')}
        ${def('💵', '', 'Va a darte dinero', 'Su valor sube esta semana y está entre los que más han crecido en el último mes: comprarlo y revenderlo debería dejar beneficio.')}
        ${def('📤', '', 'Véndelo', 'Ni puntúa ni le sube el valor. Es dinero parado, y en caja te subiría el tope de puja.')}
        ${def('🔒', '', 'Súbele la cláusula', 'Rinde y su cláusula es barata para lo que produce, así que cualquier rival puede llevárselo pagándola.')}
        ${def('7 5 4', 'txt', 'La racha', 'Lo que sacó en cada una de sus últimas jornadas, la más reciente a la derecha. Verde si hizo 8 o más, rojo si hizo cero, y un hueco si no jugó. Es dato de Mister, tal cual.')}
        ${def('5,4', 'txt', 'La cifra grande del once', `Calculada aquí. Se parte de su media <strong>donde le toca jugar</strong> —Mister la publica separada en casa y fuera— y se le suma la mitad de lo que ha mejorado o empeorado de forma, más cuatro décimas por escalón de dureza del rival, con el rival medio como punto neutro. La mitad de la forma y no toda, porque la forma ya es un promedio de jornadas recientes y contarla entera sería contar dos veces lo mismo. Debajo de cada cifra está el desglose.`)}
        ${def('●●●●○', 'txt', 'Lo duro que es el rival', `Sale de los <strong>goles esperados (xG) reales</strong> de cada club esta temporada, no de sus medias en Mister. A un defensa o un portero le importa lo que genera el rival; a un medio o un delantero, lo poco que concede. Se compara con los otros diecinueve y se reparte de uno a cinco: cinco puntos negros es de los más duros para su puesto. Pasa el dedo por encima y te dice la cifra. Los resultados salen de Football-Data.co.uk, que publica cada partido de LaLiga con su xG; si algún día no se pueden bajar, se vuelve a calcular con las medias de Mister y sigue funcionando.`)}
        ${def('🛡', '', 'Ya tiene la cláusula subida', 'La marca morada <b class="cx">×3,0</b> dice a cuántas veces su valor está la cláusula. La base es ×1,5, y cada escalón de medio punto le costó a su dueño el 20 % del valor del jugador. Cuanto más alta, más difícil quitárselo.')}
      </div>
    </div>

    <div class="tarjeta">
      <h2 class="sh">Las palabras</h2>
      <div class="defs">
        ${def('↗', 'txt', 'Llega en forma', `Calculado aquí. Sus últimas ${JORNADAS_DE_FORMA} jornadas frente a <strong>su propia</strong> media, no la de la liga: la pregunta no es si es bueno, sino si está mejor o peor que de costumbre. Hacen falta dos jornadas jugadas.`)}
        ${def('16 M', 'txt', 'Hasta cuánto sale a cuenta', `Calculado aquí. Es <strong>lo que vale en esta liga alguien que rinde como él</strong>: se buscan los jugadores con una media parecida y se toma su valor mediano. Él no cuenta en esa mediana — comparar a alguien consigo mismo daba siempre «te sobran 0», y así salía. Su media va corregida por los partidos que lleva: cuatro partidos no sostienen una media de 11, así que hasta que juegue más tira hacia la media de la liga. Con menos de dos partidos, o si no hay ocho jugadores que rindan como él, no sale ninguna cifra: a alguien sin parecidos no se le puede poner precio comparando, y decir un número sería inventarlo. El techo nunca pasa de tu tope de puja.`)}
        ${def('🎯', 'txt', 'Buen clausulazo', 'Calculado aquí. Lo primero es dejar de mirar la cláusula como el precio: el jugador entra en tu plantilla y, si lo revendes, recuperas su valor. Lo que no vuelve nunca es la diferencia, y esa <strong>prima real</strong> es la cifra sobre la que hay que decidir. Luego hacen falta <strong>las tres</strong> condiciones, porque una sola engaña: que sea titular de verdad (dos partidos de inicio y más de inicio que desde el banquillo), que la prima por punto de media esté por debajo de la mediana de la liga, y que el próximo partido le venga bien —dónde juega y contra quién, sin contar la forma—. Con las tres, «buen clausulazo»; con dos, dudoso; con menos, malo. Aparte se dice si su dueño le ha subido la cláusula: si lo ha hecho, es que le importa.')}
        ${def('±', 'txt', 'De fiar', 'Calculado aquí. Cuánto se aparta de su media jornada a jornada. Dos jugadores de media 6 no valen lo mismo: uno hace 6, 6, 6 y el otro 0, 0, 18. Cuanto más bajo, más de fiar. Solo se listan los que promedian 4 o más, porque al que hace un punto siempre le sobra regularidad.')}
        ${def('€', '', 'Valor y cláusula', 'El <strong>valor</strong> es lo que Mister dice que vale un jugador, y lo que cobras si lo vendes al mercado. La <strong>cláusula</strong> es lo que un rival paga para quitártelo sin tu permiso, y siempre es mayor. La cifra grande de cada fila es <strong>lo que costaría ficharlo de verdad</strong>.')}
        ${def('POR', 'txt', 'Los dorsales de color', 'La posición: <strong>POR</strong> portero, <strong>DEF</strong> defensa, <strong>MED</strong> centrocampista, <strong>DEL</strong> delantero.')}
        ${def('▐', '', 'Las barras de los equipos', 'La parte sólida es dinero en caja; la rayada, el crédito que le da su plantilla. Juntas, lo que puede gastar.')}
      </div>
    </div>

    <div class="tarjeta">
      <h2 class="sh">Lo que no sabe</h2>
      <div class="defs">
        ${def('?', 'txt', 'No conoce a todo LaLiga', `Conoce ${J.length} jugadores: los que han pasado por la liga y los que están hoy en el mercado. Mister no publica un catálogo completo.`)}
        ${def('?', 'txt', 'No sabe qué cuesta blindar', 'El 🔒 dice quién está expuesto, no lo que cuesta subirle la cláusula.')}
        ${def('?', 'txt', 'No adivina el futuro', 'Los iconos son criterios sobre datos publicados. Un jugador puede lesionarse el domingo siguiente.')}
      </div>
    </div>`

// ── Montaje ──────────────────────────────────────────────────────────────────
const plantilla = fs.readFileSync(path.join(AQUI, 'plantilla.html'), 'utf8')
const huecos = {
  __LIGA__: esc(NOMBRE_LIGA),
  '<!--__MARCADOR__-->': marcador,
  '<!--__MIEQUIPO__-->': miEquipo,
  '<!--__OPORTUNIDADES__-->': oportunidades,
  '/*__ISLA_ONCES__*/{}': islaOnces,
  '/*__ISLA_JORNADAS__*/{}': islaJornadas,
  '/*__ISLA_PLANTILLA__*/[]': islaPlantilla,
  '/*__ISLA_FORMACIONES__*/[]': islaFormaciones,
  '<!--__MERCADO__-->': filasMercado,
  '<!--__RESTO__-->': filasResto,
  '<!--__CUANTOS_MERCADO__-->': String(enMercado.length),
  '<!--__CUANTOS_RESTO__-->': String(fueraDelMercado.length),
  '<!--__RIVALES__-->': rivales,
  '<!--__MOVIMIENTOS__-->': movimientos,
  '<!--__NUMEROS__-->': numeros,
  '<!--__GUIA__-->': guia,
  '/*__ESCUDOS__*/': estiloEscudos,
  '<!--__SELLO__-->': `Generado el ${new Date().toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })}.`,
  // La fecha del dato, arriba y a la vista. Una pestaña vieja que el
  // navegador restaura enseña cifras plausibles y de hace días sin decirlo:
  // así se ve de un vistazo si lo que estás mirando es de ahora.
  '<!--__FECHA__-->': new Date().toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  '<!--__GENERADO__-->': YO.generado,
  '<!--__LANZAR__-->': LANZAR,
  '<!--__LANZADOR__-->': LANZADOR,
  '/*__ISLA_FICHAS__*/{}': islaFichas,
  '/*__ISLA_CLUBES__*/{}': islaClubes,
  '/*__ISLA_LIGA__*/{}': islaLiga,
  '<!--__SALDO__-->': String(MIO.saldo),
  '<!--__PLANTILLA__-->': String(MIO.pl),
  '<!--__MIS_JUGADORES__-->': String(MIOS.length),
  '<!--__LIMITE__-->': String(YO.tope || 0),
}
let html = plantilla
for (const [hueco, valor] of Object.entries(huecos)) {
  if (!html.includes(hueco)) throw new Error(`La plantilla no tiene el hueco ${hueco}`)
  html = html.replace(hueco, valor)
}
fs.writeFileSync(SALIDA, html)

console.log(
  JSON.stringify(
    {
      salida: SALIDA,
      jugadores: J.length,
      movimientos: MOVS.length,
      jornadas: JOR.length,
      porPosicion: Object.fromEntries(
        Object.entries(PUESTOS).map(([k, v]) => [v, J.filter((j) => j.puesto === Number(k)).length]),
      ),
      miPlantilla: MIOS.length,
      vender: aVender.map((j) => j.nombre),
      blindar: aBlindar.map((j) => j.nombre),
    },
    null,
    1,
  ),
)
