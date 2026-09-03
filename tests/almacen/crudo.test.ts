import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CapturaDuplicadaError,
  PaginaDuplicadaError,
  VeredictoYaMarcadoError,
  abrirAlmacen,
} from '../../src/almacen/crudo.js'

const almacenEnMemoria = () => abrirAlmacen(':memory:')

const captura = (offset: number, nEventos: number, cuerpo = '{}', recoleccion = 'r1') => ({
  recoleccion,
  offset,
  nEventos,
  cuerpo,
  capturadaEn: '2026-09-03T10:00:00Z',
})

describe('almacén crudo', () => {
  it('guarda y recupera una captura íntegra', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(0, 21, '{"a":1}'))
    expect(a.leerCapturas('r1')).toEqual([
      {
        recoleccion: 'r1',
        offset: 0,
        nEventos: 21,
        cuerpo: '{"a":1}',
        capturadaEn: '2026-09-03T10:00:00Z',
      },
    ])
    a.cerrar()
  })

  it('devuelve las capturas ordenadas por offset', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(42, 21))
    a.guardarCaptura(captura(0, 21))
    a.guardarCaptura(captura(21, 21))
    expect(a.leerCapturas('r1').map((c) => c.offset)).toEqual([0, 21, 42])
    a.cerrar()
  })

  it('no altera el cuerpo guardado', () => {
    const a = almacenEnMemoria()
    const raro = '{"texto":"acentos áéí, emoji 🏆, comillas \" y salto\n"}'
    a.guardarCaptura(captura(0, 1, raro))
    expect(a.leerCapturas('r1')[0]!.cuerpo).toBe(raro)
    a.cerrar()
  })

  it('rechaza duplicar el mismo offset dentro de una recolección', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(0, 21, 'primero'))
    expect(() => a.guardarCaptura(captura(0, 21, 'segundo'))).toThrow(CapturaDuplicadaError)
    a.cerrar()
  })

  it('el duplicado no destruye la captura original', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(0, 21, 'primero'))
    try {
      a.guardarCaptura(captura(0, 21, 'segundo'))
    } catch {
      // esperado
    }
    expect(a.leerCapturas('r1')).toHaveLength(1)
    expect(a.leerCapturas('r1')[0]!.cuerpo).toBe('primero')
    a.cerrar()
  })

  it('admite el mismo offset en recolecciones distintas', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(0, 21, 'de ayer', 'r1'))
    a.guardarCaptura(captura(0, 25, 'de hoy', 'r2'))
    expect(a.leerCapturas('r1')[0]!.cuerpo).toBe('de ayer')
    expect(a.leerCapturas('r2')[0]!.cuerpo).toBe('de hoy')
    a.cerrar()
  })

  it('lista las recolecciones guardadas', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(0, 1, '{}', 'r1'))
    a.guardarCaptura(captura(0, 1, '{}', 'r2'))
    expect(a.recolecciones().sort()).toEqual(['r1', 'r2'])
    a.cerrar()
  })

  it('devuelve vacío para una recolección desconocida', () => {
    const a = almacenEnMemoria()
    expect(a.leerCapturas('no-existe')).toEqual([])
    a.cerrar()
  })

  it('rechaza un offset negativo', () => {
    const a = almacenEnMemoria()
    expect(() => a.guardarCaptura(captura(-1, 21))).toThrow(/offset/i)
    a.cerrar()
  })

  it('rechaza un nEventos negativo', () => {
    const a = almacenEnMemoria()
    expect(() => a.guardarCaptura(captura(0, -1))).toThrow(/nEventos/i)
    a.cerrar()
  })

  it('rechaza un nEventos no entero', () => {
    const a = almacenEnMemoria()
    expect(() => a.guardarCaptura(captura(0, 2.5))).toThrow(/nEventos/i)
    a.cerrar()
  })

  it('propaga errores de base de datos que NO sean violación de unicidad', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(0, 21))

    // Cerrar la base de datos para provocar un error de "database is closed"
    a.cerrar()

    // Intentar insertar después de cerrada debe propagar el error original, no CapturaDuplicadaError
    expect(() => a.guardarCaptura(captura(1, 21))).toThrow()
    expect(() => a.guardarCaptura(captura(1, 21))).not.toThrow(CapturaDuplicadaError)
  })

  it('identifica duplicados por código de error (SQLITE_CONSTRAINT_UNIQUE), sin mirar el texto del mensaje', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(0, 21, '{}', 'r1'))

    // Capturar el error de duplicado
    let capturedError: unknown
    try {
      a.guardarCaptura(captura(0, 21, '{}', 'r1'))
    } catch (e) {
      capturedError = e
    }

    // Verificar que es CapturaDuplicadaError (no por coincidencia de texto)
    expect(capturedError).toBeInstanceOf(CapturaDuplicadaError)
    if (capturedError instanceof CapturaDuplicadaError) {
      expect(capturedError.recoleccion).toBe('r1')
      expect(capturedError.offset).toBe(0)
    }

    a.cerrar()
  })

  it('propaga la violación de otra restricción UNIQUE aunque su mensaje contenga, por casualidad, las palabras "recoleccion" y "offset_feed"', () => {
    // Regresión del Fallo 5: la detección de duplicados no debe depender del
    // texto del mensaje de SQLite. Para probarlo sin tocar esquema.ts, se le
    // añade a la MISMA base de datos (mediante una segunda conexión al mismo
    // fichero) una restricción UNIQUE ajena, sobre columnas cuyo nombre
    // contiene esas dos palabras como subcadena sin ser la restricción real
    // (recoleccion, offset_feed). Una comparación de texto —aunque revise
    // ambas palabras— caería en un falso positivo aquí; una comprobación
    // semántica (¿existe ya esa fila?) no.
    const dir = mkdtempSync(join(tmpdir(), 'mister-crudo-test-'))
    const ruta = join(dir, 'test.db')

    const a = abrirAlmacen(ruta)
    a.guardarCaptura(captura(0, 21, '{}', 'r1'))

    const raw = new Database(ruta)
    raw.exec(`
      ALTER TABLE capturas ADD COLUMN recoleccion_legado TEXT NOT NULL DEFAULT '';
      ALTER TABLE capturas ADD COLUMN offset_feed_alt TEXT NOT NULL DEFAULT '';
      CREATE UNIQUE INDEX idx_legado_test ON capturas(recoleccion_legado, offset_feed_alt);
    `)
    raw.close()

    // (recoleccion, offset) distintos de la primera fila: NO choca con la
    // restricción real. Pero como las dos columnas nuevas se quedan en su
    // valor por defecto ('', '') igual que en la primera fila, sí choca con
    // la restricción ajena idx_legado_test.
    let capturedError: unknown
    try {
      a.guardarCaptura(captura(1, 21, '{}', 'r2'))
    } catch (e) {
      capturedError = e
    }

    expect(capturedError).toBeDefined()
    expect(capturedError).not.toBeInstanceOf(CapturaDuplicadaError)

    a.cerrar()
  })

  describe('veredicto de completitud', () => {
    it('devuelve undefined para una recolección sin marcar', () => {
      const a = almacenEnMemoria()
      expect(a.leerCompletitud('r1')).toBeUndefined()
      a.cerrar()
    })

    it('guarda y recupera el veredicto de una recolección completa', () => {
      const a = almacenEnMemoria()
      a.marcarCompletitud('r1', true, '2026-09-03T12:00:00Z')
      expect(a.leerCompletitud('r1')).toEqual({
        nombre: 'r1',
        completa: true,
        marcadaEn: '2026-09-03T12:00:00Z',
      })
      a.cerrar()
    })

    it('guarda y recupera el veredicto de una recolección incompleta', () => {
      const a = almacenEnMemoria()
      a.marcarCompletitud('r1', false, '2026-09-03T12:00:00Z')
      expect(a.leerCompletitud('r1')).toEqual({
        nombre: 'r1',
        completa: false,
        marcadaEn: '2026-09-03T12:00:00Z',
      })
      a.cerrar()
    })

    it('distingue el veredicto de recolecciones distintas', () => {
      const a = almacenEnMemoria()
      a.marcarCompletitud('r1', true, '2026-09-03T12:00:00Z')
      a.marcarCompletitud('r2', false, '2026-09-03T13:00:00Z')
      expect(a.leerCompletitud('r1')!.completa).toBe(true)
      expect(a.leerCompletitud('r2')!.completa).toBe(false)
      a.cerrar()
    })

    it('rechaza marcar dos veces la misma recolección: el veredicto no se sobrescribe en silencio', () => {
      const a = almacenEnMemoria()
      a.marcarCompletitud('r1', false, '2026-09-03T12:00:00Z')
      expect(() => a.marcarCompletitud('r1', true, '2026-09-03T13:00:00Z')).toThrow(VeredictoYaMarcadoError)
      a.cerrar()
    })

    it('el segundo intento de marcar no altera el veredicto original', () => {
      const a = almacenEnMemoria()
      a.marcarCompletitud('r1', false, '2026-09-03T12:00:00Z')
      try {
        a.marcarCompletitud('r1', true, '2026-09-03T13:00:00Z')
      } catch {
        // esperado
      }
      expect(a.leerCompletitud('r1')).toEqual({
        nombre: 'r1',
        completa: false,
        marcadaEn: '2026-09-03T12:00:00Z',
      })
      a.cerrar()
    })
  })

  describe('páginas guardadas', () => {
    it('guarda y recupera una página', () => {
      const a = abrirAlmacen(':memory:')
      a.guardarPagina({ ruta: '/players/1/x', cuerpo: '<html>x</html>', capturadaEn: '2026-09-03T10:00:00Z' })
      expect(a.leerPagina('/players/1/x')!.cuerpo).toBe('<html>x</html>')
      a.cerrar()
    })

    it('devuelve null para una ruta desconocida', () => {
      const a = abrirAlmacen(':memory:')
      expect(a.leerPagina('/no/existe')).toBe(null)
      a.cerrar()
    })

    it('rechaza guardar la misma ruta en el mismo instante', () => {
      const a = abrirAlmacen(':memory:')
      const p = { ruta: '/players/1/x', cuerpo: 'primero', capturadaEn: '2026-09-03T10:00:00Z' }
      a.guardarPagina(p)
      expect(() => a.guardarPagina({ ...p, cuerpo: 'segundo' })).toThrow(PaginaDuplicadaError)
      expect(a.leerPagina('/players/1/x')!.cuerpo).toBe('primero')
      a.cerrar()
    })

    it('un refresco añade una captura nueva sin destruir la anterior', () => {
      const a = abrirAlmacen(':memory:')
      a.guardarPagina({ ruta: '/players/1/x', cuerpo: 'de ayer', capturadaEn: '2026-09-02T10:00:00Z' })
      a.guardarPagina({ ruta: '/players/1/x', cuerpo: 'de hoy', capturadaEn: '2026-09-03T10:00:00Z' })
      expect(a.leerPagina('/players/1/x')!.cuerpo).toBe('de hoy')
      a.cerrar()
    })

    it('no repite la ruta al listarla aunque tenga varias capturas', () => {
      const a = abrirAlmacen(':memory:')
      a.guardarPagina({ ruta: '/a', cuerpo: 'x', capturadaEn: '2026-09-02T10:00:00Z' })
      a.guardarPagina({ ruta: '/a', cuerpo: 'y', capturadaEn: '2026-09-03T10:00:00Z' })
      expect(a.rutasGuardadas()).toEqual(['/a'])
      a.cerrar()
    })

    it('lista las rutas guardadas', () => {
      const a = abrirAlmacen(':memory:')
      a.guardarPagina({ ruta: '/b', cuerpo: 'x', capturadaEn: '2026-09-03T10:00:00Z' })
      a.guardarPagina({ ruta: '/a', cuerpo: 'x', capturadaEn: '2026-09-03T10:00:00Z' })
      expect(a.rutasGuardadas()).toEqual(['/a', '/b'])
      a.cerrar()
    })
  })
})
