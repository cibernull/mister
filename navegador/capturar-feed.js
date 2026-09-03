/**
 * Captura páginas crudas de POST /ajax/feed desde dentro de la propia página,
 * que es el único contexto donde la petición está autenticada con certeza.
 *
 * Devuelve un objeto { paginas: [...] } listo para volcar a disco.
 * No inspecciona ni transforma el contenido: lo entrega íntegro.
 */
async function capturarFeed(desde = 0, hasta = 1) {
  const paginas = []

  for (let page = desde; page <= hasta; page++) {
    const respuesta = await fetch('/ajax/feed', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams({ page: String(page) }).toString(),
    })

    const texto = await respuesta.text()
    paginas.push({ page, estado: respuesta.status, cuerpo: texto })

    await new Promise((r) => setTimeout(r, 1000))
  }

  return { paginas }
}

globalThis.capturarFeed = capturarFeed
