// @ts-check
// Regras de sequência dos quatro tipos de hábito. Funções puras: recebem os eventos e o dia de
// hoje (no fuso da casa) e devolvem o estado. O estado do dia vem SEMPRE da agregação dos eventos.
//
// Tipos:
//   check  — feito / não feito. Sequência: dias seguidos feitos.
//   qtd    — com quantidade e meta. Sequência: dias seguidos em que bateu a meta.
//   semana — X vezes por semana. Sequência: semanas seguidas que bateram a meta; dia livre não quebra.
//   evitar — registra o deslize. Contador: dias desde o último deslize.
//
// Regra de "hoje ainda não acabou": se hoje ainda não está cumprido, a sequência conta até ontem
// (ou até a semana passada) sem quebrar. Só quebra quando o dia (ou a semana) termina sem cumprir.

import { somarDias, diferencaDias, inicioDaSemana } from './datas.js';

/**
 * @typedef {{ id: string, tipo: 'check'|'qtd'|'semana'|'evitar', meta?: number, vezes_semana?: number, criado_em?: string }} Habito
 * @typedef {{ habito: string, data: string, valor: number }} Evento
 */

/** Soma dos valores por dia. @param {Evento[]} eventos @returns {Map<string, number>} */
export function somaPorDia(eventos) {
  const m = new Map();
  for (const e of eventos) m.set(e.data, (m.get(e.data) || 0) + e.valor);
  return m;
}

/** O dia conta como cumprido? @param {Habito} h @param {number} soma */
function cumpre(h, soma) {
  if (h.tipo === 'qtd') return soma >= (h.meta || 1);
  return soma > 0;
}

/** Maior sequência de unidades consecutivas (dias ou semanas) de um conjunto ordenado. */
function maiorSequencia(/** @type {string[]} */ chaves, /** @type {number} */ passo) {
  const ord = [...chaves].sort();
  let melhor = 0, atual = 0, anterior = null;
  for (const c of ord) {
    atual = anterior && diferencaDias(anterior, c) === passo ? atual + 1 : 1;
    melhor = Math.max(melhor, atual);
    anterior = c;
  }
  return melhor;
}

/**
 * Estado de um hábito hoje.
 * @param {Habito} h @param {Evento[]} eventos só os deste hábito
 * @param {string} hoje @param {number} [inicioSemana] 1 = segunda
 */
export function estadoHabito(h, eventos, hoje, inicioSemana = 1) {
  const porDia = somaPorDia(eventos);
  const somaHoje = porDia.get(hoje) || 0;

  if (h.tipo === 'evitar') {
    const deslizes = [...porDia.entries()].filter(([, v]) => v > 0).map(([d]) => d).filter((d) => d <= hoje).sort();
    const ultimo = deslizes[deslizes.length - 1];
    const base = ultimo || h.criado_em || hoje;
    const diasSem = Math.max(0, diferencaDias(base, hoje));
    // recorde = maior intervalo entre deslizes, contando o trecho aberto até hoje
    let recorde = diasSem;
    let ant = h.criado_em && (!deslizes[0] || h.criado_em < deslizes[0]) ? h.criado_em : null;
    for (const d of deslizes) {
      if (ant) recorde = Math.max(recorde, diferencaDias(ant, d));
      ant = d;
    }
    return { tipo: 'evitar', deslizouHoje: somaHoje > 0, diasSem, recorde, feito: false };
  }

  if (h.tipo === 'semana') {
    const meta = h.vezes_semana || 1;
    const diasFeitos = [...porDia.entries()].filter(([, v]) => v > 0).map(([d]) => d);
    const porSemana = new Map();
    for (const d of diasFeitos) {
      const s = inicioDaSemana(d, inicioSemana);
      porSemana.set(s, (porSemana.get(s) || 0) + 1);
    }
    const estaSemana = inicioDaSemana(hoje, inicioSemana);
    const feitosSemana = porSemana.get(estaSemana) || 0;
    const ok = (/** @type {string} */ s) => (porSemana.get(s) || 0) >= meta;
    let s = ok(estaSemana) ? estaSemana : somarDias(estaSemana, -7);
    let seq = 0;
    while (ok(s)) { seq++; s = somarDias(s, -7); }
    const semanasOk = [...porSemana.keys()].filter(ok);
    return {
      tipo: 'semana', feitoHoje: somaHoje > 0, feitosSemana, meta, seq,
      recorde: Math.max(seq, maiorSequencia(semanasOk, 7)), feito: somaHoje > 0,
    };
  }

  // check e qtd
  const diasOk = [...porDia.entries()].filter(([, v]) => cumpre(h, v)).map(([d]) => d);
  const setOk = new Set(diasOk);
  let d = setOk.has(hoje) ? hoje : somarDias(hoje, -1);
  let seq = 0;
  while (setOk.has(d)) { seq++; d = somarDias(d, -1); }
  const recorde = Math.max(seq, maiorSequencia(diasOk, 1));
  if (h.tipo === 'qtd') return { tipo: 'qtd', valor: somaHoje, meta: h.meta || 1, feito: somaHoje >= (h.meta || 1), seq, recorde };
  return { tipo: 'check', feito: somaHoje > 0, seq, recorde };
}

/**
 * Últimos `n` dias (do mais antigo ao hoje), com se cumpriu cada um. Para o heatmap.
 * @param {Habito} h @param {Evento[]} eventos @param {string} hoje @param {number} [n]
 */
export function historico(h, eventos, hoje, n = 56) {
  const porDia = somaPorDia(eventos);
  return Array.from({ length: n }, (_, i) => {
    const dia = somarDias(hoje, i - n + 1);
    const soma = porDia.get(dia) || 0;
    return { dia, soma, ok: h.tipo === 'evitar' ? soma === 0 : cumpre(h, soma) };
  });
}
