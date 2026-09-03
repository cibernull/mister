/**
 * Convierte un importe tal y como lo muestra Mister a un entero.
 *
 * Nunca usa coma flotante: la exactitud al céntimo es un requisito del
 * proyecto y un `parseFloat` intermedio introduciría error de representación.
 */
export function parsearImporte(texto: string): number {
  const limpio = texto.replace(/[\s€]/g, '')
  const coincidencia = /^([+-]?)(\d{1,3}(?:\.\d{3})*|\d+)$/.exec(limpio)

  if (!coincidencia) {
    throw new Error(`importe no reconocido: ${JSON.stringify(texto)}`)
  }

  const [, signo, digitos] = coincidencia
  const valor = Number.parseInt(digitos!.replaceAll('.', ''), 10)

  return signo === '-' ? -valor : valor
}
