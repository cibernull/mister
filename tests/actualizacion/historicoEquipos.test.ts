import { describe, expect, it } from 'vitest'
import { actualizarHistoricoEquipos } from '../../src/actualizacion/historicoEquipos.js'

const foto = (saldo: number, pl: number) => ({ saldo, pl })

describe('actualizarHistoricoEquipos', () => {
  it('añade la foto de hoy de todos los equipos', () => {
    const historico = actualizarHistoricoEquipos({}, '2026-09-16', [
      { n: 'Niutin FC (Isaac)', saldo: 1_000_000, pl: 5_000_000 },
      { n: 'Betico1993', saldo: 2_000_000, pl: 3_000_000 },
    ])
    expect(historico).toEqual({
      '2026-09-16': {
        'Niutin FC (Isaac)': foto(1_000_000, 5_000_000),
        Betico1993: foto(2_000_000, 3_000_000),
      },
    })
  })

  it('no toca los días anteriores', () => {
    const previo = { '2026-09-15': { Niutin: foto(900_000, 4_800_000) } }
    const historico = actualizarHistoricoEquipos(previo, '2026-09-16', [{ n: 'Niutin', saldo: 1_000_000, pl: 5_000_000 }])
    expect(historico['2026-09-15']).toEqual({ Niutin: foto(900_000, 4_800_000) })
    expect(historico['2026-09-16']).toEqual({ Niutin: foto(1_000_000, 5_000_000) })
  })

  it('la última pasada del día gana, no se acumula', () => {
    // La actualización corre cada hora: si a las 10:00 el equipo tenía menos
    // caja que a las 11:00, el histórico debe quedarse con la de las 11:00,
    // no con una mezcla de ambas.
    const conLaDeLas10 = actualizarHistoricoEquipos({}, '2026-09-16', [{ n: 'Niutin', saldo: 1_000_000, pl: 5_000_000 }])
    const conLaDeLas11 = actualizarHistoricoEquipos(conLaDeLas10, '2026-09-16', [{ n: 'Niutin', saldo: 1_200_000, pl: 5_000_000 }])
    expect(conLaDeLas11['2026-09-16']).toEqual({ Niutin: foto(1_200_000, 5_000_000) })
  })

  it('no modifica el histórico que recibe', () => {
    const previo = { '2026-09-15': { Niutin: foto(900_000, 4_800_000) } }
    const copia = JSON.parse(JSON.stringify(previo))
    actualizarHistoricoEquipos(previo, '2026-09-16', [{ n: 'Niutin', saldo: 1_000_000, pl: 5_000_000 }])
    expect(previo).toEqual(copia)
  })

  it('tira los días que sobran, quedándose con los más recientes', () => {
    let historico = {}
    const dias = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']
    for (const d of dias) historico = actualizarHistoricoEquipos(historico, d, [{ n: 'Niutin', saldo: 1, pl: 1 }], 2)
    expect(Object.keys(historico)).toEqual(['2026-09-03', '2026-09-04'])
  })
})
