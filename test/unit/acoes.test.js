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
  fazer('mercado.adicionar', { texto: 'kimchi' });
  assert.equal(estado.mercado[0].secao, 'Outros');
  fazer('mercado.editar', { id: estado.mercado[0].id, secao: 'Mercearia' });
  fazer('mercado.remover', { id: estado.mercado[0].id });
  fazer('mercado.adicionar', { texto: 'Kimchi' });
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

test('exemplos ricos: iguais no aparelho e no servidor, 90 dias, sem tocar no que é real', () => {
  const a = novo(); const b = novo();
  a.fazer('mercado.adicionar', { texto: 'tapioca' });           // dado real
  a.fazer('habito.marcar', { habito: 'meditar' });               // dado real de hoje
  b.fazer('mercado.adicionar', { texto: 'tapioca' });
  b.fazer('habito.marcar', { habito: 'meditar' });
  a.fazer('exemplos.gerar');
  b.fazer('exemplos.gerar');
  assert.equal(JSON.stringify(a.estado.eventos), JSON.stringify(b.estado.eventos), 'determinístico');
  assert.ok(a.estado.habitos.filter((h) => h.exemplo).length >= 8);
  assert.ok(a.estado.eventos.length > 500);
  assert.ok(Object.keys(a.estado.registro.k).length > 50);
  assert.equal(a.estado.eventos.filter((e) => e.habito === 'meditar' && e.data === HOJE).length, 1, 'não duplica o que já foi marcado hoje');
  // gerar de novo não acumula
  const n = a.estado.eventos.length;
  a.fazer('exemplos.gerar');
  assert.equal(a.estado.eventos.length, n);
  // remover deixa só o real
  a.fazer('exemplos.remover');
  assert.equal(a.estado.habitos.filter((h) => h.exemplo).length, 0);
  assert.deepEqual(a.estado.eventos.map((e) => e.habito), ['meditar']);
  assert.deepEqual(a.estado.mercado.map((i) => i.nome), ['Tapioca']);
  assert.equal(Object.values(a.estado.registro.k).filter((r) => r.exemplo).length, 0);
});

test('destaque do dia é privado: vai para o privado e o painel da casa não vê', () => {
  const { estado, fazer } = novo('k');
  fazer('privado.salvar', { campos: { destaque: 'Plantei manjericão' } });
  fazer('registro.salvar', { campos: { humor: 4 } });
  assert.equal(estado.privado.k[HOJE].destaque, 'Plantei manjericão');
  assert.equal(estado.registro.k[HOJE].destaque, undefined);
  assert.deepEqual(filtrarPara(estado, 'casa').privado, {});
  assert.deepEqual(filtrarPara(estado, 'm').privado, {});
  // cliente antigo mandando destaque pelo registro: vai para o privado mesmo assim
  fazer('registro.salvar', { campos: { destaque: 'Pão caseiro deu certo' } });
  assert.equal(estado.privado.k[HOJE].destaque, 'Pão caseiro deu certo');
  assert.equal(estado.registro.k[HOJE].destaque, undefined);
  // por voz: substitui, não acumula
  fazer('captura', { texto: 'destaque do dia: caminhada no parque' });
  assert.equal(estado.privado.k[HOJE].destaque, 'caminhada no parque');
});

test('aniversário: repete todo ano; concluir empurra para o ano que vem; desfazer volta', async () => {
  const { estado, fazer } = novo('k');
  fazer('pendencia.criar', { titulo: 'Aniversário da Ju', prazo: '2026-10-10', repete: 'anual', aviso_dias: 14, icone: '🎂' });
  const p = estado.pendencias[0];
  const r = fazer('pendencia.concluir', { id: p.id });
  assert.equal(p.prazo, '2027-10-10');
  assert.equal(p.concluida_em, null, 'não some: volta no ano seguinte');
  assert.match(r.fala, /volta em 10\/10\/2027/);
  fazer(r.desfazer.tipo, r.desfazer.dados);
  assert.equal(p.prazo, '2026-10-10');
  assert.throws(() => fazer('pendencia.criar', { titulo: 'X', repete: 'anual' }), /precisa de dia/);
});

test('aviso: a pendência só aparece N dias antes; sem aviso aparece sempre', async () => {
  const { pendenciaVisivel, proximoAno } = await import('../../src/dominio/acoes.js');
  const niver = { prazo: '2026-10-10', aviso_dias: 14 };
  assert.equal(pendenciaVisivel(niver, '2026-09-24'), false, '16 dias antes: ainda escondido');
  assert.equal(pendenciaVisivel(niver, '2026-09-26'), true, '14 dias antes: aparece');
  assert.equal(pendenciaVisivel({ prazo: '2027-01-01' }, HOJE), true);
  assert.equal(pendenciaVisivel({ prazo: null, aviso_dias: 3 }, HOJE), true);
  assert.equal(pendenciaVisivel({ prazo: HOJE, concluida_em: 'x' }, HOJE), false);
  assert.equal(proximoAno('2028-02-29'), '2029-02-28');
  assert.equal(proximoAno('2027-02-28'), '2028-02-28');
});

test('teste de estresse: muito de tudo, e remover limpa tudo (inclusive privado de exemplo)', () => {
  const { estado, fazer } = novo('m');
  fazer('privado.salvar', { campos: { texto: 'meu diário de verdade' } });
  fazer('exemplos.gerar', { estresse: true });
  assert.ok(estado.habitos.filter((h) => h.membro === 'k').length >= 12);
  assert.ok(estado.mercado.length >= 60);
  assert.ok(estado.pendencias.length >= 40);
  assert.ok(estado.pendencias.some((p) => p.repete === 'anual' && p.icone === '🎁'));
  assert.ok(estado.mercado.every((i) => i.secao), 'toda compra tem seção');
  fazer('exemplos.remover');
  assert.equal(estado.habitos.filter((h) => h.exemplo).length, 0);
  assert.equal(estado.mercado.length, 0);
  assert.equal(estado.privado.m[HOJE].texto, 'meu diário de verdade', 'o real fica');
  assert.equal(Object.values(estado.privado.k || {}).length, 0);
});

test('catálogo: esquecer item digitado errado tira da grade e da lista; desfazer volta', () => {
  const { estado, fazer } = novo();
  fazer('mercado.adicionar', { texto: 'leitee' });
  const r = fazer('catalogo.remover', { nome: 'Leitee' });
  assert.equal(estado.catalogo.leitee, undefined);
  assert.equal(estado.mercado.length, 0);
  fazer(r.desfazer.tipo, r.desfazer.dados);
  assert.ok(estado.catalogo.leitee);
  assert.equal(estado.mercado.length, 1);
});

test('ação desconhecida é recusada', () => {
  const { fazer } = novo();
  assert.throws(() => fazer('apagar.tudo', {}), /desconhecida/);
});
