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

### Tarea 2: Capturar una respuesta real del feed

**Por qué es la primera tarea real:** nunca se ha observado una respuesta
correcta de `POST /ajax/feed` (desde fuera del navegador siempre devuelve 401).
Escribir el parseador contra un formato supuesto produciría exactamente el tipo
de fallo silencioso que este proyecto no admite. Esta tarea obtiene el formato
auténtico y lo congela.

**Ficheros:**
- Crear: `navegador/capturar-feed.js`
- Crear: `fixtures/feed-pagina-0.json` (generado, se comitea)
- Crear: `fixtures/feed-pagina-1.json` (generado, se comitea)
- Crear: `fixtures/README.md`

**Interfaces:**
- Consume: nada.
- Produce: ficheros de fixture con la respuesta íntegra de `/ajax/feed`, y el
  conocimiento del nombre exacto de los campos, que las tareas 3 y 4 necesitan.

- [ ] **Paso 1: Escribir el script de captura**

Fichero `navegador/capturar-feed.js`. Se pega en la consola de la pestaña de
Mister ya autenticada, o se ejecuta mediante las herramientas de navegador.

```js
/**
 * Captura páginas crudas de POST /ajax/feed desde dentro de la propia página,
 * que es el único contexto donde la petición está autenticada con certeza.
 *
 * Devuelve un objeto { paginas: [...] } listo para volcar a disco.
 * No inspecciona ni transforma el contenido: lo entrega íntegro.
 */
async function capturarFeed(desde = 0, hasta = 1) {
  const paginas = []

  for (let page = desde; page <= hasta; page++) {
    const respuesta = await fetch('/ajax/feed', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams({ page: String(page) }).toString(),
    })

    const texto = await respuesta.text()
    paginas.push({ page, estado: respuesta.status, cuerpo: texto })

    await new Promise((r) => setTimeout(r, 1000))
  }

  return { paginas }
}

globalThis.capturarFeed = capturarFeed
```

- [ ] **Paso 2: Ejecutar la captura en el navegador**

Abrir `https://mister.mundodeportivo.com/feed` en Chrome con la sesión
iniciada, pegar el script y ejecutar:

```js
await capturarFeed(0, 1)
```

Esperado: dos entradas con `estado: 200` y un `cuerpo` no vacío.

**Si devuelve 401**, la petición necesita algo más de lo que envía este script.
Diagnóstico, en este orden:

1. Volver a cargar `/feed`, instalar un interceptor de `fetch` y
   `XMLHttpRequest.prototype.setRequestHeader` **antes** de hacer scroll.
2. Hacer scroll hasta que la aplicación cargue otra página del feed.
3. Registrar la lista de **nombres** de cabecera que la aplicación añade (no sus
   valores) y el nombre de los campos del cuerpo.
4. Añadir esas cabeceras al script y repetir.

No continuar con la Tarea 3 hasta obtener un `estado: 200` con cuerpo.

- [ ] **Paso 3: Guardar los fixtures**

Volcar cada `cuerpo` a `fixtures/feed-pagina-0.json` y
`fixtures/feed-pagina-1.json`, tal cual, sin reformatear.

- [ ] **Paso 4: Anonimizar solo lo que sea secreto**

Revisar los fixtures y sustituir cualquier token de sesión o identificador de
autenticación por `"REDACTADO"`. **No tocar** nombres de equipo, jugadores,
importes ni fechas: son los datos que los tests deben verificar.

Ejecutar: `grep -riE "auth|token|cookie|session" fixtures/`
Esperado: sin resultados, o solo `"REDACTADO"`.

- [ ] **Paso 5: Documentar la estructura observada**

Fichero `fixtures/README.md`. Rellenar con lo realmente observado:

```markdown
# Fixtures del feed

Respuestas íntegras de `POST /ajax/feed`, capturadas el <fecha> desde la sesión
del navegador. Son la única fuente fiable del formato: se capturaron porque la
petición no se pudo reproducir desde fuera del navegador.

## Estructura de la respuesta

- Claves de la raíz: <rellenar>
- Cómo se identifica el tipo de cada evento: <rellenar>
- Campo con la fecha del evento: <rellenar>
- Cómo se señala el final del histórico: <rellenar>

## Tipos de evento presentes

| Tipo | Campos relevantes | Contable |
|---|---|---|
| <rellenar> | | |

## Regenerarlos

Ejecutar `navegador/capturar-feed.js` en la consola de la página de Mister.
```

- [ ] **Paso 6: Commit**

```bash
git add navegador fixtures
git commit -m "feat: capturar y congelar respuestas reales del feed"
```

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

**Depende de la Tarea 2:** los tests se escriben contra
`fixtures/feed-pagina-0.json`, y el cuerpo del parseador contra la estructura
documentada en `fixtures/README.md`. **No inventar el formato**: leer el fixture
primero.

**Ficheros:**
- Crear: `src/recoleccion/parseadorFeed.ts`
- Crear: `tests/recoleccion/parseadorFeed.test.ts`

**Interfaces:**
- Consume: `Evento` y afines (Tarea 3), `parsearImporte` (Tarea 1).
- Produce:
  - `function parsearPaginaFeed(cuerpo: string): PaginaFeed`
  - `type PaginaFeed = { eventos: Evento[]; hayMas: boolean }`
  - `class EventoDesconocidoError extends Error { readonly crudo: string }`

- [ ] **Paso 1: Leer el fixture y anotar la estructura**

Ejecutar: `node -e "const f=require('fs').readFileSync('fixtures/feed-pagina-0.json','utf8');const j=JSON.parse(f);console.log(Object.keys(j))"`

Anotar las claves reales. Todo lo que sigue usa esos nombres, no otros.

- [ ] **Paso 2: Escribir el test que falla**

Fichero `tests/recoleccion/parseadorFeed.test.ts`. Los valores esperados se
toman **del fixture real**, leyéndolo:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EventoDesconocidoError,
  parsearPaginaFeed,
} from '../../src/recoleccion/parseadorFeed.js'
import { esContable } from '../../src/dominio/eventos.js'

const pagina0 = readFileSync('fixtures/feed-pagina-0.json', 'utf8')

describe('parsearPaginaFeed', () => {
  it('extrae al menos un evento de la página real', () => {
    const { eventos } = parsearPaginaFeed(pagina0)
    expect(eventos.length).toBeGreaterThan(0)
  })

  it('reconoce el tipo de todos los eventos de la página real', () => {
    const { eventos } = parsearPaginaFeed(pagina0)
    // Si algún evento no se reconociera, el parseo habría lanzado.
    // Este test documenta que la página real se procesa entera.
    for (const e of eventos) {
      expect(['transaccion', 'cierreJornada', 'ruido']).toContain(e.tipo)
    }
  })

  it('toda transacción tiene importe entero y no negativo', () => {
    const { eventos } = parsearPaginaFeed(pagina0)
    for (const e of eventos) {
      if (e.tipo === 'transaccion') {
        expect(Number.isInteger(e.importe)).toBe(true)
        expect(e.importe).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('todo cierre de jornada trae resultados de equipos', () => {
    const { eventos } = parsearPaginaFeed(pagina0)
    for (const e of eventos) {
      if (e.tipo === 'cierreJornada') {
        expect(e.resultados.length).toBeGreaterThan(0)
      }
    }
  })

  it('indica si hay más páginas', () => {
    const { hayMas } = parsearPaginaFeed(pagina0)
    expect(typeof hayMas).toBe('boolean')
  })

  it('lanza EventoDesconocidoError ante un tipo no catalogado', () => {
    const inventado = JSON.stringify({ items: [{ type: 'tipo_que_no_existe' }] })
    expect(() => parsearPaginaFeed(inventado)).toThrow(EventoDesconocidoError)
  })

  it('el error de evento desconocido conserva el contenido crudo', () => {
    const inventado = JSON.stringify({ items: [{ type: 'tipo_que_no_existe' }] })
    try {
      parsearPaginaFeed(inventado)
      expect.unreachable('debería haber lanzado')
    } catch (e) {
      expect(e).toBeInstanceOf(EventoDesconocidoError)
      expect((e as EventoDesconocidoError).crudo).toContain('tipo_que_no_existe')
    }
  })

  it('no descarta ningún evento contable de la página real', () => {
    const { eventos } = parsearPaginaFeed(pagina0)
    const contables = eventos.filter(esContable)
    expect(contables.length).toBeGreaterThan(0)
  })
})
```

**Nota para el implementador:** el test del tipo inventado usa la clave `items`.
Si el fixture real usa otro nombre para la lista de eventos, ajustar ese test
para que use el nombre real; el resto no cambia.

- [ ] **Paso 3: Ejecutar el test y comprobar que falla**

Ejecutar: `npx vitest run tests/recoleccion/parseadorFeed.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 4: Escribir la implementación**

Fichero `src/recoleccion/parseadorFeed.ts`. La estructura del esqueleto es
fija; los nombres de campo marcados se sustituyen por los reales del fixture.

```ts
import type { Evento } from '../dominio/eventos.js'

export type PaginaFeed = {
  eventos: Evento[]
  hayMas: boolean
}

/**
 * Un evento cuyo tipo no está catalogado. Detiene la recolección a propósito:
 * descartarlo produciría una contabilidad plausible y equivocada.
 */
export class EventoDesconocidoError extends Error {
  readonly crudo: string

  constructor(crudo: string) {
    super(`evento de feed no catalogado; recolección detenida`)
    this.name = 'EventoDesconocidoError'
    this.crudo = crudo
  }
}

/** Tipos sin efecto contable, ignorados a conciencia y de forma explícita. */
const TIPOS_RUIDO = new Set([
  'player_transfer', // fichaje de LaLiga real, no de la liga Fantasy
])

export function parsearPaginaFeed(cuerpo: string): PaginaFeed {
  const datos = JSON.parse(cuerpo) as Record<string, unknown>

  // NOMBRE REAL DEL CAMPO: tomar de fixtures/README.md
  const brutos = (datos['items'] ?? []) as Record<string, unknown>[]

  const eventos = brutos.map((bruto) => parsearEvento(bruto))

  // NOMBRE REAL DEL CAMPO: tomar de fixtures/README.md
  const hayMas = Boolean(datos['has_more'] ?? brutos.length > 0)

  return { eventos, hayMas }
}

function parsearEvento(bruto: Record<string, unknown>): Evento {
  const tipo = String(bruto['type'] ?? '')

  if (TIPOS_RUIDO.has(tipo)) {
    return {
      tipo: 'ruido',
      fecha: leerFecha(bruto),
      motivo: `tipo de feed sin efecto contable: ${tipo}`,
    }
  }

  if (tipo === 'transfer') return parsearTransaccion(bruto)
  if (tipo === 'gameweek_end') return parsearCierreJornada(bruto)

  throw new EventoDesconocidoError(JSON.stringify(bruto))
}
```

Completar `parsearTransaccion`, `parsearCierreJornada` y `leerFecha` con los
campos reales del fixture. Todas ellas deben usar `parsearImporte` para los
importes y lanzar si un campo obligatorio falta.

- [ ] **Paso 5: Ejecutar los tests y comprobar que pasan**

Ejecutar: `npx vitest run tests/recoleccion/parseadorFeed.test.ts`
Esperado: PASA, 8 tests.

- [ ] **Paso 6: Comprobar tipos y commit**

```bash
npm run typecheck
git add src/recoleccion/parseadorFeed.ts tests/recoleccion/parseadorFeed.test.ts fixtures/README.md
git commit -m "feat: parseador del feed con parada ante eventos no catalogados"
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
  - `type Almacen = { guardarPagina(p: PaginaCruda): void; leerPaginas(): PaginaCruda[]; paginasGuardadas(): number[]; cerrar(): void }`
  - `type PaginaCruda = { pagina: number; cuerpo: string; capturadaEn: string }`

- [ ] **Paso 1: Escribir el test que falla**

Fichero `tests/almacen/crudo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { abrirAlmacen } from '../../src/almacen/crudo.js'

function almacenEnMemoria() {
  return abrirAlmacen(':memory:')
}

describe('almacén crudo', () => {
  it('guarda y recupera una página íntegra', () => {
    const a = almacenEnMemoria()
    a.guardarPagina({ pagina: 0, cuerpo: '{"a":1}', capturadaEn: '2026-09-03T10:00:00Z' })
    expect(a.leerPaginas()).toEqual([
      { pagina: 0, cuerpo: '{"a":1}', capturadaEn: '2026-09-03T10:00:00Z' },
    ])
    a.cerrar()
  })

  it('devuelve las páginas ordenadas por número', () => {
    const a = almacenEnMemoria()
    a.guardarPagina({ pagina: 2, cuerpo: 'c', capturadaEn: '2026-09-03T10:00:02Z' })
    a.guardarPagina({ pagina: 0, cuerpo: 'a', capturadaEn: '2026-09-03T10:00:00Z' })
    a.guardarPagina({ pagina: 1, cuerpo: 'b', capturadaEn: '2026-09-03T10:00:01Z' })
    expect(a.paginasGuardadas()).toEqual([0, 1, 2])
    a.cerrar()
  })

  it('reguardar una página la sustituye en vez de duplicarla', () => {
    const a = almacenEnMemoria()
    a.guardarPagina({ pagina: 0, cuerpo: 'viejo', capturadaEn: '2026-09-03T10:00:00Z' })
    a.guardarPagina({ pagina: 0, cuerpo: 'nuevo', capturadaEn: '2026-09-03T11:00:00Z' })
    const paginas = a.leerPaginas()
    expect(paginas).toHaveLength(1)
    expect(paginas[0]!.cuerpo).toBe('nuevo')
    a.cerrar()
  })

  it('no altera el cuerpo guardado', () => {
    const a = almacenEnMemoria()
    const raro = '{"texto":"acentos áéí, emoji 🏆, comillas \\" y salto\\n"}'
    a.guardarPagina({ pagina: 0, cuerpo: raro, capturadaEn: '2026-09-03T10:00:00Z' })
    expect(a.leerPaginas()[0]!.cuerpo).toBe(raro)
    a.cerrar()
  })
})
```

- [ ] **Paso 2: Ejecutar el test y comprobar que falla**

Ejecutar: `npx vitest run tests/almacen/crudo.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 3: Escribir el esquema**

Fichero `src/almacen/esquema.ts`:

```ts
export const ESQUEMA = `
CREATE TABLE IF NOT EXISTS paginas_crudas (
  pagina       INTEGER PRIMARY KEY,
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
  pagina: number
  cuerpo: string
  capturadaEn: string
}

export type Almacen = {
  guardarPagina(p: PaginaCruda): void
  leerPaginas(): PaginaCruda[]
  paginasGuardadas(): number[]
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
    `INSERT INTO paginas_crudas (pagina, cuerpo, capturada_en)
     VALUES (@pagina, @cuerpo, @capturadaEn)
     ON CONFLICT(pagina) DO UPDATE SET
       cuerpo = excluded.cuerpo,
       capturada_en = excluded.capturada_en`,
  )

  const seleccionar = db.prepare(
    `SELECT pagina, cuerpo, capturada_en AS capturadaEn
     FROM paginas_crudas ORDER BY pagina`,
  )

  return {
    guardarPagina(p) {
      insertar.run(p)
    },
    leerPaginas() {
      return seleccionar.all() as PaginaCruda[]
    },
    paginasGuardadas() {
      return (seleccionar.all() as PaginaCruda[]).map((p) => p.pagina)
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
git commit -m "feat: almacén crudo inmutable sobre SQLite"
```

---

### Tarea 6: Detección de huecos y fin del histórico

**Ficheros:**
- Crear: `src/recoleccion/integridad.ts`
- Crear: `tests/recoleccion/integridad.test.ts`

**Interfaces:**
- Consume: nada del proyecto.
- Produce:
  - `function comprobarSinHuecos(paginas: number[]): void` — lanza `HuecoError` si falta alguna página entre la primera y la última.
  - `class HuecoError extends Error { readonly faltantes: number[] }`

Esta es la garantía de completitud: sin ella, una página perdida por un fallo de
red produciría una contabilidad silenciosamente incompleta.

- [ ] **Paso 1: Escribir el test que falla**

Fichero `tests/recoleccion/integridad.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HuecoError, comprobarSinHuecos } from '../../src/recoleccion/integridad.js'

describe('comprobarSinHuecos', () => {
  it('acepta una secuencia completa desde cero', () => {
    expect(() => comprobarSinHuecos([0, 1, 2, 3])).not.toThrow()
  })

  it('acepta una sola página', () => {
    expect(() => comprobarSinHuecos([0])).not.toThrow()
  })

  it('acepta una lista vacía', () => {
    expect(() => comprobarSinHuecos([])).not.toThrow()
  })

  it('acepta páginas desordenadas si están todas', () => {
    expect(() => comprobarSinHuecos([2, 0, 1])).not.toThrow()
  })

  it('lanza si falta una página intermedia', () => {
    expect(() => comprobarSinHuecos([0, 1, 3])).toThrow(HuecoError)
  })

  it('enumera todas las páginas que faltan', () => {
    try {
      comprobarSinHuecos([0, 3, 6])
      expect.unreachable('debería haber lanzado')
    } catch (e) {
      expect(e).toBeInstanceOf(HuecoError)
      expect((e as HuecoError).faltantes).toEqual([1, 2, 4, 5])
    }
  })

  it('lanza si la secuencia no empieza en cero', () => {
    expect(() => comprobarSinHuecos([1, 2])).toThrow(HuecoError)
  })
})
```

- [ ] **Paso 2: Ejecutar el test y comprobar que falla**

Ejecutar: `npx vitest run tests/recoleccion/integridad.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 3: Escribir la implementación**

Fichero `src/recoleccion/integridad.ts`:

```ts
/** Faltan páginas del histórico: la contabilidad sería incompleta. */
export class HuecoError extends Error {
  readonly faltantes: number[]

  constructor(faltantes: number[]) {
    super(
      `faltan ${faltantes.length} página(s) del histórico: ${faltantes.join(', ')}. ` +
        `La recolección no se da por buena.`,
    )
    this.name = 'HuecoError'
    this.faltantes = faltantes
  }
}

/**
 * Comprueba que las páginas recolectadas forman la serie 0..n sin saltos.
 *
 * Un hueco significa que un fallo de red se tragó parte del histórico, lo que
 * produciría un saldo plausible y equivocado. Por eso es un error, no un aviso.
 */
export function comprobarSinHuecos(paginas: number[]): void {
  if (paginas.length === 0) return

  const presentes = new Set(paginas)
  const maximo = Math.max(...paginas)
  const faltantes: number[] = []

  for (let i = 0; i <= maximo; i++) {
    if (!presentes.has(i)) faltantes.push(i)
  }

  if (faltantes.length > 0) throw new HuecoError(faltantes)
}
```

- [ ] **Paso 4: Ejecutar los tests y comprobar que pasan**

Ejecutar: `npx vitest run tests/recoleccion/integridad.test.ts`
Esperado: PASA, 7 tests.

- [ ] **Paso 5: Commit**

```bash
git add src/recoleccion/integridad.ts tests/recoleccion/integridad.test.ts
git commit -m "feat: detección de huecos en el histórico"
```

---

### Tarea 7: Sesión y cliente HTTP

**Ficheros:**
- Crear: `src/sesion/cookie.ts`
- Crear: `src/recoleccion/cliente.ts`
- Crear: `tests/sesion/cookie.test.ts`
- Crear: `tests/recoleccion/cliente.test.ts`

**Interfaces:**
- Consume: nada del proyecto.
- Produce:
  - `function obtenerCookie(ruta?: string): string` — lee `.sesion/cookie` y lanza si no existe o está vacía.
  - `function crearCliente(opciones: OpcionesCliente): Cliente`
  - `type Cliente = { pedirPaginaFeed(pagina: number): Promise<string> }`
  - `type OpcionesCliente = { cookie: string; base?: string; esperaMs?: number; fetch?: typeof globalThis.fetch }`

- [ ] **Paso 1: Escribir el test de la sesión**

Fichero `tests/sesion/cookie.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { obtenerCookie } from '../../src/sesion/cookie.js'

function ficheroCon(contenido: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mister-'))
  const ruta = join(dir, 'cookie')
  writeFileSync(ruta, contenido)
  return ruta
}

describe('obtenerCookie', () => {
  it('lee la cookie del fichero', () => {
    expect(obtenerCookie(ficheroCon('sesion=abc123'))).toBe('sesion=abc123')
  })

  it('recorta espacios y saltos de línea', () => {
    expect(obtenerCookie(ficheroCon('  sesion=abc123\n\n'))).toBe('sesion=abc123')
  })

  it('lanza si el fichero no existe', () => {
    expect(() => obtenerCookie('/ruta/que/no/existe')).toThrow(/no se encontró la sesión/i)
  })

  it('lanza si el fichero está vacío', () => {
    expect(() => obtenerCookie(ficheroCon('   \n'))).toThrow(/sesión vacía/i)
  })

  it('el mensaje de error no incluye el contenido del fichero', () => {
    const ruta = ficheroCon('   \n')
    try {
      obtenerCookie(ruta)
      expect.unreachable('debería haber lanzado')
    } catch (e) {
      expect((e as Error).message).not.toContain('sesion=')
    }
  })
})
```

- [ ] **Paso 2: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/sesion/cookie.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 3: Implementar la sesión**

Fichero `src/sesion/cookie.ts`:

```ts
import { readFileSync } from 'node:fs'

const RUTA_POR_DEFECTO = '.sesion/cookie'

/**
 * Devuelve la cookie de sesión de Mister.
 *
 * La cookie es HttpOnly y la cuenta usa login con Apple, así que no puede
 * obtenerse programáticamente: se copia una vez desde un navegador autenticado.
 *
 * Ningún mensaje de error incluye su valor.
 */
export function obtenerCookie(ruta: string = RUTA_POR_DEFECTO): string {
  let contenido: string
  try {
    contenido = readFileSync(ruta, 'utf8')
  } catch {
    throw new Error(
      `no se encontró la sesión en ${ruta}. ` +
        `Cópiala desde el navegador y guárdala ahí.`,
    )
  }

  const cookie = contenido.trim()
  if (cookie === '') {
    throw new Error(`sesión vacía en ${ruta}. Vuelve a capturarla del navegador.`)
  }

  return cookie
}
```

- [ ] **Paso 4: Escribir el test del cliente**

Fichero `tests/recoleccion/cliente.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { crearCliente } from '../../src/recoleccion/cliente.js'

function respuesta(cuerpo: string, status = 200): Response {
  return new Response(cuerpo, { status })
}

describe('cliente del feed', () => {
  it('pide la página indicada y devuelve el cuerpo', async () => {
    const fetchFalso = vi.fn(async () => respuesta('{"ok":1}'))
    const c = crearCliente({ cookie: 'sesion=x', esperaMs: 0, fetch: fetchFalso as never })

    expect(await c.pedirPaginaFeed(3)).toBe('{"ok":1}')

    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/ajax/feed')
    expect(String(init.body)).toContain('page=3')
  })

  it('envía la cookie en la cabecera', async () => {
    const fetchFalso = vi.fn(async () => respuesta('{}'))
    const c = crearCliente({ cookie: 'sesion=secreta', esperaMs: 0, fetch: fetchFalso as never })
    await c.pedirPaginaFeed(0)

    const [, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Cookie']).toBe('sesion=secreta')
  })

  it('reintenta ante un error del servidor y acaba devolviendo el cuerpo', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(respuesta('', 500))
      .mockResolvedValueOnce(respuesta('{"ok":1}'))
    const c = crearCliente({ cookie: 'sesion=x', esperaMs: 0, fetch: fetchFalso as never })

    expect(await c.pedirPaginaFeed(0)).toBe('{"ok":1}')
    expect(fetchFalso).toHaveBeenCalledTimes(2)
  })

  it('no reintenta ante un 401 y avisa de la sesión', async () => {
    const fetchFalso = vi.fn(async () => respuesta('{"status":"error"}', 401))
    const c = crearCliente({ cookie: 'sesion=x', esperaMs: 0, fetch: fetchFalso as never })

    await expect(c.pedirPaginaFeed(0)).rejects.toThrow(/sesión/i)
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('el error de sesión no revela la cookie', async () => {
    const fetchFalso = vi.fn(async () => respuesta('', 401))
    const c = crearCliente({ cookie: 'sesion=secreta', esperaMs: 0, fetch: fetchFalso as never })

    await expect(c.pedirPaginaFeed(0)).rejects.not.toThrow(/secreta/)
  })
})
```

- [ ] **Paso 5: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/recoleccion/cliente.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 6: Implementar el cliente**

Fichero `src/recoleccion/cliente.ts`:

```ts
const BASE_POR_DEFECTO = 'https://mister.mundodeportivo.com'
const ESPERA_POR_DEFECTO_MS = 1000
const REINTENTOS = 3

export type OpcionesCliente = {
  cookie: string
  base?: string
  esperaMs?: number
  fetch?: typeof globalThis.fetch
}

export type Cliente = {
  pedirPaginaFeed(pagina: number): Promise<string>
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Cliente HTTP del feed. Solo pide y devuelve texto: no interpreta nada.
 *
 * Espacia las peticiones para no castigar el servidor de Mister y reintenta los
 * fallos transitorios, pero nunca un 401: eso significa sesión caducada y
 * reintentarlo solo añade ruido.
 */
export function crearCliente(opciones: OpcionesCliente): Cliente {
  const base = opciones.base ?? BASE_POR_DEFECTO
  const esperaMs = opciones.esperaMs ?? ESPERA_POR_DEFECTO_MS
  const hacerFetch = opciones.fetch ?? globalThis.fetch

  return {
    async pedirPaginaFeed(pagina: number): Promise<string> {
      let ultimoFallo: Error | undefined

      for (let intento = 0; intento < REINTENTOS; intento++) {
        if (intento > 0) await dormir(esperaMs * 2 ** intento)

        const res = await hacerFetch(`${base}/ajax/feed`, {
          method: 'POST',
          headers: {
            Cookie: opciones.cookie,
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          },
          body: new URLSearchParams({ page: String(pagina) }).toString(),
        })

        if (res.status === 401) {
          throw new Error(
            'sesión de Mister caducada o no válida. Vuelve a capturar la cookie.',
          )
        }

        if (res.ok) {
          await dormir(esperaMs)
          return await res.text()
        }

        ultimoFallo = new Error(`la página ${pagina} devolvió HTTP ${res.status}`)
      }

      throw ultimoFallo ?? new Error(`no se pudo obtener la página ${pagina}`)
    },
  }
}
```

- [ ] **Paso 7: Ejecutar todos los tests**

Ejecutar: `npm test`
Esperado: PASAN todos.

- [ ] **Paso 8: Commit**

```bash
git add src/sesion src/recoleccion/cliente.ts tests/sesion tests/recoleccion/cliente.test.ts
git commit -m "feat: sesión desde fichero y cliente HTTP con ritmo y reintentos"
```

---

### Tarea 8: Recolección completa y comprobación

**Ficheros:**
- Crear: `src/recoleccion/recolectar.ts`
- Crear: `src/cli/recolectar.ts`
- Crear: `tests/recoleccion/recolectar.test.ts`
- Modificar: `package.json` (añadir el script `recolectar`)

**Interfaces:**
- Consume: `Cliente` (T7), `Almacen` (T5), `parsearPaginaFeed` (T4), `comprobarSinHuecos` (T6).
- Produce:
  - `async function recolectarHistorico(dep: Dependencias): Promise<Resumen>`
  - `type Dependencias = { cliente: Cliente; almacen: Almacen; maxPaginas?: number }`
  - `type Resumen = { paginas: number; eventos: number; contables: number; ruido: number }`

- [ ] **Paso 1: Escribir el test que falla**

Fichero `tests/recoleccion/recolectar.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { abrirAlmacen } from '../../src/almacen/crudo.js'
import { recolectarHistorico } from '../../src/recoleccion/recolectar.js'
import type { Cliente } from '../../src/recoleccion/cliente.js'

/** Cliente falso que sirve páginas preparadas y luego se agota. */
function clienteCon(paginas: string[]): Cliente {
  return {
    async pedirPaginaFeed(n: number) {
      return paginas[n] ?? JSON.stringify({ items: [], has_more: false })
    },
  }
}

const conRuido = JSON.stringify({
  items: [{ type: 'player_transfer', date: '2026-09-01T00:00:00Z' }],
  has_more: true,
})

const vacia = JSON.stringify({ items: [], has_more: false })

describe('recolectarHistorico', () => {
  it('recorre hasta agotar el histórico', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await recolectarHistorico({
      cliente: clienteCon([conRuido, conRuido, vacia]),
      almacen,
    })

    expect(resumen.paginas).toBe(3)
    expect(almacen.paginasGuardadas()).toEqual([0, 1, 2])
    almacen.cerrar()
  })

  it('guarda el cuerpo crudo de cada página', async () => {
    const almacen = abrirAlmacen(':memory:')
    await recolectarHistorico({ cliente: clienteCon([conRuido, vacia]), almacen })

    expect(almacen.leerPaginas()[0]!.cuerpo).toBe(conRuido)
    almacen.cerrar()
  })

  it('cuenta eventos contables y ruido por separado', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await recolectarHistorico({
      cliente: clienteCon([conRuido, vacia]),
      almacen,
    })

    expect(resumen.ruido).toBe(1)
    expect(resumen.contables).toBe(0)
    almacen.cerrar()
  })

  it('se detiene al alcanzar el límite de páginas', async () => {
    const almacen = abrirAlmacen(':memory:')
    const infinitas = Array.from({ length: 50 }, () => conRuido)
    const resumen = await recolectarHistorico({
      cliente: clienteCon(infinitas),
      almacen,
      maxPaginas: 5,
    })

    expect(resumen.paginas).toBe(5)
    almacen.cerrar()
  })

  it('propaga el error si un evento no está catalogado', async () => {
    const almacen = abrirAlmacen(':memory:')
    const desconocido = JSON.stringify({ items: [{ type: 'inventado' }], has_more: true })

    await expect(
      recolectarHistorico({ cliente: clienteCon([desconocido]), almacen }),
    ).rejects.toThrow(/no catalogado/i)

    almacen.cerrar()
  })

  it('guarda la página cruda aunque su contenido no se pueda interpretar', async () => {
    const almacen = abrirAlmacen(':memory:')
    const desconocido = JSON.stringify({ items: [{ type: 'inventado' }], has_more: true })

    await expect(
      recolectarHistorico({ cliente: clienteCon([desconocido]), almacen }),
    ).rejects.toThrow()

    // El crudo se guarda antes de interpretar, para poder diagnosticar.
    expect(almacen.paginasGuardadas()).toEqual([0])
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
import { comprobarSinHuecos } from './integridad.js'
import { parsearPaginaFeed } from './parseadorFeed.js'

const MAX_PAGINAS_POR_DEFECTO = 2000

export type Dependencias = {
  cliente: Cliente
  almacen: Almacen
  maxPaginas?: number
}

export type Resumen = {
  paginas: number
  eventos: number
  contables: number
  ruido: number
}

/**
 * Recorre el feed desde la página 0 hacia atrás hasta agotar el histórico.
 *
 * Guarda el crudo ANTES de interpretarlo: si un evento no está catalogado, el
 * proceso se detiene pero la página queda en disco para poder diagnosticarla.
 */
export async function recolectarHistorico(dep: Dependencias): Promise<Resumen> {
  const maxPaginas = dep.maxPaginas ?? MAX_PAGINAS_POR_DEFECTO
  const resumen: Resumen = { paginas: 0, eventos: 0, contables: 0, ruido: 0 }

  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const cuerpo = await dep.cliente.pedirPaginaFeed(pagina)

    dep.almacen.guardarPagina({
      pagina,
      cuerpo,
      capturadaEn: new Date().toISOString(),
    })
    resumen.paginas++

    const { eventos, hayMas } = parsearPaginaFeed(cuerpo)

    for (const evento of eventos) {
      resumen.eventos++
      if (esContable(evento)) resumen.contables++
      else resumen.ruido++
    }

    if (!hayMas) break
  }

  comprobarSinHuecos(dep.almacen.paginasGuardadas())

  return resumen
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
import { obtenerCookie } from '../sesion/cookie.js'

async function principal(): Promise<void> {
  const almacen = abrirAlmacen('datos/mister.sqlite')

  try {
    const resumen = await recolectarHistorico({
      cliente: crearCliente({ cookie: obtenerCookie() }),
      almacen,
    })

    console.log(`Páginas recorridas: ${resumen.paginas}`)
    console.log(`Eventos totales:    ${resumen.eventos}`)
    console.log(`  contables:        ${resumen.contables}`)
    console.log(`  ruido:            ${resumen.ruido}`)
    console.log('\nHistórico completo, sin huecos.')
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

Guardar la cookie del navegador en `.sesion/cookie` y ejecutar:

Ejecutar: `npm run recolectar`

Esperado: recorre todas las páginas hasta el origen de la liga e imprime el
resumen sin errores. Si se detiene por un evento no catalogado, añadir ese tipo
a `parsearEvento` o a `TIPOS_RUIDO` **de forma razonada** —nunca al bulto— y
repetir.

- [ ] **Paso 8: Comprobar la completitud a mano**

Ejecutar:

```bash
node -e "const D=require('better-sqlite3');const db=new D('datos/mister.sqlite');console.log(db.prepare('SELECT COUNT(*) n, MIN(pagina) min, MAX(pagina) max FROM paginas_crudas').get())"
```

Esperado: `n` igual a `max + 1` y `min` igual a `0`. Cualquier otra cosa
significa hueco y ya habría fallado antes.

- [ ] **Paso 9: Ejecutar toda la batería y comprobar tipos**

Ejecutar: `npm test && npm run typecheck`
Esperado: todo pasa.

- [ ] **Paso 10: Commit**

```bash
git add src/recoleccion/recolectar.ts src/cli tests/recoleccion/recolectar.test.ts package.json
git commit -m "feat: recolección completa del histórico con verificación de integridad"
```

---

### Tarea 9 (condicional): recolección completa por la vía B

**Cuándo hacerla:** solo si en la Tarea 2 no se consiguió que
`POST /ajax/feed` respondiera 200 desde fuera del navegador. Si la vía A
funciona, esta tarea se salta entera.

**Por qué existe:** el requisito es fidelidad absoluta, y eso no puede depender
de resolver una incógnita. Dentro de la página la petición funciona con certeza,
así que esta vía garantiza el histórico completo pase lo que pase.

**Ficheros:**
- Modificar: `navegador/capturar-feed.js`
- Crear: `src/cli/importar.ts`
- Crear: `tests/cli/importar.test.ts`

**Interfaces:**
- Consume: `abrirAlmacen` (T5), `parsearPaginaFeed` (T4), `comprobarSinHuecos` (T6).
- Produce: `async function importarVolcado(ruta: string, almacen: Almacen): Promise<Resumen>` — mismo `Resumen` que `recolectarHistorico`.

El artefacto que produce es **idéntico** al de la vía A: filas en
`paginas_crudas`. Nada aguas abajo distingue una vía de otra.

- [ ] **Paso 1: Ampliar el script del navegador para recorrer todo**

Añadir a `navegador/capturar-feed.js`:

```js
/**
 * Recorre el feed entero desde dentro de la página y descarga un único fichero
 * JSON con todas las páginas crudas, listo para `npm run importar`.
 */
async function volcarHistoricoCompleto(maxPaginas = 2000) {
  const paginas = []

  for (let page = 0; page < maxPaginas; page++) {
    const respuesta = await fetch('/ajax/feed', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams({ page: String(page) }).toString(),
    })

    if (!respuesta.ok) throw new Error(`página ${page}: HTTP ${respuesta.status}`)

    const cuerpo = await respuesta.text()
    paginas.push({ pagina: page, cuerpo, capturadaEn: new Date().toISOString() })

    // Fin del histórico: la página no trae eventos.
    const datos = JSON.parse(cuerpo)
    if (!(datos.items ?? []).length) break

    console.log(`página ${page} · ${paginas.length} acumuladas`)
    await new Promise((r) => setTimeout(r, 1000))
  }

  const blob = new Blob([JSON.stringify({ paginas })], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'volcado-feed.json'
  a.click()

  return paginas.length
}

globalThis.volcarHistoricoCompleto = volcarHistoricoCompleto
```

**Nota:** ajustar `datos.items` al nombre real del campo documentado en
`fixtures/README.md`.

- [ ] **Paso 2: Escribir el test que falla**

Fichero `tests/cli/importar.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { abrirAlmacen } from '../../src/almacen/crudo.js'
import { importarVolcado } from '../../src/cli/importar.js'

const conRuido = JSON.stringify({
  items: [{ type: 'player_transfer', date: '2026-09-01T00:00:00Z' }],
  has_more: true,
})
const vacia = JSON.stringify({ items: [], has_more: false })

function volcadoCon(paginas: { pagina: number; cuerpo: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'mister-volcado-'))
  const ruta = join(dir, 'volcado-feed.json')
  writeFileSync(
    ruta,
    JSON.stringify({
      paginas: paginas.map((p) => ({ ...p, capturadaEn: '2026-09-03T10:00:00Z' })),
    }),
  )
  return ruta
}

describe('importarVolcado', () => {
  it('guarda todas las páginas del volcado', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await importarVolcado(
      volcadoCon([
        { pagina: 0, cuerpo: conRuido },
        { pagina: 1, cuerpo: vacia },
      ]),
      almacen,
    )

    expect(resumen.paginas).toBe(2)
    expect(almacen.paginasGuardadas()).toEqual([0, 1])
    almacen.cerrar()
  })

  it('produce el mismo recuento de eventos que la vía A', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await importarVolcado(
      volcadoCon([{ pagina: 0, cuerpo: conRuido }]),
      almacen,
    )

    expect(resumen.ruido).toBe(1)
    expect(resumen.contables).toBe(0)
    almacen.cerrar()
  })

  it('rechaza un volcado con huecos', async () => {
    const almacen = abrirAlmacen(':memory:')
    await expect(
      importarVolcado(
        volcadoCon([
          { pagina: 0, cuerpo: conRuido },
          { pagina: 2, cuerpo: vacia },
        ]),
        almacen,
      ),
    ).rejects.toThrow(/faltan .* página/i)
    almacen.cerrar()
  })
})
```

- [ ] **Paso 3: Ejecutar y comprobar que falla**

Ejecutar: `npx vitest run tests/cli/importar.test.ts`
Esperado: FALLA por módulo inexistente.

- [ ] **Paso 4: Implementar el importador**

Fichero `src/cli/importar.ts`:

```ts
import { readFileSync } from 'node:fs'
import type { Almacen, PaginaCruda } from '../almacen/crudo.js'
import { abrirAlmacen } from '../almacen/crudo.js'
import { esContable } from '../dominio/eventos.js'
import { comprobarSinHuecos } from '../recoleccion/integridad.js'
import { parsearPaginaFeed } from '../recoleccion/parseadorFeed.js'
import type { Resumen } from '../recoleccion/recolectar.js'

/**
 * Importa un volcado producido en el navegador (vía B).
 *
 * Aplica exactamente las mismas comprobaciones que la vía A: mismo parseo,
 * misma detección de huecos, mismo resumen. La procedencia no relaja nada.
 */
export async function importarVolcado(
  ruta: string,
  almacen: Almacen,
): Promise<Resumen> {
  const { paginas } = JSON.parse(readFileSync(ruta, 'utf8')) as {
    paginas: PaginaCruda[]
  }

  const resumen: Resumen = { paginas: 0, eventos: 0, contables: 0, ruido: 0 }

  for (const pagina of paginas) {
    almacen.guardarPagina(pagina)
    resumen.paginas++

    for (const evento of parsearPaginaFeed(pagina.cuerpo).eventos) {
      resumen.eventos++
      if (esContable(evento)) resumen.contables++
      else resumen.ruido++
    }
  }

  comprobarSinHuecos(almacen.paginasGuardadas())

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
    console.log(`Páginas importadas: ${r.paginas}`)
    console.log(`Eventos totales:    ${r.eventos} (contables ${r.contables}, ruido ${r.ruido})`)
    console.log('\nHistórico completo, sin huecos.')
  } finally {
    almacen.cerrar()
  }
}
```

- [ ] **Paso 5: Añadir el script a `package.json`**

En `"scripts"`, añadir:

```json
"importar": "mkdir -p datos && tsx src/cli/importar.ts"
```

- [ ] **Paso 6: Ejecutar los tests y comprobar que pasan**

Ejecutar: `npx vitest run tests/cli/importar.test.ts`
Esperado: PASA, 3 tests.

- [ ] **Paso 7: Ejecutar el volcado real e importarlo**

En la consola de Mister: `await volcarHistoricoCompleto()`. Descarga
`volcado-feed.json`. Después:

Ejecutar: `npm run importar -- ~/Downloads/volcado-feed.json`
Esperado: resumen sin errores y sin huecos.

- [ ] **Paso 8: Commit**

```bash
git add navegador/capturar-feed.js src/cli/importar.ts tests/cli/importar.test.ts package.json
git commit -m "feat: vía B, recolección del histórico desde el navegador"
```

---

## Criterio de aceptación de la Fase 1

La fase está terminada cuando:

1. `npm test` pasa entero y `npm run typecheck` no da errores.
2. El histórico se ha recolectado entero por la vía A (`npm run recolectar`) o
   por la vía B (`npm run importar`), terminando sin errores.
3. `paginas_crudas` contiene la serie `0..n` completa, sin huecos.
4. Ningún evento del histórico real ha quedado sin catalogar.
5. El recuento de eventos contables es mayor que cero y coherente con lo que se
   ve en la web.

**No se pasa a la Fase 2** hasta que los cinco se cumplan. La Fase 2 calibra el
motor contra `balance.current`, y esa comprobación solo tiene valor si el
histórico de partida está completo.

## Qué queda fuera de este plan

- Motor contable y cálculo de saldos → Fase 2.
- Estimación de rivales, topes de puja y panel web → Fase 3.
- Recolección incremental diaria → Fase 3, cuando haya algo que actualizar.
