# El módulo

Una sola página, `datos/mercado.html`, generada por `modulo/generar.cjs` a
partir de los datos del motor contable.

```bash
npm run app      # con botón de actualizar, en 127.0.0.1:4788
npm run generar  # solo rehace el HTML con los datos que ya hay
```

Abrirla con doble clic también funciona: pestañas y filtros van con CSS, y
JavaScript solo añade el buscador, el orden y el botón. Sin él se ve la lista
entera, que sigue siendo útil.

## Está pensada para que la entienda alguien de fuera

Es el requisito que manda desde que la idea es enseñársela a la gente de la
liga. De ahí salen la mitad de las decisiones:

- Una pestaña **Guía** que explica la fórmula del tope de puja, los cuatro
  iconos, la diferencia entre valor y cláusula, y lo que el módulo **no** sabe.
- Un **marcador** siempre visible arriba con las cuatro cifras que resumen tu
  situación: puesto, caja, tope de puja y cuánto has ganado sobre los 50 M.
- La barra de cada equipo **descompone el tope en vez de enunciarlo**: la parte
  sólida es la caja y la rayada el 25 % que le fía su plantilla. Se ve de un
  vistazo quién tiene dinero de verdad y quién lo tiene metido en jugadores —
  Betico1993 es casi todo sólido, Neky F.C. casi todo rayado.
- La **tira de cuadraditos** de cada jugador dice cuántos equipos llegan a
  pagar su precio. Es la misma información que el `7/8`, pero se lee sin leerla.

## Las cuatro pestañas

| | Qué hay |
|---|---|
| **Jugadores** | Los 197 con buscador, orden y cuatro grupos de filtros |
| **Equipos** | Los 8 por capacidad de compra, desplegables a sus cuentas completas |
| **Mi equipo** | La plantilla propia partida en vender / blindar / el resto |
| **Guía** | Qué significa cada cosa, para quien abre esto por primera vez |

## Buscar, ordenar, filtrar

**Buscador**: por nombre de jugador, por equipo (`neky` → sus 22) y también por
posición escrita (`portero` → los 17). Necesita JavaScript.

**Orden**: recomendados, más caros, más baratos, mejor media, más puntos, los
que más suben.

**Filtros**, cuatro grupos que se combinan:

| Grupo | Opciones |
|---|---|
| Posición | Todas · Porteros · Defensas · Medios · Delanteros |
| De quién es | Cualquiera · Libres · De un rival · Míos |
| Dónde busco | Todos · Solo lo que está en venta |
| Qué destaca | Todo · ⭐ Puntos · 💵 Dinero · Los dos · Puedo pagarlo |

**Míos** se salta el selector de ámbito a propósito: enseñar solo los tuyos que
están en venta deja la lista casi vacía sin explicar por qué. La página lo avisa.

Los filtros van con CSS —radios ocultos y selectores de hermano— y el buscador
con JavaScript; se componen porque cada uno esconde por su lado y el contador
solo cuenta lo que de verdad se ve (`offsetParent !== null`).

## Los cuatro iconos

| Icono | Criterio | A quién |
|---|---|---|
| ⭐ | Media en el **tercio alto** de la liga, con dos partidos o más | Cualquiera |
| 💵 | Su valor **sube esta semana** y está en el tercio que **más creció en el mes** | Cualquiera |
| 📤 | **Capital parado**: no rinde (media < 5 o cero partidos) **y** sube menos del 25 % al mes | Solo los propios |
| 🔒 | **Te lo quitan barato**: rinde (media ≥ 5 o ≥ 20 pts), 5 o más rivales pagan su cláusula, **y** esa cláusula sale a menos de 1,1 M € por punto de media **o** sigue en el mínimo (1,5 × valor) | Solo los propios |

⭐ y 💵 son **percentiles** sobre los 197, no umbrales fijos: siguen
significando lo mismo cuando cambie el nivel de la liga. Con los datos del 3 de
septiembre salen en media 4,3 y +55 % mensual. El umbral de 1,1 M € por punto
que usa 🔒 es aproximadamente el cuartil bajo de la liga (p25 = 954 k€,
p50 = 1,53 M€) sobre los 67 jugadores con cláusula que han jugado.

**Los criterios se calculan sobre los 197, no sobre lo que estás viendo.** Así
una estrella significa lo mismo mires donde mires.

### ⭐ y 📤 a la vez no es una errata

Rodri Hernández lleva las dos. La estrella dice que su media (4,5) está en el
tercio alto; el 📤 dice que 12.395.000 € inmovilizados para esa media, con el
valor plano desde hace un mes, no compensan. Son dos preguntas distintas
—«¿es bueno?» y «¿me renta tenerlo?»— y la línea de consejo lo explica en vez
de dejar los iconos peleándose.

## El precio es lo que cuesta ficharlo

- **Con dueño** → su **cláusula**, en ámbar. 70 de los 197.
- **Libre** → su **valor de mercado**. Los otros 127.

La tira cuenta sobre los 8 equipos en los jugadores ajenos y sobre los 7
rivales en los propios, que es la pregunta que importa cuando ya es tuyo.

## El balance por jugador cuenta lo que vale hoy

En la tabla de cada equipo: `Pagó · Cobró · Vale hoy · Balance`, con

```
balance = cobró + (vale hoy, si aún lo tiene) − pagó
```

Un fichaje que sigue en plantilla no es una pérdida: es dinero convertido en
jugador. Los marcados **«del reparto»** no costaron nada, así que todo lo
cobrado cuenta entero — y por eso el total de la tabla supera la ganancia real.

La ganancia de verdad está en el recuadro de cuentas, y es exacta:

```
Patrimonio hoy         = caja + valor de la plantilla
Sobre los 50.000.000 € = patrimonio − 50.000.000
```

Para Niutin FC: 9.209.955 + 77.386.000 = **86.595.955 €**, o sea
**+36.595.955 €**, de los que 3.275.000 € son premios.

## El diseño

Neutros con un punto de verde —el césped, sin disfrazarse de él— y **ámbar
como acento, porque el tema de todo esto es el dinero**. Verde y rosa quedan
reservados a ganar y perder y no se usan para nada más, que es lo que permite
leer un signo sin leer la cifra.

**Barlow Condensed** para nombres y titulares (condensada: caben los nombres
largos de equipo y tiene aire de marcador), **Manrope** para el texto y
**IBM Plex Mono** con cifras tabulares para todo lo que sea dinero, para que
las columnas de números cuadren.

Los dorsales de color marcan la posición: azul portero, verde defensa, ámbar
medio, rojo delantero.

Tres temas, como debe ser: `:root` define la paleta clara completa,
`@media (prefers-color-scheme: dark)` la redefine con guarda
`:root:not([data-theme=light])`, y `:root[data-theme=dark]` otra vez para que
una elección explícita gane en las dos direcciones.

## Lo que el módulo NO sabe

- **No conoce a todo LaLiga.** Conoce 197 jugadores: los que han pasado por la
  liga y los que están hoy en el mercado. `/search` redirige a `/market` y no
  se encontró ningún endpoint que sirva el catálogo.
- **12 de esos 197 no tienen posición**, porque vienen de la captura manual y
  no del feed. Salen con un dorsal gris.
- **No sabe cuánto cuesta subir una cláusula.** 🔒 dice quién está expuesto.
- **El nombre de la liga y el equipo propio están escritos en el generador**
  (`MI_EQUIPO`, `NOMBRE_LIGA`). Para que otro de la liga lo use tal cual habría
  que sacarlos a configuración.

## Cómo se genera

`modulo/generar.cjs` monta `modulo/plantilla.html` con los datos de
`modulo/datos/`:

| Fichero | Qué lleva |
|---|---|
| `equipos.json` | Saldo, plantilla, puntos y puesto de los 8 |
| `plantillas.json` | Quién tiene a quién hoy |
| `clausulas.json` | La cláusula de los 70 con dueño |
| `jugadores-calc.json` | Puntos, media, partidos, posición y evolución |
| `datos-liga.json` | Movimientos por equipo y por jugador |
| `liga.json` | Las constantes del reinicio (no cambian nunca) |

Todos los rehace `npm run actualizar` — ver [actualizar.md](actualizar.md).

### Un jugador solo puede estar en una plantilla

La captura de plantillas dejó a **Roger Brugué (27907) en dos equipos a la vez**.
El feed lo resuelve: traspaso `543447069`, tipo `clause`, 30 de agosto de 2026,
de Los tocahuevos a Niutin FC por 1.000.000 €.

El generador **falla en voz alta** si un jugador aparece en dos plantillas, en
vez de quedarse con el último que lea; y también si un jugador que sigue en
plantilla no tiene valor de hoy, porque entonces su balance saldría mal sin
avisar.
