/**
 * Qué ha cambiado desde la última vez.
 *
 * El módulo enseña una foto, pero las decisiones no se toman mirando la foto:
 * se toman cuando algo **cambia**. Que a tu delantero le hayan subido la
 * cláusula, que el rival con más caja se haya quedado sin ella, que se te haya
 * lesionado un titular. Todo eso está en los datos de cada día, pero enterrado
 * entre quinientos jugadores que siguen igual.
 *
 * Así que cada pasada guarda una foto de lo que importa y la compara con la
 * anterior. No hace falta más historial que el del día previo: lo que se
 * acumula son los cambios ya interpretados, no las fotos.
 *
 * Los fichajes no se sacan de aquí: el feed los publica con su precio exacto y
 * su fecha, que es mejor de lo que puede deducir una comparación. Aquí quedan
 * como red por si alguno no aparece en el feed, que ya ha pasado.
 */
import { COSTE_MODIFICACION, subidasVivas } from './clausulas.js'

/** Lo que se guarda de un jugador para poder comparar mañana. */
export type FotoJugador = {
  /** Valor. */
  v: number
  /** Cláusula, o `null` si está libre. */
  c: number | null
  /** Equipo de la liga que lo tiene, o `null`. */
  d: string | null
  /** Estado físico: `injury`, `doubt`… o `null` si está sano. */
  e: string | null
  /** Si está en el mercado. */
  m: 0 | 1
}

export type Foto = { dia: string; jugadores: Record<string, FotoJugador> }

export type Novedad =
  | { tipo: 'clausula'; dia: string; id: string; equipo: string; escalones: number; coste: number; clausula: number }
  | { tipo: 'lesion'; dia: string; id: string; estado: string; equipo: string | null }
  | { tipo: 'alta'; dia: string; id: string; equipo: string | null }
  | { tipo: 'mercado'; dia: string; id: string; entra: boolean }
  | { tipo: 'duenio'; dia: string; id: string; de: string | null; a: string | null }

/** Días de novedades que se guardan. Más atrás ya no es novedad. */
export const DIAS_DE_NOVEDADES = 7

/**
 * Compara dos fotos y devuelve lo que ha cambiado.
 *
 * Un jugador que no estaba en la foto anterior no genera nada: es la primera
 * vez que se le ve, y anunciarlo como novedad llenaría la lista de ruido el día
 * que Mister meta gente nueva en la competición.
 */
export function compararFotos(antes: Foto, ahora: Foto, dia: string): Novedad[] {
  const novedades: Novedad[] = []

  for (const [id, hoy] of Object.entries(ahora.jugadores)) {
    const ayer = antes.jugadores[id]
    if (ayer === undefined) continue

    if (ayer.d !== hoy.d) novedades.push({ tipo: 'duenio', dia, id, de: ayer.d, a: hoy.d })

    // Sube el MULTIPLICADOR, no la cláusula: la cláusula se recalcula sola
    // sobre el valor cada día, así que a quien se revaloriza le sube sin pagar.
    if (hoy.d !== null && hoy.c !== null && ayer.c !== null && ayer.d === hoy.d) {
      const antes = subidasVivas(ayer.v, ayer.c)
      const ahoraN = subidasVivas(hoy.v, hoy.c)
      const escalones = ahoraN - antes
      // La cláusula tiene que haberse movido de verdad y en el mismo sentido:
      // con el valor bailando, el ratio cruza escalones sin que nadie pague.
      // Bajarla cuenta igual, pero devuelve dinero en vez de costarlo.
      const proporcion = ayer.c === 0 ? 1 : hoy.c / ayer.c
      const deVerdad = proporcion <= 0.91 || proporcion >= 1.1
      if (escalones !== 0 && deVerdad && Math.sign(escalones) === Math.sign(proporcion - 1)) {
        novedades.push({
          tipo: 'clausula',
          dia,
          id,
          equipo: hoy.d,
          escalones,
          coste: Math.round(hoy.v * COSTE_MODIFICACION) * escalones,
          clausula: hoy.c,
        })
      }
    }

    // `doubt` va y viene todas las semanas; solo se cuenta lo que impide jugar.
    const fuera = (e: string | null) => e === 'injury' || e === 'other'
    if (!fuera(ayer.e) && fuera(hoy.e)) novedades.push({ tipo: 'lesion', dia, id, estado: hoy.e!, equipo: hoy.d })
    if (fuera(ayer.e) && !fuera(hoy.e)) novedades.push({ tipo: 'alta', dia, id, equipo: hoy.d })

    if (ayer.m !== hoy.m) novedades.push({ tipo: 'mercado', dia, id, entra: hoy.m === 1 })
  }

  return novedades
}

/** Añade las nuevas y tira las que ya no son de esta semana. */
export function acumular(previas: Novedad[], nuevas: Novedad[], hoy: string): Novedad[] {
  const corte = new Date(`${hoy}T00:00:00Z`)
  corte.setUTCDate(corte.getUTCDate() - DIAS_DE_NOVEDADES)
  const desde = corte.toISOString().slice(0, 10)

  const clave = (n: Novedad) => `${n.dia}|${n.tipo}|${n.id}`
  const vistas = new Set(previas.map(clave))
  const todas = [...previas]
  for (const n of nuevas) {
    if (vistas.has(clave(n))) continue
    vistas.add(clave(n))
    todas.push(n)
  }
  return todas.filter((n) => n.dia >= desde).sort((a, b) => b.dia.localeCompare(a.dia))
}
