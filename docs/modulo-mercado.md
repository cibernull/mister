# El módulo

Una sola página, `datos/mercado.html`, generada por `modulo/generar.cjs`.

```bash
npm run app      # con botón de actualizar, en 127.0.0.1:4788
npm run generar  # solo rehace el HTML con los datos que ya hay
```

Abrirla con doble clic también funciona: pestañas y filtros van con CSS, y
JavaScript solo añade los buscadores, el orden y el botón.

## Está organizada por preguntas, no por tablas

Cada pestaña responde a una, y en el orden en que uno se las hace:

| Pestaña | La pregunta | Qué hay |
|---|---|---|
| **Mi equipo** | ¿Cómo voy y qué hago con mi plantilla? | Tu plantilla partida en los que deberías vender, los que deberías blindar y el resto; y tus cuentas completas |
| **Fichar** | ¿A quién puedo fichar y a qué precio? | Los 197 jugadores con buscador, orden y cuatro grupos de filtros |
| **Rivales** | ¿Qué tienen los demás? | Los ocho equipos: dinero, plantilla entera y jugador a jugador |
| **Movimientos** | ¿Qué ha pasado en la liga? | Los 249 fichajes y ventas en orden, con el pulso diario del mercado |
| **Números** | ¿Quién va ganando, en puntos y en dinero? | Clasificación, riqueza, quién comercia mejor, récords y los mejores |
| **Guía** | ¿Qué significa todo esto? | Cada término y cada icono, para quien abre esto por primera vez |

Encima de todas, un **marcador** fijo con las cuatro cifras que resumen tu
situación: puesto, caja, tope de puja y ganancia sobre los 50 M.

## Quién puede ficharlo

Era la pregunta que originó el módulo y durante días solo salía el recuento.
Ahora la tira de cuadraditos de cada jugador **se despliega** y enseña qué
equipos concretos llegan a su precio y con cuánto margen:

- Roger Brugué, cláusula de 2 M → los **7 de 7** rivales, y al más rico le
  sobran 45 M después de pagarla.
- Mikel Oyarzabal, 25,5 M → solo **5 de 7**.

El propio dueño no cuenta: nadie se ficha a sí mismo.

## Buscar, ordenar, filtrar

**Buscador** en Fichar (jugador, equipo o posición escrita: `portero` da los 17)
y en Movimientos (jugador o equipo).

**Orden**: recomendados, más caros, más baratos, mejor media, más puntos, los
que más suben.

| Grupo | Opciones |
|---|---|
| Posición | Todas · Porteros · Defensas · Medios · Delanteros |
| De quién es | Cualquiera · Libres · De un rival · Míos |
| Dónde busco | Todos · Solo lo que está en venta |
| Qué destaca | Todo · ⭐ Puntos · 💵 Dinero · Los dos · Puedo pagarlo |
| Movimientos | Todo · Solo compras · Solo ventas al mercado · Solo lo mío |

**Míos** se salta el selector de ámbito a propósito: enseñar solo los tuyos que
están en venta deja la lista casi vacía sin explicar por qué.

Los filtros van con CSS —radios ocultos y selectores de hermano— y los
buscadores con JavaScript; se componen porque cada uno esconde por su lado y el
contador solo cuenta lo que de verdad se ve (`offsetParent !== null`).

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

### ⭐ y 📤 a la vez no es una errata

Rodri Hernández lleva las dos. La estrella dice que su media (4,5) está en el
tercio alto; el 📤 dice que 12.395.000 € inmovilizados para esa media, con el
valor plano desde hace un mes, no compensan. Son dos preguntas distintas
—«¿es bueno?» y «¿me renta tenerlo?»— y la línea de consejo lo explica en vez
de dejar los iconos peleándose.

## Lo que se ve sin leer

- La **barra de cada equipo** descompone el tope en vez de enunciarlo: sólido
  es caja, rayado el 25 % que le fía su plantilla. Betico1993 es casi todo
  sólido; Neky F.C., que va primero, casi todo rayado — tiene 42.285 € en caja.
- La **tira de cuadraditos** dice cuántos llegan a pagar a un jugador.
- El **pulso del mercado**: una barra por día, 32 días, el más movido con 18.
- En **Números**, las barras de riqueza son de dos tonos: lleno es caja, claro
  es plantilla.

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

Y en Números, **quién comercia mejor** descuenta además los premios, para que
sea solo lo ganado en el mercado.

## El diseño

Neutros con un punto de verde —el césped, sin disfrazarse de él— y **ámbar
como acento, porque el tema de todo esto es el dinero**. Verde y rosa quedan
reservados a ganar y perder y no se usan para nada más, que es lo que permite
leer un signo sin leer la cifra.

**Barlow Condensed** para nombres y titulares (condensada: caben los nombres
largos y tiene aire de marcador), **Manrope** para el texto y **IBM Plex Mono**
con cifras tabulares para todo lo que sea dinero.

Los dorsales de color marcan la posición: azul portero, verde defensa, ámbar
medio, rojo delantero.

Tres temas: `:root` define la paleta clara completa,
`@media (prefers-color-scheme: dark)` la redefine con guarda
`:root:not([data-theme=light])`, y `:root[data-theme=dark]` otra vez para que
una elección explícita gane en las dos direcciones.

## Lo que el módulo NO sabe

- **No conoce a todo LaLiga.** Conoce 197 jugadores: los que han pasado por la
  liga y los que están hoy en el mercado. `/search` redirige a `/market`.
- **49 jugadores de plantilla no tienen datos.** Son los que nadie ha movido
  nunca, así que no aparecen en el feed. En «Rivales» salen en su plantilla con
  **«sin datos»** en vez de desaparecer, que es lo que hacían antes. Los
  arregla la primera pasada de `npm run actualizar`, que pide su ficha.
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
| `datos-liga.json` | Movimientos, por equipo y como lista única |
| `jornadas.json` | Puntos, puesto y premio de cada equipo por jornada |
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
