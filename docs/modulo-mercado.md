# El módulo de mercado

`datos/mercado.html` — una sola página, sin servidor ni instalación: se abre con
doble clic. Todos los datos van incrustados en el propio fichero.

```bash
open datos/mercado.html
```

## Qué tiene

**Mercado.** Los jugadores en venta ahora mismo, con dos recomendaciones:

| Icono | Criterio |
|---|---|
| ⭐ | Está en el **tercio del mercado con mejor media** de puntos por partido, y ha jugado al menos dos |
| 💵 | Su valor **sube esta semana** y está en el tercio que **más ha crecido en el último mes** |

Los criterios son percentiles sobre el mercado del día, no umbrales fijos: así
siguen significando algo cuando cambie el nivel general de la liga. Se pueden
filtrar por ambos, por uno, o por lo que cabe en el propio tope de puja.

**¿Quién puede fichar?** Se escribe un jugador y dice qué equipos llegan a su
precio, ordenados por capacidad. Conoce a los jugadores que se han movido en la
liga más los que están hoy en el mercado.

**Equipos.** El listado por capacidad de compra, y al pulsar uno, sus cuentas
completas y todos sus fichajes con lo que ganó o perdió en cada jugador.

## Lo que el módulo NO sabe todavía

- **El precio mostrado es el valor de mercado, no la cláusula.** Fichar a un
  jugador de otro equipo cuesta su cláusula de rescisión, que Mister fija en el
  doble de lo pagado por él. Para los jugadores libres del mercado, el valor sí
  es la referencia correcta.
- **Solo conoce a los jugadores que han pasado por la liga o están hoy en venta.**
  No hay catálogo completo de LaLiga: `/search` redirige al mercado y no se
  encontró ningún endpoint que lo sirva.
- **Los datos son de una foto fija.** Regenerarlo automáticamente es el trabajo
  de la Fase 3.

## Cómo se generó

Los datos salen de tres sitios: el histórico ya recolectado
(`datos/volcado-feed.json`), la clasificación, y la ficha de cada jugador del
mercado —de donde se leen puntos, media y la evolución de valor—.

La Fase 3 sustituirá ese proceso manual por una orden que lo rehaga sola.
