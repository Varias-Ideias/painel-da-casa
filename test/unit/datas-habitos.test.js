import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hojeNoFuso, somarDias, diferencaDias, diaDaSemana, inicioDaSemana, formatoRelativo } from '../../src/dominio/datas.js';
import { estadoHabito, historico } from '../../src/dominio/habitos.js';

const HOJE = '2026-09-24'; // quinta-feira
const ev = (habito, ...dias) => dias.map((d) => ({ habito, data: typeof d === 'number' ? somarDias(HOJE, d) : d, valor: 1 }));

test('datas: dia da semana e semana começando na segunda', () => {
  assert.equal(diaDaSemana(HOJE), 4);
  assert.equal(inicioDaSemana(HOJE, 1), '2026-09-21');
  assert.equal(inicioDaSemana('2026-09-27', 1), '2026-09-21', 'domingo pertence à semana que começou na segunda anterior');
  assert.equal(inicioDaSemana('2026-09-28', 1), '2026-09-28');
  assert.equal(inicioDaSemana(HOJE, 0), '2026-09-20', 'semana começando no domingo');
});

test('datas: viradas de mês e de ano', () => {
  assert.equal(somarDias('2026-09-30', 1), '2026-10-01');
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(somarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(diferencaDias('2026-09-24', '2026-10-01'), 7);
});

test('datas: "hoje" é no fuso da casa, não em UTC', () => {
  // 23h30 de 24/09 em São Paulo = 02h30 de 25/09 em UTC
  assert.equal(hojeNoFuso('America/Sao_Paulo', new Date('2026-09-25T02:30:00Z')), '2026-09-24');
  assert.equal(hojeNoFuso('America/Sao_Paulo', new Date('2026-09-25T03:30:00Z')), '2026-09-25');
});

test('datas: formato relativo', () => {
  assert.equal(formatoRelativo(HOJE, HOJE), 'hoje');
  assert.equal(formatoRelativo('2026-09-25', HOJE), 'amanhã');
  assert.equal(formatoRelativo('2026-09-28', HOJE), 'segunda');
  assert.equal(formatoRelativo('2026-10-10', HOJE), '10/10');
});

test('check: dias seguidos; hoje ainda não feito não quebra', () => {
  const h = { id: 'x', tipo: 'check' };
  assert.deepEqual(estadoHabito(h, ev('x', -1, -2, -3), HOJE), { tipo: 'check', feito: false, seq: 3, recorde: 3 });
  assert.equal(estadoHabito(h, ev('x', 0, -1, -2, -3), HOJE).seq, 4);
  assert.equal(estadoHabito(h, ev('x', 0, -1, -3), HOJE).seq, 2, 'um buraco quebra');
  assert.equal(estadoHabito(h, ev('x', -2, -3), HOJE).seq, 0, 'ontem sem fazer quebra');
});

test('check: recorde guarda a maior sequência antiga', () => {
  const h = { id: 'x', tipo: 'check' };
  const s = estadoHabito(h, ev('x', 0, -10, -11, -12, -13, -14), HOJE);
  assert.equal(s.seq, 1);
  assert.equal(s.recorde, 5);
});

test('qtd: só conta o dia que bateu a meta, somando vários registros', () => {
  const h = { id: 'agua', tipo: 'qtd', meta: 2000 };
  const eventos = [
    { habito: 'agua', data: HOJE, valor: 500 }, { habito: 'agua', data: HOJE, valor: 750 },
    { habito: 'agua', data: somarDias(HOJE, -1), valor: 2000 },
    { habito: 'agua', data: somarDias(HOJE, -2), valor: 1000 }, { habito: 'agua', data: somarDias(HOJE, -2), valor: 1000 },
    { habito: 'agua', data: somarDias(HOJE, -3), valor: 1999 },
  ];
  const s = estadoHabito(h, eventos, HOJE);
  assert.equal(s.valor, 1250);
  assert.equal(s.feito, false);
  assert.equal(s.seq, 2, '1.999 ml não bate a meta');
  eventos.push({ habito: 'agua', data: HOJE, valor: 750 });
  assert.equal(estadoHabito(h, eventos, HOJE).seq, 3);
});

test('qtd: correção negativa (desfazer) tira do total', () => {
  const h = { id: 'agua', tipo: 'qtd', meta: 2000 };
  const s = estadoHabito(h, [{ habito: 'agua', data: HOJE, valor: 2000 }, { habito: 'agua', data: HOJE, valor: -250 }], HOJE);
  assert.equal(s.valor, 1750);
  assert.equal(s.feito, false);
});

test('semana: 3x por semana; dias livres não quebram; semana atual incompleta não quebra', () => {
  const h = { id: 't', tipo: 'semana', vezes_semana: 3 };
  // semana atual (21–27/09): seg e qua. Semanas anteriores: 14–20 e 7–13 com 3 cada.
  const eventos = ev('t', '2026-09-21', '2026-09-23', '2026-09-14', '2026-09-16', '2026-09-20', '2026-09-07', '2026-09-08', '2026-09-09');
  const s = estadoHabito(h, eventos, HOJE);
  assert.equal(s.feitosSemana, 2);
  assert.equal(s.seq, 2);
  assert.equal(s.feitoHoje, false);
  eventos.push(...ev('t', HOJE));
  const s2 = estadoHabito(h, eventos, HOJE);
  assert.equal(s2.feitosSemana, 3);
  assert.equal(s2.seq, 3);
});

test('semana: uma semana abaixo da meta quebra a sequência', () => {
  const h = { id: 't', tipo: 'semana', vezes_semana: 3 };
  const eventos = ev('t', '2026-09-14', '2026-09-16', '2026-09-07', '2026-09-08', '2026-09-09', '2026-08-31', '2026-09-01', '2026-09-02');
  const s = estadoHabito(h, eventos, HOJE);
  assert.equal(s.seq, 0, 'semana 14–20 teve só 2');
  assert.equal(s.recorde, 2);
});

test('semana: virada de semana com treino no domingo', () => {
  const h = { id: 't', tipo: 'semana', vezes_semana: 3 };
  const seg = '2026-09-28';
  const s = estadoHabito(h, ev('t', '2026-09-21', '2026-09-23', '2026-09-27'), seg);
  assert.equal(s.feitosSemana, 0, 'segunda começa semana nova');
  assert.equal(s.seq, 1, 'o domingo fechou a semana anterior com 3');
});

test('semana: dois registros no mesmo dia contam uma vez', () => {
  const h = { id: 't', tipo: 'semana', vezes_semana: 3 };
  const s = estadoHabito(h, ev('t', '2026-09-21', '2026-09-21', '2026-09-22'), HOJE);
  assert.equal(s.feitosSemana, 2);
});

test('evitar: dias desde o último deslize', () => {
  const h = { id: 'd', tipo: 'evitar', criado_em: '2026-08-15' };
  assert.equal(estadoHabito(h, ev('d', -5), HOJE).diasSem, 5);
  assert.equal(estadoHabito(h, ev('d', 0), HOJE).diasSem, 0);
  assert.equal(estadoHabito(h, ev('d', 0), HOJE).deslizouHoje, true);
  assert.equal(estadoHabito(h, [], HOJE).diasSem, 40, 'sem deslize conta desde a criação');
});

test('evitar: recorde é o maior intervalo entre deslizes', () => {
  const h = { id: 'd', tipo: 'evitar', criado_em: somarDias(HOJE, -40) };
  const s = estadoHabito(h, ev('d', -30, -5), HOJE);
  assert.equal(s.diasSem, 5);
  assert.equal(s.recorde, 25);
});

test('historico: 56 dias terminando hoje', () => {
  const h = { id: 'x', tipo: 'check' };
  const hs = historico(h, ev('x', 0, -1), HOJE);
  assert.equal(hs.length, 56);
  assert.equal(hs[55].dia, HOJE);
  assert.equal(hs[55].ok, true);
  assert.equal(hs[54].ok, true);
  assert.equal(hs[53].ok, false);
});
