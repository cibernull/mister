import { describe, expect, it } from 'vitest'
import { parsearClasificacion, ClasificacionIlegibleError } from '../../src/recoleccion/parseadorClasificacion.js'

const fila = (puesto: number, equipo: string, jugadores: number, valor: string, puntos: string, mio = false) => `
  <li>
    <div class="player-row">
      <a class="btn btn-sw-link user" href="users/1/x">
        <div class="position"> ${puesto} </div>
        <div class="info">
          <div class="name ${mio ? 'myself' : ''}"> ${equipo} </div>
          <div class="played"> ${jugadores} jugadores · € ${valor} </div>
        </div>
        <div class="points"> ${puntos} <span> Pts </span></div>
      </a>
    </div>
  </li>`

const pagina = (filas: string, jornada = '') =>
  `<div class="panels panels-standings"><div class="panel panel-total"><ul>${filas}</ul></div>` +
  `<div class="panel panel-gameweek"><ul>${jornada}</ul></div></div>`

describe('parsearClasificacion', () => {
  it('saca puesto, equipo, puntos, jugadores y valor de plantilla', () => {
    const html = pagina(fila(1, 'Neky F.C. (Sergio)', 18, '94.697.000', '146'))
    expect(parsearClasificacion(html)).toEqual([
      { puesto: 1, equipo: 'Neky F.C. (Sergio)', puntos: 146, jugadores: 18, valorPlantilla: 94697000 },
    ])
  })

  it('no confunde el panel de la jornada con el general', () => {
    // Mismo marcado, pero con los puntos de la última jornada. Leerlo daría una
    // clasificación entera equivocada sin que nada chirriara.
    const html = pagina(fila(1, 'Mario80', 16, '75.588.000', '113'), fila(1, 'Mario80', 16, '75.588.000', '9'))
    expect(parsearClasificacion(html)[0]!.puntos).toBe(113)
  })

  it('el propio equipo se lee igual, aunque lleve otra clase', () => {
    const html = pagina(fila(2, 'Niutin FC (Isaac)', 20, '80.305.000', '119', true))
    expect(parsearClasificacion(html)[0]!.equipo).toBe('Niutin FC (Isaac)')
  })

  it('una fila a medias rompe en vez de dejar a un equipo sin comprobar', () => {
    const rota = '<li><div class="position"> 3 </div><div class="name"> X </div></li>'
    expect(() => parsearClasificacion(pagina(rota))).toThrow(ClasificacionIlegibleError)
  })

  it('sin panel general es error', () => {
    expect(() => parsearClasificacion('<html><body>nada</body></html>')).toThrow(/panel de la clasificación/)
  })
})
