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

`data` es un **array** de eventos. No hay campo `has_more`: **el histórico se
agota cuando `data` llega vacío**. La paginación avanza sumando
`offset += data.length`, no de uno en uno.

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

Los campos que importan para la contabilidad:

| Campo | Tipo | Significado |
|---|---|---|
| `id_transfer` | número | Identificador único de la operación |
| `id_uc_from` | número | Vendedor. **`0` significa el mercado (Mister)** |
| `id_uc_to` | número | Comprador. `0` significa el mercado |
| `price` | **número entero** | Importe. Ya viene como entero, no como texto |
| `type` | texto | `"normal"`; otros valores por confirmar (cláusula) |
| `from` / `to` | texto | Nombres mostrados, p. ej. `"Mister"`, `"Niutin FC (Isaac)"` |
| `id_user1` / `id_user2` | número | Usuarios implicados |
| `name` | texto | Nombre del jugador |
| `value` / `prev_value` | número | Valor de mercado actual y anterior |
| `bids`, `other_bids` | | Pujas de la operación |

**`price` es un entero.** No hay que parsear texto ni hay riesgo de coma
flotante en el camino crítico.

## `gameweek_end` — el cierre de jornada

`data` contiene `id_gameweek`, `gameweek` y `ranking`. El ranking lleva, por
equipo, los puntos y el premio en metálico.

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
