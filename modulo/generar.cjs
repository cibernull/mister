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
const NOMBRE_LIGA = 'La Liga de Mister'

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
  e.tope = e.saldo + 0.25 * e.pl
  e.corto = e.n.replace(/\s*\(.*\)\s*/, '').trim()
  e.patrimonio = e.saldo + e.pl
  e.sobre50 = e.patrimonio - 50000000
})
const maxTope = Math.max(...EQ.map((e) => e.tope))
const MIO = EQ.find((e) => e.mio)
if (!MIO) throw new Error('No encuentro mi equipo en la tabla de equipos')
const RIVALES = EQ.filter((e) => !e.mio)
const POR_NOMBRE = new Map(EQ.map((e) => [e.n, e]))

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
const nombreEnlazado = (j) =>
  `<a class="jl" href="${fichaEn(j.id, j.nombre)}" target="_blank" rel="noopener" title="Ver su ficha en Mister">${esc(j.nombre)}</a>`

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
const UMBRAL_POR_PUNTO = 1100000 // ≈ el cuartil bajo de la liga en €/punto de media
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
const detalleDe = (j) => {
  const trozos = []
  if (j.eq) trozos.push(club(j.eq))
  if (j.gol) trozos.push(`<span title="goles esta temporada">⚽ ${j.gol}</span>`)
  if (j.tar) trozos.push(`<span title="tarjetas">🟨 ${j.tar}</span>`)
  if (j.mc != null && j.mf != null && j.mc !== j.mf) {
    // Solo cuando difieren: repetir dos veces la misma cifra no dice nada.
    trozos.push(`<span title="media jugando en casa y fuera">casa <b>${dec(j.mc)}</b> · fuera <b>${dec(j.mf)}</b></span>`)
  }
  if (j.tit != null && j.tit + j.sup > 0) {
    trozos.push(`<span title="veces que ha salido de inicio">${j.tit}/${j.tit + j.sup} de inicio</span>`)
  }
  if (j.rival) {
    trozos.push(`<span class="prox">→ ${esc(j.rival)} <i>${j.casa === 1 ? 'en casa' : 'fuera'}</i></span>`)
  }
  return trozos.length ? `<div class="jx">${trozos.join('<span class="sep">·</span>')}</div>` : ''
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
    `z${j.puesto}`,
  ]
    .filter(Boolean)
    .join(' ')
  const pct = j.subeMes != null ? Math.round(j.subeMes * 100) : null
  // Sin la cifra del mes se enseña la del día, que Mister sí da para todos.
  // Antes esta línea se quedaba muda, y un jugador sin tendencia parecía un
  // jugador plano.
  const tendencia =
    pct != null
      ? `<span class="${clase(pct)}">${pct > 0 ? '+' : ''}${pct} % este mes</span>`
      : j.semana
        ? `<span class="${clase(j.semana)}">${firmaCorta(j.semana)} hoy</span>`
        : ''
  const rec = (j.p + j.d) * 1000 + j.media
  return `<div class="${cls}" data-busca="${esc(j.nombre)} ${esc(j.duenioCorto ?? 'libre')} ${PUESTOS_LARGO[j.puesto]}" data-rec="${rec.toFixed(2)}" data-precio="${j.precio}" data-media="${j.media}" data-puntos="${j.puntos}" data-sube="${(j.subeMes ?? -9).toFixed(4)}" data-hoy="${j.semana ?? -9e9}" data-prox="${j.esperado.toFixed(2)}" data-gol="${j.gol ?? 0}">
      ${dorsal(j.puesto)}
      <div class="jn">${nombreEnlazado(j)}${j.mk ? `<span class="et et-mk">${j.ced ? 'se cede' : 'en el mercado'}</span>` : ''}${
        j.duenio
          ? `<span class="et et-eq${j.mio ? ' et-mio' : ''}">${esc(j.duenioCorto)}</span>`
          : '<span class="et et-libre">libre</span>'
      }${marcaBlindaje(j)}${j.once === 1 ? '<span class="et et-once" title="Mister lo da por titular en el próximo partido">👕 titular</span>' : ''}${ESTADOS[j.est] ?? ''}</div>
      <div class="jp"><b class="${etiquetaPrecio(j) === 'cláusula' ? 'cl' : ''}">${eur(j.precio)}</b><i>${etiquetaPrecio(j)}</i><span class="ico">${iconos(j)}</span></div>
      <div class="js">
        <span>media <b>${dec(j.media)}</b></span><span class="sep">·</span>
        <span>${j.puntos} pts en ${j.partidos} part.</span>${
          tendencia ? `<span class="sep">·</span>${tendencia}` : ''
        }${j.precio !== j.valor ? `<span class="sep">·</span><span>vale ${corto(j.valor)}</span>` : ''}
      </div>
      ${detalleDe(j)}
      ${quienPuede(j)}
    </div>`
}

const filasJugadores = J.map(filaJugador).join(NL)
const PORID_PRE = new Map(J.map((j) => [String(j.id), j]))

// ── Marcador ─────────────────────────────────────────────────────────────────
const ico = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const marcador = `  <div class="marcador">
    <div><dt>${ico('<path d="M8 21h8M12 17v4M6 4h12v5a6 6 0 0 1-12 0V4Z"/><path d="M6 6H3v2a3 3 0 0 0 3 3M18 6h3v2a3 3 0 0 1-3 3"/>')} Tu puesto</dt><dd>${MIO.pos}º<small>de ${EQ.length} · ${MIO.pts} pts</small></dd></div>
    <div><dt>${ico('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>')} En caja</dt><dd class="oro">${eur(MIO.saldo)}</dd></div>
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
 * Hasta cuánto puede estar inflada la caja de un rival.
 *
 * Su saldo se reconstruye sumando el feed, y el feed no publica lo que Mister
 * cobra por subir una cláusula. De las subidas que tiene vivas sabemos lo que
 * costarían hoy; lo que no sabemos es cuánto de eso ya estaba descontado. Así
 * que su dinero es un techo, y esto dice de cuánto.
 */
const margenDe = (e) => (e.mio ? 0 : Math.max(0, (e.costeSubidas ?? 0) - (e.gastoVisto ?? 0)))

const avisoClausulas = (e) => {
  if (!e.subidas) return ''
  const cuantos = `${e.subidas} subida${e.subidas === 1 ? '' : 's'} de cláusula en ${e.blindados} jugador${e.blindados === 1 ? '' : 'es'}`
  return e.mio
    ? `<p class="nota-cl">Has pagado <b>${eur(e.costeReal)}</b> por subir cláusulas desde que empezó la liga — ${cuantos} siguen vivas. Sale de tu libro de caja, así que es exacto.</p>`
    : `<p class="nota-cl">${cuantos}. Le habrán costado <b>unos ${eur(e.costeSubidas)}</b>: Mister cobra el 20 % del valor por cada una. Es una estimación al valor de hoy, porque su saldo no lo publica.</p>`
}

const cuentasDe = (e) => `<div class="cuenta">
        <div class="l"><span>Empezó con</span><span>${eur(e.ini)}</span></div>
        <div class="l"><span>Premios de las jornadas</span><span class="mas">+${eur(e.pre)}</span></div>
        <div class="l"><span>Ha vendido por</span><span class="mas">+${eur(e.ven)}</span></div>
        <div class="l"><span>Ha fichado por</span><span class="menos">−${eur(e.com)}</span></div>
        <div class="l tot caja"><span>Le queda en caja</span><span>${eur(e.saldo)}</span></div>${
          margenDe(e) > 0
            ? `<div class="l sub-caja"><span>…o hasta ${eur(margenDe(e))} menos</span><span>lo que haya pagado por blindar</span></div>`
            : ''
        }
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
    (j) => `        <div class="mj">${dorsal(j.puesto)}${escudoDe(j.id)}<span class="n">${j.nombre ? nombreEnlazado(j) : `<a class="jl" href="${fichaEn(j.id, j.id)}" target="_blank" rel="noopener"><em class="desc">jugador ${esc(j.id)}</em></a>`}</span>
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
      `<tr><td>${escudoDe(j.id)}${esc(j.nombre)}${j.delReparto ? '<span class="et-rep">del reparto</span>' : ''}</td><td>${cel(j.compras)}</td><td>${cel(j.ventas)}</td><td>${cel(j.valeHoy)}</td><td class="${j.balance > 0 ? 'mas' : j.balance < 0 ? 'menos' : ''}">${firma(j.balance)}</td></tr>`,
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
  const pct = j.subeMes != null ? Math.round(j.subeMes * 100) : null
  // Sin la cifra del mes se enseña la del día, que Mister sí da para todos.
  // Antes esta línea se quedaba muda, y un jugador sin tendencia parecía un
  // jugador plano.
  const tendencia =
    pct != null
      ? `<span class="${clase(pct)}">${pct > 0 ? '+' : ''}${pct} % este mes</span>`
      : j.semana
        ? `<span class="${clase(j.semana)}">${firmaCorta(j.semana)} hoy</span>`
        : ''
  const pago = MIS_MOVS[String(j.id)] ? MIS_MOVS[String(j.id)].compras : 0
  const grande = modo === 'clausula' ? j.clausula : j.valor
  const rotulo = modo === 'clausula' ? 'te lo quitan por' : modo === 'venta' ? 'te darían' : 'vale'
  const trato = pago
    ? `pagaste ${corto(pago)}, <b class="${clase(j.valor - pago)}">${firmaCorta(j.valor - pago)}</b>`
    : 'del reparto'
  return `<div class="fj">
      ${dorsal(j.puesto)}
      <div class="jn">${nombreEnlazado(j)}${j.mk ? '<span class="et et-mk">en venta</span>' : ''}${marcaBlindaje(j)}${j.eq ? club(j.eq) : ''}<label class="sel" title="Simular que lo vendes"><input type="checkbox" class="vender" data-valor="${j.valor}" data-nombre="${esc(j.nombre)}"><span>vender</span></label></div>
      <div class="jp"><b class="${modo === 'clausula' ? 'cl' : ''}">${eur(grande)}</b><i>${rotulo}</i><span class="ico">${iconos(j)}</span></div>
      <div class="js">
        <span>media <b>${dec(j.media)}</b></span><span class="sep">·</span>
        <span>${j.puntos} pts en ${j.partidos} part.</span>${
          pct != null ? `<span class="sep">·</span><span class="${clase(pct)}">${pct > 0 ? '+' : ''}${pct} %</span>` : ''
        }<span class="sep">·</span><span>${trato}</span>
      </div>
      ${modo === 'clausula' ? quienPuede(j) : ''}${
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
    ? `    <section class="sec">
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
const DOS_DIAS = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 2)
  return d.toISOString().slice(0, 10)
})()

const nombreDe = (id) => PORID_PRE.get(String(id))?.nombre ?? `jugador ${id}`
const esMio = (equipo) => equipo === MI_EQUIPO

const lineaNov = (icono, texto, tono) =>
  `        <li class="nov${tono ? ` ${tono}` : ''}"><span class="ni">${icono}</span><span>${texto}</span></li>`

const novedades = (() => {
  const filas = []

  for (const m of MOVS.filter((x) => x.fecha.slice(0, 10) >= DOS_DIAS).reverse()) {
    const de = m.de ? POR_NOMBRE.get(m.de)?.corto ?? m.de : 'mercado'
    const a = m.a ? POR_NOMBRE.get(m.a)?.corto ?? m.a : 'mercado'
    const mio = esMio(m.de) || esMio(m.a)
    filas.push(
      lineaNov(
        m.a ? '📥' : '📤',
        `${escudoDe(m.id)}<b>${esc(m.nombre)}</b> ${m.de ? 'de' : 'del'} ${esc(de)} ${m.a ? 'a' : 'al'} ${esc(a)} por ${eur(m.importe)}`,
        mio ? 'mio' : '',
      ),
    )
  }

  for (const n of NOV) {
    if (n.tipo === 'clausula') {
      filas.push(
        lineaNov(
          '🛡',
          `${escudoDe(n.id)}<b>${esc(nombreDe(n.id))}</b>: ${esc(POR_NOMBRE.get(n.equipo)?.corto ?? n.equipo)} le subió la cláusula a ${eur(n.clausula)}, y le costó ${eur(n.coste)}`,
          esMio(n.equipo) ? 'mio' : '',
        ),
      )
    } else if (n.tipo === 'lesion') {
      filas.push(lineaNov('🏥', `${escudoDe(n.id)}<b>${esc(nombreDe(n.id))}</b> se ha lesionado`, esMio(n.equipo) ? 'malo' : ''))
    } else if (n.tipo === 'alta') {
      filas.push(lineaNov('✅', `${escudoDe(n.id)}<b>${esc(nombreDe(n.id))}</b> ya está disponible`, ''))
    } else if (n.tipo === 'mercado' && n.entra) {
      filas.push(lineaNov('🏷', `${escudoDe(n.id)}<b>${esc(nombreDe(n.id))}</b> ha salido al mercado`, ''))
    }
  }

  if (filas.length === 0) return ''
  return `    <section class="sec">
      <h2 class="sh"><span class="se">🔔</span>Desde ayer <em>${filas.length}</em></h2>
      <ul class="novs">
${filas.slice(0, 25).join(NL)}
      </ul>
      ${filas.length > 25 ? `<p class="pie">Y ${filas.length - 25} más.</p>` : ''}
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
const esperadoDe = (j) => {
  const donde = j.casa === 1 ? j.mc : j.casa === 0 ? j.mf : null
  return donde != null ? donde : j.media
}
const once = (() => {
  if (FORMACION.length !== 4) return null
  const elegidos = []
  const banquillo = []
  FORMACION.forEach((cuantos, i) => {
    const puesto = i + 1
    const candidatos = MIOS.filter((j) => j.puesto === puesto)
      // Primero los que Mister da por titulares; entre ellos, el que más rinda
      // donde juega. Un lesionado no entra aunque sea el mejor.
      .sort(
        (a, b) =>
          (b.est === 'injury' ? -1 : 1) - (a.est === 'injury' ? -1 : 1) ||
          (b.once === 1 ? 1 : 0) - (a.once === 1 ? 1 : 0) ||
          esperadoDe(b) - esperadoDe(a),
      )
    elegidos.push(...candidatos.slice(0, cuantos).map((j) => ({ ...j, hueco: cuantos > candidatos.length })))
    banquillo.push(...candidatos.slice(cuantos))
  })
  return { elegidos, banquillo: banquillo.sort((a, b) => esperadoDe(b) - esperadoDe(a)) }
})()

const filaOnce = (j) => `        <div class="mj">${dorsal(j.puesto)}${escudoDe(j.id)}<span class="n">${nombreEnlazado(j)}</span>
          <span class="v">${dec(esperadoDe(j))}</span><span class="c">${
            j.riv ? `${j.casa === 1 ? 'en casa' : 'fuera'} · ${esc(CLUBES.get(String(j.riv)) ?? '?')}` : 'sin partido'
          }</span><span class="m">${
            j.est === 'injury' ? '🏥 lesionado' : j.once === 1 ? '👕 titular' : j.once === 0 ? 'suplente' : '—'
          }</span></div>`

const bloqueOnce = once === null || once.elegidos.length === 0
  ? ''
  : `    <section class="sec">
      <h2 class="sh"><span class="se">👕</span>El once del domingo <em>${YO.formacion}</em></h2>
      <p class="sd">Los que más deberían darte según Mister: su media <strong>donde les toca jugar</strong> esta jornada, y solo contando a los que da por titulares. La cifra grande es lo que cabe esperar de cada uno.${
        once.elegidos.filter((j) => j.est === 'injury').length
          ? ' <strong>Ojo:</strong> hay lesionados en el once porque no tienes recambio en su puesto.'
          : ''
      }</p>
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

const miEquipo = `${novedades}${bloqueOnce}${bloque(
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
      <div class="mn">${escudoDe(m.id)}${nombreEnlazado(m)}${OPS[m.tipo] ? `<span class="et et-op">${OPS[m.tipo]}</span>` : ''}</div>
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

const riqueza = [...EQ]
  .sort((a, b) => b.patrimonio - a.patrimonio)
  .map(
    (e) => `        <div class="ranking${e.mio ? ' mio' : ''}">
          <span class="pos">${e.pos}º</span><span class="nom">${esc(e.corto)}</span>
          <span class="bar doble"><i class="caja" style="width:${((e.saldo / maxPatrimonio) * 100).toFixed(1)}%" title="caja ${eur(e.saldo)}"></i><i class="plant" style="width:${((e.pl / maxPatrimonio) * 100).toFixed(1)}%" title="plantilla ${eur(e.pl)}"></i></span>
          <span class="val">${corto(e.patrimonio)}</span>
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
  `          <li><span class="d">${dorsal(j.puesto)}</span><span class="n">${escudoDe(j.id)}${esc(j.nombre)}</span><span class="e">${esc(j.duenioCorto ?? 'libre')}</span><span class="v">${valor}</span></li>`

const conPartidos = J.filter((j) => j.partidos >= 2)
const topMedia = [...conPartidos].sort((a, b) => b.media - a.media).slice(0, 8)
const topPuntos = [...J].sort((a, b) => b.puntos - a.puntos).slice(0, 8)
const topSube = [...J].filter((j) => j.subeMes != null).sort((a, b) => b.subeMes - a.subeMes).slice(0, 8)
const topCaros = [...J].sort((a, b) => b.valor - a.valor).slice(0, 8)
const topHoy = [...J].filter((j) => j.semana != null && j.semana !== 0).sort((a, b) => b.semana - a.semana).slice(0, 8)
// Lo que cuesta cada punto de media: la forma más directa de ver qué sale a cuenta.
const topGanga = [...conPartidos].filter((j) => j.media > 0).sort((a, b) => a.precio / a.media - b.precio / b.media).slice(0, 8)

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
      <p class="sd">Patrimonio = caja + plantilla. La parte <span class="clave caja">llena</span> es dinero disponible; la <span class="clave plant">clara</span>, jugadores. Todos empezasteis en 50 M.</p>
      <div class="rankings">
${riqueza}
      </div>
    </div>

    <div class="tarjeta">
      <h2 class="sh">Quién blinda a los suyos</h2>
      <p class="sd">Subir una cláusula cuesta el <strong>20 % del valor</strong> del jugador. Son las subidas que siguen vivas hoy. Tu cifra sale de tu libro de caja y es exacta; la de los rivales es una estimación al valor de hoy, porque Mister no publica sus saldos.</p>
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
${record('Fichaje más caro', `${escudoDe(masCaro.id)}${esc(masCaro.nombre)} · ${eur(masCaro.importe)}`, `Lo fichó ${esc(POR_NOMBRE.get(masCaro.a)?.corto ?? masCaro.a ?? 'el mercado')} el ${dia(masCaro.fecha)}.`, '')}
${record('El mejor negocio', `${escudoDe(mejorNegocio.id)}${esc(mejorNegocio.nombre)} · ${firma(mejorNegocio.bal)}`, `De ${esc(mejorNegocio.equipo?.corto ?? '—')}, contando lo que vale hoy.`, 'bien')}
${record('El peor negocio', `${escudoDe(peorNegocio.id)}${esc(peorNegocio.nombre)} · ${firma(peorNegocio.bal)}`, `De ${esc(peorNegocio.equipo?.corto ?? '—')}, contando lo que vale hoy.`, 'mal')}
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
    </div>

    <div class="tarjeta">
      <h2 class="sh">Jornada a jornada</h2>
      <div class="tabla-scroll"><table class="jt jornadas"><thead><tr><th>Equipo</th>${JOR.map((j) => `<th>J${j.jornada}</th>`).join('')}<th>Total</th><th>Premios</th></tr></thead><tbody>
${[...EQ]
  .sort((a, b) => b.pts - a.pts)
  .map((e) => {
    const suyas = JOR.map((j) => j.equipos.find((x) => x.equipo === e.n))
    return `<tr class="${e.mio ? 'mio' : ''}"><td>${esc(e.corto)}</td>${suyas.map((s) => `<td>${s ? s.puntos : '—'}</td>`).join('')}<td><b>${e.pts}</b></td><td class="mas">+${corto(e.pre)}</td></tr>`
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
        ${def('🛡', '', 'Ya tiene la cláusula subida', 'La marca morada <b class="cx">×3,0</b> dice a cuántas veces su valor está la cláusula. La base es ×1,5, y cada escalón de medio punto le costó a su dueño el 20 % del valor del jugador. Cuanto más alta, más difícil quitárselo.')}
      </div>
    </div>

    <div class="tarjeta">
      <h2 class="sh">Las palabras</h2>
      <div class="defs">
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
  '<!--__JUGADORES__-->': filasJugadores,
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
