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

El dinero sigue saliendo del feed, que es lo que cuadra al euro. Lo único que
se da por dado son las constantes del reinicio de liga, en
`modulo/datos/liga.json`: qué jugadores recibió cada equipo y cuánto valía ese
reparto. Por definición no vuelven a cambiar.

```
saldo     = (50.000.000 − valor del reparto) + premios + ventas − compras
plantilla = la que publica la página de cada equipo
tope      = saldo + 25 % del valor de la plantilla
```

Los **valores** vienen del censo, que los da al día para los 523. Las
plantillas siguen leyéndose de la página de cada equipo, no del feed: hay altas
que Mister no publica como traspaso, y reconstruirlas sumando traspasos deja
jugadores fuera.

El censo también dice de quién es cada jugador, así que sirve de contraste con
la página del equipo. Los cinco que discrepan son jugadores que **se han ido de
LaLiga** y siguen en la plantilla: el censo ya no los lista y su valor residual
solo lo tiene su ficha. Se avisa por su nombre en vez de dejarlos fuera.

### 3 bis. Las fichas, ya casi ninguna

Solo quedan dos motivos para pedir una ficha de una en una:

- **el porcentaje del mes**, que no está en ningún sitio salvo la gráfica de la
  ficha, y que es lo que decide el 📤 y el 🔒 de la propia plantilla;
- **los que ya no están en LaLiga**, cuyo valor residual solo tiene su ficha.

Eran ciento veintidós fichas al día —dos minutos y medio—; ahora son
veintitantas, y una pasada entera baja de 2,5 min a unos 25 s.

Además, cada pasada guarda en `modulo/datos/historico-valores.json` lo que vale
hoy cada uno de los 523. Dentro de un mes el porcentaje mensual saldrá de ahí,
gratis y para todos, y las fichas dejarán de hacer falta también para eso.
Hasta entonces se usa la de la ficha **solo si se pidió hoy**: una cifra vieja
no se enseña.

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

### 5. Regenera la página

Con el veredicto en la mano se escriben los datos y se lanza `modulo/generar.cjs`.
El navegador recarga y aparece un aviso con lo que ha cambiado.

## Lo que queda pendiente

- **Cinco jugadores fuera de LaLiga siguen contando.** Javi López, Javi Muñoz,
  Unai Vencedor, Iker Benito y José Ángel Jurado están en la plantilla que
  publica Mister pero ya no en su censo. Suman 919.000 € entre tres rivales, o
  sea unos 230.000 € de tope. Se cuentan por su valor residual, que es lo que
  hace la página del equipo, pero no está confirmado que Mister los sume.
- **Cacaculopedopis: 92 puntos sumando jornadas, 93 en la clasificación.** Un
  punto de diferencia, sin explicar.
- **El porcentaje del mes solo lo tienen unos pocos** hasta que el histórico de
  valores tenga tres semanas de recorrido. Mientras tanto, el resto enseña la
  subida del día, que sí es exacta para todos.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run app` | Levanta la app con el botón en `127.0.0.1:4788` |
| `npm run credenciales` | Lo mismo que la pantalla, desde el Terminal |
| `npm run actualizar` | Una pasada desde el Terminal, sin la app |
| `npm run generar` | Solo rehace el HTML con los datos que ya hay |

## Verla desde el móvil

```bash
npm run generar && npm run publicar
```

Deja en `datos/publicada.html` la misma página, lista para subirla a la web: sin
el `<html>` de fuera —quien la publica la envuelve por su cuenta— y con el botón
de actualizar apagado, porque ahí no hay servidor local al que pedirle nada. En
su sitio se lee de cuándo son los datos.

Es una foto fija: cada vez que se actualice en el Mac hay que volver a
publicarla sobre la misma dirección. A cambio se abre desde cualquier sitio, con
el Mac apagado, y es la forma de enseñársela a alguien más.
