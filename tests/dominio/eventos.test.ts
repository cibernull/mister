import { describe, expect, it } from 'vitest'
import { esContable, type Evento } from '../../src/dominio/eventos.js'

const transaccion: Evento = {
  tipo: 'transaccion',
  idEvento: 955919110,
  fecha: '2026-08-30T10:00:00Z',
  jugador: 'Natan Souza',
  origen: { clase: 'equipo', nombre: 'Neky F.C. (Sergio)', idUc: 12493763 },
  destino: { clase: 'mercado' },
  importe: 5712300,
  operacion: 'normal',
  idTransfer: 544729389,
  idJugador: 34,
}

const cierre: Evento = {
  tipo: 'cierreJornada',
  idEvento: 955555681,
  fecha: '2026-08-31T22:00:00Z',
  jornada: 3,
  idJornada: 4044,
  resultados: [
    { equipo: 'Cacaculopedopis', idUc: 13435216, premio: 725000, puntos: 29, sinPuntuar: false, valorPlantilla: 56737000 },
    { equipo: 'Saiyans FC (Fran)', idUc: 13428410, premio: 0, puntos: 0, sinPuntuar: true, valorPlantilla: 29956000 },
  ],
}

const ruido: Evento = {
  tipo: 'ruido',
  idEvento: 955702952,
  fecha: '2026-09-01T09:00:00Z',
  motivo: 'fichaje de LaLiga real',
}

const bajaPlantilla: Evento = {
  tipo: 'bajaPlantilla',
  idEvento: 952080285,
  fecha: '2026-08-10T22:06:12Z',
  idJugador: 19977,
  jugador: 'Ronald Araújo',
}

describe('esContable', () => {
  it('considera contable una transacción', () => {
    expect(esContable(transaccion)).toBe(true)
  })

  it('considera contable un cierre de jornada', () => {
    expect(esContable(cierre)).toBe(true)
  })

  it('no considera contable el ruido', () => {
    expect(esContable(ruido)).toBe(false)
  })

  it('no considera contable una baja de plantilla: no mueve dinero', () => {
    expect(esContable(bajaPlantilla)).toBe(false)
  })
})
