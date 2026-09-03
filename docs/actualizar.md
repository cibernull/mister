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

## Antes: las credenciales, una sola vez

Mister exige dos cosas en cada petición: la cookie de sesión y el token
`X-Auth`. La cuenta entra con Apple y la cookie es **HttpOnly**, así que ni el
JavaScript de la propia página la ve. No hay forma de sacarlas por código.

Las dos viajan juntas en la cabecera de cualquier petición del navegador, y
Chrome sabe copiar una petición entera como comando cURL. De ahí salen las dos
de golpe:

1. En Chrome, con Mister abierto y la sesión iniciada, abre `⌥⌘I` → pestaña
   **Network**.
2. Recarga con `⌘R`, clic derecho sobre cualquier petición →
   **Copy** → **Copy as cURL**.
3. En el Terminal, dentro del proyecto:

```bash
npm run credenciales
```

y pega (`⌘V`), Enter, `Ctrl+D`.

El comando saca las dos cabeceras, **las prueba contra Mister antes de guardar
nada** —unas credenciales caducadas guardadas solo cambian el error de sitio— y
las escribe en `.sesion/` con permisos 0600. Nunca las imprime, ni en los
errores. `.sesion/` está en `.gitignore`.

Cuando la sesión del navegador caduque, el botón lo dirá y basta con repetir
estos tres pasos.

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

### 2. Rehace las cuentas

Todo sale del feed. Lo único que se da por dado son las constantes del reinicio
de liga, en `modulo/datos/liga.json`: qué jugadores recibió cada equipo y cuánto
valía ese reparto. Por definición no vuelven a cambiar.

```
saldo    = (50.000.000 − valor del reparto) + premios + ventas − compras
plantilla = reparto + los que entraron − los que salieron
tope     = saldo + 25 % del valor de la plantilla
```

Contrastado contra las cifras ya verificadas, el feed reproduce por sí solo:

| Dato | Resultado |
|---|---|
| Premios de los 8 equipos | exacto |
| Compras y ventas de los 8 | exacto |
| Saldo | exacto en 7; el propio se aparta 800 € (el redondeo a millares conocido) |
| Puntos | exacto en 7; Cacaculopedopis sale 92 y no 93 |
| Valor de plantilla | depende de los valores de ficha, abajo |

### 3. Pide las fichas que falten

Un jugador que sigue en la plantilla del reparto y por el que nadie ha pujado
nunca no aparece en el feed: su ficha es el único sitio donde está su valor. Son
34 en la primera pasada, y quedan cacheados en `modulo/datos/valores-ficha.json`;
después solo se piden los que aparezcan nuevos.

Sin ellos el valor de plantilla se queda corto, y con él el tope de puja. El
motor lo dice por su nombre en vez de dar una cifra baja sin avisar.

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

- **Una plantilla del feed no es igual que la de la página del equipo.** Las
  reconstruidas salen más cortas: les faltan exactamente los jugadores vendidos
  hace poco. Las páginas de equipo parecen enlazar también a los que acaban de
  salir —es lo que puso a Roger Brugué en dos plantillas a la vez—, y la
  plantilla raspada de Neky supera en 24 M € el valor de plantilla que publica
  el propio Mister, mientras que la reconstruida se queda a 2,7 M. Todo apunta a
  que manda el feed, pero no está cerrado del todo.
- **Cacaculopedopis: 92 puntos sumando jornadas, 93 en la clasificación.** Un
  punto de diferencia, sin explicar.
- **La primera pasada de verdad está sin hacer**, porque necesita las
  credenciales. Los pasos 1, 3 y 4 hablan con Mister y no se han podido probar
  contra el servidor real: lo probado es la reconstrucción, contra el histórico
  ya guardado.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run app` | Levanta la app con el botón en `127.0.0.1:4788` |
| `npm run credenciales` | Guarda la sesión desde un «Copy as cURL» |
| `npm run actualizar` | Una pasada desde el Terminal, sin la app |
| `npm run generar` | Solo rehace el HTML con los datos que ya hay |
