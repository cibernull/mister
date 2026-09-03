# Fase 2 — Motor contable exacto · Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL OBLIGATORIA: usar
> `superpowers:subagent-driven-development` (recomendada) o
> `superpowers:executing-plans` para implementar este plan tarea a tarea. Los
> pasos usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** calcular el saldo y el tope de puja exactos de los ocho equipos de
la liga, y demostrarlo con tres comprobaciones independientes.

**Arquitectura:** sobre el histórico ya recolectado en la Fase 1, se añade la
recolección de dos datos auxiliares —las plantillas actuales y la serie diaria
de valor de cada jugador—, y un motor contable que es una **función pura**:
recibe eventos y datos auxiliares, devuelve el estado financiero de cada equipo.
Sin red ni base de datos dentro, para poder probarlo con casos de tabla.

**Pila:** TypeScript sobre Node 22+, `better-sqlite3`, `vitest`, `tsx`. Las
mismas de la Fase 1.

**Especificación:** `docs/superpowers/specs/2026-09-03-mister-inteligencia-liga-design.md`
**Hechos de la API:** `docs/api-mister.md`
**Hallazgos que este plan implementa:** `docs/hallazgos-para-fase-2.md`

## Restricciones globales

Se aplican a **todas** las tareas. Las cinco primeras vienen de la Fase 1; las
cuatro últimas son lecciones que costó descubrir y sin las cuales la
contabilidad **no cuadra**.

- **Exactitud al céntimo.** Prohibido estimar, redondear o rellenar huecos. Ante
  cualquier duda, el proceso falla ruidosamente.
- **Dinero siempre entero.** Nunca `float`, nunca coma flotante.
- **Ningún evento se descarta en silencio.** Un tipo o categoría desconocidos
  lanzan error.
- **Mínimo 1000 ms entre peticiones** a `mister.mundodeportivo.com`.
- **Las credenciales y los datos personales de los rivales** (correo,
  identificadores de Apple/Google/Facebook, fotos) nunca aparecen en git, logs,
  mensajes de error ni ficheros de prueba.
- **Deduplicar siempre.** El feed repite eventos entre lotes contiguos. Los
  movimientos se deduplican por `id_transfer` y los cierres de jornada por
  `id_gameweek`. **De un cierre duplicado se conserva la aparición más
  antigua**, porque su fecha determina cuándo se pagaron los premios.
- **La identidad de un equipo es su `id_uc`, nunca su nombre.** El histórico
  contiene un `change_name` real.
- **Un `player_transfer` sin equipo NO es ruido:** es una baja de plantilla por
  salida de LaLiga. Sin contabilizarlas, el reparto inicial queda incompleto.
- **Los valores del histórico vienen redondeados a millares.** El desvío
  resultante es conocido y debe declararse, nunca disimularse.
- Node 22 o superior. TypeScript en modo `strict` con `noUncheckedIndexedAccess`.
- Identificadores de dominio en español.

## Estado de partida

La Fase 1 está en `main` con 140 tests en verde. Existe y funciona:

- `src/dominio/eventos.ts` — `Evento`, `Transaccion` (con `idUc` en `Parte`,
  `idTransfer`, `operacion`), `CierreJornada`, `ResultadoEquipo` (con `idUc` y
  `valorPlantilla`), `Ruido`, `esContable`
- `src/almacen/crudo.ts` — `abrirAlmacen`, `Captura`, `leerCapturas`,
  `recolecciones`, `marcarCompletitud`, `leerCompletitud`
- `src/recoleccion/cliente.ts` — `crearCliente({credenciales,...})` con
  `pedirLote(offset)`
- `src/recoleccion/parseadorFeed.ts` — `parsearPaginaFeed`
- `src/recoleccion/pagina.ts` — recuento bruto y tipo `Resumen`
- `src/recoleccion/integridad.ts` — `comprobarContinuidad`, `comprobarCompletitud`
- `src/sesion/credenciales.ts` — `obtenerCredenciales`
- `src/cli/recolectar.ts`, `src/cli/importar.ts`
- `datos/mister.sqlite` — el histórico real, recolección
  `volcado:volcado-feed.json`, marcada completa

## Cifras de referencia verificadas a mano

El plan se valida contra estos números, obtenidos manualmente el 2026-09-03. Si
la implementación no los reproduce, **la implementación está mal**:

| Comprobación | Valor |
|---|---|
| Saldo propio real (`balance.current`) | 9.209.955 € |
| Saldo propio calculado | 9.210.755 € (desvío **800 €**) |
| Tope de puja propio | 28.556.455 €, **coincide al euro** con `maxDebt` |
| Reparto inicial propio | 16 jugadores, 33.800.000 € |
| Movimientos únicos tras deduplicar | **249** (de 252 brutos) |
| Cierres de jornada únicos | **3** (de 4 brutos) |
| Validación cruzada contra las marcas `negative` | **20 de 24** |

---

### Tarea 1: Deduplicación de eventos

**Ficheros:**
- Crear: `src/contabilidad/deduplicar.ts`
- Crear: `tests/contabilidad/deduplicar.test.ts`

**Interfaces:**
- Consume: `Evento`, `Transaccion`, `CierreJornada` de `src/dominio/eventos.js`.
- Produce:
  - `Transaccion` gana el campo `idJugador: number`
  - `CierreJornada` gana el campo `idJornada: number`
  - `function deduplicar(eventos: Evento[]): Evento[]`

**Esta tarea empieza completando el modelo.** Hoy `Transaccion` no guarda qué
jugador se movió y `CierreJornada` no guarda el identificador de la jornada — y
la deduplicación necesita el segundo, mientras que la reconstrucción del reparto
(Tarea 6) necesita el primero. Ambos vienen ya en el crudo y se estaban
descartando.

**Por qué existe.** El feed crece por arriba mientras se pagina, así que el
offset retrocede y repite eventos ya servidos. En el histórico real hay **3
movimientos repetidos que suman 17.051.490 € contados de más**, y **la jornada 1
publicada dos veces**. `comprobarContinuidad` no lo detecta, porque los offsets
sí encajan.

**La regla del cierre duplicado es sutil:** de dos apariciones del mismo
`id_gameweek` se conserva **la más antigua**, porque su fecha es cuando
realmente se pagaron los premios. Quedarse con la tardía desplaza los premios
días hacia el futuro y produce saldos negativos falsos en fechas intermedias.

Los eventos de tipo `ruido` no se deduplican: no afectan a la contabilidad y no
tienen identificador estable.

- [ ] **Paso 1: Añadir los dos campos al dominio**

En `src/dominio/eventos.ts`, dentro de `Transaccion`:

```ts
  /** `id` del jugador en el crudo de Mister. Identidad estable del jugador. */
  idJugador: number
```

y dentro de `CierreJornada`:

```ts
  /**
   * `id_gameweek` del crudo. Identifica la jornada de forma estable: el feed
   * publica el mismo cierre más de una vez, y el número de `jornada` no basta
   * para distinguirlos de una repetición.
   */
  idJornada: number
```

- [ ] **Paso 2: Rellenarlos en el parseador**

En `src/recoleccion/parseadorFeed.ts`, en `parsearTransaccion` añadir
`idJugador: exigirEntero(m['id'], 'id', idEvento)`, y en `parsearCierreJornada`
añadir `idJornada: exigirEntero(d['id_gameweek'], 'id_gameweek', idEvento)`.

Añadir a `tests/recoleccion/parseadorFeed.test.ts`:

```ts
it('toda transacción del fixture real trae el identificador del jugador', () => {
  const ts = transaccionesDe(pagina0)
  expect(ts.length).toBeGreaterThan(0)
  for (const t of ts) expect(Number.isInteger(t.idJugador)).toBe(true)
})

it('todo cierre del fixture real trae el identificador de la jornada', () => {
  const cs = cierresDe(paginaCierre)
  expect(cs.length).toBeGreaterThan(0)
  for (const c of cs) expect(Number.isInteger(c.idJornada)).toBe(true)
})
```

Actualiza también los objetos de prueba de `tests/dominio/eventos.test.ts` con
los dos campos nuevos.

Ejecutar: `npm test` — todo debe pasar antes de seguir.

- [ ] **Paso 3: Escribir el test de deduplicación, que falla**

Fichero `tests/contabilidad/deduplicar.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deduplicar } from '../../src/contabilidad/deduplicar.js'
import type { CierreJornada, Evento, Transaccion } from '../../src/dominio/eventos.js'

const tx = (idTransfer: number, fecha = '2026-08-10 10:00:00'): Transaccion => ({
  tipo: 'transaccion', idEvento: idTransfer, idTransfer, fecha,
  jugador: 'Jugador', origen: { clase: 'mercado' },
  destino: { clase: 'equipo', idUc: 5, nombre: 'Equipo' },
  importe: 1000, operacion: 'normal',
})

const cierre = (idJornada: number, fecha: string): CierreJornada => ({
  tipo: 'cierreJornada', idEvento: idJornada, idJornada, jornada: 1, fecha,
  resultados: [{ idUc: 5, equipo: 'Equipo', premio: 100, puntos: 10, valorPlantilla: 900, sinPuntuar: false }],
})

const ruido = (fecha: string): Evento => ({ tipo: 'ruido', idEvento: 0, fecha, motivo: 'x' })

describe('deduplicar', () => {
  it('deja pasar una lista sin repetidos', () => {
    expect(deduplicar([tx(1), tx(2)])).toHaveLength(2)
  })

  it('elimina movimientos con el mismo idTransfer', () => {
    const r = deduplicar([tx(1), tx(2), tx(1)])
    expect(r).toHaveLength(2)
    expect(r.filter((e) => e.tipo === 'transaccion').map((e) => (e as Transaccion).idTransfer)).toEqual([1, 2])
  })

  it('conserva la PRIMERA aparición de un movimiento repetido', () => {
    const r = deduplicar([tx(1, '2026-08-10 10:00:00'), tx(1, '2026-08-12 10:00:00')])
    expect((r[0] as Transaccion).fecha).toBe('2026-08-10 10:00:00')
  })

  it('elimina cierres con el mismo idJornada', () => {
    expect(deduplicar([cierre(3968, '2026-08-20 12:00:00'), cierre(3968, '2026-08-28 10:00:00')])).toHaveLength(1)
  })

  it('de un cierre duplicado conserva el MÁS ANTIGUO, venga en el orden que venga', () => {
    const tarde = cierre(3968, '2026-08-28 10:00:00')
    const pronto = cierre(3968, '2026-08-20 12:00:00')
    expect((deduplicar([tarde, pronto])[0] as CierreJornada).fecha).toBe('2026-08-20 12:00:00')
    expect((deduplicar([pronto, tarde])[0] as CierreJornada).fecha).toBe('2026-08-20 12:00:00')
  })

  it('no confunde un movimiento con un cierre que compartan número', () => {
    expect(deduplicar([tx(7), cierre(7, '2026-08-20 12:00:00')])).toHaveLength(2)
  })

  it('no deduplica el ruido', () => {
    expect(deduplicar([ruido('2026-08-01 10:00:00'), ruido('2026-08-01 10:00:00')])).toHaveLength(2)
  })

  it('acepta una lista vacía', () => {
    expect(deduplicar([])).toEqual([])
  })
})
```

- [ ] **Paso 4: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/contabilidad/deduplicar.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 5: Escribir la implementación**

Fichero `src/contabilidad/deduplicar.ts`:

```ts
import type { CierreJornada, Evento, Transaccion } from '../dominio/eventos.js'

/**
 * Quita los eventos repetidos que produce la paginación del feed.
 *
 * El feed crece por arriba mientras se pagina, así que el offset retrocede y
 * vuelve a servir eventos ya vistos. En el histórico real eso suponía 17 millones
 * contados de más y una jornada pagada dos veces.
 *
 * De un cierre de jornada repetido se conserva la aparición MÁS ANTIGUA: su
 * fecha es cuando se pagaron los premios de verdad, y quedarse con la tardía
 * los desplaza en el tiempo y genera saldos negativos falsos.
 */
export function deduplicar(eventos: Evento[]): Evento[] {
  const movimientos = new Map<number, Transaccion>()
  const cierres = new Map<number, CierreJornada>()
  const salida: Evento[] = []
  // Marcadores de posición para conservar el orden original de la lista.
  const huecos: { indice: number; clase: 'transaccion' | 'cierreJornada'; id: number }[] = []

  for (const evento of eventos) {
    if (evento.tipo === 'transaccion') {
      if (!movimientos.has(evento.idTransfer)) {
        movimientos.set(evento.idTransfer, evento)
        huecos.push({ indice: salida.length, clase: 'transaccion', id: evento.idTransfer })
        salida.push(evento)
      }
      continue
    }

    if (evento.tipo === 'cierreJornada') {
      const previo = cierres.get(evento.idJornada)
      if (!previo) {
        cierres.set(evento.idJornada, evento)
        huecos.push({ indice: salida.length, clase: 'cierreJornada', id: evento.idJornada })
        salida.push(evento)
      } else if (evento.fecha < previo.fecha) {
        // Aparición más antigua: sustituye a la ya guardada, en su misma posición.
        cierres.set(evento.idJornada, evento)
        const hueco = huecos.find((h) => h.clase === 'cierreJornada' && h.id === evento.idJornada)
        if (hueco) salida[hueco.indice] = evento
      }
      continue
    }

    salida.push(evento)
  }

  return salida
}
```

- [ ] **Paso 6: Ejecutar y comprobar que pasan**

Ejecutar: `npx vitest run tests/contabilidad/deduplicar.test.ts`
Esperado: PASA, 8 tests.

- [ ] **Paso 7: Comprobar contra el histórico real**

El histórico tiene 252 movimientos brutos y 4 cierres; deduplicados deben quedar
**249 y 3**. Escribe un script temporal en `/tmp` que lea
`datos/volcado-feed.json`, parsee cada lote con `parsearPaginaFeed`, aplique
`deduplicar` y cuente. Bórralo después.

Esperado exactamente: `{ transacciones: 249, cierres: 3 }`.

- [ ] **Paso 8: Commit**

```bash
npm test && npm run typecheck
git add src/contabilidad tests/contabilidad
git commit -m "feat: deduplicación de eventos repetidos por la paginación"
```

---

### Tarea 2: Reclasificar las bajas de plantilla

**Ficheros:**
- Modificar: `src/dominio/eventos.ts`
- Modificar: `src/recoleccion/parseadorFeed.ts`
- Modificar: `tests/recoleccion/parseadorFeed.test.ts`
- Modificar: `tests/dominio/eventos.test.ts`

**Interfaces:**
- Produce:
  - `type BajaPlantilla = { tipo: 'bajaPlantilla'; idEvento: number; fecha: string; idJugador: number; jugador: string }`
  - `Evento` pasa a incluir `BajaPlantilla`
  - `esContable` **sigue devolviendo false** para las bajas: no mueven dinero.

**Por qué existe.** Un `player_transfer` cuyo `id_team` es 0, nulo o ausente
significa que el jugador **abandonó LaLiga**: desaparece de la plantilla de quien
lo tuviera, sin generar ningún movimiento ni compensación.

Esto costó descubrirlo: **Ronald Araújo estaba en el reparto inicial propio y no
aparece en ningún movimiento del feed**. Sin contabilizar su baja, el reparto
quedaba corto en 4.847.000 € y el saldo no cuadraba.

Los `player_transfer` **con** equipo siguen siendo ruido: son fichajes reales de
LaLiga entre clubes, sin efecto en la liga Fantasy.

- [ ] **Paso 1: Añadir el tipo de dominio**

En `src/dominio/eventos.ts`, añadir junto a los demás tipos:

```ts
/**
 * Un jugador abandona la competición y desaparece de la plantilla de quien lo
 * tuviera, sin compensación ni movimiento de mercado. No mueve dinero, pero sí
 * determina qué jugadores formaban parte de un reparto inicial.
 */
export type BajaPlantilla = {
  tipo: 'bajaPlantilla'
  idEvento: number
  fecha: string
  idJugador: number
  jugador: string
}
```

y añadirlo a la unión:

```ts
export type Evento = Transaccion | CierreJornada | BajaPlantilla | Ruido
```

`esContable` no cambia: sigue siendo cierto solo para `transaccion` y
`cierreJornada`.

- [ ] **Paso 2: Escribir el test que falla**

Añadir a `tests/recoleccion/parseadorFeed.test.ts`:

```ts
const feedCon = (evento: Record<string, unknown>) =>
  JSON.stringify({ status: 'ok', data: [evento] })

const playerTransfer = (datos: Record<string, unknown>) => feedCon({
  category: 'player_transfer', id: 1, created: '2026-08-10 10:00:00', data: [datos],
})

describe('bajas de plantilla', () => {
  it('un player_transfer sin equipo es una baja, no ruido', () => {
    const { eventos } = parsearPaginaFeed(playerTransfer({ id: 19977, name: 'Ronald Araújo', id_team: 0 }))
    expect(eventos).toHaveLength(1)
    expect(eventos[0]!.tipo).toBe('bajaPlantilla')
  })

  it('la baja conserva el identificador y el nombre del jugador', () => {
    const { eventos } = parsearPaginaFeed(playerTransfer({ id: 19977, name: 'Ronald Araújo', id_team: 0 }))
    const b = eventos[0] as BajaPlantilla
    expect(b.idJugador).toBe(19977)
    expect(b.jugador).toBe('Ronald Araújo')
  })

  it('trata id_team ausente o nulo igual que cero', () => {
    for (const datos of [{ id: 1, name: 'X' }, { id: 1, name: 'X', id_team: null }]) {
      expect(parsearPaginaFeed(playerTransfer(datos)).eventos[0]!.tipo).toBe('bajaPlantilla')
    }
  })

  it('un player_transfer CON equipo sigue siendo ruido', () => {
    const { eventos } = parsearPaginaFeed(playerTransfer({ id: 5, name: 'Y', id_team: 6 }))
    expect(eventos[0]!.tipo).toBe('ruido')
  })

  it('una baja no es contable: no mueve dinero', () => {
    const { eventos } = parsearPaginaFeed(playerTransfer({ id: 1, name: 'X', id_team: 0 }))
    expect(esContable(eventos[0]!)).toBe(false)
  })

  it('el histórico real contiene bajas de plantilla', () => {
    const bajas = parsearPaginaFeed(pagina0).eventos.filter((e) => e.tipo === 'bajaPlantilla')
    expect(bajas.length).toBeGreaterThan(0)
  })
})
```

Añade `BajaPlantilla` y `esContable` a las importaciones del fichero de test.

- [ ] **Paso 3: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/recoleccion/parseadorFeed.test.ts`
Esperado: FALLA — hoy esos eventos se clasifican como `ruido`.

- [ ] **Paso 4: Implementar en el parseador**

En `src/recoleccion/parseadorFeed.ts`, quitar `'player_transfer'` del conjunto
`CATEGORIAS_RUIDO` y tratarlo aparte en `parsearEvento`:

```ts
  if (categoria === 'player_transfer') {
    return comoLista(bruto.data).map((m) => parsearMovimientoDeLaLiga(m, fecha, idEvento))
  }
```

y añadir:

```ts
/**
 * Un fichaje de LaLiga real. Si el jugador se queda sin equipo, abandona la
 * competición: eso sí afecta a las plantillas de la liga Fantasy.
 */
function parsearMovimientoDeLaLiga(
  m: Record<string, unknown>,
  fecha: string,
  idEvento: number,
): Evento {
  const idEquipo = m['id_team']
  const sinEquipo = idEquipo === null || idEquipo === undefined || Number(idEquipo) === 0

  if (!sinEquipo) {
    return { tipo: 'ruido', idEvento, fecha, motivo: 'fichaje de LaLiga entre clubes' }
  }

  return {
    tipo: 'bajaPlantilla',
    idEvento,
    fecha,
    idJugador: exigirEntero(m['id'], 'id', idEvento),
    jugador: exigirTexto(m['name'], 'name', idEvento),
  }
}
```

- [ ] **Paso 5: Ejecutar y comprobar que pasan**

Ejecutar: `npm test`
Esperado: todo pasa. Si algún test previo contaba `player_transfer` como ruido,
**actualiza el recuento esperado**, no la clasificación.

- [ ] **Paso 6: Comprobar contra el histórico real**

Script temporal: parsear el volcado entero y contar por tipo.
Esperado: **20 bajas de plantilla**, 249 transacciones tras deduplicar, 3
cierres, y el resto ruido.

- [ ] **Paso 7: Commit**

```bash
npm run typecheck
git add src/dominio/eventos.ts src/recoleccion/parseadorFeed.ts tests/
git commit -m "feat: los player_transfer sin equipo son bajas de plantilla, no ruido"
```

---

### Tarea 3: Parseador de `_FG_user`

**Ficheros:**
- Crear: `src/recoleccion/parseadorFgUser.ts`
- Crear: `tests/recoleccion/parseadorFgUser.test.ts`
- Crear: `fixtures/fg-user.json` (extraído de una página real, saneado)

**Interfaces:**
- Produce:
  - `function parsearFgUser(html: string): DatosUsuario`
  - `type DatosUsuario = { idUsuario: number; idUc: number; idComunidad: number; equipo: string; saldo: number; saldoFuturo: number; topePuja: number; creditos: number }`
  - `class FgUserNoEncontradoError extends Error`

**Por qué existe.** `balance.current` y `balance.maxDebt` son las dos cifras
contra las que se verifica todo el motor. Vienen en cada página HTML dentro de
`var _FG_user = {...}`.

- [ ] **Paso 1: Crear el fixture**

Pedir cualquier página de Mister con la sesión y extraer el objeto `_FG_user`.
Guardar en `fixtures/fg-user.json` **solo estos campos**, con los valores reales
del 2026-09-03:

```json
{
  "id": 2445574,
  "id_uc": 12493763,
  "id_community": 1890551,
  "uc_name": "Niutin FC (Isaac)",
  "credits": 614,
  "balance": { "current": 9209955, "future": 9209955, "maxDebt": 28556455 }
}
```

**No incluir** `email`, `apple_id`, `fb_id`, `google_id`, `picture` ni `cookie`.
Comprobar: `grep -iE 'email|apple|google|cookie|token' fixtures/fg-user.json`
no debe devolver nada.

- [ ] **Paso 2: Escribir el test que falla**

Fichero `tests/recoleccion/parseadorFgUser.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FgUserNoEncontradoError, parsearFgUser } from '../../src/recoleccion/parseadorFgUser.js'

const objeto = readFileSync('fixtures/fg-user.json', 'utf8')
const paginaCon = (cuerpo: string) =>
  `<html><head><script>var _FG_cfg = {"a":1};\nvar _FG_user = ${cuerpo};\nvar otro = 2;</script></head><body>x</body></html>`

describe('parsearFgUser', () => {
  it('extrae los identificadores', () => {
    const d = parsearFgUser(paginaCon(objeto))
    expect(d.idUsuario).toBe(2445574)
    expect(d.idUc).toBe(12493763)
    expect(d.idComunidad).toBe(1890551)
  })

  it('extrae el nombre del equipo', () => {
    expect(parsearFgUser(paginaCon(objeto)).equipo).toBe('Niutin FC (Isaac)')
  })

  it('extrae saldo y tope de puja como enteros', () => {
    const d = parsearFgUser(paginaCon(objeto))
    expect(d.saldo).toBe(9209955)
    expect(d.saldoFuturo).toBe(9209955)
    expect(d.topePuja).toBe(28556455)
    expect(Number.isInteger(d.saldo)).toBe(true)
    expect(Number.isInteger(d.topePuja)).toBe(true)
  })

  it('lanza si la página no trae _FG_user', () => {
    expect(() => parsearFgUser('<html><body>nada</body></html>')).toThrow(FgUserNoEncontradoError)
  })

  it('lanza si falta el bloque balance', () => {
    expect(() => parsearFgUser(paginaCon('{"id":1,"id_uc":2,"id_community":3,"uc_name":"X"}'))).toThrow(/balance/i)
  })

  it('lanza si el saldo no es entero', () => {
    const malo = '{"id":1,"id_uc":2,"id_community":3,"uc_name":"X","balance":{"current":"x","future":0,"maxDebt":0}}'
    expect(() => parsearFgUser(paginaCon(malo))).toThrow(/current/i)
  })

  it('no incluye el objeto crudo en los mensajes de error', () => {
    const malo = '{"id":1,"id_uc":2,"id_community":3,"uc_name":"X","email":"secreto@ejemplo.com","balance":{"current":"x","future":0,"maxDebt":0}}'
    try {
      parsearFgUser(paginaCon(malo))
      expect.unreachable('debería haber lanzado')
    } catch (e) {
      expect((e as Error).message).not.toContain('secreto@ejemplo.com')
    }
  })
})
```

- [ ] **Paso 3: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/recoleccion/parseadorFgUser.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 4: Escribir la implementación**

Fichero `src/recoleccion/parseadorFgUser.ts`:

```ts
export type DatosUsuario = {
  idUsuario: number
  idUc: number
  idComunidad: number
  equipo: string
  saldo: number
  saldoFuturo: number
  /** `maxDebt`: saldo + 25 % del valor de plantilla. */
  topePuja: number
  creditos: number
}

export class FgUserNoEncontradoError extends Error {
  constructor() {
    super('la página no contiene var _FG_user: ¿sesión caducada o ruta equivocada?')
    this.name = 'FgUserNoEncontradoError'
  }
}

/**
 * Extrae el bloque `var _FG_user = {...}` que Mister incrusta en cada página.
 *
 * Ningún mensaje de error incluye el objeto crudo: contiene el correo y los
 * identificadores de Apple/Google del usuario.
 */
export function parsearFgUser(html: string): DatosUsuario {
  const inicio = html.indexOf('var _FG_user')
  if (inicio < 0) throw new FgUserNoEncontradoError()

  const llave = html.indexOf('{', inicio)
  if (llave < 0) throw new FgUserNoEncontradoError()

  const bruto = recortarObjeto(html, llave)
  let datos: Record<string, unknown>
  try {
    datos = JSON.parse(bruto) as Record<string, unknown>
  } catch {
    throw new FgUserNoEncontradoError()
  }

  const balance = datos['balance']
  if (!balance || typeof balance !== 'object') {
    throw new Error('_FG_user no trae el bloque balance')
  }
  const b = balance as Record<string, unknown>

  return {
    idUsuario: entero(datos['id'], 'id'),
    idUc: entero(datos['id_uc'], 'id_uc'),
    idComunidad: entero(datos['id_community'], 'id_community'),
    equipo: texto(datos['uc_name'], 'uc_name'),
    saldo: entero(b['current'], 'balance.current'),
    saldoFuturo: entero(b['future'], 'balance.future'),
    topePuja: entero(b['maxDebt'], 'balance.maxDebt'),
    creditos: entero(datos['credits'], 'credits'),
  }
}

/** Recorta el objeto JSON contando llaves, respetando las cadenas. */
function recortarObjeto(texto: string, desde: number): string {
  let nivel = 0, enCadena = false, escapado = false
  for (let i = desde; i < texto.length; i++) {
    const c = texto[i]
    if (escapado) { escapado = false; continue }
    if (c === '\\') { escapado = true; continue }
    if (c === '"') { enCadena = !enCadena; continue }
    if (enCadena) continue
    if (c === '{') nivel++
    else if (c === '}') { nivel--; if (nivel === 0) return texto.slice(desde, i + 1) }
  }
  throw new FgUserNoEncontradoError()
}

function entero(valor: unknown, campo: string): number {
  if (!Number.isInteger(valor)) {
    throw new Error(`el campo ${campo} de _FG_user no es un entero`)
  }
  return valor as number
}

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor === '') {
    throw new Error(`el campo ${campo} de _FG_user no es un texto`)
  }
  return valor
}
```

- [ ] **Paso 5: Ejecutar y comprobar que pasan**

Ejecutar: `npx vitest run tests/recoleccion/parseadorFgUser.test.ts`
Esperado: PASA, 7 tests.

- [ ] **Paso 6: Commit**

```bash
npm test && npm run typecheck
git add src/recoleccion/parseadorFgUser.ts tests/recoleccion/parseadorFgUser.test.ts fixtures/fg-user.json
git commit -m "feat: parseador de _FG_user con saldo y tope de puja"
```

---

### Tarea 4: Parseadores de plantilla y de la serie de valores

**Ficheros:**
- Crear: `src/recoleccion/parseadorPlantilla.ts`
- Crear: `src/recoleccion/parseadorValores.ts`
- Crear: `tests/recoleccion/parseadorPlantilla.test.ts`
- Crear: `tests/recoleccion/parseadorValores.test.ts`

**Interfaces:**
- Produce:
  - `function parsearPlantilla(html: string): number[]` — identificadores de jugador, sin repetir, en orden de aparición
  - `function parsearSerieValores(html: string): PuntoValor[]`
  - `type PuntoValor = { fecha: string; valor: number }` — `fecha` en ISO `YYYY-MM-DD`
  - `function valorEn(serie: PuntoValor[], fechaIso: string): number | null`
  - `class SerieVaciaError extends Error`

**Por qué existe.** El reparto inicial de un equipo se compone de los jugadores
que vendió sin haberlos comprado **más los que aún conserva sin haberlos
comprado**, y esos segundos solo se conocen leyendo su plantilla actual. Y para
valorar el reparto hace falta el valor de cada jugador el día del reinicio.

**La serie está en el HTML**, no hace falta navegador:
`{"value":"6792000","date":"3 ago 2026"}`.

Tres trampas confirmadas: la serie **trae entradas repetidas** (68 puntos para
66 días), **las fechas van en castellano abreviado**, y **los valores están
redondeados a millares**.

- [ ] **Paso 1: Escribir el test de la plantilla**

Fichero `tests/recoleccion/parseadorPlantilla.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parsearPlantilla } from '../../src/recoleccion/parseadorPlantilla.js'

const pagina = (enlaces: string[]) =>
  `<html><body>${enlaces.map((h) => `<a href="${h}">x</a>`).join('')}</body></html>`

describe('parsearPlantilla', () => {
  it('extrae los identificadores de los enlaces a jugador', () => {
    expect(parsearPlantilla(pagina(['players/34/jose-gimenez', 'players/364/sergio-canales']))).toEqual([34, 364])
  })

  it('acepta rutas absolutas', () => {
    expect(parsearPlantilla(pagina(['https://mister.mundodeportivo.com/players/34/x']))).toEqual([34])
  })

  it('no repite un jugador que aparece en varios enlaces', () => {
    expect(parsearPlantilla(pagina(['players/34/x', 'players/34/x']))).toEqual([34])
  })

  it('ignora enlaces que no son de jugador', () => {
    expect(parsearPlantilla(pagina(['users/123/equipo', 'players/34/x', '/market']))).toEqual([34])
  })

  it('devuelve vacío si no hay jugadores', () => {
    expect(parsearPlantilla('<html><body>nada</body></html>')).toEqual([])
  })
})
```

- [ ] **Paso 2: Escribir el test de la serie de valores**

Fichero `tests/recoleccion/parseadorValores.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SerieVaciaError, parsearSerieValores, valorEn } from '../../src/recoleccion/parseadorValores.js'

const con = (pares: [string, string][]) =>
  `<html><script>var x = [${pares.map(([v, d]) => `{"value":"${v}","date":"${d}"}`).join(',')}];</script></html>`

describe('parsearSerieValores', () => {
  it('extrae los puntos con la fecha en ISO', () => {
    expect(parsearSerieValores(con([['6792000', '3 ago 2026']]))).toEqual([{ fecha: '2026-08-03', valor: 6792000 }])
  })

  it('traduce los doce meses del castellano abreviado', () => {
    const meses: [string, string][] = [
      ['1', '1 ene 2026'], ['2', '1 feb 2026'], ['3', '1 mar 2026'], ['4', '1 abr 2026'],
      ['5', '1 may 2026'], ['6', '1 jun 2026'], ['7', '1 jul 2026'], ['8', '1 ago 2026'],
      ['9', '1 sep 2026'], ['10', '1 oct 2026'], ['11', '1 nov 2026'], ['12', '1 dic 2026'],
    ]
    const s = parsearSerieValores(con(meses))
    expect(s.map((p) => p.fecha.slice(5, 7))).toEqual(
      ['01','02','03','04','05','06','07','08','09','10','11','12'])
  })

  it('rellena con cero el día de una cifra', () => {
    expect(parsearSerieValores(con([['1', '3 ago 2026']]))[0]!.fecha).toBe('2026-08-03')
  })

  it('elimina fechas repetidas quedándose con la primera', () => {
    const s = parsearSerieValores(con([['100', '3 ago 2026'], ['200', '3 ago 2026']]))
    expect(s).toHaveLength(1)
    expect(s[0]!.valor).toBe(100)
  })

  it('devuelve la serie ordenada cronológicamente', () => {
    const s = parsearSerieValores(con([['2', '5 ago 2026'], ['1', '3 ago 2026'], ['3', '7 ago 2026']]))
    expect(s.map((p) => p.valor)).toEqual([1, 2, 3])
  })

  it('lanza si un mes no se reconoce', () => {
    expect(() => parsearSerieValores(con([['1', '3 xxx 2026']]))).toThrow(/mes/i)
  })

  it('lanza si la página no trae ningún punto', () => {
    expect(() => parsearSerieValores('<html>nada</html>')).toThrow(SerieVaciaError)
  })
})

describe('valorEn', () => {
  const serie = parsearSerieValores(con([['100', '3 ago 2026'], ['200', '5 ago 2026']]))

  it('devuelve el valor de una fecha presente', () => {
    expect(valorEn(serie, '2026-08-03')).toBe(100)
  })

  it('devuelve null si la fecha no está en la serie', () => {
    expect(valorEn(serie, '2026-08-04')).toBe(null)
  })
})
```

- [ ] **Paso 3: Ejecutar y comprobar que fallan**

Ejecutar: `npx vitest run tests/recoleccion/parseadorPlantilla.test.ts tests/recoleccion/parseadorValores.test.ts`
Esperado: FALLAN por módulos inexistentes.

- [ ] **Paso 4: Implementar el parseador de plantilla**

Fichero `src/recoleccion/parseadorPlantilla.ts`:

```ts
/**
 * Identificadores de los jugadores de una plantilla, leídos de los enlaces
 * `players/{id}/{slug}` de la página de un equipo.
 */
export function parsearPlantilla(html: string): number[] {
  const vistos = new Set<number>()
  const orden: number[] = []

  for (const m of html.matchAll(/href="[^"]*players\/(\d+)\//g)) {
    const id = Number(m[1])
    if (!vistos.has(id)) { vistos.add(id); orden.push(id) }
  }

  return orden
}
```

- [ ] **Paso 5: Implementar el parseador de valores**

Fichero `src/recoleccion/parseadorValores.ts`:

```ts
export type PuntoValor = {
  /** ISO `YYYY-MM-DD`. */
  fecha: string
  /** Entero. Mister lo publica redondeado a millares. */
  valor: number
}

export class SerieVaciaError extends Error {
  constructor() {
    super('la ficha no contiene ninguna serie de valores')
    this.name = 'SerieVaciaError'
  }
}

const MESES: Record<string, string> = {
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12',
}

/**
 * Serie diaria de valor de un jugador, incrustada en el HTML de su ficha como
 * objetos `{"value":"...","date":"..."}`.
 *
 * Deduplica por fecha y ordena cronológicamente: el HTML trae entradas
 * repetidas y no viene en orden.
 */
export function parsearSerieValores(html: string): PuntoValor[] {
  const porFecha = new Map<string, number>()

  for (const m of html.matchAll(/\{"value":"(\d+)","date":"([^"]+)"\}/g)) {
    const fecha = aIso(m[2]!)
    if (!porFecha.has(fecha)) porFecha.set(fecha, Number(m[1]))
  }

  if (porFecha.size === 0) throw new SerieVaciaError()

  return [...porFecha.entries()]
    .map(([fecha, valor]) => ({ fecha, valor }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
}

function aIso(fecha: string): string {
  const partes = fecha.trim().split(/\s+/)
  const [dia, mes, anio] = partes
  const mm = mes ? MESES[mes.toLowerCase()] : undefined
  if (!mm) throw new Error(`mes no reconocido en la fecha ${JSON.stringify(fecha)}`)
  return `${anio}-${mm}-${String(dia).padStart(2, '0')}`
}

/** Valor exacto en una fecha, o null si ese día no está en la serie. */
export function valorEn(serie: PuntoValor[], fechaIso: string): number | null {
  return serie.find((p) => p.fecha === fechaIso)?.valor ?? null
}
```

- [ ] **Paso 6: Ejecutar y comprobar que pasan**

Ejecutar: `npx vitest run tests/recoleccion/parseadorPlantilla.test.ts tests/recoleccion/parseadorValores.test.ts`
Esperado: PASAN, 5 y 9 tests.

- [ ] **Paso 7: Commit**

```bash
npm test && npm run typecheck
git add src/recoleccion/parseadorPlantilla.ts src/recoleccion/parseadorValores.ts tests/
git commit -m "feat: parseadores de plantilla y de la serie histórica de valores"
```

---

### Tarea 5: Recolección de los datos auxiliares

**Ficheros:**
- Modificar: `src/recoleccion/cliente.ts` (añadir `pedirPagina`)
- Modificar: `src/almacen/esquema.ts` y `src/almacen/crudo.ts` (tabla de páginas)
- Crear: `src/recoleccion/auxiliares.ts`
- Crear: `tests/recoleccion/auxiliares.test.ts`
- Modificar: `package.json`

**Interfaces:**
- Consume: `Cliente`, `Almacen`, `parsearPlantilla`, `parsearSerieValores`, `parsearFgUser`.
- Produce:
  - En `Cliente`: `pedirPagina(ruta: string): Promise<string>`
  - En `Almacen`: `guardarPagina(p: PaginaGuardada): void`, `leerPagina(ruta: string): PaginaGuardada | null`, `rutasGuardadas(): string[]`
  - `type PaginaGuardada = { ruta: string; cuerpo: string; capturadaEn: string }`
  - `async function recolectarAuxiliares(dep: DependenciasAux): Promise<ResumenAux>`
  - `type DependenciasAux = { cliente: Cliente; almacen: Almacen; idsUc: number[]; idsJugador: number[]; maxEdadMs?: number; ahora?: () => number }`
  - `type ResumenAux = { plantillas: number; jugadores: number; yaEnCache: number }`

`maxEdadMs` por defecto es **12 horas**. Una captura más vieja se vuelve a
pedir; una más reciente se reutiliza. `ahora` se inyecta para poder probar la
caducidad sin esperar.

Las páginas se guardan crudas y **se reutilizan mientras sigan frescas**: son
~130 fichas de jugador, y volver a pedirlas en cada análisis castigaría el
servidor sin motivo.

**Pero el usuario necesita refrescar y que se recalcule todo**, y hay dos clases
de dato con caducidades muy distintas:

- El **valor de un jugador en una fecha pasada** no cambia nunca.
- La **plantilla actual** de un equipo y el **valor de hoy** cambian con cada
  fichaje.

Por eso la caché lleva **edad máxima**, y la tabla guarda una fila por captura
—clave `(ruta, capturada_en)`— en vez de una por ruta. Así el refresco **añade
una versión nueva** en lugar de sobrescribir, y la capa cruda mantiene su regla:
nada se pierde. `leerPagina` devuelve siempre la captura más reciente.

- [ ] **Paso 1: Escribir el test**

Fichero `tests/recoleccion/auxiliares.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { abrirAlmacen } from '../../src/almacen/crudo.js'
import { recolectarAuxiliares } from '../../src/recoleccion/auxiliares.js'
import type { Cliente } from '../../src/recoleccion/cliente.js'

const pagJugador = (v: number) =>
  `<html><script>[{"value":"${v}","date":"3 ago 2026"}]</script></html>`
const pagEquipo = '<html><a href="players/34/x">j</a></html>'

function clienteFalso(): Cliente & { pedidas: string[] } {
  const pedidas: string[] = []
  return {
    pedidas,
    async pedirLote() { throw new Error('no usado') },
    async pedirPagina(ruta: string) {
      pedidas.push(ruta)
      return ruta.includes('/players/') ? pagJugador(1000) : pagEquipo
    },
  } as Cliente & { pedidas: string[] }
}

describe('recolectarAuxiliares', () => {
  it('pide una página por equipo y otra por jugador', async () => {
    const a = abrirAlmacen(':memory:'), c = clienteFalso()
    const r = await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1, 2], idsJugador: [34] })
    expect(r.plantillas).toBe(2)
    expect(r.jugadores).toBe(1)
    expect(c.pedidas).toHaveLength(3)
    a.cerrar()
  })

  it('guarda cada página cruda con su ruta', async () => {
    const a = abrirAlmacen(':memory:')
    await recolectarAuxiliares({ cliente: clienteFalso(), almacen: a, idsUc: [1], idsJugador: [] })
    expect(a.leerPagina('/users/1/x')!.cuerpo).toBe(pagEquipo)
    a.cerrar()
  })

  it('no vuelve a pedir una página guardada que sigue fresca', async () => {
    const a = abrirAlmacen(':memory:'), c = clienteFalso()
    await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [] })
    const r = await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [] })
    expect(c.pedidas).toHaveLength(1)
    expect(r.yaEnCache).toBe(1)
    a.cerrar()
  })

  it('vuelve a pedir una página cuya captura ha caducado', async () => {
    const a = abrirAlmacen(':memory:'), c = clienteFalso()
    let t = Date.parse('2026-09-03T10:00:00Z')
    const ahora = () => t
    await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [], ahora })
    t += 13 * 60 * 60 * 1000   // trece horas después
    const r = await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [], ahora })
    expect(c.pedidas).toHaveLength(2)
    expect(r.plantillas).toBe(1)
    expect(r.yaEnCache).toBe(0)
    a.cerrar()
  })

  it('respeta una edad máxima explícita', async () => {
    const a = abrirAlmacen(':memory:'), c = clienteFalso()
    let t = Date.parse('2026-09-03T10:00:00Z')
    const ahora = () => t
    await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [], ahora, maxEdadMs: 60_000 })
    t += 61_000
    await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [], ahora, maxEdadMs: 60_000 })
    expect(c.pedidas).toHaveLength(2)
    a.cerrar()
  })

  it('lanza si una captura guardada tiene la fecha ilegible', async () => {
    const a = abrirAlmacen(':memory:')
    a.guardarPagina({ ruta: '/users/1/x', cuerpo: 'x', capturadaEn: 'no es una fecha' })
    await expect(
      recolectarAuxiliares({ cliente: clienteFalso(), almacen: a, idsUc: [1], idsJugador: [] }),
    ).rejects.toThrow(/ilegible/i)
    a.cerrar()
  })

  it('propaga el error si una página no se puede pedir', async () => {
    const a = abrirAlmacen(':memory:')
    const c = { async pedirLote() { throw new Error('x') }, pedirPagina: vi.fn(async () => { throw new Error('caída') }) } as unknown as Cliente
    await expect(recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [] })).rejects.toThrow(/caída/)
    a.cerrar()
  })
})
```

- [ ] **Paso 2: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/recoleccion/auxiliares.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 3: Añadir `pedirPagina` al cliente**

En `src/recoleccion/cliente.ts`, añadir al tipo `Cliente`:

```ts
  /** Pide una página HTML cualquiera, con el mismo regulador de ritmo. */
  pedirPagina(ruta: string): Promise<string>
```

`pedirLote` y `pedirPagina` comparten el bucle de reintentos, el regulador de
ritmo y el tratamiento del 401. **Extrae ese bucle a una función interna** en
vez de duplicarlo — la duplicación de una lógica así fue la causa directa del
fallo crítico de la Fase 1:

```ts
  /** Bucle común de ritmo, reintentos y 401. Devuelve el cuerpo como texto. */
  async function pedir(descripcion: string, init: RequestInit, ruta: string): Promise<string> {
    let ultimoFallo: Error | undefined

    for (let intento = 0; intento < REINTENTOS; intento++) {
      if (intento > 0) await dormir(esperaMs * 2 ** intento)
      await respetarRitmo()

      let res: Response
      try {
        res = await hacerFetch(`${base}${ruta}`, init)
      } catch (causa) {
        ultimoFallo = new Error(`${descripcion} falló por red: ${(causa as Error).message}`)
        continue
      }

      if (res.status === 401) {
        throw new Error(
          'credenciales de Mister caducadas o no válidas. Vuelve a copiar la cookie y el token del navegador.',
        )
      }
      if (res.ok) return await res.text()

      ultimoFallo = new Error(`${descripcion} devolvió HTTP ${res.status}`)
    }

    throw ultimoFallo ?? new Error(`no se pudo completar ${descripcion}`)
  }
```

`pedirLote` pasa a llamarlo con su `POST` y su cuerpo; `pedirPagina` con:

```ts
    async pedirPagina(ruta: string): Promise<string> {
      return pedir(`la página ${ruta}`, {
        method: 'GET',
        headers: {
          Cookie: opciones.credenciales.cookie,
          'X-Auth': opciones.credenciales.auth,
          Accept: 'text/html',
        },
      }, ruta)
    },
```

Los tests existentes del cliente deben seguir pasando sin tocarlos: si alguno
falla, el refactor cambió el comportamiento y hay que corregirlo, no el test.

- [ ] **Paso 4: Añadir la tabla de páginas al almacén**

En `src/almacen/esquema.ts`, añadir al SQL:

```sql
CREATE TABLE IF NOT EXISTS paginas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ruta         TEXT NOT NULL,
  cuerpo       TEXT NOT NULL,
  capturada_en TEXT NOT NULL,
  UNIQUE (ruta, capturada_en)
);
CREATE INDEX IF NOT EXISTS idx_paginas_ruta ON paginas (ruta, capturada_en DESC);
```

La clave es el par `(ruta, capturada_en)`, no la ruta: un refresco **añade** una
captura nueva sin destruir la anterior.

En `src/almacen/crudo.ts`, añadir el tipo y las tres operaciones:

```ts
export type PaginaGuardada = {
  ruta: string
  cuerpo: string
  capturadaEn: string
}

/** Se intentó guardar dos veces la misma ruta. */
export class PaginaDuplicadaError extends Error {
  readonly ruta: string

  constructor(ruta: string) {
    super(`la página ${ruta} ya está guardada. El crudo no se sobrescribe.`)
    this.name = 'PaginaDuplicadaError'
    this.ruta = ruta
  }
}
```

dentro de `abrirAlmacen`, las sentencias:

```ts
  const insertarPagina = db.prepare(
    `INSERT INTO paginas (ruta, cuerpo, capturada_en) VALUES (@ruta, @cuerpo, @capturadaEn)`,
  )
  // La más reciente de esa ruta.
  const seleccionarPagina = db.prepare(
    `SELECT ruta, cuerpo, capturada_en AS capturadaEn FROM paginas
     WHERE ruta = ? ORDER BY capturada_en DESC LIMIT 1`,
  )
  const listarRutas = db.prepare(`SELECT DISTINCT ruta FROM paginas ORDER BY ruta`)
```

y los tres métodos del objeto devuelto:

```ts
    guardarPagina(p: PaginaGuardada) {
      try {
        insertarPagina.run(p)
      } catch (e) {
        // Solo colisiona si se guarda dos veces la MISMA ruta en el MISMO
        // instante; un refresco posterior añade una captura nueva sin chocar.
        if (esViolacionDeUnicidad(e)) throw new PaginaDuplicadaError(p.ruta)
        throw e
      }
    },
    leerPagina(ruta: string) {
      return (seleccionarPagina.get(ruta) as PaginaGuardada | undefined) ?? null
    },
    rutasGuardadas() {
      return (listarRutas.all() as { ruta: string }[]).map((f) => f.ruta)
    },
```

Añádelos también al tipo `Almacen`. Reutiliza el `esViolacionDeUnicidad` que ya
existe en el fichero; si comprueba columnas concretas de `capturas`, generalízalo
para que sirva a ambas tablas, con su test.

Añade a `tests/almacen/crudo.test.ts`:

```ts
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
```

- [ ] **Paso 5: Implementar la recolección auxiliar**

Fichero `src/recoleccion/auxiliares.ts`:

```ts
import type { Almacen } from '../almacen/crudo.js'
import type { Cliente } from './cliente.js'

const DOCE_HORAS_MS = 12 * 60 * 60 * 1000

export type DependenciasAux = {
  cliente: Cliente
  almacen: Almacen
  idsUc: number[]
  idsJugador: number[]
  /** Edad a partir de la cual una captura se considera caducada. 12 h por defecto. */
  maxEdadMs?: number
  ahora?: () => number
}

export type ResumenAux = {
  plantillas: number
  jugadores: number
  yaEnCache: number
}

export const rutaEquipo = (idUc: number) => `/users/${idUc}/x`
export const rutaJugador = (idJugador: number) => `/players/${idJugador}/x`

/**
 * Descarga las plantillas actuales y las fichas de jugador que hacen falta.
 *
 * Reutiliza lo guardado mientras siga fresco: son más de cien fichas y volver a
 * pedirlas en cada análisis castigaría el servidor. Pero la plantilla de un
 * equipo y el valor de hoy cambian con cada fichaje, así que la caché caduca:
 * pasada `maxEdadMs`, se vuelve a pedir y se guarda una captura nueva junto a
 * la vieja, sin destruirla.
 */
export async function recolectarAuxiliares(dep: DependenciasAux): Promise<ResumenAux> {
  const resumen: ResumenAux = { plantillas: 0, jugadores: 0, yaEnCache: 0 }
  const maxEdadMs = dep.maxEdadMs ?? DOCE_HORAS_MS
  const ahora = dep.ahora ?? (() => Date.now())

  const fresca = (capturadaEn: string): boolean => {
    const t = Date.parse(capturadaEn)
    if (Number.isNaN(t)) {
      throw new Error(`la captura guardada tiene una fecha ilegible: ${JSON.stringify(capturadaEn)}`)
    }
    return ahora() - t < maxEdadMs
  }

  const pedir = async (ruta: string, contador: 'plantillas' | 'jugadores') => {
    const guardada = dep.almacen.leerPagina(ruta)
    if (guardada && fresca(guardada.capturadaEn)) { resumen.yaEnCache++; return }
    const cuerpo = await dep.cliente.pedirPagina(ruta)
    dep.almacen.guardarPagina({ ruta, cuerpo, capturadaEn: new Date(ahora()).toISOString() })
    resumen[contador]++
  }

  for (const idUc of dep.idsUc) await pedir(rutaEquipo(idUc), 'plantillas')
  for (const id of dep.idsJugador) await pedir(rutaJugador(id), 'jugadores')

  return resumen
}
```

- [ ] **Paso 6: Ejecutar y comprobar que pasan**

Ejecutar: `npm test`
Esperado: todo en verde.

- [ ] **Paso 7: Commit**

```bash
npm run typecheck
git add src/recoleccion src/almacen tests/
git commit -m "feat: recolección de plantillas y fichas de jugador, con reutilización"
```

---

### Tarea 6: Reconstrucción del reparto inicial

**Ficheros:**
- Crear: `src/contabilidad/reparto.ts`
- Crear: `tests/contabilidad/reparto.test.ts`

**Interfaces:**
- Consume: `Evento`, `Transaccion`, `BajaPlantilla`.
- Produce:
  - `function reconstruirRepartos(eventos: Evento[], plantillas: Map<number, number[]>): Map<number, RepartoEquipo>`
  - `type RepartoEquipo = { idUc: number; nombre: string; jugadores: number[]; porVenta: number[]; porPlantilla: number[]; porBaja: number[] }`

**La regla, que costó descubrir.** Un jugador formaba parte del reparto inicial
de un equipo si se da alguna de estas tres cosas:

1. **Lo vendió sin haberlo comprado antes** (recorriendo en orden cronológico).
2. **Lo conserva hoy sin haberlo comprado** (de ahí que hagan falta las
   plantillas actuales; los equipos que apenas han vendido tienen ahí casi todo
   su reparto).
3. **Desapareció por una baja de plantilla** sin que ningún equipo lo comprara
   ni vendiera. Este tercer caso es el que faltaba: Ronald Araújo se esfumó del
   reparto propio sin dejar rastro en el feed.

El caso 3 tiene una ambigüedad real: una baja no dice **de quién** era el
jugador. Se le asigna al equipo que lo tuviera, y si nadie lo compró ni lo
vendió nunca, no hay forma de saberlo desde el feed. **Esos jugadores se
devuelven aparte**, en `porBaja`, para que quien llame decida — el motor los
tratará como incertidumbre declarada, nunca repartidos a ojo.

- [ ] **Paso 1: Escribir el test que falla**

Fichero `tests/contabilidad/reparto.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { reconstruirRepartos } from '../../src/contabilidad/reparto.js'
import type { Evento, Transaccion } from '../../src/dominio/eventos.js'

let n = 0
const mov = (
  idJugador: number, deIdUc: number | null, aIdUc: number | null, fecha: string,
): Transaccion => ({
  tipo: 'transaccion', idEvento: ++n, idTransfer: n, fecha,
  jugador: 'J' + idJugador, idJugador,
  origen: deIdUc === null ? { clase: 'mercado' } : { clase: 'equipo', idUc: deIdUc, nombre: 'E' + deIdUc },
  destino: aIdUc === null ? { clase: 'mercado' } : { clase: 'equipo', idUc: aIdUc, nombre: 'E' + aIdUc },
  importe: 100, operacion: 'normal',
})

const baja = (idJugador: number, fecha: string): Evento => ({
  tipo: 'bajaPlantilla', idEvento: ++n, fecha, idJugador, jugador: 'J' + idJugador,
})

describe('reconstruirRepartos', () => {
  it('un jugador vendido sin haberlo comprado era del reparto', () => {
    const r = reconstruirRepartos([mov(10, 1, null, '2026-08-05 10:00:00')], new Map([[1, []]]))
    expect(r.get(1)!.porVenta).toEqual([10])
    expect(r.get(1)!.jugadores).toContain(10)
  })

  it('un jugador comprado y luego vendido NO era del reparto', () => {
    const eventos = [mov(10, null, 1, '2026-08-04 10:00:00'), mov(10, 1, null, '2026-08-06 10:00:00')]
    expect(reconstruirRepartos(eventos, new Map([[1, []]])).get(1)!.jugadores).toEqual([])
  })

  it('un jugador que conserva sin haberlo comprado era del reparto', () => {
    const r = reconstruirRepartos([], new Map([[1, [20]]]))
    expect(r.get(1)!.porPlantilla).toEqual([20])
  })

  it('un jugador que conserva y sí compró no era del reparto', () => {
    const r = reconstruirRepartos([mov(20, null, 1, '2026-08-04 10:00:00')], new Map([[1, [20]]]))
    expect(r.get(1)!.jugadores).toEqual([])
  })

  it('una baja de un jugador que nadie tocó queda en porBaja, sin dueño', () => {
    const r = reconstruirRepartos([baja(99, '2026-08-10 10:00:00'), mov(10, 1, null, '2026-08-05 10:00:00')], new Map([[1, []]]))
    expect(r.get(1)!.porBaja).toEqual([])
    expect([...r.values()].flatMap((x) => x.jugadores)).not.toContain(99)
  })

  it('una baja de un jugador que un equipo tenía se le asigna', () => {
    // El equipo 1 lo compró y nunca lo vendió: cuando causa baja, era suyo.
    const eventos = [mov(30, null, 1, '2026-08-04 10:00:00'), baja(30, '2026-08-10 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []]]))
    // Lo compró, así que NO es del reparto inicial aunque cause baja.
    expect(r.get(1)!.jugadores).toEqual([])
  })

  it('no cuenta dos veces a un jugador vendido y luego recomprado y conservado', () => {
    const eventos = [mov(40, 1, null, '2026-08-05 10:00:00'), mov(40, null, 1, '2026-08-09 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, [40]]]))
    expect(r.get(1)!.jugadores).toEqual([40])
  })

  it('separa correctamente a dos equipos', () => {
    const eventos = [mov(10, 1, null, '2026-08-05 10:00:00'), mov(11, 2, null, '2026-08-05 11:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []], [2, []]]))
    expect(r.get(1)!.jugadores).toEqual([10])
    expect(r.get(2)!.jugadores).toEqual([11])
  })

  it('un traspaso entre equipos por cláusula no hace al jugador del reparto del comprador', () => {
    const eventos = [mov(50, 1, 2, '2026-08-05 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []], [2, [50]]]))
    expect(r.get(1)!.jugadores).toEqual([50])
    expect(r.get(2)!.jugadores).toEqual([])
  })
})
```

- [ ] **Paso 2: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/contabilidad/reparto.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 3: Escribir la implementación**

Fichero `src/contabilidad/reparto.ts`. Usa `Transaccion.idJugador`, añadido en
la Tarea 1.

```ts
import type { Evento, Transaccion } from '../dominio/eventos.js'

export type RepartoEquipo = {
  idUc: number
  nombre: string
  /** Unión sin repetidos de las tres vías. */
  jugadores: number[]
  porVenta: number[]
  porPlantilla: number[]
  porBaja: number[]
}

/**
 * Reconstruye qué jugadores recibió cada equipo en el reinicio de la liga.
 *
 * Tres vías, y las tres hacen falta:
 *  - vendió al jugador sin haberlo comprado antes,
 *  - lo conserva hoy sin haberlo comprado,
 *  - desapareció por una baja de plantilla estando en su poder.
 *
 * La tercera es la que se descubrió tarde: un jugador del reparto puede
 * esfumarse al abandonar LaLiga sin dejar ningún movimiento en el feed.
 */
export function reconstruirRepartos(
  eventos: Evento[],
  plantillas: Map<number, number[]>,
): Map<number, RepartoEquipo> {
  const cronologico = [...eventos].sort((a, b) => a.fecha.localeCompare(b.fecha))

  const repartos = new Map<number, RepartoEquipo>()
  const comprados = new Map<number, Set<number>>()   // idUc -> jugadores comprados
  const nombres = new Map<number, string>()

  const equipo = (idUc: number): RepartoEquipo => {
    let r = repartos.get(idUc)
    if (!r) {
      r = { idUc, nombre: nombres.get(idUc) ?? '', jugadores: [], porVenta: [], porPlantilla: [], porBaja: [] }
      repartos.set(idUc, r)
    }
    return r
  }
  const compradosDe = (idUc: number): Set<number> => {
    let s = comprados.get(idUc)
    if (!s) { s = new Set(); comprados.set(idUc, s) }
    return s
  }

  for (const idUc of plantillas.keys()) equipo(idUc)

  // 1 y preparación: recorrer los movimientos en orden cronológico.
  for (const e of cronologico) {
    if (e.tipo !== 'transaccion') continue
    const t = e as Transaccion

    if (t.origen.clase === 'equipo') {
      const idUc = t.origen.idUc
      nombres.set(idUc, t.origen.nombre)
      const r = equipo(idUc)
      r.nombre = t.origen.nombre
      if (!compradosDe(idUc).has(t.idJugador) && !r.porVenta.includes(t.idJugador)) {
        r.porVenta.push(t.idJugador)
      }
    }

    if (t.destino.clase === 'equipo') {
      const idUc = t.destino.idUc
      nombres.set(idUc, t.destino.nombre)
      equipo(idUc).nombre = t.destino.nombre
      compradosDe(idUc).add(t.idJugador)
    }
  }

  // 2: los que conserva sin haberlos comprado.
  for (const [idUc, jugadores] of plantillas) {
    const r = equipo(idUc)
    for (const id of jugadores) {
      if (!compradosDe(idUc).has(id) && !r.porVenta.includes(id)) r.porPlantilla.push(id)
    }
  }

  // 3: bajas de jugadores que un equipo tuviera del reparto y nunca movió.
  //    Si nadie lo compró ni lo vendió, no hay forma de saber de quién era:
  //    se deja fuera y el motor lo declarará como incertidumbre.
  for (const [, r] of repartos) {
    r.jugadores = [...new Set([...r.porVenta, ...r.porPlantilla, ...r.porBaja])]
    r.nombre = nombres.get(r.idUc) ?? r.nombre
  }

  return repartos
}
```

- [ ] **Paso 4: Ejecutar y comprobar que pasan**

Ejecutar: `npx vitest run tests/contabilidad/reparto.test.ts`
Esperado: PASA, 9 tests.

- [ ] **Paso 5: Comprobar contra el histórico real**

Script temporal sobre el volcado más las plantillas ya recolectadas.
Esperado: **cada equipo con 15 jugadores** en su reparto, salvo Neky F.C. con
16. El reparto propio debe contener los 14 vendidos más Fer Niño (id 20449).
Ronald Araújo (id 19977) **no** aparecerá: se resuelve en la Tarea 7.

- [ ] **Paso 6: Commit**

```bash
npm test && npm run typecheck
git add src/contabilidad/reparto.ts tests/contabilidad/reparto.test.ts src/dominio/eventos.ts
git commit -m "feat: reconstrucción del reparto inicial por sus tres vías"
```

---

### Tarea 6b: Asignación de las bajas sin dueño

**Ficheros:**
- Crear: `src/contabilidad/asignaciones.ts`
- Crear: `tests/contabilidad/asignaciones.test.ts`
- Crear: `datos/bajas-asignadas.json` (no versionado: `datos/` está en `.gitignore`)
- Modificar: `src/contabilidad/reparto.ts`
- Modificar: `tests/contabilidad/reparto.test.ts`

**Interfaces:**
- Produce:
  - `function leerAsignaciones(ruta: string): Map<number, number>` — idJugador → idUc
  - `class AsignacionesIlegiblesError extends Error`
  - `reconstruirRepartos` gana un tercer parámetro: `asignaciones: Map<number, number>`
  - `RepartoEquipo.porBaja` pasa a contener las bajas **asignadas** a ese equipo
  - `function bajasSinDuenio(eventos: Evento[], repartos: Map<number, RepartoEquipo>): number[]`

**El problema que resuelve, y por qué no tiene solución automática.**

Un jugador puede desaparecer del reparto inicial de un equipo al abandonar
LaLiga, sin dejar **ningún** rastro en el feed. Le ocurrió a Ronald Araújo
(idJugador 19977) con el equipo propio: valía 4.847.000 € el día del reinicio, y
sin él el saldo calculado se desviaba exactamente en esa cantidad.

**Se comprobó que no hay forma de deducir de quién era:** su ficha de jugador no
menciona ningún equipo de la liga, y el feed no registra la baja como
movimiento. La información no existe en ninguna fuente accesible.

Por eso la asignación es **un dato de entrada que aporta la persona**, no algo
que el programa adivine. Un reparto por ajuste —buscar qué baja cuadra con el
desvío— produciría exactamente la cifra plausible y equivocada que este proyecto
prohíbe.

**Formato del fichero**, con la única asignación conocida hoy y su
justificación:

```json
{
  "comentario": "Bajas por salida de LaLiga cuyo dueño no consta en ninguna fuente. Se asignan a mano.",
  "asignaciones": [
    {
      "idJugador": 19977,
      "jugador": "Ronald Araújo",
      "idUc": 12493763,
      "equipo": "Niutin FC (Isaac)",
      "motivo": "Valía 4.847.000 € el 2026-08-03 y es exactamente lo que faltaba para cuadrar el saldo propio con el que publica Mister."
    }
  ]
}
```

- [ ] **Paso 1: Escribir el test de las asignaciones**

Fichero `tests/contabilidad/asignaciones.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AsignacionesIlegiblesError, leerAsignaciones } from '../../src/contabilidad/asignaciones.js'

function ficheroCon(contenido: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mister-asig-'))
  const ruta = join(dir, 'bajas-asignadas.json')
  writeFileSync(ruta, contenido)
  return ruta
}

const valido = JSON.stringify({
  asignaciones: [{ idJugador: 19977, jugador: 'Ronald Araújo', idUc: 12493763, equipo: 'X', motivo: 'y' }],
})

describe('leerAsignaciones', () => {
  it('lee las asignaciones como un mapa de jugador a equipo', () => {
    expect(leerAsignaciones(ficheroCon(valido)).get(19977)).toBe(12493763)
  })

  it('devuelve un mapa vacío si el fichero no existe', () => {
    expect(leerAsignaciones('/ruta/que/no/existe').size).toBe(0)
  })

  it('acepta un fichero sin asignaciones', () => {
    expect(leerAsignaciones(ficheroCon('{"asignaciones":[]}')).size).toBe(0)
  })

  it('lanza si el fichero no es JSON', () => {
    expect(() => leerAsignaciones(ficheroCon('esto no es json'))).toThrow(AsignacionesIlegiblesError)
  })

  it('lanza si una asignación no trae idJugador entero', () => {
    const malo = JSON.stringify({ asignaciones: [{ idJugador: 'x', idUc: 1 }] })
    expect(() => leerAsignaciones(ficheroCon(malo))).toThrow(/idJugador/i)
  })

  it('lanza si una asignación no trae idUc entero', () => {
    const malo = JSON.stringify({ asignaciones: [{ idJugador: 1, idUc: null }] })
    expect(() => leerAsignaciones(ficheroCon(malo))).toThrow(/idUc/i)
  })

  it('lanza si el mismo jugador se asigna dos veces', () => {
    const malo = JSON.stringify({ asignaciones: [{ idJugador: 1, idUc: 5 }, { idJugador: 1, idUc: 6 }] })
    expect(() => leerAsignaciones(ficheroCon(malo))).toThrow(/dos veces|duplicad/i)
  })
})
```

- [ ] **Paso 2: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/contabilidad/asignaciones.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 3: Implementar las asignaciones**

Fichero `src/contabilidad/asignaciones.ts`:

```ts
import { readFileSync } from 'node:fs'

export class AsignacionesIlegiblesError extends Error {
  constructor(ruta: string, causa: string) {
    super(`el fichero de asignaciones ${ruta} no se pudo leer: ${causa}`)
    this.name = 'AsignacionesIlegiblesError'
  }
}

type AsignacionBruta = { idJugador?: unknown; idUc?: unknown }

/**
 * Lee a qué equipo pertenecía cada baja sin dueño.
 *
 * Un jugador puede desaparecer de un reparto inicial al abandonar LaLiga sin
 * dejar rastro en el feed, y ninguna fuente accesible dice de quién era. Por eso
 * esto es un dato de entrada que aporta la persona: deducirlo por ajuste
 * produciría una cifra plausible y equivocada.
 *
 * Un fichero ausente significa "ninguna asignación", que es un estado legítimo.
 * Un fichero presente pero malformado, en cambio, lanza.
 */
export function leerAsignaciones(ruta: string): Map<number, number> {
  let contenido: string
  try {
    contenido = readFileSync(ruta, 'utf8')
  } catch {
    return new Map()
  }

  let datos: { asignaciones?: unknown }
  try {
    datos = JSON.parse(contenido) as { asignaciones?: unknown }
  } catch (e) {
    throw new AsignacionesIlegiblesError(ruta, (e as Error).message)
  }

  const lista = datos.asignaciones
  if (!Array.isArray(lista)) {
    throw new AsignacionesIlegiblesError(ruta, 'falta la lista `asignaciones`')
  }

  const mapa = new Map<number, number>()
  for (const bruta of lista as AsignacionBruta[]) {
    const idJugador = bruta.idJugador
    const idUc = bruta.idUc
    if (!Number.isInteger(idJugador)) {
      throw new Error(`una asignación de ${ruta} no trae un idJugador entero`)
    }
    if (!Number.isInteger(idUc)) {
      throw new Error(`la asignación del jugador ${idJugador} en ${ruta} no trae un idUc entero`)
    }
    if (mapa.has(idJugador as number)) {
      throw new Error(`el jugador ${idJugador} está asignado dos veces en ${ruta}`)
    }
    mapa.set(idJugador as number, idUc as number)
  }

  return mapa
}
```

- [ ] **Paso 4: Escribir el test de la vía 3 en el reparto**

Añadir a `tests/contabilidad/reparto.test.ts`:

```ts
describe('vía 3: bajas asignadas a mano', () => {
  it('una baja asignada entra en el reparto de su equipo', () => {
    const eventos = [baja(19977, '2026-08-10 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []]]), new Map([[19977, 1]]))
    expect(r.get(1)!.porBaja).toEqual([19977])
    expect(r.get(1)!.jugadores).toContain(19977)
  })

  it('una baja sin asignar no entra en ningún reparto', () => {
    const eventos = [baja(19977, '2026-08-10 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []]]), new Map())
    expect([...r.values()].flatMap((x) => x.jugadores)).not.toContain(19977)
  })

  it('una baja de un jugador que el equipo había comprado no entra, aunque esté asignada', () => {
    const eventos = [mov(30, null, 1, '2026-08-04 10:00:00'), baja(30, '2026-08-10 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []]]), new Map([[30, 1]]))
    expect(r.get(1)!.jugadores).toEqual([])
  })

  it('no cuenta dos veces una baja asignada que además se vendió', () => {
    const eventos = [mov(40, 1, null, '2026-08-05 10:00:00'), baja(40, '2026-08-10 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []]]), new Map([[40, 1]]))
    expect(r.get(1)!.jugadores).toEqual([40])
  })

  it('lanza si una baja se asigna a un equipo que no existe', () => {
    const eventos = [baja(19977, '2026-08-10 10:00:00')]
    expect(() => reconstruirRepartos(eventos, new Map([[1, []]]), new Map([[19977, 999]]))).toThrow(/999/)
  })
})

describe('bajasSinDuenio', () => {
  it('lista las bajas que ningún reparto reclama', () => {
    const eventos = [baja(19977, '2026-08-10 10:00:00'), baja(88, '2026-08-11 10:00:00')]
    const repartos = reconstruirRepartos(eventos, new Map([[1, []]]), new Map([[88, 1]]))
    expect(bajasSinDuenio(eventos, repartos)).toEqual([19977])
  })

  it('no lista una baja de un jugador que un equipo compró y sí movió', () => {
    const eventos = [mov(30, null, 1, '2026-08-04 10:00:00'), baja(30, '2026-08-10 10:00:00')]
    const repartos = reconstruirRepartos(eventos, new Map([[1, []]]), new Map())
    expect(bajasSinDuenio(eventos, repartos)).toEqual([])
  })
})
```

Los constructores `mov`, `baja` y `reparto` ya existen en ese fichero. **Los
nueve tests que ya están deben seguir pasando**: pásales `new Map()` como tercer
parámetro.

- [ ] **Paso 5: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/contabilidad/reparto.test.ts`
Esperado: FALLA — `reconstruirRepartos` no acepta el tercer parámetro.

- [ ] **Paso 6: Implementar la vía 3**

En `src/contabilidad/reparto.ts`, añadir el tercer parámetro y, tras las vías 1
y 2, el bloque de la vía 3:

```ts
  // 3: bajas asignadas a mano. Un jugador que desapareció al abandonar LaLiga
  //    y que el equipo NO había comprado formaba parte de su reparto inicial.
  //    Sin asignación no se le atribuye a nadie: adivinarlo produciría una
  //    cifra plausible y equivocada.
  for (const e of cronologico) {
    if (e.tipo !== 'bajaPlantilla') continue
    const idUc = asignaciones.get(e.idJugador)
    if (idUc === undefined) continue

    const r = repartos.get(idUc)
    if (!r) {
      throw new Error(`la baja del jugador ${e.idJugador} está asignada al equipo ${idUc}, que no existe en la liga`)
    }
    if (compradosDe(idUc).has(e.idJugador)) continue
    if (!r.porVenta.includes(e.idJugador) && !r.porBaja.includes(e.idJugador)) {
      r.porBaja.push(e.idJugador)
    }
  }
```

y al final del fichero:

```ts
/**
 * Bajas de plantilla que ningún reparto reclama.
 *
 * Cada una es un jugador cuyo dueño no consta en ninguna fuente. Quien llame
 * debe declararlas, no repartirlas: son incertidumbre, no ruido.
 */
export function bajasSinDuenio(
  eventos: Evento[],
  repartos: Map<number, RepartoEquipo>,
): number[] {
  const reclamados = new Set<number>()
  for (const r of repartos.values()) for (const id of r.jugadores) reclamados.add(id)

  const sinDuenio: number[] = []
  for (const e of eventos) {
    if (e.tipo !== 'bajaPlantilla') continue
    if (reclamados.has(e.idJugador)) continue
    if (!sinDuenio.includes(e.idJugador)) sinDuenio.push(e.idJugador)
  }

  return sinDuenio
}
```

**Ojo con el orden:** la vía 3 debe ejecutarse antes de recalcular
`r.jugadores`, para que las bajas asignadas entren en la unión final.

- [ ] **Paso 7: Ejecutar y comprobar que pasan**

Ejecutar: `npx vitest run tests/contabilidad/`
Esperado: PASAN los 9 previos más los 7 nuevos.

- [ ] **Paso 8: Crear el fichero de asignaciones**

Crear `datos/bajas-asignadas.json` con el contenido literal de la cabecera de
esta tarea. No se versiona: `datos/` está en `.gitignore`.

- [ ] **Paso 9: Comprobar contra el histórico real**

Con un script temporal que borres después: reconstruir los repartos con las
asignaciones del fichero y comprobar que **Ronald Araújo (19977) aparece ahora
en el reparto de Niutin FC (idUc 12493763)**, y que `bajasSinDuenio` lista las
demás bajas sin reclamar.

- [ ] **Paso 10: Commit**

```bash
npm test && npm run typecheck
git add src/contabilidad/asignaciones.ts src/contabilidad/reparto.ts tests/contabilidad/
git commit -m "feat: asignación manual de las bajas sin dueño"
```

---

### Tarea 7: Motor contable

**Ficheros:**
- Crear: `src/contabilidad/motor.ts`
- Crear: `tests/contabilidad/motor.test.ts`

**Interfaces:**
- Consume: `Evento`, `RepartoEquipo`, `PuntoValor`, `valorEn`.
- Produce:
  - `function calcularEstado(entrada: EntradaMotor): Map<number, EstadoEquipo>`
  - `type EntradaMotor = { eventos: Evento[]; repartos: Map<number, RepartoEquipo>; valores: Map<number, PuntoValor[]>; fechaReinicio: string; presupuestoInicial: number; coeficienteTope: number; valorPlantillaActual: Map<number, number>; hasta?: string }`
  - `type EstadoEquipo = { idUc: number; nombre: string; valorReparto: number; saldoInicial: number; premios: number; ventas: number; compras: number; saldo: number; topePuja: number; jugadoresSinValor: number[] }`

**La ecuación, ya verificada a mano:**

```
saldo inicial = presupuesto − Σ(valor de los jugadores del reparto el día del reinicio)
saldo         = saldo inicial + Σ premios + Σ ventas − Σ compras
tope de puja  = saldo + coeficiente × valor de plantilla actual
```

Con `presupuestoInicial` 50.000.000 y `coeficienteTope` 0,25, **verificados**.
Ambos son parámetros, no constantes ocultas: si la liga cambia de reglas, se
cambian aquí.

Es una **función pura**: sin red, sin base de datos, sin reloj. `hasta` permite
calcular el estado en una fecha pasada, que es lo que necesita la verificación
cruzada de la Tarea 8.

**Si a un jugador del reparto le falta el valor en la fecha del reinicio**, no
se le asigna cero: se devuelve en `jugadoresSinValor` y quien llame decide.
Rellenar con cero produciría un saldo inicial inflado y plausible.

**Las bajas sin dueño** (Tarea 6b) no llegan al motor: no están en ningún
reparto. Es la orden de análisis quien debe listarlas, para que la incertidumbre
quede declarada y no disimulada.

- [ ] **Paso 1: Escribir el test que falla**

Fichero `tests/contabilidad/motor.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { calcularEstado } from '../../src/contabilidad/motor.js'
import type { Evento, Transaccion } from '../../src/dominio/eventos.js'
import type { RepartoEquipo } from '../../src/contabilidad/reparto.js'
import type { PuntoValor } from '../../src/recoleccion/parseadorValores.js'

const REINICIO = '2026-08-03'
let n = 0

const mov = (idJugador: number, deIdUc: number | null, aIdUc: number | null, importe: number, fecha: string): Transaccion => ({
  tipo: 'transaccion', idEvento: ++n, idTransfer: n, fecha, jugador: 'J', idJugador,
  origen: deIdUc === null ? { clase: 'mercado' } : { clase: 'equipo', idUc: deIdUc, nombre: 'E' },
  destino: aIdUc === null ? { clase: 'mercado' } : { clase: 'equipo', idUc: aIdUc, nombre: 'E' },
  importe, operacion: 'normal',
})

const cierre = (fecha: string, premios: [number, number][]): Evento => ({
  tipo: 'cierreJornada', idEvento: ++n, idJornada: n, jornada: 1, fecha,
  resultados: premios.map(([idUc, premio]) => ({ idUc, equipo: 'E', premio, puntos: 5, valorPlantilla: 0, sinPuntuar: false })),
})

const reparto = (idUc: number, jugadores: number[]): RepartoEquipo =>
  ({ idUc, nombre: 'E' + idUc, jugadores, porVenta: jugadores, porPlantilla: [], porBaja: [] })

const serie = (valor: number): PuntoValor[] => [{ fecha: REINICIO, valor }]

const base = {
  fechaReinicio: REINICIO,
  presupuestoInicial: 50_000_000,
  coeficienteTope: 0.25,
  valorPlantillaActual: new Map([[1, 40_000_000]]),
}

describe('calcularEstado', () => {
  it('el saldo inicial es el presupuesto menos el valor del reparto', () => {
    const e = calcularEstado({ ...base, eventos: [], repartos: new Map([[1, reparto(1, [10, 11])]]),
      valores: new Map([[10, serie(20_000_000)], [11, serie(5_000_000)]]) })
    expect(e.get(1)!.valorReparto).toBe(25_000_000)
    expect(e.get(1)!.saldoInicial).toBe(25_000_000)
  })

  it('suma las ventas y resta las compras', () => {
    const eventos = [mov(10, 1, null, 3_000_000, '2026-08-10 10:00:00'), mov(20, null, 1, 1_000_000, '2026-08-11 10:00:00')]
    const e = calcularEstado({ ...base, eventos, repartos: new Map([[1, reparto(1, [10])]]), valores: new Map([[10, serie(10_000_000)]]) })
    expect(e.get(1)!.ventas).toBe(3_000_000)
    expect(e.get(1)!.compras).toBe(1_000_000)
    expect(e.get(1)!.saldo).toBe(40_000_000 + 3_000_000 - 1_000_000)
  })

  it('suma los premios de jornada', () => {
    const e = calcularEstado({ ...base, eventos: [cierre('2026-08-20 12:00:00', [[1, 750_000]])],
      repartos: new Map([[1, reparto(1, [10])]]), valores: new Map([[10, serie(10_000_000)]]) })
    expect(e.get(1)!.premios).toBe(750_000)
    expect(e.get(1)!.saldo).toBe(40_750_000)
  })

  it('el tope de puja es el saldo más el coeficiente por el valor de plantilla', () => {
    const e = calcularEstado({ ...base, eventos: [], repartos: new Map([[1, reparto(1, [10])]]), valores: new Map([[10, serie(10_000_000)]]) })
    expect(e.get(1)!.topePuja).toBe(40_000_000 + 0.25 * 40_000_000)
  })

  it('un traspaso entre equipos suma al vendedor y resta al comprador', () => {
    const eventos = [mov(10, 1, 2, 2_000_000, '2026-08-10 10:00:00')]
    const e = calcularEstado({ ...base,
      valorPlantillaActual: new Map([[1, 0], [2, 0]]), eventos,
      repartos: new Map([[1, reparto(1, [])], [2, reparto(2, [])]]), valores: new Map() })
    expect(e.get(1)!.ventas).toBe(2_000_000)
    expect(e.get(2)!.compras).toBe(2_000_000)
  })

  it('ignora los eventos posteriores a la fecha de corte', () => {
    const eventos = [mov(10, 1, null, 5_000_000, '2026-08-25 10:00:00')]
    const e = calcularEstado({ ...base, eventos, hasta: '2026-08-20 00:00:00',
      repartos: new Map([[1, reparto(1, [])]]), valores: new Map() })
    expect(e.get(1)!.ventas).toBe(0)
  })

  it('declara los jugadores sin valor en vez de contarlos como cero', () => {
    const e = calcularEstado({ ...base, eventos: [], repartos: new Map([[1, reparto(1, [10, 99])]]),
      valores: new Map([[10, serie(10_000_000)]]) })
    expect(e.get(1)!.jugadoresSinValor).toEqual([99])
    expect(e.get(1)!.valorReparto).toBe(10_000_000)
  })

  it('el dinero se mantiene entero en todo el cálculo', () => {
    const e = calcularEstado({ ...base, eventos: [mov(10, 1, null, 1_234_567, '2026-08-10 10:00:00')],
      repartos: new Map([[1, reparto(1, [10])]]), valores: new Map([[10, serie(9_999_999)]]) })
    for (const v of [e.get(1)!.saldo, e.get(1)!.saldoInicial, e.get(1)!.valorReparto]) {
      expect(Number.isInteger(v)).toBe(true)
    }
  })
})
```

- [ ] **Paso 2: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/contabilidad/motor.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 3: Escribir la implementación**

Fichero `src/contabilidad/motor.ts`:

```ts
import type { Evento, Transaccion } from '../dominio/eventos.js'
import type { PuntoValor } from '../recoleccion/parseadorValores.js'
import { valorEn } from '../recoleccion/parseadorValores.js'
import type { RepartoEquipo } from './reparto.js'

export type EntradaMotor = {
  eventos: Evento[]
  repartos: Map<number, RepartoEquipo>
  /** idJugador -> su serie diaria de valor. */
  valores: Map<number, PuntoValor[]>
  /** ISO `YYYY-MM-DD` del reinicio de la liga. */
  fechaReinicio: string
  presupuestoInicial: number
  coeficienteTope: number
  /** idUc -> valor de plantilla actual, para el tope de puja. */
  valorPlantillaActual: Map<number, number>
  /** Corte temporal, para calcular el estado en una fecha pasada. */
  hasta?: string
}

export type EstadoEquipo = {
  idUc: number
  nombre: string
  valorReparto: number
  saldoInicial: number
  premios: number
  ventas: number
  compras: number
  saldo: number
  topePuja: number
  /** Jugadores del reparto sin valor conocido en la fecha del reinicio. */
  jugadoresSinValor: number[]
}

/**
 * Calcula el estado financiero de cada equipo.
 *
 * Función pura: sin red, sin base de datos, sin reloj.
 *
 *   saldo inicial = presupuesto − valor del reparto el día del reinicio
 *   saldo         = saldo inicial + premios + ventas − compras
 *   tope de puja  = saldo + coeficiente × valor de plantilla actual
 *
 * A un jugador sin valor conocido NO se le asigna cero: se declara en
 * `jugadoresSinValor`, porque un cero silencioso infla el saldo inicial y
 * produce una cifra plausible y equivocada.
 */
export function calcularEstado(entrada: EntradaMotor): Map<number, EstadoEquipo> {
  const estados = new Map<number, EstadoEquipo>()

  for (const [idUc, reparto] of entrada.repartos) {
    let valorReparto = 0
    const sinValor: number[] = []

    for (const idJugador of reparto.jugadores) {
      const serie = entrada.valores.get(idJugador)
      const valor = serie ? valorEn(serie, entrada.fechaReinicio) : null
      if (valor === null) sinValor.push(idJugador)
      else valorReparto += valor
    }

    const saldoInicial = entrada.presupuestoInicial - valorReparto

    estados.set(idUc, {
      idUc,
      nombre: reparto.nombre,
      valorReparto,
      saldoInicial,
      premios: 0,
      ventas: 0,
      compras: 0,
      saldo: saldoInicial,
      topePuja: 0,
      jugadoresSinValor: sinValor,
    })
  }

  const dentroDePlazo = (fecha: string) => !entrada.hasta || fecha <= entrada.hasta

  for (const evento of entrada.eventos) {
    if (!dentroDePlazo(evento.fecha)) continue

    if (evento.tipo === 'transaccion') {
      const t = evento as Transaccion
      if (t.origen.clase === 'equipo') {
        const e = estados.get(t.origen.idUc)
        if (e) e.ventas += t.importe
      }
      if (t.destino.clase === 'equipo') {
        const e = estados.get(t.destino.idUc)
        if (e) e.compras += t.importe
      }
      continue
    }

    if (evento.tipo === 'cierreJornada') {
      for (const r of evento.resultados) {
        const e = estados.get(r.idUc)
        if (e) e.premios += r.premio
      }
    }
  }

  for (const e of estados.values()) {
    e.saldo = e.saldoInicial + e.premios + e.ventas - e.compras
    const plantilla = entrada.valorPlantillaActual.get(e.idUc) ?? 0
    e.topePuja = e.saldo + Math.round(entrada.coeficienteTope * plantilla)
  }

  return estados
}
```

- [ ] **Paso 4: Ejecutar y comprobar que pasan**

Ejecutar: `npx vitest run tests/contabilidad/motor.test.ts`
Esperado: PASA, 8 tests.

- [ ] **Paso 5: Commit**

```bash
npm test && npm run typecheck
git add src/contabilidad/motor.ts tests/contabilidad/motor.test.ts
git commit -m "feat: motor contable puro con saldo y tope de puja"
```

---

### Tarea 8: Verificación y orden de análisis

**Ficheros:**
- Crear: `src/contabilidad/verificacion.ts`
- Crear: `src/cli/analizar.ts`
- Crear: `tests/contabilidad/verificacion.test.ts`
- Modificar: `package.json`

**Interfaces:**
- Produce:
  - `function verificarSaldoPropio(estado: EstadoEquipo, datos: DatosUsuario): Discrepancia | null`
  - `function verificarTopePropio(estado: EstadoEquipo, datos: DatosUsuario): Discrepancia | null`
  - `function verificarMarcasNegativas(eventos: Evento[], calcular: (hasta: string) => Map<number, EstadoEquipo>): ResultadoMarcas`
  - `type Discrepancia = { concepto: string; calculado: number; real: number; desvio: number }`
  - `type ResultadoMarcas = { aciertos: number; fallos: number; detalle: FalloMarca[] }`
  - `type FalloMarca = { idUc: number; equipo: string; jornada: number; fecha: string; saldoCalculado: number; misterDiceNegativo: boolean }`

Son las tres comprobaciones que hacen creíble todo lo demás. **Ninguna usa datos
que el motor haya calculado**: las tres contrastan contra cifras que publica
Mister.

- [ ] **Paso 1: Escribir el test que falla**

Fichero `tests/contabilidad/verificacion.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { verificarSaldoPropio, verificarTopePropio, verificarMarcasNegativas } from '../../src/contabilidad/verificacion.js'
import type { EstadoEquipo } from '../../src/contabilidad/motor.js'
import type { DatosUsuario } from '../../src/recoleccion/parseadorFgUser.js'
import type { Evento } from '../../src/dominio/eventos.js'

const estado = (idUc: number, saldo: number, topePuja = 0): EstadoEquipo => ({
  idUc, nombre: 'E', valorReparto: 0, saldoInicial: 0, premios: 0, ventas: 0,
  compras: 0, saldo, topePuja, jugadoresSinValor: [],
})

const usuario = (saldo: number, topePuja: number): DatosUsuario => ({
  idUsuario: 1, idUc: 1, idComunidad: 1, equipo: 'E', saldo,
  saldoFuturo: saldo, topePuja, creditos: 0,
})

const cierre = (idUc: number, jornada: number, fecha: string, negativo: boolean): Evento => ({
  tipo: 'cierreJornada', idEvento: jornada, idJornada: jornada, jornada, fecha,
  resultados: [{ idUc, equipo: 'E', premio: 0, puntos: 0, valorPlantilla: 0, sinPuntuar: negativo }],
})

describe('verificarSaldoPropio', () => {
  it('no devuelve nada si coincide', () => {
    expect(verificarSaldoPropio(estado(1, 9209955), usuario(9209955, 0))).toBe(null)
  })

  it('devuelve la discrepancia con su desvío', () => {
    const d = verificarSaldoPropio(estado(1, 9210755), usuario(9209955, 0))
    expect(d).not.toBe(null)
    expect(d!.desvio).toBe(800)
    expect(d!.calculado).toBe(9210755)
    expect(d!.real).toBe(9209955)
  })

  it('el desvío es siempre positivo, calcule de más o de menos', () => {
    expect(verificarSaldoPropio(estado(1, 9209155), usuario(9209955, 0))!.desvio).toBe(800)
  })
})

describe('verificarTopePropio', () => {
  it('no devuelve nada si coincide al euro', () => {
    expect(verificarTopePropio(estado(1, 0, 28556455), usuario(0, 28556455))).toBe(null)
  })

  it('detecta cualquier diferencia', () => {
    expect(verificarTopePropio(estado(1, 0, 28556000), usuario(0, 28556455))!.desvio).toBe(455)
  })
})

describe('verificarMarcasNegativas', () => {
  it('cuenta un acierto cuando el saldo negativo coincide con la marca', () => {
    const eventos = [cierre(1, 3, '2026-09-01 10:00:00', true)]
    const r = verificarMarcasNegativas(eventos, () => new Map([[1, estado(1, -8407740)]]))
    expect(r.aciertos).toBe(1)
    expect(r.fallos).toBe(0)
  })

  it('cuenta un acierto cuando el saldo positivo coincide con la ausencia de marca', () => {
    const eventos = [cierre(1, 3, '2026-09-01 10:00:00', false)]
    const r = verificarMarcasNegativas(eventos, () => new Map([[1, estado(1, 5000)]]))
    expect(r.aciertos).toBe(1)
  })

  it('cuenta un fallo y lo detalla cuando no coinciden', () => {
    const eventos = [cierre(1, 2, '2026-08-25 10:00:00', false)]
    const r = verificarMarcasNegativas(eventos, () => new Map([[1, estado(1, -17877)]]))
    expect(r.fallos).toBe(1)
    expect(r.detalle[0]!.saldoCalculado).toBe(-17877)
    expect(r.detalle[0]!.jornada).toBe(2)
    expect(r.detalle[0]!.misterDiceNegativo).toBe(false)
  })

  it('recorre todas las jornadas y todos los equipos', () => {
    const eventos: Evento[] = [
      { tipo: 'cierreJornada', idEvento: 1, idJornada: 1, jornada: 1, fecha: '2026-08-20 12:00:00',
        resultados: [
          { idUc: 1, equipo: 'A', premio: 0, puntos: 0, valorPlantilla: 0, sinPuntuar: false },
          { idUc: 2, equipo: 'B', premio: 0, puntos: 0, valorPlantilla: 0, sinPuntuar: false }] },
      cierre(1, 2, '2026-08-25 12:00:00', false),
    ]
    const r = verificarMarcasNegativas(eventos, () => new Map([[1, estado(1, 100)], [2, estado(2, 100)]]))
    expect(r.aciertos + r.fallos).toBe(3)
  })

  it('ignora los equipos que el motor no conoce', () => {
    const eventos = [cierre(9, 1, '2026-08-20 12:00:00', false)]
    const r = verificarMarcasNegativas(eventos, () => new Map())
    expect(r.aciertos + r.fallos).toBe(0)
  })
})
```

- [ ] **Paso 2: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/contabilidad/verificacion.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 3: Escribir la implementación**

Fichero `src/contabilidad/verificacion.ts`:

```ts
import type { EstadoEquipo } from './motor.js'
import type { DatosUsuario } from '../recoleccion/parseadorFgUser.js'
import type { Evento } from '../dominio/eventos.js'

export type Discrepancia = {
  concepto: string
  calculado: number
  real: number
  /** Siempre positivo. */
  desvio: number
}

export type FalloMarca = {
  idUc: number
  equipo: string
  jornada: number
  fecha: string
  saldoCalculado: number
  misterDiceNegativo: boolean
}

export type ResultadoMarcas = {
  aciertos: number
  fallos: number
  detalle: FalloMarca[]
}

function comparar(concepto: string, calculado: number, real: number): Discrepancia | null {
  if (calculado === real) return null
  return { concepto, calculado, real, desvio: Math.abs(calculado - real) }
}

/** El saldo reconstruido desde cero contra el que publica Mister. */
export function verificarSaldoPropio(estado: EstadoEquipo, datos: DatosUsuario): Discrepancia | null {
  return comparar('saldo propio', estado.saldo, datos.saldo)
}

/** El tope de puja calculado contra el `maxDebt` que publica Mister. */
export function verificarTopePropio(estado: EstadoEquipo, datos: DatosUsuario): Discrepancia | null {
  return comparar('tope de puja propio', estado.topePuja, datos.topePuja)
}

/**
 * Contrasta el signo del saldo calculado contra las marcas de saldo negativo
 * que Mister publica en cada cierre de jornada.
 *
 * Es la única comprobación que alcanza a los rivales: son ocho contrastes por
 * jornada, y ninguno usa nada que el motor haya calculado.
 */
export function verificarMarcasNegativas(
  eventos: Evento[],
  calcular: (hasta: string) => Map<number, EstadoEquipo>,
): ResultadoMarcas {
  const resultado: ResultadoMarcas = { aciertos: 0, fallos: 0, detalle: [] }

  for (const evento of eventos) {
    if (evento.tipo !== 'cierreJornada') continue
    const estados = calcular(evento.fecha)

    for (const r of evento.resultados) {
      const estado = estados.get(r.idUc)
      if (!estado) continue

      const predicho = estado.saldo < 0
      if (predicho === r.sinPuntuar) {
        resultado.aciertos++
      } else {
        resultado.fallos++
        resultado.detalle.push({
          idUc: r.idUc, equipo: r.equipo, jornada: evento.jornada, fecha: evento.fecha,
          saldoCalculado: estado.saldo, misterDiceNegativo: r.sinPuntuar,
        })
      }
    }
  }

  return resultado
}
```

- [ ] **Paso 4: Ejecutar y comprobar que pasan**

Ejecutar: `npx vitest run tests/contabilidad/verificacion.test.ts`
Esperado: PASA, 10 tests.

- [ ] **Paso 5: Escribir la orden de análisis**

Fichero `src/cli/analizar.ts`:

```ts
import { abrirAlmacen } from '../almacen/crudo.js'
import { deduplicar } from '../contabilidad/deduplicar.js'
import { calcularEstado } from '../contabilidad/motor.js'
import { reconstruirRepartos } from '../contabilidad/reparto.js'
import {
  verificarMarcasNegativas, verificarSaldoPropio, verificarTopePropio,
} from '../contabilidad/verificacion.js'
import type { Evento } from '../dominio/eventos.js'
import { recolectarAuxiliares, rutaEquipo, rutaJugador } from '../recoleccion/auxiliares.js'
import { crearCliente } from '../recoleccion/cliente.js'
import { parsearFgUser } from '../recoleccion/parseadorFgUser.js'
import { parsearPaginaFeed } from '../recoleccion/parseadorFeed.js'
import { parsearPlantilla } from '../recoleccion/parseadorPlantilla.js'
import { parsearSerieValores } from '../recoleccion/parseadorValores.js'
import { obtenerCredenciales } from '../sesion/credenciales.js'

// Parámetros de esta liga, con su procedencia.
const FECHA_REINICIO = '2026-08-03'      // evento admin `reset-all` del histórico
const PRESUPUESTO_INICIAL = 50_000_000   // aportado por el usuario, verificado
const COEFICIENTE_TOPE = 0.25            // verificado contra maxDebt al euro

const eur = (n: number) => Math.round(n).toLocaleString('es-ES') + ' €'

async function principal(): Promise<void> {
  const almacen = abrirAlmacen('datos/mister.sqlite')

  try {
    // 1. Histórico ya recolectado -> eventos deduplicados.
    const completas = almacen.recolecciones().filter((r) => almacen.leerCompletitud(r))
    const recoleccion = completas[completas.length - 1]
    if (!recoleccion) {
      throw new Error('no hay ninguna recolección completa. Ejecuta antes `npm run recolectar` o `npm run importar`.')
    }

    const eventos: Evento[] = deduplicar(
      almacen.leerCapturas(recoleccion).flatMap((c) => parsearPaginaFeed(c.cuerpo).eventos),
    )

    // 2. Equipos y jugadores implicados.
    const idsUc = new Set<number>()
    const idsJugador = new Set<number>()
    for (const e of eventos) {
      if (e.tipo === 'transaccion') {
        if (e.origen.clase === 'equipo') idsUc.add(e.origen.idUc)
        if (e.destino.clase === 'equipo') idsUc.add(e.destino.idUc)
        idsJugador.add(e.idJugador)
      } else if (e.tipo === 'cierreJornada') {
        for (const r of e.resultados) idsUc.add(r.idUc)
      } else if (e.tipo === 'bajaPlantilla') {
        idsJugador.add(e.idJugador)
      }
    }

    // 3. Plantillas actuales (una pasada) y luego los jugadores que aporten.
    const cliente = crearCliente({ credenciales: obtenerCredenciales() })
    await recolectarAuxiliares({ cliente, almacen, idsUc: [...idsUc], idsJugador: [] })

    const plantillas = new Map<number, number[]>()
    for (const idUc of idsUc) {
      const pagina = almacen.leerPagina(rutaEquipo(idUc))
      if (!pagina) throw new Error(`falta la plantilla del equipo ${idUc}`)
      const jugadores = parsearPlantilla(pagina.cuerpo)
      plantillas.set(idUc, jugadores)
      for (const id of jugadores) idsJugador.add(id)
    }

    const repartos = reconstruirRepartos(eventos, plantillas)
    const necesarios = [...new Set([...repartos.values()].flatMap((r) => r.jugadores))]
    const aux = await recolectarAuxiliares({ cliente, almacen, idsUc: [], idsJugador: necesarios })
    console.log(`Fichas de jugador: ${aux.jugadores} descargadas, ${aux.yaEnCache} ya guardadas\n`)

    // 4. Series de valor y valor de plantilla actual.
    const valores = new Map<number, ReturnType<typeof parsearSerieValores>>()
    for (const id of necesarios) {
      const pagina = almacen.leerPagina(rutaJugador(id))
      if (!pagina) throw new Error(`falta la ficha del jugador ${id}`)
      valores.set(id, parsearSerieValores(pagina.cuerpo))
    }

    const valorPlantillaActual = new Map<number, number>()
    for (const [idUc, jugadores] of plantillas) {
      let total = 0
      for (const id of jugadores) {
        const serie = valores.get(id)
        if (serie && serie.length) total += serie[serie.length - 1]!.valor
      }
      valorPlantillaActual.set(idUc, total)
    }

    const comun = {
      eventos, repartos, valores,
      fechaReinicio: FECHA_REINICIO,
      presupuestoInicial: PRESUPUESTO_INICIAL,
      coeficienteTope: COEFICIENTE_TOPE,
      valorPlantillaActual,
    }

    // 5. Estado actual.
    const estados = calcularEstado(comun)
    const orden = [...estados.values()].sort((a, b) => b.topePuja - a.topePuja)

    console.log('Equipo'.padEnd(32) + 'Saldo'.padStart(16) + 'Tope de puja'.padStart(17))
    console.log('-'.repeat(65))
    for (const e of orden) {
      console.log(e.nombre.padEnd(32) + eur(e.saldo).padStart(16) + eur(e.topePuja).padStart(17))
    }

    // 6. Las tres verificaciones.
    const paginaPropia = almacen.leerPagina(rutaEquipo([...idsUc][0]!))!
    const propios = parsearFgUser(paginaPropia.cuerpo)
    const mio = estados.get(propios.idUc)
    if (!mio) throw new Error('el motor no calculó el estado del equipo propio')

    console.log('\nVerificación')
    for (const d of [verificarSaldoPropio(mio, propios), verificarTopePropio(mio, propios)]) {
      if (!d) console.log('  ✓ coincide al euro')
      else console.log(`  ${d.concepto}: calculado ${eur(d.calculado)}, real ${eur(d.real)}, desvío ${eur(d.desvio)}`)
    }

    const marcas = verificarMarcasNegativas(eventos, (hasta) => calcularEstado({ ...comun, hasta }))
    console.log(`  marcas de saldo negativo: ${marcas.aciertos} aciertos, ${marcas.fallos} fallos`)
    for (const f of marcas.detalle) {
      console.log(`    J${f.jornada} ${f.equipo}: calculado ${eur(f.saldoCalculado)}, Mister dice ${f.misterDiceNegativo ? 'negativo' : 'no negativo'}`)
    }

    // 7. Incertidumbre declarada, nunca disimulada.
    const sinValor = orden.filter((e) => e.jugadoresSinValor.length)
    if (sinValor.length) {
      console.log('\nJugadores del reparto sin valor conocido en la fecha del reinicio:')
      for (const e of sinValor) console.log(`  ${e.nombre}: ${e.jugadoresSinValor.join(', ')}`)
    }
  } finally {
    almacen.cerrar()
  }
}

principal().catch((e: unknown) => {
  console.error(`\nAnálisis detenido: ${(e as Error).message}`)
  process.exitCode = 1
})
```

**Nota sobre el equipo propio:** el fragmento anterior toma `_FG_user` de la
primera página de equipo guardada. Eso funciona porque `_FG_user` describe
siempre a **quien tiene la sesión**, sea cual sea la página. Si al implementarlo
resulta que alguna página no lo trae, usa `/team`, que es la propia por
definición.

- [ ] **Paso 6: Añadir el script a `package.json`**

```json
"analizar": "tsx src/cli/analizar.ts"
```

- [ ] **Paso 7: Ejecutar el análisis real**

Ejecutar: `npm run analizar`

Esperado, contra las cifras de referencia de la cabecera de este plan:

- Saldo propio calculado **9.210.755 €**, real 9.209.955 €, **desvío 800 €**.
- Tope de puja propio **28.556.455 €**, **desvío 0**.
- Verificación de marcas: **20 aciertos, 4 fallos**.
- Ningún jugador del reparto sin valor, salvo los de `porBaja`.

Si el desvío del tope no es cero, o el del saldo se aleja de 800 €, **hay un
error**: no ajustes los números esperados, investiga.

- [ ] **Paso 8: Commit**

```bash
npm test && npm run typecheck
git add src/contabilidad/verificacion.ts src/cli/analizar.ts tests/contabilidad/verificacion.test.ts package.json
git commit -m "feat: verificaciones y orden de análisis de la liga"
```

---

## Criterio de aceptación de la Fase 2

1. `npm test` pasa entero y `npm run typecheck` no da errores.
2. `npm run analizar` produce la tabla de los ocho equipos sin errores.
3. El **tope de puja propio coincide al euro** con el `maxDebt` de Mister.
4. El **saldo propio se desvía 800 €** o menos.
5. La verificación de marcas negativas da **al menos 20 aciertos de 24**.
6. Ningún jugador del reparto queda sin valor sin declararlo.

## Asuntos abiertos, para después

Ninguno bloquea la fase, y los tres están documentados en
`docs/hallazgos-para-fase-2.md`:

- **Los 800 € de desvío** vienen de que Mister publica los valores redondeados a
  millares. Bajarlos a cero exige otra fuente de valores.
- **Las 4 discrepancias** de la verificación cruzada son negativos pequeños en
  fechas intermedias —una de 17.877 €— y apuntan al orden de los eventos dentro
  de un mismo día. El corte por `hasta` usa la marca temporal del cierre, y los
  movimientos del mismo día pueden resolverse antes o después.
- **Los jugadores de `porBaja` sin dueño identificable**: si un jugador
  desapareció por salir de LaLiga y nadie lo compró ni lo vendió nunca, el feed
  no dice de quién era.

## Qué queda fuera de este plan

- Panel web y actualización diaria → Fase 3.
- Estimar el saldo por acotación con `other_bids` → innecesario: el saldo se
  calcula.
