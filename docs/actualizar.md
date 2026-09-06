# El botón de actualizar

```bash
npm run app
```

Abre la app en `http://127.0.0.1:4788/` con un botón **Actualizar** arriba.
El botón baja lo nuevo de Mister, rehace todas las cuentas, las comprueba y
vuelve a generar la página.

Abrir el HTML con doble clic sigue funcionando —filtros y pestañas no usan
JavaScript— pero ahí el botón no aparece: en su sitio se lee cómo arrancar el
servidor. Un navegador no puede pedirle nada a Mister por su cuenta, así que
quien va a buscar los datos es el proceso de Node.

## La sesión: la pide la propia app

Al arrancar, el servidor comprueba si la sesión guardada sigue valiendo. Si no
hay ninguna, o ya no vale, lo primero que se abre **no es el módulo sino la
pantalla para pegarla**. No hay que salir al Terminal.

Mister exige dos cosas en cada petición: la cookie de sesión y el token
`X-Auth`. La cuenta entra con Apple y la cookie es **HttpOnly**, así que ni el
JavaScript de la propia página la ve. No hay forma de sacarlas por código: las
tiene que traer una persona.

Ahora bien, las dos viajan juntas en la cabecera de cualquier petición del
navegador, y Chrome sabe copiar una petición entera como comando cURL. Así que
son un clic derecho y un pegado, no dos búsquedas por separado:

1. En Chrome, con Mister abierto y la sesión iniciada, abre `⌥⌘I` → pestaña
   **Network**.
2. Recarga con `⌘R`, clic derecho sobre cualquier petición →
   **Copy** → **Copy as cURL**.
3. Pégalo en el recuadro y dale a **Conectar**.

De ahí se sacan solo esas dos cabeceras. **Se prueban contra Mister antes de
guardar nada** —unas credenciales caducadas guardadas solo cambian el error de
sitio, y encima pisarían unas que quizá sí valían— y se escriben en `.sesion/`
con permisos 0600. No se imprimen nunca, ni en los errores, y `.sesion/` está
en `.gitignore`.

Desde el enlace *«o mira los datos de la última actualización»* se entra igual
al módulo sin conectar: tener los datos viejos es mejor que no poder mirarlos.

Cuando la sesión caduque, el botón Actualizar lo dirá y ofrecerá un botón que
lleva a esa misma pantalla. Y quien prefiera el Terminal tiene
`npm run credenciales`, que hace exactamente lo mismo.

## Qué hace una pasada

### 1. Baja solo lo nuevo

El feed se pagina de lo más reciente a lo más antiguo, así que para ponerse al
día basta con bajar desde arriba hasta pisar terreno conocido. Se para cuando
**dos páginas seguidas** caen enteras por debajo del último evento que ya se
tenía; la página de más es a propósito, porque el feed agrupa y reordena y
cortar en el primer solape podría dejar fuera algo publicado con retraso.

El crudo se guarda entero, sin tirar lo viejo. Deduplicar es tarea de
`extraerHechos`, y ahí **manda la captura más reciente**: los hechos de un
traspaso no cambian, pero el valor del jugador que viaja con él sí —el feed lo
reescribe con el de hoy cada vez que se pide—, así que quedarse con la primera
aparición congelaría los valores para siempre.

### 2. Pide el censo de jugadores

`POST /ajax/sw/players` es la lista que alimenta la pestaña Buscar de Mister:
**todos los jugadores de la competición**, de cincuenta en cincuenta, con sus
puntos, su media, su racha, su valor de hoy, su cláusula, su lesión y quién los
tiene. Son once peticiones y unos segundos.

Tiene que pedirse por **POST** aunque la web lo pida por GET: por GET el
servidor ignora el `offset` y devuelve siempre los mismos cincuenta, así que
paginar en silencio daba cuarenta veces la primera página. Y hace falta la
cabecera `X-Requested-With: XMLHttpRequest` o responde 403.

Esto sustituye a lo que antes se deducía del feed. **El feed no vale para
estadísticas**: solo publica una foto del jugador en el instante de un evento
—un traspaso, o los tres que entran al mercado en cada rotación— y no la
refresca nunca. El día que se contrastó, de 523 jugadores de LaLiga el feed
conocía 238, los partidos jugados estaban mal en 127 de 223, y de 73 cláusulas
guardadas 63 no coincidían con las de Mister. Los doce mejores de la
competición estaban libres y ninguno aparecía.

El mercado del día sale de la página `/market`, que sí los trae todos. El
evento `market_unified` del feed **no es el mercado**: son solo los que entran
en esa rotación, y tomarlo por el mercado dejaba la etiqueta «en venta» en tres
jugadores cuando había treinta y tres.

### 3. Rehace las cuentas

**El saldo propio no se calcula: se lee.** `POST /ajax/sw/balance` es el libro
de caja de Mister —1255 apuntes, cada euro con su motivo y el balance que
dejó—. Estas son **todas** las formas en que mueve dinero, contadas una a una:

| Tipo · motivo | n | Lo publica el feed |
|---|---|---|
| Compra / Venta | 808 | Sí (`normal`) |
| Modificación de cláusula (Penalización) | 173 | **No** |
| Jornada N (Bonificación) | 115 | Sí (`gameweek_end`) |
| Modificación de cláusula (Bonificación) | 67 | **No** |
| Compra / Venta por cláusula | 69 | Sí (`clause`) |
| Venta por rescisión | 8 | Sí (`rescind`) |
| Venta / Compra por cesión | 7 | **No** |
| Ajuste por reinicio de liga o temporada | 5 | **No** |
| Venta por trueque | 1 | **No** (y no mueve dinero: 0 €) |
| Saldo inicial | 1 | **No** |

El feed solo publica tres tipos de traspaso —`normal`, `clause` y `rescind`—,
así que las **cesiones** y los **trueques** son invisibles en él. Esta temporada
todavía no ha habido ninguna; cuando la haya, la app la detecta igual, porque el
jugador cambia de dueño en el censo sin que aparezca un traspaso, y lo dice en
las novedades. El importe, ese no hay forma de saberlo.

Los ajustes por reinicio y el saldo inicial son de una vez y están dentro de las
constantes de `liga.json`.

Reconstruir el saldo sumando el feed obligaba a llevar una constante fabricada
a mano por equipo para que cuadrase, y volvía a descuadrar en cuanto alguien
tocaba una cláusula: una noche de septiembre la app se quedó sin poder
actualizarse por 416.619 € que eran dos subidas de cláusula de la misma tarde.

Los saldos de los rivales sí hay que seguir reconstruyéndolos —Mister los oculta
(`show_balances: 0`)—, y lo que les falta es justamente el dinero de las
cláusulas. **No es un techo**: subir una cláusula resta, pero bajarla suma, así
que el error puede caer a los dos lados. La ficha de cada equipo dice de cuánto
es ese margen.

### Deducir lo que un rival paga por blindar

Aunque su libro de caja no se pueda leer, sus cláusulas sí. Dos cosas
comprobadas contra el libro propio:

- La cláusula base es **1,5 × el valor** (con un suelo de **1.000.000 €**), y se
  recalcula sola cada día. 61 jugadores con dueño están clavados en ese ×1,50, y
  21 en el suelo del millón.
- Mister ofrece moverla al 50 % (la base), 100 %, 150 %, 200 %, 250 % y 300 %, y
  el multiplicador resultante es `1 + porcentaje/100`: ×1,5, ×2, ×2,5, ×3, ×3,5,
  ×4. **Cada escalón de medio punto vale el 20 % del valor**, y es simétrico:
  subirlo cuesta y **bajarlo devuelve**. Siete de siete penalizaciones propias
  con valor conocido dan 20,00 % exacto; Juan Foyth —que pagó tres veces— está
  hoy en ×3,000; y de las 67 bonificaciones del libro, Lamine Yamal bajó cinco
  escalones y le devolvieron 13.855.490 €, su valor entero.

Con eso:

- **Cuántas subidas tiene vivas cada equipo** se sabe hoy, mirando el
  multiplicador. Exacto.
- **Lo que le costaron** solo se puede estimar, valorándolas al precio de hoy en
  vez de al de aquel día: en el equipo propio esa cuenta da 6.018.400 € contra
  los 5.263.619 € reales del libro. Se enseña como estimación, y la propia se
  enseña exacta.
- **De aquí en adelante es exacto**: cada pasada guarda las cláusulas de los 522
  en `historico-clausulas.json`, y una que suba por encima de su base y de donde
  estaba ayer es una modificación pagada ese día, al valor de ese día. Se
  acumulan en `subidas-clausula.json` y se le restan al rival.

Lo que no se hace es deducir hacia atrás cuándo se subió cada una: haría falta
adivinar la fecha, y este módulo no adivina.

El resto del dinero sigue saliendo del feed. Lo único que
se da por dado son las constantes del reinicio de liga, en
`modulo/datos/liga.json`: qué jugadores recibió cada equipo y cuánto valía ese
reparto. Por definición no vuelven a cambiar.

```
saldo     = (50.000.000 − valor del reparto) + premios + ventas − compras
plantilla = la que publica la página de cada equipo
tope      = saldo + 25 % del valor de la plantilla
```

Los **valores** y las **plantillas** vienen del censo. Del feed no pueden
salir: hay altas que Mister no publica como traspaso. Y de la página de cada
equipo tampoco, aunque durante un tiempo fue así: **va retrasada**. Al vender a
Fer Niño, el censo y la clasificación decían 18 jugadores y 75.323.000 €, y su
página de equipo seguía enseñando 19 y 77.674.000 €.

La página sigue haciendo falta para una cosa: los que **se han ido de LaLiga**
desaparecen del censo pero siguen en la plantilla, y Mister los cuenta. Su valor
residual solo lo tiene su ficha. Se avisa por su nombre en vez de dejarlos
fuera.

### 3 bis. La pasada larga: las fichas

Lo que sube o baja un jugador **en un mes** no lo publica Mister en ningún
sitio: solo está en la gráfica de su ficha, y las fichas se piden de una en una.
Por eso el módulo tenía esa cifra para unos pocos y en el resto callaba.

Pero una ficha no trae un punto: trae la **serie diaria entera**, más de un año.
Y de paso trae cosas que no están en ningún otro sitio:

- los **goles** y las **tarjetas**;
- la **media en casa** y la **media fuera**, que suelen no parecerse en nada
  —Oyarzabal hace 6,0 en casa y 3,5 fuera, Mbappé 15,0 y 3,0—;
- cuántas veces ha salido **de inicio** y cuántas del banquillo;
- si Mister lo da por **titular en el próximo partido**, que es su propia
  predicción.

```bash
npm run fichas
```

Son 523 peticiones, unos nueve minutos, y va **aparte de la actualización
normal**: el botón de Actualizar no puede quedarse esperando eso. Deja
`modulo/datos/historico-valores.json` (cuarenta días de valores) y
`modulo/datos/fichas.json`, y la pasada normal los lee de disco.

El slug del enlace, por cierto, es decorativo: `/players/{id}/x` devuelve la
ficha igual. Lo que no vale es el id a secas, que redirige a las noticias.

Con eso, la pasada normal no pide ninguna ficha y tarda unos 25 s.

### 4. Comprueba antes de escribir

Cada página de Mister lleva incrustado `var _FG_user` con el **saldo y el tope
de puja reales**. El motor los calcula por su cuenta desde el histórico, así que
compararlos es una comprobación de verdad: si el cálculo se tuerce —un traspaso
mal leído, un premio contado dos veces—, dejan de coincidir.

**Si no cuadran, la pasada no escribe nada** y el botón explica por qué. Es
preferible seguir viendo las cifras de ayer, sabiendo que son de ayer, que unas
de hoy que están mal sin que nadie lo diga.

El margen es de 5.000 €, para cubrir el redondeo a millares de 800 € sin tapar
un error de verdad, que sería de otro orden.

**Y desde ahora también los siete rivales.** `_FG_user` solo habla de uno mismo,
así que los demás equipos no se comprobaban contra nada. Pero `/standings` se
renderiza en el servidor y publica, por equipo, **cuántos jugadores tiene y
cuánto vale su plantilla**: dos cifras que el módulo calcula por su cuenta.

No es teórico. Nada más ponerlo, saltó: a Los tocahuevos les faltaba **Matteo
Ruggeri** —13 jugadores y 32.359.000 € frente a los 14 y 33.658.000 € de
Mister—. El feed había publicado su salida de LaLiga y el módulo lo borraba de
la plantilla, mientras Mister lo seguía contando con su valor residual. De paso
quedó contestada la duda de los otros cinco: **Mister los cuenta**, porque el
número de jugadores y el valor de plantilla solo cuadran contándolos.

**Los puntos no se comprueban: se copian.** Antes se calculaban sumando los
cierres de jornada del feed, y eso no podía sostenerse. Mister los **revisa**
cuando llegan las estadísticas oficiales: en una misma tarde bajó a Betico de 17
a 9 y subió a Niutin de 119 a 134. Contrastar una suma propia contra una cifra
que se revisa significaba bloquear la actualización cada vez, y encima
perdiendo, porque la buena es la suya. Ahora los puntos y el puesto salen de la
clasificación —el desempate entre dos equipos igualados también es cosa de
Mister— y, cuando la suma del feed no coincide, se dice como aviso en vez de
tumbar la pasada.

### 5. Regenera la página

Con el veredicto en la mano se escriben los datos y se lanza `modulo/generar.cjs`.
El navegador recarga y aparece un aviso con lo que ha cambiado.

## Lo que guarda en disco

Además de lo que enseña la página, cada pasada deja tres cosas que solo sirven
para comparar con mañana:

| Fichero | Para qué |
|---|---|
| `historico-valores.json` | 40 días de valores. De ahí sale el «% este mes» |
| `historico-clausulas.json` | 40 días de cláusulas. De ahí salen las subidas de los rivales |
| `foto.json` | La última foto de valor, cláusula, dueño, estado y mercado de los 522 |
| `novedades.json` | Los cambios ya interpretados de la última semana |
| `subidas-clausula.json` | Las subidas detectadas, con lo que costaron |

## Lo que queda pendiente

- **El «% este mes» le falta a 71 de los 523**, los que llevan menos de un mes
  en LaLiga. No es un hueco: es que no existe esa cifra todavía. Enseñan la
  subida del día, que sí es exacta.
- El `teamValue` de los cierres de jornada sigue sin usarse para nada, porque
  **no es el valor de la plantilla sino el del once**: 54.979.000 € frente a los
  80.305.000 € que sí cuadran con `maxDebt`. Anotado para no volver a caer.

## Verla desde el móvil

```bash
npm run generar && npm run publicar
```

Deja en `datos/publicada.html` la misma página, lista para subirla a la web: sin
el `<html>` de fuera —quien la publica la envuelve por su cuenta— y sin el botón
de Actualizar, porque ahí no hay servidor local al que pedirle nada.

En su sitio va un botón de **Recargar** y la hora de los datos. No es lo mismo y
conviene no confundirlo: **quien habla con Mister es el Mac**. La página
publicada es una copia, y ninguna de las cosas que un navegador puede hacer
desde fuera —ni las capacidades que da el visor— llega a un servidor que
escucha en `127.0.0.1` de otra máquina. Recargar trae la última versión que el
Mac haya subido, que es lo que hace falta casi siempre.

El botón de la copia publicada sí actualiza de verdad, y desde el móvil. Lo
hace posible un intermediario en Cloudflare —`aplicacion/lanzador/`—, porque la
página no puede hacerlo sola: pedirle a GitHub que actualice exige un token con
permiso de escritura, y la página es pública, así que el token se leería con
ver el código fuente. El intermediario lo guarda él, y lo único que sabe hacer
es lanzar esta actualización.

No lleva contraseña a propósito. Lo peor que puede hacer un desconocido que
encuentre la dirección es refrescar unos datos que ya son públicos en la propia
página. Lo que sí lleva es un freno de cuatro minutos, y lo resuelve
preguntándole a GitHub por la última pasada en vez de recordarla: un Worker no
tiene memoria entre peticiones, así que un contador propio sería mentira.

Se publica **siempre sobre la misma dirección**, así que el enlace no cambia
nunca: quien lo tenga guardado ve lo último cada vez que entra.

De mantenerlo al día se encargan dos relojes, y **ninguno necesita el Mac**:

| Quién | Cuándo | Qué hace |
|---|---|---|
| **Cron de Cloudflare** | :07 y :37 de cada hora, las 24 h | Le pide a GitHub que actualice |
| Cron de GitHub Actions | los mismos horarios | Lo mismo, por si el otro cae |

Que hagan lo mismo no es descuido: **el que cumple es el de Cloudflare**. El de
GitHub Actions es «cuando pueda» y su documentación lo admite. Medido en este
repositorio el 6 de septiembre de 2026, con datos y no con impresiones:

- Un workflow de prueba con `*/5 * * * *` —la expresión más simple que existe—
  estuvo **dos horas sin disparar una sola vez**: cero de veinticuatro turnos.
  Eso descarta que fuera un problema de la expresión.
- En diez horas, el workflow de verdad disparó **dos veces de las quince que le
  tocaban**, con retrasos de 10 y 23 minutos.
- El cron de Cloudflare, en su primer turno, disparó a los **55 segundos** del
  minuto en punto.

Por eso el reloj bueno está fuera de GitHub. El de GitHub se deja puesto porque
no cuesta nada y cubre el caso de que Cloudflare falle; si disparan los dos, el
`concurrency` del workflow impide que se pisen y la segunda pasada no encuentra
nada nuevo que guardar.

La pasada larga de las 523 fichas va dentro del mismo workflow, no en una tarea
aparte. No se ata a una hora concreta —«si son las 7, hazla»— porque eso depende
de que exista una pasada justo a esa hora, y perderla cuesta un día entero de
goles, tarjetas y titularidades. Se mira cuánto hace de la última con una marca
guardada en la caché, así que la hace la primera pasada que se encuentre con las
veinte horas cumplidas.

### Lo que se probó antes, y por qué se descartó

Vale la pena dejarlo escrito para no repetirlo:

- **El programador de la propia app** no dispara si la sesión está ocupada. Una
  mañana estuvo diez horas sin publicar con el Mac encendido.
- **launchd**, el de macOS, sí es puntual, pero **no puede ejecutar nada que viva
  bajo `~/Documents`**: sale con código 126 y «Operation not permitted», sin
  escribir una línea en ningún log, porque el guion no llega ni a arrancar. Había
  que instalar el ejecutable en `~/Library/Application Support/`. Funcionaba,
  pero exigía el Mac encendido, que era justo lo que había que quitar.

La actualización y la publicación van en **un solo comando** (`npm run
refrescar`) a propósito. Cuando eran dos pasos separados, una mañana el primero
corrió y el segundo no: los datos se actualizaron a las 9:05 y la página
publicada se quedó en la de las 0:42 de la madrugada. Un solo comando es un solo
permiso, y o se hace entero o no se hace.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run app` | Levanta la app con el botón en `127.0.0.1:4788` |
| `npm run credenciales` | Lo mismo que la pantalla, desde el Terminal |
| `npm run actualizar` | Una pasada desde el Terminal, sin la app |
| `npm run generar` | Solo rehace el HTML con los datos que ya hay |
| `npm run publicar` | Prepara `datos/publicada.html` para subirla a la web |
| `npm run refrescar` | Las dos de arriba de una vez. Es lo que corre GitHub |
| `npm run fichas` | La pasada larga: lee las 523 fichas (~9 min, una vez al día) |
| `python3 modulo/escudos.py` | Baja los escudos de los clubes. Una vez y ya |
