# Hallazgos del histórico real, para la Fase 2

Obtenidos el 2026-09-03 ejecutando un diagnóstico sobre el histórico completo ya
recolectado (16 lotes, 252 transacciones, 4 cierres de jornada). No son
suposiciones: cada uno se comprobó contra los datos.

Los tres primeros **habrían falseado la contabilidad** si el motor contable de la
Fase 2 se hubiera escrito sin conocerlos.

## 1. El día 1 de la liga es el 3 de agosto de 2026

El evento más antiguo del feed es:

```
2026-08-03 06:17:52  admin  {"key":"reset-all","msg":"La liga ha sido reiniciada por el administrador"}
```

La liga existe desde 2023 (`uc_created` = agosto de 2023), pero fue **reiniciada**
el 3 de agosto de 2026. Ese reinicio es el origen contable: el feed lo contiene,
y con él todo lo posterior. La primera transacción es de ese mismo día a las
17:00.

**Consecuencia:** el histórico recolectado está completo respecto al periodo que
importa. No hay que ir más atrás.

## 2. Una jornada aparece DOS VECES

Hay 4 eventos `gameweek_end` pero solo **3 jornadas distintas**:

| Fecha del evento | `gameweek` | `id_gameweek` |
|---|---|---|
| 2026-08-20 12:34:06 | 1 | 3968 |
| 2026-08-25 11:59:44 | 2 | 4043 |
| 2026-08-28 10:58:16 | 1 | **3968 — repetido** |
| 2026-09-01 10:45:05 | 3 | 4044 |

La jornada 1 se publica dos veces con el mismo `id_gameweek`. Sumar sus premios
sin deduplicar **infla el dinero de los ocho equipos**: en el caso propio, un
millón de más.

**Regla para el motor:** deduplicar los cierres por `id_gameweek`, no por el
número de jornada ni por la fecha del evento. Y no dar por sentado que no
volverá a ocurrir: si aparece un tercer evento con un `id_gameweek` ya visto y
**premios distintos**, eso es una anomalía que debe detener el proceso, no
resolverse eligiendo uno.

## 3. Los equipos se identifican por `id_uc`, nunca por nombre

El feed contiene un evento `change_name`:

```
2026-08-17 23:44:42  "Rafael manda" → "Cacaculopedopis"
```

Las transacciones anteriores a esa fecha llevan el nombre viejo en `from`/`to`,
y las posteriores el nuevo. **Agrupar por nombre partiría ese equipo en dos**, y
ninguna de las dos mitades cuadraría.

**Regla para el motor:** la identidad es `id_uc_from` / `id_uc_to` en las
transacciones e `idUc` en las posiciones del ranking. El nombre es solo para
mostrar, y conviene quedarse con el más reciente.

## 4. El presupuesto inicial no sale redondo — queda por explicar

Despejando con el saldo propio real (`balance.current` = 9.209.955 €), y ya
deduplicada la jornada repetida:

```
presupuesto inicial = 9.209.955 − (3.275.000 + 102.008.780 − 107.997.495)
                    = 11.923.670 €
```

Un presupuesto de reinicio de liga debería ser una cifra redonda. **No lo es**,
así que falta algún concepto contable por descubrir. Hipótesis a comprobar en la
Fase 2, en este orden:

1. Que las ventas al mercado no ingresen el importe íntegro (comisión, o precio
   distinto del publicado en el feed).
2. Que existan movimientos de dinero que no sean `transfer` ni `gameweek_end`
   (por ejemplo, algo asociado a los créditos, o a las cláusulas de rescisión).
3. Que las operaciones de tipo `clause` (7) o `rescind` (1) tengan un signo o un
   reparto distinto del que se les suponga.
4. Que el reinicio conservara parte del saldo de la temporada anterior.

**Mientras esto no se explique, ninguna cifra de saldo se da por buena.** Es
justo lo que la comprobación de la Fase 2 —saldo propio reconstruido igual a
`balance.current` al céntimo— está para detectar.

## 5. Tres equipos no han comprado nada, pero tienen plantilla

`Legalize F.C`, `Betico1993` y `Los tocahuevos C.F` suman **cero compras** en
todo el histórico, y sin embargo tienen plantillas valoradas entre 6 y 30
millones.

Tras un `reset-all`, Mister reparte plantillas iniciales que **no generan
eventos `transfer`**. Eso es coherente: no costaron dinero, así que no afectan al
saldo. Pero sí implica que **el valor de plantilla de un equipo no puede
reconstruirse sumando sus fichajes**: hay que tomarlo de `teamValue` en los
cierres de jornada, o de la clasificación actual.

Importa porque el tope de puja depende de él:
`tope = saldo + 0,25 × valor de plantilla`.

## 6. Lo que el feed NO da: el saldo de los rivales

El feed permite reconstruir con exactitud **la variación** del dinero de cada
rival desde el reinicio, pero no su saldo de partida. `user.cash` viene a `0`
para todos en el ranking, y solo se conoce el saldo propio.

Si al resolver el punto 4 resulta que todos partieron del mismo presupuesto,
queda resuelto de golpe para los ocho. Si no, harán falta restricciones
adicionales para acotarlo, por ejemplo:

- El indicador `negative` de cada jornada dice que ese equipo tenía **saldo
  negativo** en ese momento (`Saiyans FC` en la jornada 3).
- Una puja ganada de importe X demuestra que su tope de puja era **al menos X**
  en esa fecha.

Estas son desigualdades, no igualdades: acotan, no determinan. Si al final el
saldo de los rivales solo pudiera acotarse y no calcularse, **hay que decirlo
explícitamente** en vez de presentar un número aproximado como si fuera exacto.

---

# Investigación del descuadre (2026-09-03, tras cerrar la Fase 1)

## Los presupuestos iniciales NO son iguales para todos

Probado y descartado. Suponiendo que los ocho partieran del mismo saldo que se
despeja con el propio (11.923.670 €), los saldos calculados en el cierre de la
jornada 3 dan:

| Equipo | Saldo calculado | ¿Mister lo marca negativo? |
|---|---|---|
| Saiyans FC (Fran) | −24.754.070 € | **Sí** ✓ coherente |
| Mario80 | −12.085.510 € | **No** ✗ **contradicción** |

Si todos hubieran partido de lo mismo, Mario80 también estaría en negativo y
Mister lo habría marcado. No lo hace. **Cada equipo arrancó con un saldo
distinto tras el `reset-all`.**

**Consecuencia directa:** el feed permite reconstruir con exactitud *cuánto ha
variado* el dinero de cada rival, pero **no su saldo absoluto**. Solo el propio
es conocido, porque Mister lo publica.

## Hallazgo que abre una vía: `other_bids`

Los movimientos de tipo `transfer` incluyen un campo `other_bids` con **las
pujas perdedoras y su importe exacto**:

```json
"other_bids": [
  { "name": "Saiyans FC (Fran)", "bid": 1600000 },
  { "name": "Mario80",           "bid": 1062020 }
]
```

**49 de los 252 movimientos** lo traen. Cada puja demuestra que ese rival tenía
esa capacidad de gasto en esa fecha, lo que da una **cota inferior** de su saldo.
Las marcas `negative` de los cierres de jornada dan **cotas superiores**. Con
suficientes de ambas, el saldo de cada rival queda encajonado.

## Pero las cotas actuales se contradicen

Calculadas con `tope = saldo + 0,25 × valor de plantilla`:

| Equipo | Cota mínima | Cota máxima | |
|---|---|---|---|
| Saiyans FC (Fran) | 39.632.740 € | 36.677.740 € | **imposible: se cruzan** |
| Mario80 | 32.011.400 € | — | |
| Neky F.C. (Sergio) | 21.211.285 € | — | |
| Cacaculopedopis | 20.399.725 € | — | |
| Niutin FC (Isaac) | 7.894.259 € | — | real: 11.923.670 ✓ coherente |

Que la cota mínima de Saiyans supere a su máxima demuestra que **alguna
suposición del método es falsa**. Candidatas, por orden de probabilidad:

1. **El valor de plantilla usado es el de la jornada anterior**, no el del
   instante de la puja. El valor cambia con cada fichaje y con las variaciones
   diarias de mercado, así que el error puede ser de millones. *Es la causa más
   probable y la más fácil de eliminar.*
2. **Pujar no exige tener los fondos en ese instante.** Si Mister acepta pujas
   por encima del tope y las descarta al resolverse, una puja no prueba nada
   sobre el saldo.
3. **El coeficiente 0,25 no es universal**: podría depender de reglas de liga o
   del número de jugadores.
4. **`payment` no recoge todo el dinero que entra** por una jornada.

## Qué desbloquea esto

**Capturar el valor de plantilla de cada rival a diario.** `/standings` lo
publica para los ocho equipos, y hoy solo se conoce en los cierres de jornada.
Con la serie diaria, la causa 1 desaparece y las cotas se estrechan de golpe.

Es un añadido pequeño a la recolección y **debería ser lo primero de la Fase 2**,
antes de escribir ningún motor contable: sin él, el método de acotación no se
puede ni evaluar.

## Y el propio presupuesto inicial sigue sin explicarse

11.923.670 € no es una cifra redonda, y debería serlo si el reinicio repartiera
un presupuesto limpio. Como ahora sabemos que cada equipo arrancó distinto, la
hipótesis más plausible pasa a ser que **el reinicio conservó algo de la
temporada anterior** —saldo, o el valor de la plantilla heredada— en vez de
repartir una cantidad igual para todos.

Eso encajaría con que tres equipos tengan cero compras y aun así plantilla.
Queda por confirmar.

---

# El mecanismo del saldo inicial (aportado por el usuario, 2026-09-03)

> "Todos empezamos con 50 millones y se le resta el valor de los jugadores que
> teníamos por defecto. Casi todos hemos vendido la totalidad del equipo, y los
> que no se han vendido puedes entrar en la ficha del jugador y ver cuánto
> costaba en esa fecha."

Es decir:

```
saldo inicial(equipo) = 50.000.000 − valor de la plantilla repartida en el reinicio
```

Eso explica de golpe por qué los saldos iniciales son **distintos** entre equipos
(cada uno recibió una plantilla de distinto valor) y por qué el propio no sale
redondo.

## Cómo se reconstruye la plantilla repartida

Un jugador que un equipo **vendió sin haberlo comprado antes** en el histórico
formaba parte de su reparto inicial. Los que aún conserva sin haberlos comprado,
también. Recuento sobre el histórico real:

| Equipo | Jugadores del reparto detectados |
|---|---|
| Cacaculopedopis | 15 |
| Neky F.C. (Sergio) | 14 |
| Niutin FC (Isaac) | 14 vendidos + 1 en plantilla = **15** |
| Saiyans FC (Fran) | 14 |
| Mario80 | 9 |
| Betico1993 | 2 |
| Legalize F.C (Victor) | 1 |
| Los tocahuevos C.F ( juanito) | 1 |

Los tres últimos apenas han vendido, así que su reparto está casi entero en su
plantilla actual: hay que leerlo de ahí, no del histórico de movimientos.

## Los valores históricos SÍ son accesibles

La ficha de cada jugador (`/players/{id}/{slug}`) trae un bloque **"Historial de
valores"** con el cambio en **un día**, **una semana** y **un mes**. Restando el
cambio del mes al valor actual se obtiene el valor de hace un mes, que para esta
liga es prácticamente el día del reinicio.

**Aviso importante que se descubrió aquí:** el campo `value` de los movimientos
del feed **no es el valor en el momento del movimiento, sino el valor ACTUAL del
jugador**. Comprobado: Lucas Torró se vendió el 3 de agosto y su `value` en ese
evento (1.266.000) coincide exactamente con su valor de hoy. **No usar `value`
como valor histórico bajo ningún concepto.**

## La verificación, que todavía NO cuadra

Aplicando el mecanismo a la plantilla inicial propia (15 jugadores, valores del
3 de agosto reconstruidos desde el historial de cada ficha):

```
valor de la plantilla repartida     28.953.000 €
50.000.000 − 28.953.000           = 21.047.000 €   ← saldo inicial según el mecanismo
saldo inicial despejado con el real = 11.923.670 €
                                      ------------
diferencia                            9.123.330 €
```

**El mecanismo es casi con certeza el correcto, pero falta un concepto de unos
9,1 millones.** Hipótesis, por orden de facilidad de comprobación:

1. **Una comisión sobre las operaciones.** 9.123.330 sobre unas ventas de
   102.008.780 € es un 8,94 %. Sospechosamente cerca de un 9 %, aunque no
   exacto. Se comprueba mirando si el `price` de una venta al mercado difiere
   sistemáticamente del valor del jugador en esa fecha.
2. **El "hace un mes" de la ficha no cae exactamente en el día del reinicio.**
   El reinicio fue el 3 de agosto a las 06:17 y la consulta se hizo el 3 de
   septiembre: la ventana puede desplazarse unas horas o redondearse.
3. **El reparto tenía más de 15 jugadores.** Faltarían jugadores que salieron
   del equipo por una vía que el feed no registra como `transfer`.

## Cómo cerrarlo

La prueba más limpia es un equipo que apenas se haya movido: **Legalize F.C**,
**Betico1993** o **Los tocahuevos C.F** tienen **cero compras** en todo el
histórico. Su plantilla actual es casi íntegramente el reparto inicial, así que
su saldo se calcula con muy pocos términos:

```
saldo hoy = 50.000.000 − valor del reparto + ventas + premios
```

Si para ellos cuadra y para el propio no, la diferencia está en las operaciones
(hipótesis 1). Si tampoco cuadra, está en el reparto o en la ventana temporal.

---

# Los valores históricos exactos SÍ son extraíbles

La ficha de cada jugador dibuja el gráfico de valor con **Chart.js**, y la
instancia expone la serie completa día a día:

```js
const c = Object.values(Chart.instances)[0]
c.data.labels            // ["30 jun 2026", "1 jul 2026", ... ] hasta 366 días
c.data.datasets[0].data  // valor exacto de cada día
```

Comprobado contra los 15 jugadores del reparto inicial: coincide al euro con la
estimación hecha restando el "cambio en un mes" del bloque de texto. **Esta es
la fuente fiable del valor histórico**, y resuelve el problema de que `value`
en el feed sea el valor actual.

Es la vía para reconstruir el valor de plantilla de cualquier equipo en
cualquier fecha, que es lo que la fórmula del tope de puja necesita.

# El descuadre acotado: 9.123.330 € de gasto invisible

Con los valores exactos del 3 de agosto, el reparto inicial propio (15
jugadores, confirmado por el usuario) suma **28.953.000 €**. Por tanto:

```
saldo inicial según el mecanismo   50.000.000 − 28.953.000 = 21.047.000 €
saldo hoy que eso predice          21.047.000 + 3.275.000 + 102.008.780 − 107.997.495 = 18.333.285 €
saldo hoy real (Mister)                                                                =  9.209.955 €
                                                                                          -----------
gasto que el feed no registra                                                             9.123.330 €
```

**Descartado, con la comprobación hecha:**

| Hipótesis | Por qué se descarta |
|---|---|
| Comisión al vender | Las ventas se hacen **por encima** del valor (son subastas), no por debajo |
| Jugadores perdidos por salir de LaLiga | 20 jugadores salieron, pero el único que afectó (Carlos Domínguez) se había **comprado** cuatro días antes |
| Valores históricos imprecisos | Verificados al euro con la serie de Chart.js |
| Haber subido cláusulas pagando | Los ratios altos son automáticos: al fichar por cláusula, Mister fija la nueva en **el doble de lo pagado**. Comprobado en Aubameyang (12.342.000 = 2 × 6.171.000) y Brugué (2.000.000 = 2 × 1.000.000) |
| Reparto de más de 15 jugadores | El usuario confirma que fueron unos 15 |

**Pista cuantitativa:** 9.123.330 sobre las ventas normales al mercado
(101.449.580 €) es un **8,99 %**. La cercanía a un 9 % redondo es demasiado
buena para ignorarla, pero no encaja con que las ventas se cobren por encima del
valor. Merece una comprobación dirigida: contrastar, para varias ventas, el
precio que registra el feed con el incremento real del saldo.

**Cómo cerrarlo definitivamente:** anotar el saldo propio hoy, hacer una única
venta al mercado, y volver a mirarlo. La diferencia entre el `price` que
registre el feed y el aumento real del saldo revela el concepto que falta en una
sola operación.
