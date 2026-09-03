#!/usr/bin/env node
// Genera el módulo de mercado (un HTML sin JavaScript) a partir de los datos
// del motor contable.  Uso: node modulo/generar.cjs [salida.html]
'use strict'
const fs = require('fs')
const path = require('path')

const AQUI = __dirname
const DAT = path.join(AQUI, 'datos')
const SALIDA = process.argv[2] || path.join(AQUI, '..', 'datos', 'mercado.html')
const MI_EQUIPO = 'Niutin FC (Isaac)'

const leer = n => JSON.parse(fs.readFileSync(path.join(DAT, n), 'utf8'))
const J = leer('jugadores-calc.json')
const CL = new Map(leer('clausulas.json').map(([id, k]) => [String(id), k * 1000]))
const D = leer('datos-liga.json')
const PL = leer('plantillas.json')

// Dueño actual de cada jugador.  Un jugador solo puede estar en una plantilla:
// si aparece en dos, la captura está mal y prefiero enterarme a taparlo.
const DUENIO = new Map()
for (const [eq, ids] of Object.entries(PL)) {
  for (const id of ids) {
    const previo = DUENIO.get(String(id))
    if (previo) throw new Error(`El jugador ${id} está en dos plantillas: ${previo} y ${eq}`)
    DUENIO.set(String(id), eq)
  }
}

// Valor de mercado de hoy.  jugadores-calc manda sobre el volcado general.
const VALOR = new Map()
for (const j of D.jugadores) VALOR.set(String(j.id), j.valor)
for (const j of J) VALOR.set(String(j.id), j.valor)

const EQ = [
 {n:'Betico1993',pos:8,pts:25,saldo:44706500,pl:9295000,rep:10419000,ini:39581000,com:0,ven:4000500,pre:1125000},
 {n:'Los tocahuevos C.F ( juanito)',pos:6,pts:67,saldo:21818000,pl:34158000,rep:31407000,ini:18593000,com:0,ven:1000000,pre:2225000},
 {n:'Niutin FC (Isaac)',pos:2,pts:119,saldo:9209955,pl:77386000,rep:33800000,ini:16200000,com:107997495,ven:97733250,pre:3275000,mio:1},
 {n:'Legalize F.C (Victor)',pos:7,pts:48,saldo:17104000,pl:44476000,rep:38225000,ini:11775000,com:0,ven:4029000,pre:1300000},
 {n:'Cacaculopedopis',pos:4,pts:93,saldo:16529646,pl:37177000,rep:19942000,ini:30058000,com:61422844,ven:45594490,pre:2300000},
 {n:'Neky F.C. (Sergio)',pos:1,pts:146,saldo:42285,pl:93660000,rep:31142000,ini:18858000,com:135478325,ven:112112610,pre:4550000},
 {n:'Mario80',pos:3,pts:110,saldo:3871150,pl:75124000,rep:28838000,ini:21162000,com:64304040,ven:43963190,pre:3050000},
 {n:'Saiyans FC (Fran)',pos:5,pts:70,saldo:1115300,pl:81659000,rep:21730000,ini:28270000,com:98059000,ven:68954300,pre:1950000}]
EQ.forEach(e => {
  e.tope = e.saldo + .25 * e.pl
  e.corto = e.n.replace(/\s*\(.*\)\s*/, '').trim()
  e.patrimonio = e.saldo + e.pl
  e.sobre50 = e.patrimonio - 50000000
})
const maxTope = Math.max(...EQ.map(e => e.tope))
const MIO = EQ.find(e => e.mio)
if (!MIO) throw new Error('No encuentro mi equipo en la tabla')
const TOPE_MIO = MIO.tope
const RIVALES = EQ.filter(e => !e.mio)

const eur = n => Math.round(n).toLocaleString('es-ES') + ' €'
const firma = n => (n > 0 ? '+' : n < 0 ? '−' : '') + eur(Math.abs(n))
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
const NL = '\n'

// ── Jugadores ────────────────────────────────────────────────────────────────
for (const j of J) {
  j.clausula = CL.get(String(j.id)) ?? null
  j.duenio = DUENIO.get(String(j.id)) ?? null
  j.duenioCorto = j.duenio ? j.duenio.replace(/\s*\(.*\)\s*/, '').trim() : null
  j.mio = j.duenio === MI_EQUIPO ? 1 : 0
  // Precio efectivo: cláusula si tiene dueño, valor si está libre.
  j.precio = j.clausula ?? j.valor
  j.a = j.precio <= TOPE_MIO ? 1 : 0
  j.pueden = EQ.filter(e => e.tope >= j.precio).length
  j.rivalesQuePueden = RIVALES.filter(e => e.tope >= j.precio).length
  j.subeMes = j.mes != null && j.valor ? j.mes / j.valor : null
}

// ── Recomendaciones sobre mi plantilla ───────────────────────────────────────
// Dos consejos, y solo para mis jugadores: nadie más me interesa vender ni blindar.
//
// 📤 Vender: capital parado.  No puntúa y su valor ya no crece, así que ni da
//    puntos ni plusvalía; el dinero rinde más en caja (y sube el tope de puja).
// 🔒 Blindar: te lo pueden quitar barato.  Rinde, media liga puede pagar su
//    cláusula, y esa cláusula es barata para lo que produce — o está en el
//    mínimo porque nunca la subiste.
const UMBRAL_POR_PUNTO = 1100000  // ≈ el cuartil bajo de la liga en €/punto de media
const RATIO_MINIMO = 1.55         // cláusula = 1,5 × valor es el suelo de Mister

for (const j of J) {
  j.vender = 0
  j.blindar = 0
  j.razon = null
  if (!j.mio) continue

  const parado = j.subeMes != null && j.subeMes < 0.25
  const noRinde = j.partidos === 0 || j.media < 5
  if (noRinde && parado) {
    j.vender = 1
    j.razon = j.partidos === 0
      ? 'no ha jugado ni un partido y su valor está plano'
      : `media de ${j.media.toFixed(1).replace('.', ',')} y su valor solo sube un ${Math.round(j.subeMes * 100)} % al mes`
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

J.sort((a, b) => (b.p + b.d) - (a.p + a.d) || b.media - a.media || b.valor - a.valor)

const filas = J.map(j => {
  const cls = ['fj', j.mk ? 'mk' : 'nomk', j.p ? 'tp' : '', j.d ? 'td' : '', j.a ? 'ta' : '',
    j.duenio ? 'tc' : 'tl', j.mio ? 'tmio' : '', j.vender ? 'tv' : '', j.blindar ? 'tb' : ''].filter(Boolean).join(' ')
  const pct = j.subeMes != null ? Math.round(j.subeMes * 100) : null
  const precio = j.clausula
    ? `<span class="jc">${eur(j.clausula)}</span><span class="jc-et">cláusula</span>`
    : `<span class="jv">${eur(j.valor)}</span><span class="jc-et">valor</span>`
  // A quién le cuento el «pueden pagarlo»: si el jugador es mío, el dato que
  // importa es cuántos RIVALES pueden quitármelo.
  const alcance = j.mio
    ? `<b>${j.rivalesQuePueden}/7</b> rivales pueden pagarla`
    : `<b>${j.pueden}/8</b> pueden pagarlo`
  return `<div class="${cls}">
      <div class="jn">${esc(j.nombre)}${j.mk ? '<span class="et-mk">en venta</span>' : ''}${
        j.duenio ? `<span class="et-eq${j.mio ? ' et-mio' : ''}">${esc(j.duenioCorto)}</span>` : '<span class="et-libre">libre</span>'}</div>
      <div class="jp">${precio}</div>
      <div class="ji">${j.p ? '⭐' : ''}${j.d ? '💵' : ''}${j.vender ? '📤' : ''}${j.blindar ? '🔒' : ''}</div>
      <div class="js">media ${(j.media || 0).toFixed(1).replace('.', ',')} · ${j.puntos} pts en ${j.partidos} part.${
        pct != null ? ` · ${pct > 0 ? '+' : ''}${pct} % mes` : ''}${
        j.clausula ? ` · vale ${eur(j.valor)}` : ''} · ${alcance}</div>${
        j.razon ? `<div class="jr">${j.vender ? '📤 <b>Véndelo:</b>' : '🔒 <b>Súbele la cláusula:</b>'} ${esc(j.razon)}.</div>` : ''}
    </div>`
}).join(NL)

// ── Equipos ──────────────────────────────────────────────────────────────────
const filasEq = [...EQ].sort((a, b) => b.tope - a.tope).map(e => {
  const d = (D.porEquipo || {})[e.n] || { movimientos: [], porJugador: {} }
  const js = Object.entries(d.porJugador).map(([id, x]) => {
    const loTiene = DUENIO.get(String(id)) === e.n
    const valeHoy = loTiene ? VALOR.get(String(id)) : null
    if (loTiene && valeHoy == null) throw new Error(`Sin valor de hoy para ${x.nombre} (${id}), que sigue en ${e.n}`)
    return {
      ...x,
      valeHoy,
      // Lo que este jugador le ha dejado: lo cobrado más lo que vale si lo
      // conserva, menos lo pagado.  Un fichaje que aún tiene en plantilla no
      // es una pérdida: es dinero convertido en jugador.
      balance: x.ventas + (valeHoy ?? 0) - x.compras,
      delReparto: x.compras === 0,
    }
  }).sort((a, b) => b.balance - a.balance)

  const tot = js.reduce((s, j) => ({
    compras: s.compras + j.compras, ventas: s.ventas + j.ventas,
    valeHoy: s.valeHoy + (j.valeHoy ?? 0), balance: s.balance + j.balance,
  }), { compras: 0, ventas: 0, valeHoy: 0, balance: 0 })

  const cel = n => n ? eur(n) : '—'
  const hayReparto = js.some(j => j.delReparto && j.ventas)
  const tabla = js.length ? `<table class="jt"><thead><tr><th>Jugador</th><th>Pagó</th><th>Cobró</th><th>Vale hoy</th><th>Balance</th></tr></thead><tbody>
${js.map(j => `<tr><td>${esc(j.nombre)}${j.delReparto ? '<span class="et-rep">del reparto</span>' : ''}</td><td>${cel(j.compras)}</td><td>${cel(j.ventas)}</td><td>${cel(j.valeHoy)}</td><td class="${j.balance>0?'mas':j.balance<0?'menos':''}">${firma(j.balance)}</td></tr>`).join(NL)}
<tr class="sum"><td>${js.length} jugador${js.length === 1 ? '' : 'es'}</td><td>${cel(tot.compras)}</td><td>${cel(tot.ventas)}</td><td>${cel(tot.valeHoy)}</td><td class="${tot.balance>0?'mas':tot.balance<0?'menos':''}">${firma(tot.balance)}</td></tr>
</tbody></table>${hayReparto ? '<p class="pie">«Del reparto» son los que le tocaron al empezar: no pagó nada por ellos, así que aquí todo lo que cobró cuenta entero. Por eso este total supera la ganancia real de arriba: los del reparto no eran gratis de verdad, ya valían dinero el día del reinicio.</p>' : ''}` : '<p class="vacio2">No ha hecho ningún movimiento.</p>'

  return `<details class="eq-det${e.mio ? ' yo' : ''}">
    <summary><span class="pos">${e.pos}º</span><span class="eqn">${esc(e.corto)}</span>${e.mio ? '<span class="tuyo">tú</span>' : ''}<span class="barra"><i style="width:${(e.tope/maxTope*100).toFixed(0)}%"></i></span><span class="tp">${eur(e.tope)}</span></summary>
    <div class="eq-cuerpo">
      <p class="frase">Puede gastar hasta <strong>${eur(e.tope)}</strong> — ${eur(e.saldo)} en caja más el 25 % de su plantilla.</p>
      <div class="cuenta">
        <div class="l"><span>Empezó con</span><span>${eur(e.ini)}</span></div>
        <div class="l"><span>Premios</span><span class="mas">+${eur(e.pre)}</span></div>
        <div class="l"><span>Ha vendido por</span><span class="mas">+${eur(e.ven)}</span></div>
        <div class="l"><span>Ha fichado por</span><span class="menos">−${eur(e.com)}</span></div>
        <div class="l tot"><span>Le queda en caja</span><span>${eur(e.saldo)}</span></div>
        <div class="l"><span>Más su plantilla, que vale</span><span>${eur(e.pl)}</span></div>
        <div class="l tot"><span>Patrimonio hoy</span><span>${eur(e.patrimonio)}</span></div>
        <div class="l"><span>Sobre los 50.000.000 € de salida</span><span class="${e.sobre50>0?'mas':'menos'}">${firma(e.sobre50)}</span></div>
      </div>
      ${tabla}
    </div>
  </details>`
}).join(NL)

// ── Montaje ──────────────────────────────────────────────────────────────────
const plantilla = fs.readFileSync(path.join(AQUI, 'plantilla.html'), 'utf8')
const html = plantilla
  .replace('<!--__JUGADORES__-->', filas)
  .replace('<!--__EQUIPOS__-->', filasEq)
if (html.includes('__JUGADORES__') || html.includes('__EQUIPOS__')) throw new Error('Quedaron huecos sin rellenar')
fs.writeFileSync(SALIDA, html)

const mios = J.filter(j => j.mio)
console.log(JSON.stringify({
  salida: SALIDA,
  jugadores: J.length,
  conClausula: J.filter(j => j.clausula).length,
  conDuenio: J.filter(j => j.duenio).length,
  miPlantilla: mios.length,
  vender: mios.filter(j => j.vender).map(j => j.nombre),
  blindar: mios.filter(j => j.blindar).map(j => j.nombre),
}, null, 1))
