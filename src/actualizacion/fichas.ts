/**
 * La pasada larga: leer la ficha de todos los jugadores, una vez al día.
 *
 *     npm run fichas
 *
 * La actualización normal tarda veinticinco segundos porque no pide fichas: se
 * apaña con el censo, que da valor, puntos, media, cláusula y dueño de los 523
 * en once peticiones. Pero hay cosas que **solo** están en la ficha de cada
 * jugador, y que son justo las que ayudan a decidir a quién fichar:
 *
 *   · los goles y las tarjetas;
 *   · la media en casa y la media fuera, que suelen no parecerse en nada;
 *   · cuántas veces ha salido de inicio y cuántas del banquillo;
 *   · si Mister lo da por titular en el próximo partido;
 *   · y la serie diaria de valor, de la que sale el «% este mes».
 *
 * Son 523 peticiones y unos nueve minutos, así que va aparte: el botón de
 * Actualizar no puede quedarse esperando eso. Se guarda todo en disco y la
 * pasada normal lo lee de ahí.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { crearCliente } from '../recoleccion/cliente.js'
import { obtenerCredenciales } from '../sesion/credenciales.js'
import { parsearSerieValores } from '../recoleccion/parseadorValores.js'
import { parsearFicha, type Ficha } from '../recoleccion/parseadorFicha.js'
import { recolectarUniverso } from './recolectar.js'
import { podar, type Historico } from './historicoValores.js'

const RAIZ = process.cwd()
const DATOS = join(RAIZ, 'modulo', 'datos')
const HISTORICO = join(DATOS, 'historico-valores.json')
const FICHAS = join(DATOS, 'fichas.json')

/** Lo que se guarda de cada jugador, con el día en que se leyó. */
export type FichaGuardada = Ficha & { dia: string }

const paso = (t: string) => process.stderr.write(`${t}\n`)
const leer = <T>(ruta: string, sino: T): T =>
  existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as T) : sino
const escribir = (ruta: string, x: unknown) => writeFileSync(ruta, `${JSON.stringify(x, null, 1)}\n`)

async function main(): Promise<void> {
  const cliente = crearCliente({ credenciales: obtenerCredenciales(join(RAIZ, '.sesion')) })

  paso('Pidiendo el censo…')
  const universo = await recolectarUniverso(cliente)
  paso(`${universo.length} jugadores. Ahora su ficha, una por una; esto tarda unos minutos.`)

  const historico = leer<Historico>(HISTORICO, {})
  const fichas = leer<Record<string, FichaGuardada>>(FICHAS, {})
  const hoy = new Date().toISOString().slice(0, 10)

  const fallidos: string[] = []
  let hechos = 0

  for (const j of universo) {
    try {
      // El slug del enlace es decorativo: `/players/{id}/x` devuelve la ficha
      // igual. Lo que no vale es el id a secas, que redirige a las noticias.
      const html = await cliente.pedirPagina(`/players/${j.id}/x`)
      for (const p of parsearSerieValores(html)) (historico[p.fecha] ??= {})[j.id] = p.valor
      fichas[j.id] = { ...parsearFicha(html), dia: hoy }
      hechos += 1
    } catch (e) {
      fallidos.push(`${j.nombre} (${j.id}): ${e instanceof Error ? e.message : String(e)}`)
    }
    // Se guarda sobre la marcha: si esto se corta a mitad, lo leído se queda.
    if (hechos % 25 === 0) {
      guardar(historico, fichas)
      paso(`  ${hechos}/${universo.length}…`)
    }
  }

  guardar(historico, fichas)
  const dias = Object.keys(historico).sort()
  paso(`Listo: ${hechos} fichas, ${dias.length} días de valores (${dias[0]} → ${dias[dias.length - 1]}).`)
  if (fallidos.length > 0) paso(`No pude con ${fallidos.length}:\n  ${fallidos.join('\n  ')}`)
}

function guardar(historico: Historico, fichas: Record<string, FichaGuardada>): void {
  podar(historico)
  escribir(HISTORICO, historico)
  escribir(FICHAS, fichas)
}

main().catch((e: unknown) => {
  // El error entero no: por ahí podrían asomar las credenciales.
  process.stderr.write(`No pude terminar: ${e instanceof Error ? e.message : 'error desconocido'}\n`)
  process.exit(1)
})
