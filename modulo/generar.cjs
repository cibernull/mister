#!/usr/bin/env node
// Genera el módulo (una página) a partir de los datos del motor contable.
//   node modulo/generar.cjs [salida.html]
'use strict'
const fs = require('fs')
const path = require('path')

const AQUI = __dirname
const DAT = path.join(AQUI, 'datos')
const SALIDA = process.argv[2] || path.join(AQUI, '..', 'datos', 'mercado.html')
const MI_EQUIPO = 'Niutin FC (Isaac)'
const NOMBRE_LIGA = 'La Liga de Niutin'

const leer = (n) => JSON.parse(fs.readFileSync(path.join(DAT, n), 'utf8'))
const J = leer('jugadores-calc.json')
const CL = new Map(leer('clausulas.json').map(([id, k]) => [String(id), k * 1000]))
const D = leer('datos-liga.json')
const PL = leer('plantillas.json')
const EQ = leer('equipos.json')

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

// Valor de mercado de hoy. jugadores-calc manda sobre el volcado general.
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
const TOPE_MIO = MIO.tope
const RIVALES = EQ.filter((e) => !e.mio)

const eur = (n) => `${Math.round(n).toLocaleString('es-ES')} €`
// Cifras redondas para donde manda el vistazo, no el céntimo.
const corto = (n) => {
  const m = Math.round(n)
  if (Math.abs(m) >= 1000000) return `${(m / 1000000).toFixed(m % 1000000 === 0 ? 0 : 1).replace('.', ',')} M`
  if (Math.abs(m) >= 1000) return `${Math.round(m / 1000)} K`
  return String(m)
}
const firma = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + eur(Math.abs(n))
const dec = (n) => (n || 0).toFixed(1).replace('.', ',')
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const NL = '\n'

const PUESTOS = { 0: '—', 1: 'POR', 2: 'DEF', 3: 'MED', 4: 'DEL' }
const PUESTOS_LARGO = { 0: 'sin posición', 1: 'portero', 2: 'defensa', 3: 'centrocampista', 4: 'delantero' }

// ── Jugadores ────────────────────────────────────────────────────────────────
for (const j of J) {
  j.clausula = CL.get(String(j.id)) ?? null
  j.duenio = DUENIO.get(String(j.id)) ?? null
  j.duenioCorto = j.duenio ? j.duenio.replace(/\s*\(.*\)\s*/, '').trim() : null
  j.mio = j.duenio === MI_EQUIPO ? 1 : 0
  // Precio efectivo: cláusula si tiene dueño, valor si está libre.
  j.precio = j.clausula ?? j.valor
  j.a = j.precio <= TOPE_MIO ? 1 : 0
  j.pueden = EQ.filter((e) => e.tope >= j.precio).length
  j.rivalesQuePueden = RIVALES.filter((e) => e.tope >= j.precio).length
  j.subeMes = j.mes != null && j.valor ? j.mes / j.valor : null
  j.puesto = j.pos ?? 0
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
  if (!j.mio) continue

  const parado = j.subeMes != null && j.subeMes < 0.25
  const noRinde = j.partidos === 0 || j.media < 5
  if (noRinde && parado) {
    j.vender = 1
    // Un jugador puede llevar ⭐ y 📤 a la vez: la estrella dice que su media
    // está en el tercio alto de la liga, y 📤 dice que para lo que cuesta no
    // compensa tenerlo parado. No es una contradicción, pero hay que decirlo.
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
    j.razon = barato
      ? `su cláusula sale a ${eur(porPunto)} por punto de media, una ganga para lo que rinde`
      : 'su cláusula está en el mínimo: nunca la has subido'
  }
}

J.sort((a, b) => b.p + b.d - (a.p + a.d) || b.media - a.media || b.valor - a.valor)

/** Tira de cuadraditos: cuántos equipos llegan a pagar ese precio. */
const tira = (llegan, total) =>
  `<span class="puede"><span class="tira" role="img" aria-label="${llegan} de ${total} pueden pagarlo">${Array.from(
    { length: total },
    (_, i) => `<i class="${i < llegan ? 'on' : ''}"></i>`,
  ).join('')}</span><em>${llegan}/${total}</em></span>`

const iconos = (j) =>
  `${j.p ? '⭐' : ''}${j.d ? '💵' : ''}${j.vender ? '📤' : ''}${j.blindar ? '🔒' : ''}`

const filas = J.map((j) => {
  const cls = [
    'fj',
    j.mk ? 'mk' : 'nomk',
    j.p ? 'tp' : '',
    j.d ? 'td' : '',
    j.a ? 'ta' : '',
    j.duenio ? (j.mio ? 'tmio' : 'triv') : 'tl',
    `z${j.puesto}`,
  ]
    .filter(Boolean)
    .join(' ')
  const pct = j.subeMes != null ? Math.round(j.subeMes * 100) : null
  const etiquetaEquipo = j.duenio
    ? `<span class="et et-eq${j.mio ? ' et-mio' : ''}">${esc(j.duenioCorto)}</span>`
    : '<span class="et et-libre">libre</span>'
  // Ordenar por «recomendados» tiene que dar lo mismo que el orden de partida.
  const rec = (j.p + j.d) * 1000 + j.media
  return `<div class="${cls}" data-busca="${esc(j.nombre)} ${esc(j.duenioCorto ?? 'libre')} ${PUESTOS_LARGO[j.puesto]}" data-rec="${rec.toFixed(2)}" data-precio="${j.precio}" data-media="${j.media}" data-puntos="${j.puntos}" data-sube="${(j.subeMes ?? -9).toFixed(4)}">
      <span class="dorsal p${j.puesto}" title="${PUESTOS_LARGO[j.puesto]}">${PUESTOS[j.puesto]}</span>
      <div class="jn">${esc(j.nombre)}${j.mk ? '<span class="et et-mk">en venta</span>' : ''}${etiquetaEquipo}</div>
      <div class="jp">
        <b class="${j.clausula ? 'cl' : ''}">${eur(j.precio)}</b>
        <i>${j.clausula ? 'cláusula' : 'valor'}</i>
        <span class="ico">${iconos(j)}</span>
      </div>
      <div class="js">
        <span>media <b>${dec(j.media)}</b></span><span class="sep">·</span>
        <span>${j.puntos} pts en ${j.partidos} part.</span>${
          pct != null
            ? `<span class="sep">·</span><span class="${pct > 0 ? 'sube' : pct < 0 ? 'baja' : ''}">${pct > 0 ? '+' : ''}${pct} % este mes</span>`
            : ''
        }${j.clausula ? `<span class="sep">·</span><span>vale ${corto(j.valor)}</span>` : ''}
        <span class="sep">·</span>${j.mio ? tira(j.rivalesQuePueden, RIVALES.length) : tira(j.pueden, EQ.length)}
      </div>
    </div>`
}).join(NL)

// ── Marcador propio ──────────────────────────────────────────────────────────
const ico = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const marcador = `  <div class="marcador">
    <div><dt>${ico('<path d="M8 21h8M12 17v4M6 4h12v5a6 6 0 0 1-12 0V4Z"/><path d="M6 6H3v2a3 3 0 0 0 3 3M18 6h3v2a3 3 0 0 1-3 3"/>')} Tu puesto</dt><dd>${MIO.pos}º<small>de ${EQ.length} · ${MIO.pts} pts</small></dd></div>
    <div><dt>${ico('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>')} En caja</dt><dd class="oro">${eur(MIO.saldo)}</dd></div>
    <div><dt>${ico('<path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h6v6"/>')} Tope de puja</dt><dd>${eur(MIO.tope)}</dd></div>
    <div><dt>${ico('<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>')} Sobre los 50 M</dt><dd class="${MIO.sobre50 > 0 ? 'sube' : 'baja'}">${firma(MIO.sobre50)}</dd></div>
  </div>`

// ── Mi equipo ────────────────────────────────────────────────────────────────
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
  const pago = MIS_MOVS[String(j.id)] ? MIS_MOVS[String(j.id)].compras : 0
  const grande = modo === 'clausula' ? j.clausula : j.valor
  const rotulo = modo === 'clausula' ? 'te lo quitan por' : modo === 'venta' ? 'te darían' : 'vale'
  const trato = pago
    ? `pagaste ${corto(pago)}, <b class="${j.valor >= pago ? 'sube' : 'baja'}">${firma(j.valor - pago)}</b>`
    : 'del reparto'
  return `<div class="fj">
      <span class="dorsal p${j.puesto}" title="${PUESTOS_LARGO[j.puesto]}">${PUESTOS[j.puesto]}</span>
      <div class="jn">${esc(j.nombre)}${j.mk ? '<span class="et et-mk">en venta</span>' : ''}</div>
      <div class="jp">
        <b class="${modo === 'clausula' ? 'cl' : ''}">${eur(grande)}</b><i>${rotulo}</i>
        <span class="ico">${iconos(j)}</span>
      </div>
      <div class="js">
        <span>media <b>${dec(j.media)}</b></span><span class="sep">·</span>
        <span>${j.puntos} pts en ${j.partidos} part.</span>${
          pct != null ? `<span class="sep">·</span><span class="${pct > 0 ? 'sube' : 'baja'}">${pct > 0 ? '+' : ''}${pct} %</span>` : ''
        }<span class="sep">·</span><span>${trato}</span>${
          modo === 'clausula' ? `<span class="sep">·</span>${tira(j.rivalesQuePueden, RIVALES.length)}` : ''
        }
      </div>${
        j.razon
          ? `<div class="jr">${
              j.vender
                ? `📤 <b>Véndelo:</b> ${esc(j.razon)}. Solo con él, tu tope de puja pasaría a ${eur(topeTrasVender(j.valor))}.`
                : `🔒 <b>Súbele la cláusula:</b> ${esc(j.razon)}.`
            }</div>`
          : ''
      }
    </div>`
}

const seccion = (icono, titulo, desc, lista, modo) =>
  lista.length
    ? `    <div class="sec">
      <h2 class="sh">${icono ? `<span class="se">${icono}</span>` : ''}${titulo} <em>${lista.length}</em></h2>
      <p class="sd">${desc}</p>
      <div class="lista">
${lista.map((j) => filaMia(j, modo)).join(NL)}
      </div>
    </div>`
    : ''

const aVender = MIOS.filter((j) => j.vender).sort((a, b) => b.valor - a.valor)
const aBlindar = MIOS.filter((j) => j.blindar).sort((a, b) => a.clausula / a.media - b.clausula / b.media)
const resto = MIOS.filter((j) => !j.vender && !j.blindar).sort((a, b) => b.valor - a.valor)
const sumaVenta = aVender.reduce((s, j) => s + j.valor, 0)

const miEquipo = `${seccion(
  '📤',
  'Deberías vender',
  aVender.length
    ? `Dinero parado: ni te dan puntos ni les sube el valor. Vendiendo los ${aVender.length} entrarían <strong>${eur(sumaVenta)}</strong> en caja y tu tope de puja pasaría de ${eur(MIO.tope)} a <strong>${eur(topeTrasVender(sumaVenta))}</strong>.`
    : '',
  aVender,
  'venta',
)}
${seccion(
  '🔒',
  'Deberías blindar',
  'Rinden, y su cláusula es barata para lo que producen: cualquier rival puede llevárselos pagándola. Subírsela es lo que lo evita.',
  aBlindar,
  'clausula',
)}
${seccion('', 'El resto de tu plantilla', 'Ni urge venderlos ni están especialmente expuestos.', resto, 'valor')}`

// ── Equipos ──────────────────────────────────────────────────────────────────
const filasEq = [...EQ]
  .sort((a, b) => b.tope - a.tope)
  .map((e) => {
    const d = (D.porEquipo || {})[e.n] || { movimientos: [], porJugador: {} }
    const js = Object.entries(d.porJugador)
      .map(([id, x]) => {
        const loTiene = DUENIO.get(String(id)) === e.n
        const valeHoy = loTiene ? VALOR.get(String(id)) : null
        if (loTiene && valeHoy == null) throw new Error(`Sin valor de hoy para ${x.nombre} (${id}), que sigue en ${e.n}`)
        return {
          ...x,
          valeHoy,
          // Lo que este jugador le ha dejado: lo cobrado más lo que vale si lo
          // conserva, menos lo pagado. Un fichaje que aún tiene en plantilla no
          // es una pérdida: es dinero convertido en jugador.
          balance: x.ventas + (valeHoy ?? 0) - x.compras,
          delReparto: x.compras === 0,
        }
      })
      .sort((a, b) => b.balance - a.balance)

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
    const tabla = js.length
      ? `<div class="tabla-scroll"><table class="jt"><thead><tr><th>Jugador</th><th>Pagó</th><th>Cobró</th><th>Vale hoy</th><th>Balance</th></tr></thead><tbody>
${js
  .map(
    (j) =>
      `<tr><td>${esc(j.nombre)}${j.delReparto ? '<span class="et-rep">del reparto</span>' : ''}</td><td>${cel(j.compras)}</td><td>${cel(j.ventas)}</td><td>${cel(j.valeHoy)}</td><td class="${j.balance > 0 ? 'mas' : j.balance < 0 ? 'menos' : ''}">${firma(j.balance)}</td></tr>`,
  )
  .join(NL)}
<tr class="sum"><td>${js.length} jugador${js.length === 1 ? '' : 'es'}</td><td>${cel(tot.compras)}</td><td>${cel(tot.ventas)}</td><td>${cel(tot.valeHoy)}</td><td class="${tot.balance > 0 ? 'mas' : 'menos'}">${firma(tot.balance)}</td></tr>
</tbody></table></div>${hayReparto ? '<p class="pie">«Del reparto» son los que le tocaron al empezar: no pagó nada por ellos, así que aquí todo lo cobrado cuenta entero. Por eso este total supera la ganancia real de arriba: los del reparto ya valían dinero el día del reinicio.</p>' : ''}`
      : '<p class="vacio2">No ha hecho ningún movimiento.</p>'

    // La barra descompone el tope: lo sólido es caja, lo rayado es el 25 % de
    // la plantilla. Se ve de un vistazo quién tiene dinero de verdad y quién
    // lo tiene metido en jugadores.
    const anchoCaja = ((e.saldo / maxTope) * 100).toFixed(1)
    const anchoCred = (((0.25 * e.pl) / maxTope) * 100).toFixed(1)

    return `<details class="eq${e.mio ? ' yo' : ''}">
    <summary>
      <span class="puesto">${e.pos}º</span>
      <div class="eqn">${esc(e.corto)}${e.mio ? '<span class="et et-eq et-mio">tú</span>' : ''}</div>
      <div class="eqp"><b>${eur(e.tope)}</b><i>puede gastar</i></div>
      <div class="poder">
        <span class="barra"><span class="caja" style="width:${anchoCaja}%"></span><span class="credito" style="width:${anchoCred}%"></span></span>
        <small>${corto(e.saldo)} en caja + ${corto(0.25 * e.pl)} de su plantilla</small>
      </div>
    </summary>
    <div class="cuerpo">
      <p class="frase">Va <strong>${e.pos}º con ${e.pts} puntos</strong> y su plantilla vale ${eur(e.pl)}.</p>
      <div class="cuenta">
        <div class="l"><span>Empezó con</span><span>${eur(e.ini)}</span></div>
        <div class="l"><span>Premios de las jornadas</span><span class="mas">+${eur(e.pre)}</span></div>
        <div class="l"><span>Ha vendido por</span><span class="mas">+${eur(e.ven)}</span></div>
        <div class="l"><span>Ha fichado por</span><span class="menos">−${eur(e.com)}</span></div>
        <div class="l tot caja"><span>Le queda en caja</span><span>${eur(e.saldo)}</span></div>
        <div class="l"><span>Más su plantilla, que vale</span><span>${eur(e.pl)}</span></div>
        <div class="l tot"><span>Patrimonio hoy</span><span>${eur(e.patrimonio)}</span></div>
        <div class="l"><span>Sobre los 50.000.000 € de salida</span><span class="${e.sobre50 > 0 ? 'mas' : 'menos'}">${firma(e.sobre50)}</span></div>
      </div>
      ${tabla}
    </div>
  </details>`
  })
  .join(NL)

// ── Guía ─────────────────────────────────────────────────────────────────────
const def = (marca, clase, termino, texto) =>
  `<div class="def"><span class="marca-def${clase ? ` ${clase}` : ''}">${marca}</span><dt>${termino}</dt><dd>${texto}</dd></div>`

const guia = `    <div class="guia">
      <h2>Qué es esto</h2>
      <p>Un panel de la liga privada de Mister, reconstruido movimiento a movimiento desde que empezó. Sirve para responder a una pregunta: <strong>¿quién puede fichar a quién, y a qué precio?</strong></p>
      <div class="formula">
Todos empezasteis con <b>50.000.000 €</b> menos lo que valía la plantilla que os tocó.<br>
<b>caja</b> = eso + premios + lo vendido − lo fichado<br>
<b>tope de puja</b> = caja + 25 % del valor de tu plantilla
      </div>
      <p style="margin:13px 0 0">Ese 25 % es crédito que Mister fía contra tus jugadores: por eso alguien con poca caja pero buena plantilla puede pujar más de lo que tiene. En la pestaña <strong>Equipos</strong>, la parte sólida de cada barra es la caja y la rayada ese crédito.</p>
    </div>

    <div class="guia">
      <h2>Los iconos</h2>
      <p>Los dos primeros pueden salir en cualquier jugador. Los dos últimos, solo en los tuyos.</p>
      <div class="defs">
        ${def('⭐', '', 'Va a darte puntos', 'Su media por partido está en el tercio alto de la liga y ha jugado al menos dos partidos.')}
        ${def('💵', '', 'Va a darte dinero', 'Su valor sube esta semana y está entre los que más han crecido en el último mes: comprarlo y revenderlo debería dejar beneficio.')}
        ${def('📤', '', 'Véndelo', 'Ni puntúa ni le sube el valor. Es dinero parado, y en caja te subiría el tope de puja.')}
        ${def('🔒', '', 'Súbele la cláusula', 'Rinde y su cláusula es barata para lo que produce, así que cualquier rival puede llevárselo pagándola.')}
      </div>
    </div>

    <div class="guia">
      <h2>Las palabras</h2>
      <div class="defs">
        ${def('€', '', 'Valor y cláusula', 'El <strong>valor</strong> es lo que Mister dice que vale un jugador, y es lo que cobras si lo vendes al mercado. La <strong>cláusula</strong> es lo que un rival tiene que pagarte para quitártelo sin tu permiso, y siempre es mayor. En la lista, la cifra grande es <strong>lo que costaría ficharlo de verdad</strong>: la cláusula si tiene dueño, el valor si está libre.')}
        ${def('▐', '', 'La tira de cuadraditos', `Cuántos de los ${EQ.length} equipos llegan a pagar ese precio hoy. En tus jugadores cuenta solo a los ${RIVALES.length} rivales, que es lo que importa cuando el jugador ya es tuyo.`)}
        ${def('POR', 'txt', 'Los dorsales de color', 'La posición del jugador: <strong>POR</strong> portero, <strong>DEF</strong> defensa, <strong>MED</strong> centrocampista, <strong>DEL</strong> delantero.')}
      </div>
    </div>

    <div class="guia">
      <h2>Lo que no sabe</h2>
      <div class="defs">
        ${def('?', 'txt', 'No conoce a todo LaLiga', `Conoce ${J.length} jugadores: los que han pasado por la liga y los que están hoy en el mercado. Mister no publica un catálogo completo.`)}
        ${def('?', 'txt', 'No sabe qué cuesta blindar', 'El 🔒 dice quién está expuesto, no lo que cuesta subirle la cláusula.')}
        ${def('?', 'txt', 'No adivina el futuro', 'Los iconos son criterios sobre datos publicados. Un jugador puede lesionarse o dejar de jugar el domingo siguiente.')}
      </div>
    </div>`

// ── Montaje ──────────────────────────────────────────────────────────────────
const plantilla = fs.readFileSync(path.join(AQUI, 'plantilla.html'), 'utf8')
const html = plantilla
  .replace('__LIGA__', esc(NOMBRE_LIGA))
  .replace('<!--__MARCADOR__-->', marcador)
  .replace('<!--__JUGADORES__-->', filas)
  .replace('<!--__EQUIPOS__-->', filasEq)
  .replace('<!--__MIEQUIPO__-->', miEquipo)
  .replace('<!--__GUIA__-->', guia)
  .replace(
    '<!--__SELLO__-->',
    `Generado el ${new Date().toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })}.`,
  )
for (const hueco of ['__LIGA__', '__MARCADOR__', '__JUGADORES__', '__EQUIPOS__', '__MIEQUIPO__', '__GUIA__', '__SELLO__']) {
  if (html.includes(hueco)) throw new Error(`El hueco ${hueco} se quedó sin rellenar`)
}
fs.writeFileSync(SALIDA, html)

console.log(
  JSON.stringify(
    {
      salida: SALIDA,
      jugadores: J.length,
      conClausula: J.filter((j) => j.clausula).length,
      conDuenio: J.filter((j) => j.duenio).length,
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
