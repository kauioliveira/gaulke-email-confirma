/**
 * Periodo dos relatorios, SEMPRE em dias de Sao Paulo.
 *
 * `de`/`ate` chegam como YYYY-MM-DD (o <input type="date">); viram o inicio do
 * primeiro dia e o fim do ultimo no fuso de Brasilia. Sem datas: os ultimos 30
 * dias, incluindo hoje.
 */
export function lerPeriodo(q: Record<string, unknown>) {
  const valido = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  const hoje = dataSP()
  const ate = valido(q.ate) ?? hoje
  const de = valido(q.de) ?? dataSP(new Date(Date.now() - 29 * 86_400_000))
  const inicio = new Date(`${de}T00:00:00${DESLOCAMENTO_SP}`)
  const fim = new Date(`${ate}T23:59:59.999${DESLOCAMENTO_SP}`)
  return {
    de,
    ate,
    inicio,
    fim,
    /**
     * Os mesmos limites em texto ISO, para SQL cru (useSql). O driver do
     * drizzle troca o serializador de datas do postgres.js por um que repassa
     * o valor como veio — uma Date passada crua quebra a consulta.
     */
    inicioIso: inicio.toISOString(),
    fimIso: fim.toISOString()
  }
}
