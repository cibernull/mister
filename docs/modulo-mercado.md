# El módulo de mercado

`datos/mercado.html` — una sola página que se abre con doble clic. **No usa
JavaScript**: las pestañas y los filtros funcionan con HTML y CSS, así que
también se ven bien en visores que no ejecutan scripts.

```bash
open datos/mercado.html
```

## Cómo funciona el filtrado

Dos selectores que se combinan en cascada, con radios ocultos y selectores CSS:

**Dónde busco** — solo los 32 jugadores en venta ahora mismo, o los 197 que
conozco (los que han pasado por la liga más los del mercado).

**Qué me interesa** — todos, los dos iconos, solo puntos, solo dinero, o lo que
cabe en el propio tope de puja.

**De quién es** — cualquiera, sin dueño (117), o de algún equipo (80).

Cada jugador lleva junto al nombre la **etiqueta de su equipo** en la liga: en
rojo los propios, en verde los que no son de nadie.

| Icono | Criterio |
|---|---|
| ⭐ | Está en el **tercio con mejor media** de puntos por partido, y ha jugado al menos dos |
| 💵 | Su valor **sube esta semana** y está en el tercio que **más ha crecido en el mes** |

**Los criterios se calculan sobre los 197 jugadores, no sobre el subconjunto
mostrado.** Así una estrella significa lo mismo se mire donde se mire, y el
selector de ámbito solo decide a quién se enseña. Son percentiles, no umbrales
fijos: siguen significando algo cuando cambie el nivel general de la liga.

Con los datos del 3 de septiembre, los umbrales salen en media 4,3 y +55 % de
crecimiento mensual.

## Las diez combinaciones, verificadas

| Ámbito | Filtro | Jugadores |
|---|---|---|
| Mercado | Todos | 32 |
| Mercado | ⭐💵 | 5 |
| Mercado | ⭐ | 9 |
| Mercado | 💵 | 14 |
| Mercado | A mi alcance | 32 |
| Todos | Todos | 197 |
| Todos | ⭐💵 | 25 |
| Todos | ⭐ | 52 |
| Todos | 💵 | 63 |
| Todos | A mi alcance | 197 |

Comprobado en el navegador que cada combinación muestra exactamente las filas
que le corresponden y ninguna más.

## Pestaña de equipos

Los ocho ordenados por capacidad de compra. Al desplegar uno: sus cuentas
completas y todos sus jugadores con lo que pagó, cobró y ganó en cada uno.

## El precio: cláusula o valor

Cada jugador muestra **lo que cuesta ficharlo de verdad**, no una cifra
orientativa:

- **Con dueño** → su **cláusula de rescisión**, en rojo y etiquetada. Es lo que
  hay que pagar para arrebatárselo a su equipo. 70 de los 197 están en este caso.
- **Libre** → su **valor de mercado**. Los otros 127.

El contador `x/8` de cada fila usa ese precio efectivo, así que ya responde a la
pregunta real: cuántos equipos pueden pagar lo que ese jugador cuesta hoy.

Ejemplo: Aubameyang vale 5.614.000 € pero su cláusula es **12.342.000 €** —más
del doble—, porque Mister la fija en el doble de lo que se pagó por él.

## Lo que el módulo NO sabe

- **Conoce 197 jugadores, no todo LaLiga.** No hay catálogo completo accesible:
  `/search` redirige al mercado y no se encontró ningún endpoint que lo sirva.
- **Los datos son una foto fija** del 3 de septiembre. Regenerarlo solo es el
  trabajo de la Fase 3, que necesita las credenciales de sesión en disco.

## Cómo se generó

Del histórico ya recolectado salen los movimientos y los nombres; de la
clasificación, los valores de plantilla; y de la ficha de cada jugador, los
puntos, la media y la evolución de valor. Ese proceso es hoy manual.
