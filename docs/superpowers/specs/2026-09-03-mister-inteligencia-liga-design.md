# Mister — Inteligencia de liga Fantasy

**Fecha:** 2026-09-03
**Estado:** diseño aprobado; Fase 1 en ejecución. Actualizado el 2026-09-03 con
los hechos verificados de `docs/api-mister.md`.

## Propósito

Reconstruir la contabilidad completa de una liga Fantasy de Mister desde su
primer día, para responder en cualquier momento a tres preguntas:

1. Cuánto dinero tiene cada rival y cuánto puede pujar como máximo.
2. Cómo va uno mismo: balance, plusvalías, puntos, posición relativa.
3. Qué ha pasado en la liga: todos los fichajes, ventas, cláusulas y premios
   desde la jornada 1.

Mister responde la primera pregunta solo para uno mismo, y la tercera únicamente
como un muro que hay que recorrer a mano. Este proyecto convierte ambas en datos
consultables.

## Alcance

Primera versión **de uso personal**, para la liga del autor. No se distribuye,
no hay instaladores ni gestión de múltiples usuarios. El diseño deja aislada la
única pieza que impediría distribuirlo más adelante (la obtención de la sesión),
pero no se construye esa capacidad ahora.

## Hechos verificados

Todo lo que sigue se comprobó el 2026-09-03 contra una sesión real. No son
suposiciones.

### Autenticación

Hacen falta **dos** credenciales, y ambas salen de un navegador ya autenticado
—la cuenta usa login con Apple, así que no hay autenticación programática
posible:

1. La **cookie de sesión**, `HttpOnly`, del dominio `mister.mundodeportivo.com`.
2. El **token `X-Auth`**, que la web guarda en `window._FG_cfg.auth`.

No hay token en `localStorage` (solo el perfil del usuario) ni cabecera
`Authorization`.

La sesión observada estaba viva desde agosto de 2023, lo que indica una cookie
de larga duración. Se asume que capturarla una vez basta durante meses.

### Datos en cada página

Toda página HTML incluye `var _FG_user = {...}` y `var _FG_cfg = {...}` como
JSON literal, extraíbles con una expresión regular. **No hay que raspar el DOM.**

`_FG_user` contiene, entre otros campos:

| Campo | Contenido |
|---|---|
| `id`, `id_uc`, `id_community` | Identificadores de usuario, usuario-en-liga y liga |
| `balance.current` / `balance.future` | Saldo actual y comprometido |
| `balance.maxDebt` | **Tope máximo de puja** |
| `team_limit`, `mode`, `salaries`, `market_speed`, `loans_floor` | Reglas de la liga |
| `custom_rules` | Reglas escritas por el administrador |

`_FG_cfg` aporta el contexto de la aplicación, incluidos `id_competition`,
`season`, `market_date` y un campo `auth` usado por las llamadas internas.

`_FG_data` viene vacío en las vistas examinadas y no se usa.

### La fórmula del tope de puja

Con datos reales de la liga:

```
saldo                    9.209.955
valor de la plantilla   77.386.000
maxDebt informado       28.556.455

77.386.000 × 0,25    =  19.346.500
 9.209.955 + 19.346.500 = 28.556.455   ← coincide exactamente
```

Es decir:

```
tope de puja = saldo + 0,25 × valor de la plantilla
```

Esto es lo que hace viable el objetivo principal. El **valor de plantilla de
cada rival es público** en la clasificación, de modo que en cuanto se conoce el
saldo de un rival se obtiene su tope exacto, no una aproximación.

El coeficiente 0,25 se ha verificado con una sola observación. La implementación
debe tratarlo como parámetro configurable y comprobarlo contra el propio
`maxDebt` en cada recolección: si algún día deja de cuadrar, es que la regla
cambió y hay que avisar en vez de calcular mal en silencio.

### El histórico: `POST /ajax/feed`

El "Inicio" de la liga es un muro paginado que **retrocede hasta el origen de la
liga**. Se alimenta de `POST /ajax/feed`, con la cabecera `X-Auth` y un cuerpo
con `offset` acumulado y `cardsPerPage`. Responde JSON: `data` es el array de
eventos y el histórico se agota cuando llega vacío.

**Recorrido completo verificado:** 285 eventos en 16 lotes, desde el 2026-08-03.
De las 12 categorías del feed, solo dos son contables:

| `category` | Nº | Uso |
|---|---|---|
| `transfer` | 183 | **Esencial** — transacción de la liga |
| `gameweek_end` | 4 | **Esencial** — cierre de jornada con premios |
| las otras diez | 98 | Ruido catalogado, se descarta a conciencia |

La petición exacta y el catálogo íntegro están en `docs/api-mister.md`.

Formas de `transfer` observadas, **todas con importe entero explícito**. Un
`transfer` sin `price` es una anomalía y debe detener el proceso, no asumirse
como cero:

- `«Jugador» cambia de «Manager» a «Mister»` — venta al mercado.
- `«Jugador» cambia de «Mister» a «Manager»` — compra en el mercado.
- `«Jugador» cambia de «Manager A» a «Manager B» por pago de cláusula`.
- `«Jugador» abandona la competición` — NO es una transacción: es el
  renderizado de un `player_transfer` (jugador que deja LaLiga). Es ruido y no
  afecta a la contabilidad. Ver `docs/api-mister.md`.

El evento de cierre de jornada lista, para cada equipo, **el dinero ganado y los
puntos** (por ejemplo `+725.000 · 29 PTS`), incluido el caso
`Saldo negativo, no puntuó`.

Con esas dos familias de evento la contabilidad queda cerrada:

```
saldo(equipo) = presupuesto inicial
              + Σ premios de jornada
              + Σ ventas
              − Σ compras y pagos de cláusula
              + Σ cobros de cláusula recibidos
```

### Rutas útiles

| Ruta | Aporta |
|---|---|
| `/standings` | Clasificación: jugadores, valor de plantilla y puntos por equipo |
| `/users/{id}/{slug}` | Puntos por jornada y plantilla de un rival |
| `/market` | Mercado actual |
| `/players/{id}/{slug}` | Ficha de jugador |
| `/team` | Plantilla propia |
| `POST /ajax/feed` | Histórico paginado |

### Callejones sin salida, ya descartados

- `/api2/*` existe pero devuelve 500 con la cookie del navegador: espera
  cabeceras de la aplicación móvil. No se investiga más por ahora.
- `/activity`, `/history`, `/movements`, `/transfers`, `/community`, `/news`
  devuelven 404. No hay página de histórico distinta del feed.
- Un `ajax/balance` visible en el tráfico **no es de Mister**: proviene de otra
  extensión instalada en el navegador del autor.

### La incógnita del 401, resuelta

`POST /ajax/feed` devolvía 401 por dos errores de diagnóstico: el token va en la
cabecera **`X-Auth`**, no en el cuerpo, y la paginación es por **`offset`**
acumulado, no por un campo `page` que no existe. Con eso, responde 200.

Aun resuelto, la recolección conserva **dos vías con una condición de aceptación
común**, porque el requisito es fidelidad absoluta y no conviene depender de una
sola:

- **Vía A — cliente HTTP directo.** Replica la petición de la aplicación
  cabecera por cabecera. Es la principal: rápida, programable y sin
  dependencias externas.
- **Vía B — recolección conducida en el navegador.** El recorrido se ejecuta
  **dentro de la propia página** y vuelca el JSON íntegro a disco. Es el
  respaldo si las credenciales caducan, y es con la que se capturó el histórico
  de referencia.

Ambas producen exactamente el mismo artefacto: las respuestas crudas del feed,
página a página, sin alterar. **El resto del sistema no sabe cuál se usó**, así
que la elección es reversible y no contamina el diseño.

La condición de aceptación no cambia con la vía elegida: el histórico está
completo cuando el feed se agota y los lotes encajan sin hueco ni solape —cada
`offset` es el anterior más su número de eventos—, y las tres comprobaciones de
la sección de exactitud cuadran al céntimo.

## Arquitectura

Cuatro piezas con una responsabilidad cada una, comunicadas por interfaces
estrechas. Cada una se entiende y se prueba por separado.

```
  Sesión  ─────►  Recolector  ─────►  Almacén  ─────►  Motor  ─────►  Panel
(credenciales)   (HTTP + parseo)     (SQLite)        (cálculo)       (web)
```

### 1. Sesión

Única responsabilidad: entregar una cookie válida. Interfaz de una sola
operación, `obtenerCookie()`, con una implementación en la v1 que la lee de un
fichero local fuera del repositorio. Si algún día se hace una extensión de
Chrome, se añade una segunda implementación y **nada más cambia**.

Valida al arrancar que la sesión sigue viva y falla con un mensaje claro —
"cookie caducada, vuelve a capturarla" — en lugar de producir datos vacíos.

### 2. Recolector

Pide páginas y las convierte en eventos. Dos capas separadas a propósito:

- **Cliente HTTP**: hace las peticiones y guarda la respuesta cruda. Espacia
  las peticiones (mínimo un segundo entre ellas) y reintenta con retroceso
  exponencial. No interpreta nada.
- **Parseadores**: funciones puras `texto → objetos`. Uno extrae `_FG_user`,
  otro convierte una página de feed en eventos tipados, otro lee la
  clasificación. Al no tener red dentro, se prueban con respuestas guardadas.

El recolector tiene dos modos:

- **Recolección inicial**: recorre `/ajax/feed` desde `offset=0` hacia atrás
  hasta agotar el histórico. Se ejecuta una vez.
- **Recolección incremental**: recorre solo hasta encontrar el último evento ya
  conocido. Se ejecuta a diario.

### 3. Almacén

SQLite, en dos capas:

- **Crudo**: cada respuesta HTTP tal cual llegó, con su fecha y su ruta. Nunca
  se borra. Si mañana se descubre un dato que hoy se ignora, se reprocesa el
  pasado sin volver a pedir nada al servidor. Esto es lo que hace que un error
  de interpretación no cueste datos.
- **Derivado**: tablas normalizadas de equipos, jugadores, transacciones,
  jornadas e instantáneas de saldo. Se regeneran por completo desde el crudo.

Que el derivado sea reconstruible es una propiedad deliberada, no un detalle:
permite corregir el motor y recalcular toda la historia.

### 4. Motor contable

Función pura: recibe la lista de eventos y las reglas de la liga, devuelve el
estado financiero de cada equipo. Sin red, sin base de datos, sin reloj.

Produce por equipo: saldo, tope de puja, valor de plantilla, dinero
ganado acumulado, gasto en fichajes, ingresos por ventas y plusvalía.

**No estima: calcula.** El requisito es cifra exacta, sin margen de error. El
motor no devuelve intervalos ni grados de confianza: devuelve el número, o
falla. Cómo se consigue y cómo se demuestra está en la sección siguiente.

## Exactitud: requisito y demostración

**Requisito.** Todos los movimientos de todos los equipos, uno a uno, desde el
primer día hasta el momento de la consulta, sin excepciones. La cifra de hoy
debe ser exacta, no aproximada.

No es una aspiración: es comprobable, porque el sistema tiene tres ecuaciones de
control que sobran respecto a las incógnitas. Si el recorrido estuviera
incompleto, no cuadrarían.

### El presupuesto inicial se deduce, no se supone

Es la única incógnita del sistema, y se despeja con el saldo propio, que Mister
informa:

```
presupuesto inicial = balance.current − (Σ premios + Σ ventas − Σ compras)
```

Todos los equipos de una liga parten del mismo presupuesto, así que el valor
despejado con los datos propios debe reproducir también los saldos de los siete
rivales. Ocho comprobaciones donde bastaría una.

### Las tres comprobaciones

1. **Saldo propio.** El saldo reconstruido desde cero debe coincidir **al
   céntimo** con `balance.current`. Es la prueba maestra: si el recorrido del
   feed tuviera un solo hueco, este número se desviaría.
2. **Tope de puja propio.** `saldo + 0,25 × valor de plantilla` debe dar
   exactamente el `maxDebt` informado. Verifica la fórmula además del saldo.
3. **Valor de plantilla de cada rival.** El valor calculado sumando sus altas y
   bajas debe coincidir con el que publica la clasificación. Extiende la
   verificación a los siete rivales, no solo a uno mismo.

Las tres se ejecutan en cada recolección. **Mientras las tres cuadren, las
cifras de los rivales son exactas por construcción**, porque salen del mismo
motor y los mismos eventos que reproducen los datos conocidos.

### Completitud del recorrido

- La recolección inicial avanza por el feed hasta **agotarlo de verdad**,
  identificando el primer evento de la liga. No se detiene por número de
  páginas ni por fecha.
- Se registran páginas recorridas y eventos por página. Un hueco en la
  numeración **aborta el proceso**; no se continúa con datos incompletos.
- Un fallo de red en una página se reintenta. Si tras los reintentos sigue
  fallando, el proceso para y lo dice.

### Ningún evento se descarta en silencio

Solo se ignoran los tipos catalogados explícitamente como ruido —hoy,
`player_transfer`, que son fichajes de LaLiga real y no afectan a la
contabilidad—. Cualquier tipo no catalogado **detiene el proceso y se
reporta**, con su contenido crudo guardado para inspección.

Esta es la diferencia entre un sistema exacto y uno que parece exacto: un evento
raro descartado en silencio produciría un número plausible y equivocado. Aquí
produce una parada.

### Si algo no cuadra

El panel no muestra una cifra aproximada ni un margen. Muestra que la
verificación ha fallado, en qué equipo y por cuánto, y las cifras afectadas
quedan marcadas como no fiables hasta corregir el motor o completar la
recolección. El descuadre es un fallo a arreglar, no un dato a presentar.

### 5. Panel web local

Servidor local que sirve una página con:

- **Tabla de rivales**: saldo, tope de puja, valor de plantilla, puntos
  y posición, ordenable.
- **Ficha de rival**: su histórico de movimientos y su evolución de saldo.
- **Balance propio**: plusvalías por jugador, ingresos y gastos.
- **Histórico de la liga**: todos los eventos, filtrables por equipo, jugador,
  tipo y jornada.

Sin autenticación: escucha solo en la interfaz local.

## Fases

El orden importa: cada fase deja algo utilizable y valida la siguiente.

**Fase 1 — Histórico.** Resolver el 401, recorrer el feed entero, guardar el
crudo y extraer los eventos. Entregable: base de datos con toda la historia de
la liga y un volcado legible. Valida lo más incierto del proyecto antes de
construir nada encima.

**Fase 2 — Balance propio.** Motor contable calibrado contra el saldo real
propio. Entregable: cifras propias correctas y comprobables.

**Fase 3 — Rivales y panel.** Aplicar el motor a los rivales, calcular topes de
puja y construir la interfaz.

## Pruebas

- **Parseadores**: respuestas reales guardadas como ficheros de prueba. Cuando
  Mister cambie su formato, fallarán con precisión en vez de producir datos
  silenciosamente incorrectos.
- **Motor**: casos de tabla con ligas inventadas pequeñas, donde el resultado se
  calcula a mano. Al ser una función pura no necesita andamiaje.
- **Prueba de integración clave**: el saldo propio calculado desde cero debe
  coincidir al céntimo con el `balance.current` informado. Es la comprobación
  que demuestra que toda la cadena funciona.
- **Recolector**: contra un servidor de prueba, sin tocar Mister.

## Errores y límites

- **Cookie caducada** → mensaje claro y parada. Nunca datos parciales mudos.
- **Formato cambiado** → el parseador falla ruidosamente y se conserva el crudo.
- **Evento desconocido** → detiene el proceso y se reporta, con su contenido
  crudo guardado. Nunca se descarta en silencio: eso produciría una cifra
  plausible y equivocada.
- **Ritmo de peticiones** → mínimo un segundo entre peticiones, y la recolección
  incremental se detiene en cuanto reconoce lo ya visto. La recolección inicial
  es un evento único.

Estos datos son de una liga privada del propio autor y de uso personal.

## Decisiones técnicas

**TypeScript sobre Node.** El proyecto es sobre todo peticiones HTTP, parseo de
texto y una interfaz web; Node los cubre con la biblioteca estándar, y compartir
lenguaje entre recolector y panel evita duplicar los tipos de los eventos.
SQLite mediante `better-sqlite3`, síncrono, que encaja con un proceso por lotes.

**Sin dependencias de scraping.** Los datos salen de JSON embebido y de
respuestas JSON. Introducir un analizador de HTML invitaría a depender de la
maquetación, que es justo lo frágil.

## Fuera de alcance

Pujar o realizar cualquier operación en Mister; la aplicación es de solo
lectura. Tampoco: distribución a terceros, aplicación móvil, notificaciones,
predicción de puntos ni recomendaciones de alineación.

---

## Requisito añadido: refresco bajo demanda (2026-09-03)

> "Es importante que yo en tiempo real pueda ver en todo momento cuánto dinero
> tiene cada uno, y si alguien vende o ficha y vuelvo a refrescar, que me vuelva
> a calcular todo."

**Qué significa en la práctica.** No hace falta un proceso permanente ni avisos
automáticos: basta con que **refrescar recalcule todo desde cero** con los datos
del momento. El coste de un refresco completo es asumible —el histórico entero
son 16 lotes, unos 16 segundos con el ritmo de una petición por segundo— así que
no hace falta recolección incremental para cumplirlo.

**Qué implica para el diseño:**

- La orden de análisis debe poder **recolectar y recalcular en una sola
  ejecución**, no solo leer lo ya guardado.
- Las **plantillas actuales** y el **valor de mercado de hoy** cambian a diario,
  así que su caché no puede ser permanente como la de los valores históricos: un
  valor de una fecha pasada nunca cambia, pero el de hoy sí. Hay que distinguir
  ambas cosas o el refresco devolverá cifras viejas.
- El **panel de la Fase 3** se sirve de esa orden: al recargar la página,
  recolecta, recalcula y pinta.

Es un requisito de la Fase 3, pero condiciona la Fase 2: la caché de páginas
auxiliares debe poder invalidarse.

---

## Alcance de la Fase 3, ampliado por el usuario (2026-09-03)

Deja de ser "un panel" para ser **un módulo de apoyo al juego**, con varias
piezas. Lo pedido, en sus palabras:

### 1. Buscador de equipo

Filtrar por nombre y ver **todo** de ese equipo: los fichajes que ha hecho, lo
que ha ganado o perdido con cada jugador, el total, su saldo de hoy y su tope de
puja.

### 2. Módulo de viabilidad de un fichaje

Escribir el nombre de un futbolista y obtener su valor de mercado ahora mismo y,
sobre todo, **qué equipos podrían ficharlo hoy**. En sus palabras: *"pongo
Mbappé y tú me dices: Mbappé vale 24 millones; hoy solo podrían ficharlo estos
equipos"*.

Lo que hace esto calculable es la fórmula ya verificada:
`tope de puja = saldo + 0,25 × valor de plantilla`. Un equipo puede ficharlo si
su tope supera el precio, sea la cláusula o lo que costaría en el mercado.

### 3. Búsqueda y estadísticas de jugadores

Buscar cualquier jugador y ver sus datos y su evolución. La serie diaria de valor
ya es accesible desde su ficha, así que el dato está.

### 4. Ranking de equipos

Por puntos y por capacidad de compra.

### 5. Recolección incremental — el requisito técnico que condiciona todo

> "Que la próxima vez que vuelva a mirar, solo mire el histórico desde el último
> día que se actualizó hasta hoy, para no tener que buscar siempre el histórico.
> Tienes que mirar siempre desde qué día y hora exactamente para luego seguir
> desde el mismo punto."

**Cómo se hace, y por qué es viable.** El feed se sirve de lo más reciente a lo
más antiguo, así que un recorrido incremental **avanza hasta reconocer el primer
evento ya conocido y para ahí**. Guardando el `id_transfer` y el `id` de evento
más recientes de cada recolección, la siguiente solo pide los lotes necesarios:
con un puñado de movimientos nuevos al día, eso es **un lote en vez de dieciséis**.

**Lo que hay que cuidar, y no es menor:**

- El feed **repite eventos entre lotes contiguos** porque crece por arriba. Un
  recorrido incremental que pare "al ver algo conocido" puede pararse demasiado
  pronto si topa con una repetición. Hay que parar por **identificador de evento
  ya almacenado**, no por posición.
- Los **valores de mercado y las plantillas cambian a diario** aunque no haya
  movimientos: el histórico incremental ahorra pedir el feed, pero esos datos hay
  que refrescarlos igual.
- La contabilidad se **recalcula entera** desde el crudo acumulado. Lo
  incremental es la recolección, no el cálculo: recalcular es barato y así un
  error de interpretación se corrige reprocesando, sin volver a pedir nada.

### Sobre el rendimiento

El usuario pide que "sea muy rentable y que funcione muy bien". Las cifras de
hoy: el histórico completo son 16 peticiones, y las fichas de jugador ~130 —
pero estas últimas solo cambian de valor, y su serie histórica no cambia nunca
hacia atrás. Con la recolección incremental y la caché con caducidad, un refresco
típico debería quedarse en unas pocas peticiones.
