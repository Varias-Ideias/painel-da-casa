import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicar, filtrarPara, ErroAcao } from '../../src/dominio/acoes.js';
import { semente } from '../../src/dominio/semente.js';
import { estadoHabito } from '../../src/dominio/habitos.js';

const HOJE = '2026-09-24';
function novo(quem = 'm') {
  const estado = semente(HOJE, { exemplos: false });
  let n = 0;
  const ctx = { quem, agora: '2026-09-24T15:00:00.000Z', hoje: HOJE, novoId: () => `id${++n}` };
  const fazer = (tipo, dados, c = ctx) => aplicar(estado, { tipo, dados }, c);
  return { estado, ctx, fazer };
}
const estadoDe = (estado, id) => estadoHabito(estado.habitos.find((h) => h.id === id), estado.eventos.filter((e) => e.habito === id), HOJE);

test('captura: mercado com três itens e frase falável', () => {
  const { estado, fazer } = novo();
  const r = fazer('captura', { texto: 'leite, pão e 2 dúzias de ovos' });
  assert.equal(estado.mercado.length, 3);
  assert.equal(r.fala, 'Anotei leite, pão e ovos no mercado.');
  assert.equal(estado.mercado.find((i) => i.nome === 'Ovos').qtd, '2 dúzias');
  assert.equal(estado.mercado.find((i) => i.nome === 'Pão').secao, 'Padaria');
});

test('mercado: não duplica e avisa', () => {
  const { estado, fazer } = novo();
  fazer('mercado.adicionar', { texto: 'leite' });
  const r = fazer('mercado.adicionar', { texto: 'Leite, café' });
  assert.equal(estado.mercado.length, 2);
  assert.match(r.fala, /Leite já estava na lista/);
});

test('mercado: item comprado volta para a lista em vez de duplicar', () => {
  const { estado, fazer } = novo();
  fazer('mercado.adicionar', { texto: 'leite' });
  fazer('mercado.alternar', { id: estado.mercado[0].id });
  fazer('mercado.adicionar', { texto: 'leite' });
  assert.equal(estado.mercado.length, 1);
  assert.equal(estado.mercado[0].comprado_em, null);
});

test('mercado: mover de seção ensina a próxima vez', () => {
  const { estado, fazer } = novo();
  fazer('mercado.adicionar', { texto: 'tapioca' });
  assert.equal(estado.mercado[0].secao, 'Outros');
  fazer('mercado.editar', { id: estado.mercado[0].id, secao: 'Mercearia' });
  fazer('mercado.remover', { id: estado.mercado[0].id });
  fazer('mercado.adicionar', { texto: 'Tapioca' });
  assert.equal(estado.mercado[0].secao, 'Mercearia');
});

test('desfazer: cada ação devolve o inverso que restaura o estado', () => {
  const { estado, fazer } = novo();
  fazer('mercado.adicionar', { texto: 'leite, café' });
  const antes = JSON.stringify(estado.mercado);
  const r = fazer('mercado.alternar', { id: estado.mercado[0].id });
  fazer(r.desfazer.tipo, r.desfazer.dados);
  assert.equal(JSON.stringify(estado.mercado), antes);

  fazer('mercado.alternar', { id: estado.mercado[0].id });
  const limpo = fazer('mercado.limpar');
  assert.equal(estado.mercado.length, 1);
  fazer(limpo.desfazer.tipo, limpo.desfazer.dados);
  assert.equal(estado.mercado.length, 2);

  const add = fazer('mercado.adicionar', { texto: 'banana' });
  fazer(add.desfazer.tipo, add.desfazer.dados);
  assert.equal(estado.mercado.length, 2);
});

test('hábito check: marcar alterna; desfazer volta', () => {
  const { estado, fazer } = novo('k');
  const r = fazer('habito.marcar', { habito: 'meditar' });
  assert.equal(estadoDe(estado, 'meditar').feito, true);
  fazer(r.desfazer.tipo, r.desfazer.dados);
  assert.equal(estadoDe(estado, 'meditar').feito, false);
  fazer('habito.marcar', { habito: 'meditar' });
  fazer('habito.marcar', { habito: 'meditar' });
  assert.equal(estadoDe(estado, 'meditar').feito, false, 'segundo toque desmarca');
});

test('hábito: corrigir ontem', () => {
  const { estado, fazer } = novo('k');
  fazer('habito.marcar', { habito: 'meditar', data: '2026-09-23' });
  fazer('habito.marcar', { habito: 'meditar' });
  assert.equal(estadoDe(estado, 'meditar').seq, 2);
});

test('captura de hábito: "bebi 500 ml de água" soma e fala o total', () => {
  const { estado, fazer } = novo();
  fazer('habito.somar', { habito: 'agua', valor: 1000 });
  const r = fazer('captura', { texto: 'bebi 500 ml de água' });
  assert.equal(estadoDe(estado, 'agua').valor, 1500);
  assert.equal(r.fala, 'Água: 1,5 de 2 litros.');
});

test('captura: "treinei" duas vezes não desmarca', () => {
  const { estado, fazer } = novo();
  fazer('captura', { texto: 'treinei' });
  const r = fazer('captura', { texto: 'treinei' });
  assert.equal(estadoDe(estado, 'treino').feitoHoje, true);
  assert.match(r.fala, /já estava marcado/);
});

test('captura: pendência com prazo fala o dia', () => {
  const { estado, fazer } = novo();
  const r = fazer('captura', { texto: 'pendência: pagar o IPTU até sexta' });
  assert.equal(estado.pendencias[0].prazo, '2026-09-25');
  assert.equal(r.fala, 'Anotei a pendência pagar o IPTU para amanhã.');
});

test('captura ambígua não muda nada e pergunta', () => {
  const { estado, fazer } = novo();
  const antes = JSON.stringify(estado);
  const r = fazer('captura', { texto: 'água' });
  assert.equal(JSON.stringify(estado), antes);
  assert.equal(r.desfazer, null);
  assert.match(r.fala, /mercado ou para o hábito/);
});

test('privacidade: o painel da casa não escreve nem lê o diário', () => {
  const { estado, fazer } = novo('m');
  fazer('privado.salvar', { campos: { texto: 'segredo' } });
  const casa = { quem: 'casa', agora: '2026-09-24T15:00:00.000Z', hoje: HOJE, novoId: () => 'x' };
  assert.throws(() => aplicar(estado, { tipo: 'privado.salvar', dados: { campos: { texto: 'x' } } }, casa), ErroAcao);
  assert.deepEqual(filtrarPara(estado, 'casa').privado, {});
  assert.deepEqual(filtrarPara(estado, 'k').privado, {}, 'a Karen não vê o diário do Matheus');
  assert.equal(filtrarPara(estado, 'm').privado.m[HOJE].texto, 'segredo');
});

test('privacidade: tokens e log nunca saem para o aparelho', () => {
  const { estado } = novo();
  estado.tokens = [{ hash: 'abc' }];
  estado.capturas = [{ texto: 'x' }];
  const v = filtrarPara(estado, 'm');
  assert.equal(v.tokens, undefined);
  assert.equal(v.capturas, undefined);
});

test('registro: pessoa só edita o próprio; o painel edita o de todos; escala 1–5', () => {
  const { estado, fazer } = novo('k');
  assert.throws(() => fazer('registro.salvar', { membro: 'm', campos: { humor: 3 } }), /próprio/);
  fazer('registro.salvar', { campos: { humor: 4 } });
  assert.equal(estado.registro.k[HOJE].humor, 4);
  const casa = { quem: 'casa', agora: '', hoje: HOJE, novoId: () => 'x' };
  aplicar(estado, { tipo: 'registro.salvar', dados: { membro: 'm', campos: { energia: 2 } } }, casa);
  assert.equal(estado.registro.m[HOJE].energia, 2);
  assert.throws(() => fazer('registro.salvar', { campos: { humor: 7 } }), /1 a 5/);
  assert.throws(() => aplicar(estado, { tipo: 'registro.salvar', dados: { membro: 'a', campos: { humor: 3 } } }, casa), /Pessoa inválida/);
});

test('diário por voz anexa em vez de apagar o que já tinha', () => {
  const { estado, fazer } = novo('m');
  fazer('captura', { texto: 'diário: manhã boa' });
  fazer('captura', { texto: 'diário: tarde corrida' });
  assert.equal(estado.privado.m[HOJE].texto, 'manhã boa\ntarde corrida');
});

test('pendências: concluir e reabrir', () => {
  const { estado, fazer } = novo();
  fazer('pendencia.criar', { titulo: 'Ligar pro encanador' });
  const r = fazer('pendencia.concluir', { id: estado.pendencias[0].id });
  assert.ok(estado.pendencias[0].concluida_em);
  fazer(r.desfazer.tipo, r.desfazer.dados);
  assert.equal(estado.pendencias[0].concluida_em, null);
  assert.throws(() => fazer('pendencia.criar', { titulo: '  ' }), /título/);
});

test('hábitos: criar, validar e arquivar', () => {
  const { estado, fazer } = novo();
  fazer('habito.salvar', { habito: { nome: 'Alongar', emoji: '🤸', tipo: 'check', membro: 'm' } });
  assert.equal(estado.habitos.at(-1).nome, 'Alongar');
  assert.throws(() => fazer('habito.salvar', { habito: { nome: 'X', tipo: 'outro', membro: 'm' } }), /Tipo/);
  assert.throws(() => fazer('habito.salvar', { habito: { nome: 'X', tipo: 'check', membro: 'zz' } }), /Dono/);
  fazer('habito.arquivar', { id: estado.habitos.at(-1).id, arquivado: true });
  assert.equal(estado.habitos.at(-1).arquivado, true);
});

test('ação desconhecida é recusada', () => {
  const { fazer } = novo();
  assert.throws(() => fazer('apagar.tudo', {}), /desconhecida/);
});
