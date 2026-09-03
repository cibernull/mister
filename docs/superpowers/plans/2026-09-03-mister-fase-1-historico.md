# Fase 1 — Histórico completo de la liga · Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL OBLIGATORIA: usar
> `superpowers:subagent-driven-development` (recomendada) o
> `superpowers:executing-plans` para implementar este plan tarea a tarea. Los
> pasos usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** recolectar, uno a uno y sin excepciones, todos los eventos de la
liga Fantasy desde su primer día, guardarlos íntegros y demostrar que no falta
ninguno.

**Arquitectura:** un cliente HTTP que solo pide y guarda respuestas crudas; un
almacén SQLite con capa cruda inmutable y capa derivada reconstruible; y
parseadores puros que traducen esas respuestas a eventos de dominio. La
recolección tiene dos vías intercambiables (HTTP directo y ejecución en el
navegador) que producen el mismo artefacto crudo.

**Pila:** TypeScript sobre Node 22+ (fetch nativo), `better-sqlite3`, `vitest`,
`tsx`.

**Especificación:** `docs/superpowers/specs/2026-09-03-mister-inteligencia-liga-design.md`

## Restricciones globales

Se aplican a **todas** las tareas de este plan.

- **Exactitud al céntimo.** Prohibido estimar, redondear o rellenar huecos. Ante
  cualquier duda, el proceso falla ruidosamente.
- **Dinero siempre entero**, en la unidad en que lo publica Mister (euros enteros: los importes observados no llevan decimales). Nunca `float`, nunca coma
  flotante, nunca `parseFloat` sobre importes. Los importes se parsean de texto
  a entero directamente.
- **Ningún evento se descarta en silencio.** Solo se ignoran los tipos
  catalogados explícitamente como ruido. Un tipo desconocido lanza error.
- **Mínimo 1000 ms entre peticiones** a `mister.mundodeportivo.com`.
- **La cookie de sesión nunca** se escribe en git, ni en logs, ni en mensajes de
  error, ni en los ficheros de prueba.
- **Identificadores de dominio en español** (`Evento`, `Transaccion`,
  `importe`), coherente con el resto del proyecto.
- Node 22 o superior. TypeScript en modo `strict`.

---

### Tarea 1: Esqueleto del proyecto

**Ficheros:**
- Crear: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Crear: `src/dominio/dinero.ts`
- Crear: `tests/dominio/dinero.test.ts`

**Interfaces:**
- Consume: nada.
- Produce: `parsearImporte(texto: string): number` — convierte `"1.602.440"` en
  el entero `1602440`. Lanza `Error` si el texto no es un importe válido.

- [ ] **Paso 1: Crear `package.json`**

```json
{
  "name": "mister-inteligencia",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.7.5",
    "tsx": "^4.19.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.3"
  },
  "dependencies": {
    "better-sqlite3": "^11.5.0"
  }
}
```

- [ ] **Paso 2: Crear `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Paso 3: Crear `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
```

- [ ] **Paso 4: Instalar dependencias**

Ejecutar: `npm install`
Esperado: termina sin errores y crea `node_modules/` y `package-lock.json`.

- [ ] **Paso 5: Escribir el test que falla**

Fichero `tests/dominio/dinero.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parsearImporte } from '../../src/dominio/dinero.js'

describe('parsearImporte', () => {
  it('convierte un importe con puntos de millar en entero', () => {
    expect(parsearImporte('1.602.440')).toBe(1602440)
  })

  it('acepta un importe sin separadores', () => {
    expect(parsearImporte('900000')).toBe(900000)
  })

  it('acepta el signo positivo de los premios de jornada', () => {
    expect(parsearImporte('+725.000')).toBe(725000)
  })

  it('acepta importes negativos', () => {
    expect(parsearImporte('-6.000')).toBe(-6000)
  })

  it('ignora el símbolo de euro y los espacios', () => {
    expect(parsearImporte(' € 5.712.300 ')).toBe(5712300)
  })

  it('lanza error ante un texto que no es un importe', () => {
    expect(() => parsearImporte('no puntuó')).toThrow(/importe no reconocido/i)
  })

  it('lanza error ante un importe con decimales', () => {
    expect(() => parsearImporte('1.602,44')).toThrow(/importe no reconocido/i)
  })

  it('lanza error ante texto vacío', () => {
    expect(() => parsearImporte('')).toThrow(/importe no reconocido/i)
  })
})
```

- [ ] **Paso 6: Ejecutar el test y comprobar que falla**

Ejecutar: `npx vitest run tests/dominio/dinero.test.ts`
Esperado: FALLA con un error de resolución del módulo `src/dominio/dinero.js`.

- [ ] **Paso 7: Escribir la implementación mínima**

Fichero `src/dominio/dinero.ts`:

```ts
/**
 * Convierte un importe tal y como lo muestra Mister a un entero.
 *
 * Nunca usa coma flotante: la exactitud al céntimo es un requisito del
 * proyecto y un `parseFloat` intermedio introduciría error de representación.
 */
export function parsearImporte(texto: string): number {
  const limpio = texto.replace(/[\s€]/g, '')
  const coincidencia = /^([+-]?)(\d{1,3}(?:\.\d{3})*|\d+)$/.exec(limpio)

  if (!coincidencia) {
    throw new Error(`importe no reconocido: ${JSON.stringify(texto)}`)
  }

  const [, signo, digitos] = coincidencia
  const valor = Number.parseInt(digitos!.replaceAll('.', ''), 10)

  return signo === '-' ? -valor : valor
}
```

- [ ] **Paso 8: Ejecutar los tests y comprobar que pasan**

Ejecutar: `npx vitest run tests/dominio/dinero.test.ts`
Esperado: PASA, 8 tests.

- [ ] **Paso 9: Comprobar tipos**

Ejecutar: `npm run typecheck`
Esperado: sin errores.

- [ ] **Paso 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src tests
git commit -m "feat: esqueleto del proyecto y parseo exacto de importes"
```

---

### Tarea 2: Capturar el histórico real del navegador ✅ COMPLETADA

**Ejecutada el 2026-09-03 por el controlador**, porque requiere el navegador del
usuario con la sesión de Mister abierta.

**Qué se resolvió:** el 401 que bloqueaba `POST /ajax/feed` venía de dos errores
de diagnóstico previos. El token va en la cabecera `X-Auth`, no en el cuerpo, y
la paginación es por `offset` acumulado, no por un campo `page` que no existe.
Ver `docs/api-mister.md` para la petición exacta y el catálogo de categorías.

**Resultado:** histórico completo de la liga recorrido y agotado — 16 lotes,
285 eventos, desde el 2026-08-03. Categorías contables: 183 `transfer` y
4 `gameweek_end`.

**Artefactos producidos:**
- `docs/api-mister.md` — la petición, la forma de la respuesta y las 12
  categorías, todo verificado.
- `navegador/capturar-feed.js` — script de captura para la consola de Mister.
- `datos/volcado-feed.json` — el histórico crudo íntegro (~975 KB, no se
  comitea: está en `datos/`, ignorado por git).
- `fixtures/feed-offset-0.json`, `fixtures/feed-con-cierre-jornada.json`,
  `fixtures/feed-final-vacio.json` — lotes reales congelados para los tests.

**Antes de dar la tarea por buena**, comprobar que los fixtures no contienen
credenciales:

```bash
grep -riE '"auth"|token|cookie|session' fixtures/ || echo "limpio"
```

Si aparece algún token, sustituirlo por `"REDACTADO"`. **No tocar** nombres de
equipo, jugadores, importes ni fechas: son los datos que los tests verifican.

---

### Tarea 3: Tipos de evento del dominio

**Ficheros:**
- Crear: `src/dominio/eventos.ts`
- Crear: `tests/dominio/eventos.test.ts`

**Interfaces:**
- Consume: `parsearImporte` de la Tarea 1.
- Produce:
  - `type Evento = Transaccion | CierreJornada | Ruido`
  - `type Transaccion = { tipo: 'transaccion'; fecha: string; jugador: string; origen: Parte; destino: Parte; importe: number; porClausula: boolean }`
  - `type Parte = { clase: 'mercado' } | { clase: 'equipo'; nombre: string }`
  - `type CierreJornada = { tipo: 'cierreJornada'; fecha: string; jornada: number; resultados: ResultadoEquipo[] }`
  - `type ResultadoEquipo = { equipo: string; premio: number; puntos: number; sinPuntuar: boolean }`
  - `type Ruido = { tipo: 'ruido'; fecha: string; motivo: string }`
  - `function esContable(e: Evento): e is Transaccion | CierreJornada`

Estos tipos son **independientes del formato JSON de Mister**: describen el
dominio, no la respuesta. Por eso esta tarea puede hacerse sin depender de la
forma exacta del fixture.

- [ ] **Paso 1: Escribir el test que falla**

Fichero `tests/dominio/eventos.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { esContable, type Evento } from '../../src/dominio/eventos.js'

const transaccion: Evento = {
  tipo: 'transaccion',
  fecha: '2026-08-30T10:00:00Z',
  jugador: 'Natan Souza',
  origen: { clase: 'equipo', nombre: 'Neky F.C. (Sergio)' },
  destino: { clase: 'mercado' },
  importe: 5712300,
  porClausula: false,
}

const cierre: Evento = {
  tipo: 'cierreJornada',
  fecha: '2026-08-31T22:00:00Z',
  jornada: 3,
  resultados: [
    { equipo: 'Cacaculopedopis', premio: 725000, puntos: 29, sinPuntuar: false },
    { equipo: 'Saiyans FC (Fran)', premio: 0, puntos: 0, sinPuntuar: true },
  ],
}

const ruido: Evento = {
  tipo: 'ruido',
  fecha: '2026-09-01T09:00:00Z',
  motivo: 'fichaje de LaLiga real',
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
})
```

- [ ] **Paso 2: Ejecutar el test y comprobar que falla**

Ejecutar: `npx vitest run tests/dominio/eventos.test.ts`
Esperado: FALLA por módulo `src/dominio/eventos.js` inexistente.

- [ ] **Paso 3: Escribir la implementación**

Fichero `src/dominio/eventos.ts`:

```ts
/** Una de las dos partes de una transacción: el mercado o un equipo. */
export type Parte = { clase: 'mercado' } | { clase: 'equipo'; nombre: string }

/** Movimiento de un jugador con importe. */
export type Transaccion = {
  tipo: 'transaccion'
  fecha: string
  jugador: string
  origen: Parte
  destino: Parte
  importe: number
  porClausula: boolean
}

/** Resultado de un equipo en el cierre de una jornada. */
export type ResultadoEquipo = {
  equipo: string
  premio: number
  puntos: number
  /** Mister no reparte premio a quien tiene saldo negativo. */
  sinPuntuar: boolean
}

export type CierreJornada = {
  tipo: 'cierreJornada'
  fecha: string
  jornada: number
  resultados: ResultadoEquipo[]
}

/** Evento reconocido pero sin efecto contable, p. ej. fichajes de LaLiga. */
export type Ruido = { tipo: 'ruido'; fecha: string; motivo: string }

export type Evento = Transaccion | CierreJornada | Ruido

/** Un evento es contable si mueve dinero de algún equipo. */
export function esContable(e: Evento): e is Transaccion | CierreJornada {
  return e.tipo === 'transaccion' || e.tipo === 'cierreJornada'
}
```

- [ ] **Paso 4: Ejecutar los tests y comprobar que pasan**

Ejecutar: `npx vitest run tests/dominio/eventos.test.ts`
Esperado: PASA, 3 tests.

- [ ] **Paso 5: Commit**

```bash
git add src/dominio/eventos.ts tests/dominio/eventos.test.ts
git commit -m "feat: tipos de evento del dominio"
```

---

### Tarea 4: Parseador del feed

**Base fáctica:** la forma real de la respuesta está documentada en
`docs/api-mister.md`, verificada contra el histórico completo de la liga. Los
fixtures reales están en `fixtures/`. **No inventes campos**: los de aquí son
los que existen.

**Ficheros:**
- Crear: `src/recoleccion/parseadorFeed.ts`
- Crear: `tests/recoleccion/parseadorFeed.test.ts`

**Interfaces:**
- Consume: `Evento`, `Transaccion`, `CierreJornada`, `Ruido`, `esContable` (Tarea 3).
- Produce:
  - `function parsearPaginaFeed(cuerpo: string): PaginaFeed`
  - `type PaginaFeed = { eventos: Evento[]; agotado: boolean }`
  - `class CategoriaDesconocidaError extends Error { readonly categoria: string; readonly crudo: string }`

**Estructura de la respuesta** (ver `docs/api-mister.md`):

```
{ status: "ok", data: [ { category, created, date, data, id, ... } ], cfg, isAjax }
```

- `data` es un **array**. No hay `has_more`: `agotado` es `data.length === 0`.
- `category` es el discriminador del tipo.
- En un `transfer`, la carga útil está en `evento.data` e incluye
  `id_transfer`, `id_uc_from`, `id_uc_to`, `price` (**entero**), `type`,
  `from`, `to`, `name`.
- `id_uc_from === 0` o `id_uc_to === 0` significa **el mercado**, no un equipo.

**Catálogo de categorías** — las 12 observadas. Contables: `transfer` y
`gameweek_end`. Ruido catalogado: las otras diez.

- [ ] **Paso 1: Escribir el test que falla**

Fichero `tests/recoleccion/parseadorFeed.test.ts`. Los tests exigen que exista
al menos un evento de cada tipo antes de comprobarlo: un bucle vacío **no**
puede pasar en verde.

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CategoriaDesconocidaError,
  parsearPaginaFeed,
} from '../../src/recoleccion/parseadorFeed.js'
import type { Transaccion, CierreJornada } from '../../src/dominio/eventos.js'

const pagina0 = readFileSync('fixtures/feed-offset-0.json', 'utf8')
const paginaCierre = readFileSync('fixtures/feed-con-cierre-jornada.json', 'utf8')
const paginaFinal = readFileSync('fixtures/feed-final-vacio.json', 'utf8')

const transaccionesDe = (cuerpo: string): Transaccion[] =>
  parsearPaginaFeed(cuerpo).eventos.filter((e): e is Transaccion => e.tipo === 'transaccion')

const cierresDe = (cuerpo: string): CierreJornada[] =>
  parsearPaginaFeed(cuerpo).eventos.filter((e): e is CierreJornada => e.tipo === 'cierreJornada')

describe('parsearPaginaFeed', () => {
  it('extrae eventos de la página real', () => {
    expect(parsearPaginaFeed(pagina0).eventos.length).toBeGreaterThan(0)
  })

  it('la página real contiene transacciones', () => {
    expect(transaccionesDe(pagina0).length).toBeGreaterThan(0)
  })

  it('toda transacción tiene importe entero no negativo', () => {
    const ts = transaccionesDe(pagina0)
    expect(ts.length).toBeGreaterThan(0)
    for (const t of ts) {
      expect(Number.isInteger(t.importe)).toBe(true)
      expect(t.importe).toBeGreaterThanOrEqual(0)
    }
  })

  it('toda transacción nombra jugador y ambas partes', () => {
    const ts = transaccionesDe(pagina0)
    expect(ts.length).toBeGreaterThan(0)
    for (const t of ts) {
      expect(t.jugador).not.toBe('')
      expect(t.origen).toBeDefined()
      expect(t.destino).toBeDefined()
    }
  })

  it('reconoce el mercado cuando id_uc vale 0', () => {
    const ts = transaccionesDe(pagina0)
    const conMercado = ts.filter(
      (t) => t.origen.clase === 'mercado' || t.destino.clase === 'mercado',
    )
    expect(conMercado.length).toBeGreaterThan(0)
  })

  it('la página de cierre contiene un cierre de jornada con resultados', () => {
    const cs = cierresDe(paginaCierre)
    expect(cs.length).toBeGreaterThan(0)
    for (const c of cs) {
      expect(c.resultados.length).toBeGreaterThan(0)
      expect(Number.isInteger(c.jornada)).toBe(true)
    }
  })

  it('todo resultado de jornada tiene premio entero y puntos', () => {
    const cs = cierresDe(paginaCierre)
    expect(cs.length).toBeGreaterThan(0)
    for (const c of cs) {
      for (const r of c.resultados) {
        expect(Number.isInteger(r.premio)).toBe(true)
        expect(Number.isInteger(r.puntos)).toBe(true)
        expect(r.equipo).not.toBe('')
      }
    }
  })

  it('clasifica player_transfer como ruido, no como transacción', () => {
    const { eventos } = parsearPaginaFeed(pagina0)
    const ruido = eventos.filter((e) => e.tipo === 'ruido')
    expect(ruido.length).toBeGreaterThan(0)
  })

  it('marca agotado cuando data llega vacío', () => {
    expect(parsearPaginaFeed(paginaFinal).agotado).toBe(true)
  })

  it('no marca agotado en una página con eventos', () => {
    expect(parsearPaginaFeed(pagina0).agotado).toBe(false)
  })

  it('lanza CategoriaDesconocidaError ante una categoría no catalogada', () => {
    const inventado = JSON.stringify({
      status: 'ok',
      data: [{ category: 'categoria_que_no_existe', created: '2026-09-03 10:00:00', data: {} }],
    })
    expect(() => parsearPaginaFeed(inventado)).toThrow(CategoriaDesconocidaError)
  })

  it('el error conserva la categoría y el contenido crudo', () => {
    const inventado = JSON.stringify({
      status: 'ok',
      data: [{ category: 'categoria_que_no_existe', created: '2026-09-03 10:00:00', data: {} }],
    })
    try {
      parsearPaginaFeed(inventado)
      expect.unreachable('debería haber lanzado')
    } catch (e) {
      expect(e).toBeInstanceOf(CategoriaDesconocidaError)
      expect((e as CategoriaDesconocidaError).categoria).toBe('categoria_que_no_existe')
      expect((e as CategoriaDesconocidaError).crudo).toContain('categoria_que_no_existe')
    }
  })
})
```

- [ ] **Paso 2: Ejecutar el test y comprobar que falla**

Ejecutar: `npx vitest run tests/recoleccion/parseadorFeed.test.ts`
Esperado: FALLA por módulo `src/recoleccion/parseadorFeed.js` inexistente.

- [ ] **Paso 3: Escribir la implementación**

Fichero `src/recoleccion/parseadorFeed.ts`:

```ts
import type {
  CierreJornada,
  Evento,
  Parte,
  ResultadoEquipo,
  Transaccion,
} from '../dominio/eventos.js'

export type PaginaFeed = {
  eventos: Evento[]
  /** El histórico se agota cuando el servidor devuelve `data` vacío. */
  agotado: boolean
}

/**
 * Categoría de feed no catalogada. Detiene la recolección a propósito:
 * descartarla produciría una contabilidad plausible y equivocada.
 */
export class CategoriaDesconocidaError extends Error {
  readonly categoria: string
  readonly crudo: string

  constructor(categoria: string, crudo: string) {
    super(`categoría de feed no catalogada: ${categoria}. Recolección detenida.`)
    this.name = 'CategoriaDesconocidaError'
    this.categoria = categoria
    this.crudo = crudo
  }
}

/** Categorías sin efecto contable, ignoradas a conciencia y de forma explícita. */
const CATEGORIAS_RUIDO = new Set([
  'player_transfer',  // fichaje de LaLiga real, no de la liga Fantasy
  'post',
  'blog',
  'news_md',
  'pool_public',
  'porra',
  'gameweek_start',
  'admin',
  'change_name',
  'market_unified',
])

type EventoBruto = {
  category?: string
  created?: string
  data?: Record<string, unknown>
}

export function parsearPaginaFeed(cuerpo: string): PaginaFeed {
  const respuesta = JSON.parse(cuerpo) as { data?: EventoBruto[] }
  const brutos = respuesta.data ?? []

  return {
    eventos: brutos.map(parsearEvento),
    agotado: brutos.length === 0,
  }
}

function parsearEvento(bruto: EventoBruto): Evento {
  const categoria = bruto.category ?? ''
  const fecha = bruto.created ?? ''

  if (categoria === 'transfer') return parsearTransaccion(bruto, fecha)
  if (categoria === 'gameweek_end') return parsearCierreJornada(bruto, fecha)

  if (CATEGORIAS_RUIDO.has(categoria)) {
    return { tipo: 'ruido', fecha, motivo: `categoría sin efecto contable: ${categoria}` }
  }

  throw new CategoriaDesconocidaError(categoria, JSON.stringify(bruto))
}

/** `id_uc` 0 es el mercado de Mister, no un equipo. */
function parte(idUc: unknown, nombre: unknown): Parte {
  return Number(idUc) === 0
    ? { clase: 'mercado' }
    : { clase: 'equipo', nombre: String(nombre ?? '') }
}

function exigirEntero(valor: unknown, campo: string): number {
  const n = Number(valor)
  if (!Number.isInteger(n)) {
    throw new Error(`campo ${campo} no es un entero: ${JSON.stringify(valor)}`)
  }
  return n
}

function parsearTransaccion(bruto: EventoBruto, fecha: string): Transaccion {
  const d = bruto.data ?? {}

  return {
    tipo: 'transaccion',
    fecha,
    jugador: String(d['name'] ?? ''),
    origen: parte(d['id_uc_from'], d['from']),
    destino: parte(d['id_uc_to'], d['to']),
    importe: exigirEntero(d['price'], 'price'),
    porClausula: String(d['type'] ?? '') === 'clause',
  }
}

function parsearCierreJornada(bruto: EventoBruto, fecha: string): CierreJornada {
  const d = bruto.data ?? {}
  const ranking = (d['ranking'] ?? []) as Record<string, unknown>[]

  const resultados: ResultadoEquipo[] = ranking.map((r) => ({
    equipo: String(r['name'] ?? r['team'] ?? ''),
    premio: exigirEntero(r['cash'] ?? r['prize'] ?? 0, 'premio'),
    puntos: exigirEntero(r['points'] ?? 0, 'puntos'),
    sinPuntuar: Boolean(r['negative'] ?? false),
  }))

  return {
    tipo: 'cierreJornada',
    fecha,
    jornada: exigirEntero(d['gameweek'], 'gameweek'),
    resultados,
  }
}
```

**Nota importante:** los nombres de los campos dentro de `ranking` de
`gameweek_end` (`name`/`team`, `cash`/`prize`, `negative`) están sin confirmar,
porque solo se inspeccionó el nivel superior. **Antes de implementar, abre
`fixtures/feed-con-cierre-jornada.json` y comprueba los nombres reales.** Ajusta
`parsearCierreJornada` a lo que haya y quita las alternativas que sobren: dejar
un `??` de más es exactamente el tipo de suposición que este proyecto no admite.

- [ ] **Paso 4: Ejecutar los tests y comprobar que pasan**

Ejecutar: `npx vitest run tests/recoleccion/parseadorFeed.test.ts`
Esperado: PASA, 12 tests.

- [ ] **Paso 5: Comprobar tipos y commit**

```bash
npm run typecheck
git add src/recoleccion/parseadorFeed.ts tests/recoleccion/parseadorFeed.test.ts
git commit -m "feat: parseador del feed con parada ante categorías no catalogadas"
```

---

### Tarea 5: Almacén crudo

**Ficheros:**
- Crear: `src/almacen/esquema.ts`
- Crear: `src/almacen/crudo.ts`
- Crear: `tests/almacen/crudo.test.ts`

**Interfaces:**
- Consume: nada del proyecto.
- Produce:
  - `function abrirAlmacen(ruta: string): Almacen`
  - `type PaginaCruda = { offset: number; nEventos: number; cuerpo: string; capturadaEn: string }`
  - `type Almacen = { guardarPagina(p: PaginaCruda): void; leerPaginas(): PaginaCruda[]; cerrar(): void }`

La clave es el **`offset`**, no un número de página: la paginación del feed
avanza sumando el tamaño de cada lote. Se guarda también `nEventos` porque es
lo que permite verificar después que los lotes encajan sin solaparse ni dejar
hueco.

- [ ] **Paso 1: Escribir el test que falla**

Fichero `tests/almacen/crudo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { abrirAlmacen } from '../../src/almacen/crudo.js'

const almacenEnMemoria = () => abrirAlmacen(':memory:')

const pagina = (offset: number, nEventos: number, cuerpo = '{}') => ({
  offset,
  nEventos,
  cuerpo,
  capturadaEn: '2026-09-03T10:00:00Z',
})

describe('almacén crudo', () => {
  it('guarda y recupera una página íntegra', () => {
    const a = almacenEnMemoria()
    a.guardarPagina(pagina(0, 21, '{"a":1}'))
    expect(a.leerPaginas()).toEqual([
      { offset: 0, nEventos: 21, cuerpo: '{"a":1}', capturadaEn: '2026-09-03T10:00:00Z' },
    ])
    a.cerrar()
  })

  it('devuelve las páginas ordenadas por offset', () => {
    const a = almacenEnMemoria()
    a.guardarPagina(pagina(42, 21))
    a.guardarPagina(pagina(0, 21))
    a.guardarPagina(pagina(21, 21))
    expect(a.leerPaginas().map((p) => p.offset)).toEqual([0, 21, 42])
    a.cerrar()
  })

  it('reguardar un offset lo sustituye en vez de duplicarlo', () => {
    const a = almacenEnMemoria()
    a.guardarPagina(pagina(0, 21, 'viejo'))
    a.guardarPagina(pagina(0, 21, 'nuevo'))
    const ps = a.leerPaginas()
    expect(ps).toHaveLength(1)
    expect(ps[0]!.cuerpo).toBe('nuevo')
    a.cerrar()
  })

  it('no altera el cuerpo guardado', () => {
    const a = almacenEnMemoria()
    const raro = '{"texto":"acentos áéí, emoji 🏆, comillas \\" y salto\\n"}'
    a.guardarPagina(pagina(0, 1, raro))
    expect(a.leerPaginas()[0]!.cuerpo).toBe(raro)
    a.cerrar()
  })
})
```

- [ ] **Paso 2: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/almacen/crudo.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 3: Escribir el esquema**

Fichero `src/almacen/esquema.ts`:

```ts
export const ESQUEMA = `
CREATE TABLE IF NOT EXISTS paginas_crudas (
  offset_feed  INTEGER PRIMARY KEY,
  n_eventos    INTEGER NOT NULL,
  cuerpo       TEXT    NOT NULL,
  capturada_en TEXT    NOT NULL
);
`
```

- [ ] **Paso 4: Escribir la implementación**

Fichero `src/almacen/crudo.ts`:

```ts
import Database from 'better-sqlite3'
import { ESQUEMA } from './esquema.js'

export type PaginaCruda = {
  offset: number
  nEventos: number
  cuerpo: string
  capturadaEn: string
}

export type Almacen = {
  guardarPagina(p: PaginaCruda): void
  leerPaginas(): PaginaCruda[]
  cerrar(): void
}

/**
 * Capa cruda del almacén: guarda las respuestas tal y como llegaron.
 *
 * Nunca se borra ni se transforma. Si mañana se descubre un dato que hoy se
 * ignora, se reprocesa el pasado sin volver a pedir nada al servidor.
 */
export function abrirAlmacen(ruta: string): Almacen {
  const db = new Database(ruta)
  db.pragma('journal_mode = WAL')
  db.exec(ESQUEMA)

  const insertar = db.prepare(
    `INSERT INTO paginas_crudas (offset_feed, n_eventos, cuerpo, capturada_en)
     VALUES (@offset, @nEventos, @cuerpo, @capturadaEn)
     ON CONFLICT(offset_feed) DO UPDATE SET
       n_eventos = excluded.n_eventos,
       cuerpo = excluded.cuerpo,
       capturada_en = excluded.capturada_en`,
  )

  const seleccionar = db.prepare(
    `SELECT offset_feed AS "offset", n_eventos AS nEventos,
            cuerpo, capturada_en AS capturadaEn
     FROM paginas_crudas ORDER BY offset_feed`,
  )

  return {
    guardarPagina(p) {
      insertar.run(p)
    },
    leerPaginas() {
      return seleccionar.all() as PaginaCruda[]
    },
    cerrar() {
      db.close()
    },
  }
}
```

- [ ] **Paso 5: Ejecutar los tests y comprobar que pasan**

Ejecutar: `npx vitest run tests/almacen/crudo.test.ts`
Esperado: PASA, 4 tests.

- [ ] **Paso 6: Commit**

```bash
git add src/almacen tests/almacen
git commit -m "feat: almacén crudo inmutable indexado por offset"
```

---

### Tarea 6: Verificación de continuidad del histórico

**Ficheros:**
- Crear: `src/recoleccion/integridad.ts`
- Crear: `tests/recoleccion/integridad.test.ts`

**Interfaces:**
- Consume: `PaginaCruda` (Tarea 5).
- Produce:
  - `function comprobarContinuidad(paginas: PaginaCruda[]): void`
  - `class DiscontinuidadError extends Error { readonly offsetEsperado: number; readonly offsetHallado: number }`

Esta es la garantía de completitud. Los lotes del feed encajan como piezas: el
`offset` de cada página debe ser exactamente el anterior más el número de
eventos que trajo. Un salto significa eventos perdidos; un solape, eventos
contados dos veces. Ambos falsearían la contabilidad, así que ambos son error.

- [ ] **Paso 1: Escribir el test que falla**

Fichero `tests/recoleccion/integridad.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DiscontinuidadError,
  comprobarContinuidad,
} from '../../src/recoleccion/integridad.js'
import type { PaginaCruda } from '../../src/almacen/crudo.js'

const p = (offset: number, nEventos: number): PaginaCruda => ({
  offset,
  nEventos,
  cuerpo: '{}',
  capturadaEn: '2026-09-03T10:00:00Z',
})

describe('comprobarContinuidad', () => {
  it('acepta lotes que encajan exactamente', () => {
    expect(() => comprobarContinuidad([p(0, 21), p(21, 21), p(42, 5), p(47, 0)])).not.toThrow()
  })

  it('acepta una sola página', () => {
    expect(() => comprobarContinuidad([p(0, 21)])).not.toThrow()
  })

  it('acepta una lista vacía', () => {
    expect(() => comprobarContinuidad([])).not.toThrow()
  })

  it('lanza si el primer offset no es cero', () => {
    expect(() => comprobarContinuidad([p(21, 21)])).toThrow(DiscontinuidadError)
  })

  it('lanza si hay un salto entre lotes', () => {
    expect(() => comprobarContinuidad([p(0, 21), p(50, 21)])).toThrow(DiscontinuidadError)
  })

  it('lanza si hay solape entre lotes', () => {
    expect(() => comprobarContinuidad([p(0, 21), p(10, 21)])).toThrow(DiscontinuidadError)
  })

  it('el error dice qué offset se esperaba y cuál se halló', () => {
    try {
      comprobarContinuidad([p(0, 21), p(50, 21)])
      expect.unreachable('debería haber lanzado')
    } catch (e) {
      expect(e).toBeInstanceOf(DiscontinuidadError)
      expect((e as DiscontinuidadError).offsetEsperado).toBe(21)
      expect((e as DiscontinuidadError).offsetHallado).toBe(50)
    }
  })
})
```

- [ ] **Paso 2: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/recoleccion/integridad.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 3: Escribir la implementación**

Fichero `src/recoleccion/integridad.ts`:

```ts
import type { PaginaCruda } from '../almacen/crudo.js'

/** Los lotes recolectados no encajan: faltan eventos o se cuentan dos veces. */
export class DiscontinuidadError extends Error {
  readonly offsetEsperado: number
  readonly offsetHallado: number

  constructor(offsetEsperado: number, offsetHallado: number) {
    super(
      `el histórico no es continuo: se esperaba el offset ${offsetEsperado} ` +
        `y se halló ${offsetHallado}. La recolección no se da por buena.`,
    )
    this.name = 'DiscontinuidadError'
    this.offsetEsperado = offsetEsperado
    this.offsetHallado = offsetHallado
  }
}

/**
 * Comprueba que los lotes recolectados encajan sin hueco ni solape.
 *
 * El feed pagina por offset acumulado: cada página empieza donde acabó la
 * anterior. Un salto significa eventos perdidos —y un saldo plausible pero
 * equivocado—, así que es un error, no un aviso.
 */
export function comprobarContinuidad(paginas: PaginaCruda[]): void {
  let esperado = 0

  for (const pagina of paginas) {
    if (pagina.offset !== esperado) {
      throw new DiscontinuidadError(esperado, pagina.offset)
    }
    esperado += pagina.nEventos
  }
}
```

- [ ] **Paso 4: Ejecutar los tests y comprobar que pasan**

Ejecutar: `npx vitest run tests/recoleccion/integridad.test.ts`
Esperado: PASA, 7 tests.

- [ ] **Paso 5: Commit**

```bash
git add src/recoleccion/integridad.ts tests/recoleccion/integridad.test.ts
git commit -m "feat: verificación de continuidad del histórico por offset"
```

---

### Tarea 7: Sesión y cliente HTTP

**Base fáctica:** la petición exacta está documentada en `docs/api-mister.md`.
Hacen falta **dos** credenciales: la cookie de sesión y el token `X-Auth`.

**Ficheros:**
- Crear: `src/sesion/credenciales.ts`
- Crear: `src/recoleccion/cliente.ts`
- Crear: `tests/sesion/credenciales.test.ts`
- Crear: `tests/recoleccion/cliente.test.ts`

**Interfaces:**
- Consume: nada del proyecto.
- Produce:
  - `type Credenciales = { cookie: string; auth: string }`
  - `function obtenerCredenciales(dir?: string): Credenciales` — lee `.sesion/cookie` y `.sesion/auth`
  - `function crearCliente(o: OpcionesCliente): Cliente`
  - `type Cliente = { pedirLote(offset: number): Promise<string> }`
  - `type OpcionesCliente = { credenciales: Credenciales; base?: string; esperaMs?: number; fetch?: typeof globalThis.fetch }`

- [ ] **Paso 1: Escribir el test de credenciales**

Fichero `tests/sesion/credenciales.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { obtenerCredenciales } from '../../src/sesion/credenciales.js'

function dirCon(cookie: string | null, auth: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'mister-'))
  if (cookie !== null) writeFileSync(join(dir, 'cookie'), cookie)
  if (auth !== null) writeFileSync(join(dir, 'auth'), auth)
  return dir
}

describe('obtenerCredenciales', () => {
  it('lee la cookie y el token', () => {
    expect(obtenerCredenciales(dirCon('sesion=abc', 'tok123'))).toEqual({
      cookie: 'sesion=abc',
      auth: 'tok123',
    })
  })

  it('recorta espacios y saltos de línea', () => {
    expect(obtenerCredenciales(dirCon('  sesion=abc\n', ' tok123 \n\n'))).toEqual({
      cookie: 'sesion=abc',
      auth: 'tok123',
    })
  })

  it('lanza si falta la cookie', () => {
    expect(() => obtenerCredenciales(dirCon(null, 'tok123'))).toThrow(/cookie/i)
  })

  it('lanza si falta el token', () => {
    expect(() => obtenerCredenciales(dirCon('sesion=abc', null))).toThrow(/auth/i)
  })

  it('lanza si la cookie está vacía', () => {
    expect(() => obtenerCredenciales(dirCon('  \n', 'tok123'))).toThrow(/vací/i)
  })

  it('ningún mensaje de error revela el contenido de los ficheros', () => {
    const dir = dirCon('sesion=secretisima', null)
    try {
      obtenerCredenciales(dir)
      expect.unreachable('debería haber lanzado')
    } catch (e) {
      expect((e as Error).message).not.toContain('secretisima')
    }
  })
})
```

- [ ] **Paso 2: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/sesion/credenciales.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 3: Implementar las credenciales**

Fichero `src/sesion/credenciales.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR_POR_DEFECTO = '.sesion'

export type Credenciales = {
  cookie: string
  auth: string
}

/**
 * Lee las dos credenciales que Mister exige.
 *
 * La cuenta usa login con Apple y la cookie es HttpOnly, así que ninguna de las
 * dos puede obtenerse programáticamente: se copian de un navegador autenticado.
 *
 * Ningún mensaje de error incluye su valor.
 */
export function obtenerCredenciales(dir: string = DIR_POR_DEFECTO): Credenciales {
  return {
    cookie: leer(join(dir, 'cookie'), 'cookie'),
    auth: leer(join(dir, 'auth'), 'auth'),
  }
}

function leer(ruta: string, nombre: string): string {
  let contenido: string
  try {
    contenido = readFileSync(ruta, 'utf8')
  } catch {
    throw new Error(`falta la credencial ${nombre}: no se encontró ${ruta}. Cópiala del navegador.`)
  }

  const valor = contenido.trim()
  if (valor === '') {
    throw new Error(`la credencial ${nombre} está vacía en ${ruta}. Vuelve a capturarla.`)
  }

  return valor
}
```

- [ ] **Paso 4: Escribir el test del cliente**

Fichero `tests/recoleccion/cliente.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { crearCliente } from '../../src/recoleccion/cliente.js'

const credenciales = { cookie: 'sesion=x', auth: 'tok123' }
const respuesta = (cuerpo: string, status = 200) => new Response(cuerpo, { status })

const cliente = (fetchFalso: unknown) =>
  crearCliente({ credenciales, esperaMs: 0, fetch: fetchFalso as never })

describe('cliente del feed', () => {
  it('pide el offset indicado y devuelve el cuerpo', async () => {
    const f = vi.fn(async () => respuesta('{"data":[]}'))
    expect(await cliente(f).pedirLote(42)).toBe('{"data":[]}')

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/ajax/feed')
    expect(init.method).toBe('POST')
    const cuerpo = new URLSearchParams(String(init.body))
    expect(cuerpo.get('offset')).toBe('42')
    expect(cuerpo.get('cardsPerPage')).toBe('20')
  })

  it('envía la cookie y el token X-Auth', async () => {
    const f = vi.fn(async () => respuesta('{}'))
    await cliente(f).pedirLote(0)

    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    const h = init.headers as Record<string, string>
    expect(h['Cookie']).toBe('sesion=x')
    expect(h['X-Auth']).toBe('tok123')
    expect(h['X-Requested-With']).toBe('XMLHttpRequest')
  })

  it('reintenta ante un error del servidor y acaba devolviendo el cuerpo', async () => {
    const f = vi.fn().mockResolvedValueOnce(respuesta('', 500)).mockResolvedValueOnce(respuesta('{"ok":1}'))
    expect(await cliente(f).pedirLote(0)).toBe('{"ok":1}')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('no reintenta ante un 401 y avisa de las credenciales', async () => {
    const f = vi.fn(async () => respuesta('{"status":"error"}', 401))
    await expect(cliente(f).pedirLote(0)).rejects.toThrow(/credencial|sesión/i)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('el error de credenciales no revela la cookie ni el token', async () => {
    const f = vi.fn(async () => respuesta('', 401))
    const c = crearCliente({
      credenciales: { cookie: 'sesion=secretisima', auth: 'tokensecreto' },
      esperaMs: 0,
      fetch: f as never,
    })
    await expect(c.pedirLote(0)).rejects.toThrow(/^(?!.*secretisima)(?!.*tokensecreto).*$/s)
  })
})
```

- [ ] **Paso 5: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/recoleccion/cliente.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 6: Implementar el cliente**

Fichero `src/recoleccion/cliente.ts`:

```ts
import type { Credenciales } from '../sesion/credenciales.js'

const BASE_POR_DEFECTO = 'https://mister.mundodeportivo.com'
const ESPERA_POR_DEFECTO_MS = 1000
const EVENTOS_POR_LOTE = 20
const REINTENTOS = 3

export type OpcionesCliente = {
  credenciales: Credenciales
  base?: string
  esperaMs?: number
  fetch?: typeof globalThis.fetch
}

export type Cliente = {
  pedirLote(offset: number): Promise<string>
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Cliente HTTP del feed. Solo pide y devuelve texto: no interpreta nada.
 *
 * Espacia las peticiones para no castigar el servidor de Mister y reintenta los
 * fallos transitorios, pero nunca un 401: eso significa credenciales caducadas
 * y reintentarlo solo añade ruido.
 */
export function crearCliente(opciones: OpcionesCliente): Cliente {
  const base = opciones.base ?? BASE_POR_DEFECTO
  const esperaMs = opciones.esperaMs ?? ESPERA_POR_DEFECTO_MS
  const hacerFetch = opciones.fetch ?? globalThis.fetch

  return {
    async pedirLote(offset: number): Promise<string> {
      let ultimoFallo: Error | undefined

      for (let intento = 0; intento < REINTENTOS; intento++) {
        if (intento > 0) await dormir(esperaMs * 2 ** intento)

        const res = await hacerFetch(`${base}/ajax/feed`, {
          method: 'POST',
          headers: {
            Cookie: opciones.credenciales.cookie,
            'X-Auth': opciones.credenciales.auth,
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            end: '0',
            loading: '0',
            offset: String(offset),
            cardsPerPage: String(EVENTOS_POR_LOTE),
          }).toString(),
        })

        if (res.status === 401) {
          throw new Error(
            'credenciales de Mister caducadas o no válidas. Vuelve a copiar la cookie y el token del navegador.',
          )
        }

        if (res.ok) {
          await dormir(esperaMs)
          return await res.text()
        }

        ultimoFallo = new Error(`el offset ${offset} devolvió HTTP ${res.status}`)
      }

      throw ultimoFallo ?? new Error(`no se pudo obtener el offset ${offset}`)
    },
  }
}
```

- [ ] **Paso 7: Ejecutar toda la batería y comprobar tipos**

Ejecutar: `npm test && npm run typecheck`
Esperado: todo pasa.

- [ ] **Paso 8: Commit**

```bash
git add src/sesion src/recoleccion/cliente.ts tests/sesion tests/recoleccion/cliente.test.ts
git commit -m "feat: credenciales desde fichero y cliente HTTP del feed"
```

---

### Tarea 8: Recolección completa

**Ficheros:**
- Crear: `src/recoleccion/recolectar.ts`
- Crear: `src/cli/recolectar.ts`
- Crear: `tests/recoleccion/recolectar.test.ts`
- Modificar: `package.json` (script `recolectar`)

**Interfaces:**
- Consume: `Cliente` (T7), `Almacen` (T5), `parsearPaginaFeed` (T4), `comprobarContinuidad` (T6), `esContable` (T3).
- Produce:
  - `async function recolectarHistorico(dep: Dependencias): Promise<Resumen>`
  - `type Dependencias = { cliente: Cliente; almacen: Almacen; maxLotes?: number }`
  - `type Resumen = { lotes: number; eventos: number; contables: number; ruido: number }`

- [ ] **Paso 1: Escribir el test que falla**

Fichero `tests/recoleccion/recolectar.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { abrirAlmacen } from '../../src/almacen/crudo.js'
import { recolectarHistorico } from '../../src/recoleccion/recolectar.js'
import type { Cliente } from '../../src/recoleccion/cliente.js'

const ruido = (n: number) =>
  JSON.stringify({
    status: 'ok',
    data: Array.from({ length: n }, () => ({
      category: 'player_transfer',
      created: '2026-09-01 10:00:00',
      data: {},
    })),
  })

const vacio = JSON.stringify({ status: 'ok', data: [] })

/** Cliente falso que sirve lotes por offset. */
function clienteCon(lotes: Record<number, string>): Cliente {
  return { async pedirLote(offset: number) { return lotes[offset] ?? vacio } }
}

describe('recolectarHistorico', () => {
  it('recorre hasta agotar el histórico', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await recolectarHistorico({
      cliente: clienteCon({ 0: ruido(21), 21: ruido(21), 42: vacio }),
      almacen,
    })

    expect(resumen.lotes).toBe(3)
    expect(almacen.leerPaginas().map((p) => p.offset)).toEqual([0, 21, 42])
    almacen.cerrar()
  })

  it('guarda el cuerpo crudo y el número de eventos de cada lote', async () => {
    const almacen = abrirAlmacen(':memory:')
    await recolectarHistorico({ cliente: clienteCon({ 0: ruido(21), 21: vacio }), almacen })

    const primera = almacen.leerPaginas()[0]!
    expect(primera.cuerpo).toBe(ruido(21))
    expect(primera.nEventos).toBe(21)
    almacen.cerrar()
  })

  it('cuenta eventos contables y ruido por separado', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await recolectarHistorico({
      cliente: clienteCon({ 0: ruido(3), 3: vacio }),
      almacen,
    })

    expect(resumen.eventos).toBe(3)
    expect(resumen.ruido).toBe(3)
    expect(resumen.contables).toBe(0)
    almacen.cerrar()
  })

  it('se detiene al alcanzar el límite de lotes', async () => {
    const almacen = abrirAlmacen(':memory:')
    const lotes: Record<number, string> = {}
    for (let i = 0; i < 50; i++) lotes[i * 21] = ruido(21)

    const resumen = await recolectarHistorico({ cliente: clienteCon(lotes), almacen, maxLotes: 5 })
    expect(resumen.lotes).toBe(5)
    almacen.cerrar()
  })

  it('propaga el error si una categoría no está catalogada', async () => {
    const almacen = abrirAlmacen(':memory:')
    const desconocida = JSON.stringify({
      status: 'ok',
      data: [{ category: 'inventada', created: '2026-09-01 10:00:00', data: {} }],
    })

    await expect(
      recolectarHistorico({ cliente: clienteCon({ 0: desconocida }), almacen }),
    ).rejects.toThrow(/no catalogada/i)
    almacen.cerrar()
  })

  it('guarda el lote crudo aunque su contenido no se pueda interpretar', async () => {
    const almacen = abrirAlmacen(':memory:')
    const desconocida = JSON.stringify({
      status: 'ok',
      data: [{ category: 'inventada', created: '2026-09-01 10:00:00', data: {} }],
    })

    await expect(
      recolectarHistorico({ cliente: clienteCon({ 0: desconocida }), almacen }),
    ).rejects.toThrow()

    // El crudo se guarda antes de interpretar, para poder diagnosticarlo.
    expect(almacen.leerPaginas()).toHaveLength(1)
    almacen.cerrar()
  })
})
```

- [ ] **Paso 2: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/recoleccion/recolectar.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 3: Implementar la recolección**

Fichero `src/recoleccion/recolectar.ts`:

```ts
import type { Almacen } from '../almacen/crudo.js'
import { esContable } from '../dominio/eventos.js'
import type { Cliente } from './cliente.js'
import { comprobarContinuidad } from './integridad.js'
import { parsearPaginaFeed } from './parseadorFeed.js'

const MAX_LOTES_POR_DEFECTO = 500

export type Dependencias = {
  cliente: Cliente
  almacen: Almacen
  maxLotes?: number
}

export type Resumen = {
  lotes: number
  eventos: number
  contables: number
  ruido: number
}

/**
 * Recorre el feed desde el offset 0 hacia atrás hasta agotar el histórico.
 *
 * Guarda el crudo ANTES de interpretarlo: si una categoría no está catalogada,
 * el proceso se detiene pero el lote queda en disco para poder diagnosticarlo.
 */
export async function recolectarHistorico(dep: Dependencias): Promise<Resumen> {
  const maxLotes = dep.maxLotes ?? MAX_LOTES_POR_DEFECTO
  const resumen: Resumen = { lotes: 0, eventos: 0, contables: 0, ruido: 0 }
  let offset = 0

  for (let lote = 0; lote < maxLotes; lote++) {
    const cuerpo = await dep.cliente.pedirLote(offset)
    const nEventos = contarEventos(cuerpo)

    dep.almacen.guardarPagina({
      offset,
      nEventos,
      cuerpo,
      capturadaEn: new Date().toISOString(),
    })
    resumen.lotes++

    const { eventos, agotado } = parsearPaginaFeed(cuerpo)

    for (const evento of eventos) {
      resumen.eventos++
      if (esContable(evento)) resumen.contables++
      else resumen.ruido++
    }

    if (agotado) break
    offset += eventos.length
  }

  comprobarContinuidad(dep.almacen.leerPaginas())

  return resumen
}

/** Cuenta sin interpretar, para poder guardar el crudo antes de parsearlo. */
function contarEventos(cuerpo: string): number {
  const datos = JSON.parse(cuerpo) as { data?: unknown[] }
  return (datos.data ?? []).length
}
```

- [ ] **Paso 4: Ejecutar los tests y comprobar que pasan**

Ejecutar: `npx vitest run tests/recoleccion/recolectar.test.ts`
Esperado: PASA, 6 tests.

- [ ] **Paso 5: Escribir la orden de consola**

Fichero `src/cli/recolectar.ts`:

```ts
import { abrirAlmacen } from '../almacen/crudo.js'
import { crearCliente } from '../recoleccion/cliente.js'
import { recolectarHistorico } from '../recoleccion/recolectar.js'
import { obtenerCredenciales } from '../sesion/credenciales.js'

async function principal(): Promise<void> {
  const almacen = abrirAlmacen('datos/mister.sqlite')

  try {
    const resumen = await recolectarHistorico({
      cliente: crearCliente({ credenciales: obtenerCredenciales() }),
      almacen,
    })

    console.log(`Lotes recorridos: ${resumen.lotes}`)
    console.log(`Eventos totales:  ${resumen.eventos}`)
    console.log(`  contables:      ${resumen.contables}`)
    console.log(`  ruido:          ${resumen.ruido}`)
    console.log('\nHistórico completo y continuo.')
  } finally {
    almacen.cerrar()
  }
}

principal().catch((e: unknown) => {
  console.error(`\nRecolección detenida: ${(e as Error).message}`)
  process.exitCode = 1
})
```

- [ ] **Paso 6: Añadir el script a `package.json`**

En `"scripts"`, añadir:

```json
"recolectar": "mkdir -p datos && tsx src/cli/recolectar.ts"
```

- [ ] **Paso 7: Ejecutar la recolección real**

Con `.sesion/cookie` y `.sesion/auth` en su sitio:

Ejecutar: `npm run recolectar`

Esperado: recorre el histórico entero e imprime el resumen sin errores. Con los
datos de referencia del 2026-09-03 deberían salir **16 lotes y 285 eventos**,
de los cuales **187 contables** (183 `transfer` + 4 `gameweek_end`) y 98 ruido.
Si se detiene por una categoría no catalogada, añadirla a `CATEGORIAS_RUIDO` o
a `parsearEvento` **de forma razonada**, nunca al bulto, y repetir.

- [ ] **Paso 8: Ejecutar la batería completa y comprobar tipos**

Ejecutar: `npm test && npm run typecheck`
Esperado: todo pasa.

- [ ] **Paso 9: Commit**

```bash
git add src/recoleccion/recolectar.ts src/cli tests/recoleccion/recolectar.test.ts package.json
git commit -m "feat: recolección completa del histórico con verificación de continuidad"
```

---

### Tarea 9: Importador de volcados del navegador

**Por qué sigue existiendo aunque la vía A funcione:** es el respaldo si el
token `X-Auth` o la cookie caducan en mal momento, y es la vía con la que se
capturó el histórico de referencia. Ambas producen filas idénticas en
`paginas_crudas`; nada aguas abajo distingue su procedencia.

**Ficheros:**
- Crear: `src/cli/importar.ts`
- Crear: `tests/cli/importar.test.ts`
- Modificar: `package.json` (script `importar`)

**Interfaces:**
- Consume: `abrirAlmacen` (T5), `parsearPaginaFeed` (T4), `comprobarContinuidad` (T6), `Resumen` (T8).
- Produce: `async function importarVolcado(ruta: string, almacen: Almacen): Promise<Resumen>`

El volcado tiene la forma `{ paginas: [{ offset, cuerpo, capturadaEn }] }`.

- [ ] **Paso 1: Escribir el test que falla**

Fichero `tests/cli/importar.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { abrirAlmacen } from '../../src/almacen/crudo.js'
import { importarVolcado } from '../../src/cli/importar.js'

const ruido = (n: number) =>
  JSON.stringify({
    status: 'ok',
    data: Array.from({ length: n }, () => ({
      category: 'player_transfer',
      created: '2026-09-01 10:00:00',
      data: {},
    })),
  })
const vacio = JSON.stringify({ status: 'ok', data: [] })

function volcadoCon(paginas: { offset: number; cuerpo: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'mister-volcado-'))
  const ruta = join(dir, 'volcado-feed.json')
  writeFileSync(
    ruta,
    JSON.stringify({ paginas: paginas.map((p) => ({ ...p, capturadaEn: '2026-09-03T10:00:00Z' })) }),
  )
  return ruta
}

describe('importarVolcado', () => {
  it('guarda todos los lotes del volcado', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await importarVolcado(
      volcadoCon([{ offset: 0, cuerpo: ruido(21) }, { offset: 21, cuerpo: vacio }]),
      almacen,
    )

    expect(resumen.lotes).toBe(2)
    expect(almacen.leerPaginas().map((p) => p.offset)).toEqual([0, 21])
    almacen.cerrar()
  })

  it('cuenta los eventos igual que la recolección directa', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await importarVolcado(volcadoCon([{ offset: 0, cuerpo: ruido(3) }]), almacen)

    expect(resumen.eventos).toBe(3)
    expect(resumen.ruido).toBe(3)
    almacen.cerrar()
  })

  it('rechaza un volcado con discontinuidad', async () => {
    const almacen = abrirAlmacen(':memory:')
    await expect(
      importarVolcado(
        volcadoCon([{ offset: 0, cuerpo: ruido(21) }, { offset: 99, cuerpo: vacio }]),
        almacen,
      ),
    ).rejects.toThrow(/no es continuo/i)
    almacen.cerrar()
  })
})
```

- [ ] **Paso 2: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/cli/importar.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 3: Implementar el importador**

Fichero `src/cli/importar.ts`:

```ts
import { readFileSync } from 'node:fs'
import type { Almacen } from '../almacen/crudo.js'
import { abrirAlmacen } from '../almacen/crudo.js'
import { esContable } from '../dominio/eventos.js'
import { comprobarContinuidad } from '../recoleccion/integridad.js'
import { parsearPaginaFeed } from '../recoleccion/parseadorFeed.js'
import type { Resumen } from '../recoleccion/recolectar.js'

type PaginaVolcada = { offset: number; cuerpo: string; capturadaEn: string }

/**
 * Importa un volcado capturado en el navegador.
 *
 * Aplica exactamente las mismas comprobaciones que la recolección directa:
 * mismo parseo, misma verificación de continuidad. La procedencia no relaja nada.
 */
export async function importarVolcado(ruta: string, almacen: Almacen): Promise<Resumen> {
  const { paginas } = JSON.parse(readFileSync(ruta, 'utf8')) as { paginas: PaginaVolcada[] }
  const resumen: Resumen = { lotes: 0, eventos: 0, contables: 0, ruido: 0 }

  for (const pagina of paginas) {
    const { eventos } = parsearPaginaFeed(pagina.cuerpo)

    almacen.guardarPagina({
      offset: pagina.offset,
      nEventos: eventos.length,
      cuerpo: pagina.cuerpo,
      capturadaEn: pagina.capturadaEn,
    })
    resumen.lotes++

    for (const evento of eventos) {
      resumen.eventos++
      if (esContable(evento)) resumen.contables++
      else resumen.ruido++
    }
  }

  comprobarContinuidad(almacen.leerPaginas())

  return resumen
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ruta = process.argv[2]
  if (!ruta) {
    console.error('Uso: npm run importar -- <ruta del volcado-feed.json>')
    process.exit(1)
  }

  const almacen = abrirAlmacen('datos/mister.sqlite')
  try {
    const r = await importarVolcado(ruta, almacen)
    console.log(`Lotes importados: ${r.lotes}`)
    console.log(`Eventos totales:  ${r.eventos} (contables ${r.contables}, ruido ${r.ruido})`)
    console.log('\nHistórico completo y continuo.')
  } finally {
    almacen.cerrar()
  }
}
```

- [ ] **Paso 4: Añadir el script a `package.json`**

En `"scripts"`, añadir:

```json
"importar": "mkdir -p datos && tsx src/cli/importar.ts"
```

- [ ] **Paso 5: Ejecutar los tests y comprobar que pasan**

Ejecutar: `npx vitest run tests/cli/importar.test.ts`
Esperado: PASA, 3 tests.

- [ ] **Paso 6: Importar el volcado real**

Ejecutar: `npm run importar -- datos/volcado-feed.json`
Esperado: 16 lotes, 285 eventos, 187 contables, sin discontinuidad.

- [ ] **Paso 7: Commit**

```bash
git add src/cli/importar.ts tests/cli/importar.test.ts package.json
git commit -m "feat: importador de volcados del navegador"
```

---

## Criterio de aceptación de la Fase 1

La fase está terminada cuando:

1. `npm test` pasa entero y `npm run typecheck` no da errores.
2. El histórico se ha recolectado completo, por `npm run recolectar` o por
   `npm run importar`, terminando sin errores.
3. `paginas_crudas` es continua: cada offset es el anterior más su número de
   eventos, empezando en 0.
4. Ninguna categoría del histórico real ha quedado sin catalogar.
5. Los recuentos coinciden con la referencia del 2026-09-03: 16 lotes, 285
   eventos, 187 contables (183 `transfer` + 4 `gameweek_end`).

**No se pasa a la Fase 2** hasta que los cinco se cumplan.

## Asunto abierto para la Fase 2

Hay **4 eventos `gameweek_end`** con la liga en la jornada 6. Podría ser normal
(jornadas aún sin cerrar, o la primera sin premio) o un hueco real. La
comprobación de la Fase 2 —saldo propio reconstruido igual a `balance.current`
al céntimo— lo resolverá: si falta una jornada, no cuadrará.

## Qué queda fuera de este plan

- Motor contable y cálculo de saldos → Fase 2.
- Saldos de rivales, topes de puja y panel web → Fase 3.
- Recolección incremental diaria → Fase 3.
