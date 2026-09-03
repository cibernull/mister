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
