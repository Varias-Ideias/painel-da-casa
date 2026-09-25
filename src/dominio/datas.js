// @ts-check
// Datas do dia a dia da casa. Um "dia" é sempre uma string 'AAAA-MM-DD' no fuso da casa,
// nunca um instante UTC: assim "hoje" e a virada de semana não dependem do aparelho.

/** @param {string} tz @param {Date} [agora] @returns {string} */
export function hojeNoFuso(tz, agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

/** @param {string} dia */
function paraUTC(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

/** @param {number} ms */
function deUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** @param {string} dia @param {number} n */
export function somarDias(dia, n) {
  return deUTC(paraUTC(dia) + n * 86400000);
}

/** Dias de `a` até `b` (b - a). @param {string} a @param {string} b */
export function diferencaDias(a, b) {
  return Math.round((paraUTC(b) - paraUTC(a)) / 86400000);
}

/** 0 = domingo … 6 = sábado. @param {string} dia */
export function diaDaSemana(dia) {
  return new Date(paraUTC(dia)).getUTCDay();
}

/**
 * Primeiro dia da semana que contém `dia`.
 * @param {string} dia @param {number} inicio 0 = domingo, 1 = segunda
 */
export function inicioDaSemana(dia, inicio = 1) {
  const recuo = (diaDaSemana(dia) - inicio + 7) % 7;
  return somarDias(dia, -recuo);
}

const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const SEMANA_CURTA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** 'sex, 26/09' @param {string} dia */
export function formatoCurto(dia) {
  const [, m, d] = dia.split('-');
  return `${SEMANA_CURTA[diaDaSemana(dia)]}, ${d}/${m}`;
}

/** Texto falável/relativo: 'hoje', 'amanhã', 'sexta', '10/10'. @param {string} dia @param {string} hoje */
export function formatoRelativo(dia, hoje) {
  const n = diferencaDias(hoje, dia);
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  if (n > 1 && n < 7) return SEMANA[diaDaSemana(dia)];
  const [, m, d] = dia.split('-');
  return `${d}/${m}`;
}

export { SEMANA };
