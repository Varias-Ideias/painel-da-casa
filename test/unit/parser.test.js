// Tabela de frases reais em pt-BR (briefing §4). Cada linha: frase → o que o parser tem de entender.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretar, extrairPrazo } from '../../src/dominio/parser.js';
import { semente } from '../../src/dominio/semente.js';

const HOJE = '2026-09-24'; // quinta
const S = semente(HOJE, { exemplos: false });
const ctx = (quem = 'm') => ({ hoje: HOJE, quem, habitos: S.habitos, membros: S.membros, catalogo: {} });

const merc = (...nomes) => ({ tipo: 'mercado', nomes });
const pend = (titulo, prazo = null) => ({ tipo: 'pendencia', titulo, prazo });
const hab = (habito, acao, valor) => ({ tipo: 'habito', habito, acao, ...(valor !== undefined ? { valor } : {}) });
const reg = (campos) => ({ tipo: 'registro', campos });
const priv = (campos) => ({ tipo: 'privado', campos });
const AMB = { tipo: 'ambiguo' };

const CASOS = [
  // mercado
  ['leite, pão e 2 dúzias de ovos', merc('Leite', 'Pão', 'Ovos')],
  ['adiciona sabão em pó na lista', merc('Sabão em pó')],
  ['comprar papel higiênico', merc('Papel higiênico')],
  ['acabou o café', merc('Café')],
  ['falta arroz e feijão', merc('Arroz', 'Feijão')],
  ['coloca 2 litros de leite no mercado', merc('Leite')],
  ['tomate', merc('Tomate')],
  ['comprar água', merc('Água')],
  ['sabão em pó', merc('Sabão em pó')],
  ['banana, maçã e 1 kg de carne moída', merc('Banana', 'Maçã', 'Carne moída')],
  ['ração do anakin', merc('Ração do anakin')],
  ['ovos', merc('Ovos')],
  ['adiciona pão, leite e café', merc('Pão', 'Leite', 'Café')],
  ['mercado: detergente', merc('Detergente')],
  ['põe uns tomates na lista', merc('Tomates')],
  ['preciso comprar leite', merc('Leite')],
  // pendências e datas relativas
  ['pendência: pagar o IPTU até sexta', pend('Pagar o IPTU', '2026-09-25')],
  ['lembrar de ligar pro encanador', pend('Ligar pro encanador')],
  ['tarefa: renovar CNH dia 10', pend('Renovar CNH', '2026-10-10')],
  ['pendência: consulta do Anakin amanhã', pend('Consulta do Anakin', '2026-09-25')],
  ['tenho que pagar a luz até segunda', pend('Pagar a luz', '2026-09-28')],
  ['preciso levar o carro na revisão', pend('Levar o carro na revisão')],
  ['lembra de comprar ração amanhã', pend('Comprar ração', '2026-09-25')],
  ['pendência: dar banho no Anakin na sexta', pend('Dar banho no Anakin', '2026-09-25')],
  ['pendencia: marcar dentista hoje', pend('Marcar dentista', '2026-09-24')],
  ['tarefa: trocar a lâmpada da sala até 02/10', pend('Trocar a lâmpada da sala', '2026-10-02')],
  // hábitos
  ['bebi 500 ml de água', hab('agua', 'somar', 500)],
  ['bebi água', hab('agua', 'somar', 250)],
  ['bebi 2 copos de água', hab('agua', 'somar', 500)],
  ['bebi meio litro de água', hab('agua', 'somar', 500)],
  ['bebi 1,5 l de água', hab('agua', 'somar', 1500)],
  ['treinei hoje', hab('treino', 'marcar')],
  ['fui na academia', hab('treino', 'marcar')],
  ['meditei', hab('meditar', 'marcar')],
  ['li 20 páginas', hab('ler', 'marcar')],
  ['comi doce', hab('doce', 'deslize')],
  ['passeei com o anakin', hab('passeio', 'marcar')],
  ['dei o remédio da chihiro', hab('remedio', 'marcar')],
  // registro do dia
  ['humor 4, energia 3', reg({ humor: 4, energia: 3 })],
  ['energia 2', reg({ energia: 2 })],
  ['humor 5', reg({ humor: 5 })],
  ['destaque do dia: terminei o relatório', reg({ destaque: 'terminei o relatório' })],
  ['diário: dia puxado mas bom', priv({ texto: 'dia puxado mas bom' })],
  ['gratidão: o almoço com a família', priv({ gratidao: 'o almoço com a família' })],
  // ambíguas: o sistema pergunta em vez de chutar
  ['água', AMB],
  ['dormi 7 horas', AMB],
  ['não treinei', AMB],
  ['bla bla bla', AMB],
  ['', AMB],
  ['humor 9', AMB],
];

test(`tabela do parser tem pelo menos 40 frases (${CASOS.length})`, () => {
  assert.ok(CASOS.length >= 40);
});

for (const [frase, esperado] of CASOS) {
  test(`parser: "${frase}"`, () => {
    const r = interpretar(frase, ctx());
    assert.equal(r.tipo, esperado.tipo, JSON.stringify(r));
    if (esperado.tipo === 'mercado') assert.deepEqual(r.itens.map((i) => i.nome), esperado.nomes);
    if (esperado.tipo === 'pendencia') { assert.equal(r.titulo, esperado.titulo); assert.equal(r.prazo, esperado.prazo); }
    if (esperado.tipo === 'habito') {
      assert.equal(r.habito, esperado.habito);
      assert.equal(r.acao, esperado.acao);
      if (esperado.valor !== undefined) assert.equal(r.valor, esperado.valor);
    }
    if (esperado.tipo === 'registro' || esperado.tipo === 'privado') assert.deepEqual(r.campos, esperado.campos);
    if (esperado.tipo === 'ambiguo') assert.ok(r.pergunta && r.pergunta.length > 5, 'ambígua precisa de pergunta');
  });
}

test('parser: quantidades do mercado', () => {
  const r = interpretar('leite, pão e 2 dúzias de ovos', ctx());
  assert.deepEqual(r.itens.map((i) => i.qtd), ['', '', '2 dúzias']);
  assert.equal(interpretar('coloca 2 litros de leite no mercado', ctx()).itens[0].qtd, '2 litros');
  assert.equal(interpretar('banana, maçã e 1 kg de carne moída', ctx()).itens[2].qtd, '1 kg');
});

test('parser: "até sexta" dita na própria sexta é hoje', () => {
  assert.equal(extrairPrazo('pagar até sexta', '2026-09-25').prazo, '2026-09-25');
});

test('parser: "dia 10" já passado no mês vai para o mês seguinte, e dezembro vira janeiro', () => {
  assert.equal(extrairPrazo('renovar dia 10', '2026-12-20').prazo, '2027-01-10');
  assert.equal(extrairPrazo('renovar dia 25', HOJE).prazo, '2026-09-25');
});

test('parser: hábito com o mesmo apelido para duas pessoas pergunta de quem é', () => {
  const habitos = [...S.habitos, { id: 'ler2', membro: 'm', nome: 'Ler', tipo: 'check', apelidos: ['li', 'ler'] }];
  const r = interpretar('li', { hoje: HOJE, quem: 'casa', habitos, membros: S.membros, catalogo: {} });
  assert.equal(r.tipo, 'ambiguo');
  const r2 = interpretar('li', { hoje: HOJE, quem: 'm', habitos, membros: S.membros, catalogo: {} });
  assert.equal(r2.tipo, 'habito');
  assert.equal(r2.habito, 'ler2', 'quem fala desempata');
});
