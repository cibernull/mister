/**
 * Rellena de una vez el histórico de valores, leyendo la ficha de cada jugador.
 *
 *     npm run historico
 *
 * Lo que sube o baja un jugador **en un mes** no lo publica Mister en ningún
 * sitio: solo está en la gráfica de su ficha, y las fichas se piden de una en
 * una. Por eso el módulo lo tenía para unos pocos y en el resto callaba.
 *
 * Pero cada ficha no trae un punto: trae la serie diaria entera, más de un año.
 * Así que con una pasada —una petición por jugador, unos nueve minutos— queda
 * el histórico completo, y a partir de ahí la cifra del mes sale de aquí para
 * los 523 sin volver a pedir ninguna ficha.
 *
 * Es un comando aparte y no parte de `actualizar` a propósito: se ejecuta una
 * vez, tarda, y no tiene por qué meterse en el camino del botón.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { crearCliente } from '../recoleccion/cliente.js'
import { obtenerCredenciales } from '../sesion/credenciales.js'
import { parsearSerieValores } from '../recoleccion/parseadorValores.js'
import { recolectarUniverso } from './recolectar.js'
import { podar, DIAS_DE_HISTORICO, type Historico } from './historicoValores.js'

const RAIZ = process.cwd()
const HISTORICO = join(RAIZ, 'modulo', 'datos', 'historico-valores.json')

const paso = (t: string) => process.stderr.write(`${t}\n`)

async function main(): Promise<void> {
  const cliente = crearCliente({ credenciales: obtenerCredenciales(join(RAIZ, '.sesion')) })

  paso('Pidiendo el censo…')
  const universo = await recolectarUniverso(cliente)
  paso(`${universo.length} jugadores. Ahora su ficha, una por una; esto tarda unos minutos.`)

  const historico: Historico = existsSync(HISTORICO) ? (JSON.parse(readFileSync(HISTORICO, 'utf8')) as Historico) : {}

  const desde = new Date()
  desde.setUTCDate(desde.getUTCDate() - DIAS_DE_HISTORICO)
  const corte = desde.toISOString().slice(0, 10)

  const fallidos: string[] = []
  let hechos = 0

  for (const j of universo) {
    try {
      // El slug del enlace es decorativo: `/players/{id}/x` devuelve la ficha
      // igual. Lo que no vale es el id a secas, que redirige a las noticias.
      const serie = parsearSerieValores(await cliente.pedirPagina(`/players/${j.id}/x`))
      for (const p of serie) {
        if (p.fecha < corte) continue
        ;(historico[p.fecha] ??= {})[j.id] = p.valor
      }
      hechos += 1
    } catch (e) {
      fallidos.push(`${j.nombre} (${j.id}): ${e instanceof Error ? e.message : String(e)}`)
    }
    // Se guarda sobre la marcha: si esto se corta a mitad, lo bajado se queda.
    if (hechos % 25 === 0) {
      guardar(historico)
      paso(`  ${hechos}/${universo.length}…`)
    }
  }

  guardar(historico)
  const dias = Object.keys(historico).sort()
  paso(`Listo: ${hechos} fichas, ${dias.length} días (${dias[0]} → ${dias[dias.length - 1]}).`)
  if (fallidos.length > 0) paso(`No pude con ${fallidos.length}:\n  ${fallidos.join('\n  ')}`)
}

function guardar(historico: Historico): void {
  podar(historico)
  writeFileSync(HISTORICO, `${JSON.stringify(historico, null, 1)}\n`)
}

main().catch((e: unknown) => {
  // El error entero no: por ahí podrían asomar las credenciales.
  process.stderr.write(`No pude terminar: ${e instanceof Error ? e.message : 'error desconocido'}\n`)
  process.exit(1)
})
