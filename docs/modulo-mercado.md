# El módulo de mercado

`datos/mercado.html` — una sola página que se abre con doble clic. **No usa
JavaScript**: las pestañas y los filtros funcionan con HTML y CSS, así que
también se ven bien en visores que no ejecutan scripts.

```bash
open datos/mercado.html
```

Se regenera con:

```bash
node modulo/generar.cjs
```

## Cómo funciona el filtrado

Tres selectores que se combinan en cascada, con radios ocultos y selectores CSS:

**Dónde busco** — solo los 32 jugadores en venta ahora mismo, o los 197 que
conozco (los que han pasado por la liga más los del mercado).

**Qué me interesa** — todos, los dos iconos, solo puntos, solo dinero, lo que
cabe en el propio tope de puja, o los dos consejos sobre la plantilla propia.

**De quién es** — cualquiera, sin dueño (117), de algún equipo (80), o la
plantilla propia (18).

Cada jugador lleva junto al nombre la **etiqueta de su equipo** en la liga: en
rojo los propios, en verde los que no son de nadie.

| Icono | Criterio | A quién se le pone |
|---|---|---|
| ⭐ | Está en el **tercio con mejor media** de puntos por partido, y ha jugado al menos dos | A cualquiera |
| 💵 | Su valor **sube esta semana** y está en el tercio que **más ha crecido en el mes** | A cualquiera |
| 📤 | **Capital parado**: no rinde (media < 5 o cero partidos) **y** su valor sube menos del 25 % al mes | Solo a los propios |
| 🔒 | **Te lo pueden quitar barato**: rinde (media ≥ 5 o ≥ 20 puntos), al menos 5 rivales pueden pagar su cláusula, **y** esa cláusula sale a menos de 1,1 M € por punto de media **o** sigue en el mínimo (1,5 × valor) | Solo a los propios |

⭐ y 💵 son **percentiles** sobre los 197 jugadores, no umbrales fijos: siguen
significando algo cuando cambie el nivel general de la liga. Con los datos del
3 de septiembre salen en media 4,3 y +55 % de crecimiento mensual.

El umbral de 1,1 M € por punto de media que usa 🔒 tampoco es inventado: es
aproximadamente el cuartil bajo de la liga (p25 = 954 k€, p50 = 1,53 M€) sobre
los 67 jugadores con cláusula que han jugado.

**Los criterios se calculan sobre los 197 jugadores, no sobre el subconjunto
mostrado.** Así una estrella significa lo mismo se mire donde se mire, y el
selector de ámbito solo decide a quién se enseña.

📤 y 🔒 son la excepción deliberada: hablan de la plantilla propia entera, así
que **ignoran los otros dos selectores**. Si no fuera así, elegir «Solo el
mercado» + 📤 dejaría la lista vacía sin explicar por qué. La página avisa de
ello con un recuadro cuando uno de los dos está activo.

Con los datos del 3 de septiembre: 📤 señala a Rodri Hernández, José Giménez y
Hector Fort; 🔒 a Roger Brugué, Aubameyang, Dani Lorenzo, Ramón Terrats y
Álvaro Valles.

## Las 56 combinaciones, verificadas

| Ámbito | Filtro | Cualquiera | Sin dueño | De algún equipo | Mi plantilla |
|---|---|---|---|---|---|
| Mercado | Todos | 32 | 20 | 12 | 5 |
| Mercado | ⭐💵 | 5 | 1 | 4 | 2 |
| Mercado | ⭐ | 9 | 5 | 4 | 2 |
| Mercado | 💵 | 14 | 3 | 11 | 5 |
| Mercado | A mi alcance | 32 | 20 | 12 | 5 |
| Todos | Todos | 197 | 117 | 80 | 18 |
| Todos | ⭐💵 | 25 | 4 | 21 | 7 |
| Todos | ⭐ | 52 | 13 | 39 | 9 |
| Todos | 💵 | 63 | 18 | 45 | 14 |
| Todos | A mi alcance | 197 | 117 | 80 | 18 |
| cualquiera | 📤 | 3 | 3 | 3 | 3 |
| cualquiera | 🔒 | 5 | 5 | 5 | 5 |

Comprobado en el navegador que cada combinación muestra exactamente las filas
que le corresponden y ninguna más.

## Pestaña de equipos

Los ocho ordenados por capacidad de compra. Al desplegar uno: sus cuentas
completas y todos sus jugadores.

### El balance de cada jugador cuenta lo que vale hoy

La tabla es `Pagó · Cobró · Vale hoy · Balance`, y

```
balance = cobró + (vale hoy, si aún lo tiene) − pagó
```

Un fichaje que sigue en plantilla **no es una pérdida**: es dinero convertido en
jugador. Si costó 13 M y hoy vale 14, se está ganando 1 M, no perdiendo 13. Una
versión anterior de la tabla mostraba solo `cobró − pagó` y pintaba de rojo a
casi toda la plantilla; era engañosa.

Los jugadores marcados **«del reparto»** son los que tocaron al empezar. No se
pagó nada por ellos, así que todo lo cobrado cuenta entero — y por eso el total
de la tabla supera la ganancia real: los del reparto ya valían dinero el día del
reinicio.

### La ganancia real está arriba, y es exacta

El recuadro de cuentas termina con:

```
Patrimonio hoy            = saldo en caja + valor de la plantilla
Sobre los 50.000.000 €    = patrimonio − 50.000.000
```

Ese sí es el «voy ganando o perdiendo», y sale del motor contable, no de la
tabla. Para Niutin FC: 9.209.955 + 77.386.000 = **86.595.955 €**, es decir
**+36.595.955 €** sobre la salida, de los que 3.275.000 € son premios.

## El precio: cláusula o valor

Cada jugador muestra **lo que cuesta ficharlo de verdad**, no una cifra
orientativa:

- **Con dueño** → su **cláusula de rescisión**, en rojo y etiquetada. Es lo que
  hay que pagar para arrebatárselo a su equipo. 70 de los 197 están en este caso.
- **Libre** → su **valor de mercado**. Los otros 127.

El contador de cada fila usa ese precio efectivo. En los jugadores ajenos dice
`x/8` (cuántos equipos llegan a pagarlo); en los propios dice **`x/7` rivales
pueden pagarla**, que es la pregunta que importa cuando el jugador ya es tuyo.

Ejemplo: Aubameyang vale 5.614.000 € pero su cláusula es **12.342.000 €** —más
del doble—, porque Mister la fija en el doble de lo que se pagó por él.

## Lo que el módulo NO sabe

- **Conoce 197 jugadores, no todo LaLiga.** No hay catálogo completo accesible:
  `/search` redirige al mercado y no se encontró ningún endpoint que lo sirva.
- **No sabe cuánto cuesta subir una cláusula.** 🔒 dice qué jugadores están
  expuestos, no lo que cuesta blindarlos.
- **Los datos son una foto fija** del 3 de septiembre. Regenerarlo solo es el
  trabajo de la Fase 3, que necesita las credenciales de sesión en disco.

## Cómo se generó

`modulo/generar.cjs` monta `modulo/plantilla.html` con los datos de
`modulo/datos/`. De ahí:

- `datos-liga.json` — movimientos por equipo y por jugador, del histórico.
- `plantillas.json` — quién tiene a quién hoy.
- `clausulas.json` — la cláusula de los 70 jugadores con dueño.
- `jugadores-calc.json` — puntos, media, partidos y evolución de valor.
- `reparto.json` — el reparto inicial de cada equipo.

Los saldos, valores de plantilla y topes de puja están escritos en el propio
generador, tal como los calculó el motor contable. La captura de esos datos es
hoy manual; automatizarla es la Fase 3.

### Un jugador solo puede estar en una plantilla

La captura de plantillas dejó a **Roger Brugué (27907) en dos equipos a la vez**.
El feed lo resuelve sin ambigüedad: el traspaso `543447069`, de tipo `clause` y
fechado el 30 de agosto de 2026, lo llevó de Los tocahuevos a Niutin FC por
1.000.000 €. Se corrigió en `plantillas.json`.

El generador ahora **falla en voz alta** si un jugador aparece en dos plantillas,
en vez de quedarse con la última y seguir. También falla si un jugador que sigue
en plantilla no tiene valor de hoy conocido, porque entonces su balance saldría
mal sin avisar.
