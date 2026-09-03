/**
 * navegador/capturar-feed.js — captura el histórico completo del feed de
 * Mister desde dentro de la propia página autenticada, y lo deja listo para
 * `npm run importar`.
 *
 * ## Cómo se usa
 *
 * 1. Entra en https://mister.mundodeportivo.com con tu sesión de siempre (el
 *    login es con Apple: tiene que ser un navegador ya autenticado a mano,
 *    no hay forma de autenticarse por programa).
 * 2. Abre las herramientas de desarrollador (F12) y ve a la pestaña "Consola".
 * 3. Pega el contenido íntegro de este fichero y pulsa Intro.
 * 4. Ejecuta:
 *
 *      await capturarFeed()
 *
 *    En la consola se ve el avance página a página. Tarda al menos 1 segundo
 *    por página (16 páginas del histórico actual ⇒ mínimo ~16 segundos): es
 *    el espaciado mínimo exigido para no castigar el servidor de Mister, y
 *    no se puede acelerar.
 * 5. Al terminar aparece, flotando en la esquina superior derecha de la
 *    página, un enlace de descarga. HAY QUE PULSARLO A MANO: Chrome bloquea
 *    las descargas que un script intenta iniciar por su cuenta, así que no
 *    basta con que la función termine.
 * 6. Mueve el fichero descargado a `datos/` (esa carpeta ya está en
 *    `.gitignore`: nunca debe llegar a git) y ejecuta:
 *
 *      npm run importar -- datos/<el-fichero-descargado>.json
 *
 * ## Aviso de privacidad
 *
 * El volcado contiene, dentro de cada cierre de jornada, el correo
 * electrónico y los identificadores de Apple/Google/Facebook de cada rival
 * de la liga (ver el aviso de privacidad en docs/api-mister.md). NO lo
 * compartas, no lo subas a ningún sitio, no lo comitees. `datos/` ya está en
 * `.gitignore`, pero eso no protege de moverlo o subirlo a mano a otro lado.
 *
 * ## Por qué está escrito así
 *
 * Reproduce exactamente lo que `src/cli/importar.ts` espera consumir
 * (`{ paginas: [{ offset, cuerpo, capturadaEn }] }`) y exactamente cómo habla
 * el servidor real, verificado ejecutando peticiones (ver
 * docs/api-mister.md): la paginación es por `offset` acumulado —no por
 * "page", que no existe—, la autenticación va en la cabecera `X-Auth` —nunca
 * en el cuerpo—, y el fin del histórico se señala con `status: "end"`, nunca
 * con un array `data` vacío ni con un cuerpo de error confundido con el fin.
 *
 * No es TypeScript ni tiene imports: se ejecuta pegado tal cual en la
 * consola del navegador, sin build.
 *
 * No se ha podido probar contra el servidor real (este entorno no tiene
 * acceso a una sesión de Mister autenticada): revisado a conciencia línea a
 * línea contra docs/api-mister.md, pero pendiente de una primera ejecución
 * real antes de confiar en él a ciegas.
 */
async function capturarFeed() {
  const CARDS_POR_PAGINA = 20
  const ESPERA_MS = 1000
  const MAX_PAGINAS = 1000 // válvula de seguridad: nunca debería hacer falta tantas

  const auth = window._FG_cfg && window._FG_cfg.auth
  if (!auth) {
    throw new Error(
      'no se encontró window._FG_cfg.auth: ¿estás en una página de ' +
        'mister.mundodeportivo.com con la sesión iniciada?',
    )
  }

  const paginas = []
  let offset = 0

  for (let i = 0; i < MAX_PAGINAS; i++) {
    const respuesta = await fetch('/ajax/feed', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Auth': auth,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        offset: String(offset),
        cardsPerPage: String(CARDS_POR_PAGINA),
        end: '0',
        loading: '0',
      }).toString(),
    })

    if (respuesta.status === 401) {
      throw new Error(
        `credenciales caducadas o no válidas (HTTP 401) al pedir el offset ${offset}. ` +
          'Recarga la página para renovar la sesión y vuelve a ejecutar capturarFeed().',
      )
    }
    if (!respuesta.ok) {
      throw new Error(`el offset ${offset} devolvió HTTP ${respuesta.status}`)
    }

    const cuerpo = await respuesta.text()
    const capturadaEn = new Date().toISOString()

    let json
    try {
      json = JSON.parse(cuerpo)
    } catch (causa) {
      throw new Error(`la respuesta del offset ${offset} no es JSON válido: ${cuerpo.slice(0, 200)}`, {
        cause: causa,
      })
    }

    // El fin del histórico se decide por "status", nunca por que "data" esté
    // vacío o ausente por otro motivo: un "status" que no sea "ok" ni "end"
    // (por ejemplo "error", una sesión caducada a media petición aunque no
    // haya dado 401) es una forma inesperada y debe detener la captura, no
    // confundirse con el final legítimo ni descartarse en silencio.
    if (json.status !== 'ok' && json.status !== 'end') {
      throw new Error(
        `status inesperado en el offset ${offset}: ${JSON.stringify(json.status)} ` +
          `(se esperaba "ok" o "end"). Cuerpo: ${cuerpo.slice(0, 200)}`,
      )
    }

    if (json.status === 'end') {
      if (json.data !== undefined) {
        throw new Error(
          `el lote final ("status":"end") en el offset ${offset} trae, contra lo esperado, ` +
            `un campo "data": ${cuerpo.slice(0, 200)}`,
        )
      }

      // El importador (src/cli/importar.ts) exige este último lote como
      // marcador de fin del feed: se incluye en el volcado, no se descarta.
      paginas.push({ offset, cuerpo, capturadaEn })
      console.log(`[capturarFeed] offset ${offset}: fin del histórico. ${paginas.length} páginas capturadas.`)

      ofrecerDescarga(paginas)
      return { paginas }
    }

    if (!Array.isArray(json.data)) {
      throw new Error(
        `la respuesta del offset ${offset} trae "status":"ok" pero no un array "data": ` +
          `${cuerpo.slice(0, 200)}`,
      )
    }

    paginas.push({ offset, cuerpo, capturadaEn })
    console.log(`[capturarFeed] offset ${offset}: ${json.data.length} eventos brutos`)

    // El offset avanza por el recuento BRUTO de esta página (data.length),
    // nunca por eventos de dominio ya interpretados: un "transfer" puede
    // contener varios movimientos, y avanzar por eventos de dominio saltaría
    // páginas reales del feed (ver contarEventosBrutos en
    // src/recoleccion/pagina.ts, que aplica exactamente el mismo criterio al
    // importar este volcado).
    offset += json.data.length

    await new Promise((r) => setTimeout(r, ESPERA_MS))
  }

  throw new Error(`se alcanzó el límite de seguridad de ${MAX_PAGINAS} páginas sin llegar al fin del histórico`)
}

/**
 * Inserta en la página un enlace VISIBLE que la persona debe pulsar a mano
 * para descargar el volcado. Chrome bloquea las descargas que un script
 * inicia por su cuenta sin un gesto real del usuario (`a.click()` desde
 * código no basta), así que no se intenta: se ofrece el enlace y se espera
 * el clic.
 */
function ofrecerDescarga(paginas) {
  const blob = new Blob([JSON.stringify({ paginas })], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const nombre = `volcado-feed-${new Date().toISOString().replace(/[:.]/g, '-')}.json`

  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  enlace.textContent = `⬇ Descargar ${nombre} (${paginas.length} páginas) — NO comitear, contiene datos de rivales`
  enlace.style.cssText =
    'position:fixed; top:12px; right:12px; z-index:2147483647; background:#111; color:#fff; ' +
    'padding:10px 16px; border-radius:6px; font:14px/1.4 -apple-system,sans-serif; ' +
    'text-decoration:none; box-shadow:0 2px 10px rgba(0,0,0,.5);'
  document.body.appendChild(enlace)

  console.log(
    `[capturarFeed] captura terminada: ${paginas.length} páginas. ` +
      'Pulsa el enlace de descarga que ha aparecido arriba a la derecha (no se descarga solo).',
  )
}

globalThis.capturarFeed = capturarFeed
