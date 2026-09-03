# API de Mister — hechos verificados

Verificado el 2026-09-03 contra la sesión real de la liga. Todo lo de aquí se
comprobó ejecutando las peticiones, no leyendo código.

## El endpoint del histórico

```
POST https://mister.mundodeportivo.com/ajax/feed
```

**Cabeceras obligatorias:**

| Cabecera | Valor |
|---|---|
| `X-Auth` | El token de `window._FG_cfg.auth` |
| `X-Requested-With` | `XMLHttpRequest` |
| `Content-Type` | `application/x-www-form-urlencoded; charset=UTF-8` |
| `Accept` | `application/json` |

**Cuerpo** (`application/x-www-form-urlencoded`):

| Campo | Valor |
|---|---|
| `offset` | Nº de eventos ya consumidos. Empieza en 0. |
| `cardsPerPage` | `20`. Valores mayores se ignoran: el servidor devuelve lotes de ~21. |
| `end` | `0` |
| `loading` | `0` |

**Sin `X-Auth` la respuesta es 401** con `{"status":"error","popup":false}`.
Este fue el bloqueo que costó resolver: el token va en la cabecera, no en el
cuerpo. El campo `page` no existe — la paginación es por `offset`.

## Forma de la respuesta

```
{ status: "ok", data: [ ...eventos... ], cfg: {...}, isAjax: ... }
```

`data` es un **array** de eventos. La paginación avanza sumando
`offset += data.length` — el recuento **bruto** de la respuesta, no el número de
eventos de dominio que se deriven de ella (un `transfer` produce varios).

**El fin del histórico se señala con `status`, nunca con `data` vacío:**

| `status` | Significado |
|---|---|
| `"ok"` | Lote con datos; **debe** traer un array `data` |
| `"end"` | Histórico agotado; **no trae campo `data` en absoluto** |
| `"error"` | Fallo, típicamente 401 por sesión caducada; tampoco trae `data` |

Verificado contra los 16 lotes del histórico real. Esto importa: como una
respuesta de error tampoco trae `data`, deducir el final de que la lista esté
vacía **confundiría una sesión caducada con el fin del histórico** y cortaría la
recolección en silencio.

Cada evento trae:

| Campo | Contenido |
|---|---|
| `category` | **El tipo de evento.** Es el discriminador. |
| `date` | Fecha relativa mostrada en la interfaz (`"1d"`, `"1m"`) |
| `created` | Fecha absoluta, `YYYY-MM-DD HH:MM:SS` |
| `data` | Carga útil, distinta según `category` |
| `id`, `sticky`, `communityId`, `competitionId`, `pinDate`, `unPinDate`, `segmentId` | Metadatos |

## Catálogo completo de categorías

Recuento del histórico entero de la liga (285 eventos, 16 páginas, desde el
2026-08-03):

| `category` | Nº | Contable | Qué es |
|---|---|---|---|
| `transfer` | 183 | **Sí** | Transacción de la liga Fantasy |
| `gameweek_end` | 4 | **Sí** | Cierre de jornada, con ranking y premios |
| `player_transfer` | 76 | No | Fichaje de LaLiga real |
| `post` | 5 | No | Publicación en el muro |
| `pool_public` | 4 | No | Quiniela |
| `blog` | 3 | No | Entrada de blog |
| `gameweek_start` | 3 | No | Apertura de jornada |
| `porra` | 2 | No | Porra |
| `admin` | 2 | No | Evento administrativo (el más antiguo: origen de la liga) |
| `change_name` | 1 | No | Cambio de nombre de equipo |
| `news_md` | 1 | No | Noticia de Mundo Deportivo |
| `market_unified` | 1 | No | Resumen del mercado actual |

## `transfer` — la transacción

**Su `data` es un ARRAY: un evento puede contener varios movimientos.** En el
histórico completo, 183 eventos `transfer` contienen **252 movimientos**; 32 de
ellos traen más de uno. Un parseador que asuma uno por evento perdería 69
transacciones en silencio.

**Tipos de operación observados:** `normal` (244), `clause` (7), `rescind` (1).

Los campos de cada movimiento:

| Campo | Tipo | Significado |
|---|---|---|
| `id_transfer` | número | Identificador único de la operación |
| `id_uc_from` | número | Vendedor. **`0` significa el mercado (Mister)** |
| `id_uc_to` | número | Comprador. `0` significa el mercado |
| `price` | **número entero** | Importe. Ya viene como entero, no como texto |
| `type` | texto | `normal`, `clause` o `rescind` |
| `from` / `to` | texto | Nombres mostrados, p. ej. `"Mister"`, `"Niutin FC (Isaac)"` |
| `id_user1` / `id_user2` | número | Usuarios implicados |
| `name` | texto | Nombre del jugador |
| `value` / `prev_value` | número | Valor de mercado actual y anterior |
| `bids`, `other_bids` | | Pujas de la operación |

**`price` es un entero.** No hay que parsear texto ni hay riesgo de coma
flotante en el camino crítico.

## `gameweek_end` — el cierre de jornada

`data` contiene `id_gameweek`, `gameweek` y `ranking`. La lista de equipos está
anidada tres niveles: **`data.ranking.ranking.positions`**, un array con una
entrada por equipo:

| Campo | Tipo | Significado |
|---|---|---|
| `idUc` | entero | Identidad estable del equipo |
| `user.name` | texto | Nombre del equipo |
| `points` | entero | Puntos de la jornada (puede ser negativo) |
| `payment` | entero **o `null`** | Premio; `null` cuando el equipo no cobra |
| `teamValue` | entero | Valor de plantilla en esa jornada |
| `negative` | booleano | Saldo negativo, no puntuó |

**Aviso de privacidad:** cada posición incluye un objeto `user` con el correo
electrónico y los identificadores de Apple/Google/Facebook de cada rival. Los
fixtures del repositorio los llevan redactados; cualquier volcado nuevo debe
sanearse antes de comitearlo.

## Discrepancia pendiente de resolver

Hay **4 eventos `gameweek_end`** pero la liga va por la jornada 6. Cabría
esperar 5 jornadas cerradas. Puede deberse a que una jornada aún no haya
cerrado, a que la primera no reparta premio, o a un hueco real en el feed.

**No se da por buena ninguna cifra hasta aclararlo.** La comprobación de la
Fase 2 —saldo propio reconstruido igual a `balance.current` al céntimo— lo
detectará: si falta una jornada, el saldo no cuadrará.

## Autenticación

Dos piezas, ambas necesarias:

1. **Cookie de sesión**, `HttpOnly`, del dominio `mister.mundodeportivo.com`.
   No accesible desde el JavaScript de la página; se copia del navegador.
2. **Token `X-Auth`**, en `window._FG_cfg.auth`. Sí accesible desde la página.

La cuenta usa login con Apple, así que no hay autenticación programática
posible: ambas piezas salen de un navegador ya autenticado.

## Otros datos por página

Cada página HTML incluye `var _FG_user = {...}` con `balance.current`,
`balance.future` y `balance.maxDebt`, además de las reglas de la liga. Se
extrae con una expresión regular sobre el HTML.

**Fórmula verificada:** `maxDebt = balance.current + 0,25 × valor de plantilla`.

## Serie histórica de valores de un jugador

`GET /players/{id}/{slug}` incluye en el HTML la serie completa de valor diario
como objetos JSON:

```
{"value":"6792000","date":"3 ago 2026"}
```

Se extrae con `/\{"value":"(\d+)","date":"([^"]+)"\}/g`. **No hace falta
navegador ni ejecutar Chart.js**: basta pedir la página con la cookie.

Verificado contra el gráfico de la interfaz: coinciden al euro.

Detalles a tener en cuenta:

- La serie llega a **68 puntos** cuando el gráfico dibuja 66: **hay entradas
  repetidas**. Hay que deduplicar por fecha y ordenar cronológicamente, no
  fiarse del orden de aparición.
- Las fechas vienen en castellano abreviado (`3 ago 2026`), no en ISO.
- **Los valores están redondeados a millares.** Es el origen del desvío de 800 €
  al cuadrar el saldo propio. Para exactitud al euro haría falta otra fuente.
