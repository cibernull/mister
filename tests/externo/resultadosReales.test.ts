import { describe, expect, it } from 'vitest'
import { CLUBES, ClubDesconocidoError, fuerzaPorClub, parsearCsv } from '../../src/externo/resultadosReales.js'

const cab = 'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HxG,AxG,HS,AS,HST,AST'
const csv = (...filas: string[]) => [cab, ...filas].join('\n')

describe('parsearCsv', () => {
  it('traduce los nombres de los clubes a los ids de Mister', () => {
    const p = parsearCsv(csv('SP1,15/08/2026,Alaves,Getafe,3,0,1.8,0.4,14,6,6,1'))
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ local: 48, visitante: 9, golesLocal: 3, xgLocal: 1.8, aPuertaVisitante: 1 })
  })

  it('los veinte de esta temporada están todos', () => {
    // Si Football-Data renombra uno o sube un recién ascendido, esto lo canta
    // aquí y no en producción con el escudo de otro equipo al lado.
    expect(Object.keys(CLUBES)).toHaveLength(20)
    expect(new Set(Object.values(CLUBES)).size).toBe(20)
  })

  it('un club que no sabe traducir rompe la pasada, no se ignora', () => {
    // Ignorarlo en silencio dejaría a media liga sin datos sin que nadie lo
    // notara, que es exactamente lo que no se puede permitir.
    expect(() => parsearCsv(csv('SP1,15/08/2026,Alaves,Cartagena,1,1,0.5,0.5,9,9,3,3'))).toThrow(ClubDesconocidoError)
  })

  it('un partido sin jugar todavía no cuenta', () => {
    expect(parsearCsv(csv('SP1,20/09/2026,Alaves,Getafe,,,,,,,,'))).toEqual([])
  })
})

describe('fuerzaPorClub', () => {
  it('promedia lo que hace y lo que concede, por los dos lados', () => {
    const p = parsearCsv(
      csv(
        'SP1,15/08/2026,Alaves,Getafe,3,0,2.0,0.5,15,5,6,2',
        'SP1,22/08/2026,Getafe,Alaves,1,1,1.0,1.5,10,12,4,5',
      ),
    )
    const f = fuerzaPorClub(p)
    const alaves = f.get(48)!
    expect(alaves.partidos).toBe(2)
    expect(alaves.xgAFavor).toBeCloseTo(1.75)   // 2.0 en casa, 1.5 fuera
    expect(alaves.xgEnContra).toBeCloseTo(0.75) // 0.5 y 1.0
    expect(alaves.golesAFavor).toBeCloseTo(2)   // 3 y 1
  })

  it('el xG que falte no hunde el promedio', () => {
    // La fuente deja alguna casilla vacía. Contar ese partido como cero xG
    // convertiría a un equipo normal en un desastre por un hueco suyo.
    const p = parsearCsv(
      csv('SP1,15/08/2026,Alaves,Getafe,1,0,2.0,0.5,15,5,6,2', 'SP1,22/08/2026,Alaves,Betis,1,0,,,11,9,4,3'),
    )
    const alaves = fuerzaPorClub(p).get(48)!
    expect(alaves.partidos).toBe(2)
    expect(alaves.xgAFavor).toBeCloseTo(2.0)
  })
})
