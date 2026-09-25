// @ts-check
// Estado inicial da casa. Membros e hábitos são o ponto de partida combinado na Fase 0 (editáveis
// no app). Mercado, pendências e histórico são EXEMPLOS (origem 'exemplo') para o painel não
// nascer vazio; a ação `exemplos.remover` (botão nos Ajustes, com desfazer) apaga só isso.

import { estadoVazio } from './acoes.js';
import { somarDias, inicioDaSemana } from './datas.js';

/** @param {string} hoje @param {{ exemplos?: boolean }} [op] */
export function semente(hoje, op = { exemplos: true }) {
  const e = estadoVazio();
  e.casa.nome = 'Casa';
  e.membros = [
    { id: 'm', tipo: 'pessoa', nome: 'Matheus', cor: '#2F62B0', emoji: '🦉' },
    { id: 'k', tipo: 'pessoa', nome: 'Karen', cor: '#3C8A43', emoji: '🌿' },
    { id: 'a', tipo: 'pet', nome: 'Anakin', cor: '#8A6D4E', emoji: '🐕' },
    { id: 'c', tipo: 'pet', nome: 'Chihiro', cor: '#5A4A3A', emoji: '🐾' },
  ];
  const inicio = somarDias(hoje, -60);
  e.habitos = [
    { id: 'agua', membro: 'm', nome: 'Água', emoji: '💧', tipo: 'qtd', meta: 2000, unidade: 'ml', passo: 250, apelidos: ['agua', 'beber agua', 'bebi agua', 'bebi'], ordem: 0 },
    { id: 'treino', membro: 'm', nome: 'Treino', emoji: '🏋️', tipo: 'semana', vezes_semana: 3, apelidos: ['treinei', 'treinar', 'academia', 'malhei', 'fui na academia'], ordem: 1 },
    { id: 'doce', membro: 'm', nome: 'Sem doce', emoji: '🍫', tipo: 'evitar', apelidos: ['doce', 'comi doce', 'comi chocolate', 'chocolate'], ordem: 2 },
    { id: 'meditar', membro: 'k', nome: 'Meditar', emoji: '🧘', tipo: 'check', apelidos: ['meditei', 'meditacao', 'meditar'], ordem: 3 },
    { id: 'ler', membro: 'k', nome: 'Ler 20 min', emoji: '📖', tipo: 'check', apelidos: ['li', 'ler', 'leitura', 'lendo'], ordem: 4 },
    { id: 'passeio', membro: 'a', nome: 'Passear', emoji: '🦮', tipo: 'check', apelidos: ['passeei', 'passeio', 'passear com o anakin', 'passeei com o anakin', 'levei o anakin'], ordem: 5 },
    { id: 'remedio', membro: 'c', nome: 'Remédio', emoji: '💊', tipo: 'check', apelidos: ['remedio da chihiro', 'dei o remedio', 'dei remedio', 'remedio'], ordem: 6 },
  ].map((h) => ({ arquivado: false, criado_em: inicio, ...h }));

  if (!op.exemplos) return e;

  // Histórico de exemplo: determinístico, para sequências e heatmaps terem o que mostrar.
  let n = 0;
  const ev = (habito, data, valor = 1, por = 'm') => e.eventos.push({ id: `ex${++n}`, habito, data, valor, por, em: `${data}T12:00:00.000Z`, origem: 'exemplo' });
  for (let i = 1; i <= 40; i++) {
    const d = somarDias(hoje, -i);
    if (i <= 6 || i % 5) { ev('agua', d, 1250, 'm'); ev('agua', d, 1000, 'm'); }
    if (i <= 12 || i % 4) ev('meditar', d, 1, 'k');
    if (i <= 3 || i % 3 === 0) ev('ler', d, 1, 'k');
    if (i <= 8 || i % 6) ev('passeio', d, 1, i % 2 ? 'k' : 'm');
    if (i <= 15) ev('remedio', d, 1, 'k');
  }
  ev('agua', hoje, 1250, 'm');
  ev('meditar', hoje, 1, 'k');
  ev('passeio', hoje, 1, 'k');
  // treino: 3 por semana nas últimas 4 semanas, 2 nesta
  const semana = inicioDaSemana(hoje, 1);
  for (let s = 1; s <= 4; s++) for (const off of [0, 2, 4]) ev('treino', somarDias(semana, -7 * s + off), 1, 'm');
  for (const off of [0, 2]) { const d = somarDias(semana, off); if (d < hoje) ev('treino', d, 1, 'm'); }
  ev('doce', somarDias(hoje, -5), 1, 'm');
  ev('doce', somarDias(hoje, -23), 1, 'm');

  const item = (nome, qtd, secao, por, comprado) => ({
    id: `exm${++n}`, nome, nome_norm: nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(), qtd, secao,
    adicionado_por: por, em: `${hoje}T09:00:00.000Z`, comprado_em: comprado ? `${hoje}T10:00:00.000Z` : null, comprado_por: comprado ? por : null, origem: 'exemplo',
  });
  e.mercado = [
    item('Leite', '2', 'Frios e laticínios', 'k'), item('Pão francês', '6', 'Padaria', 'm'), item('Ovos', '2 dúzias', 'Frios e laticínios', 'm'),
    item('Banana', '1 cacho', 'Hortifrúti', 'k'), item('Tomate', '', 'Hortifrúti', 'k'), item('Ração', '10 kg', 'Pet', 'm'),
    item('Sabão em pó', '', 'Limpeza', 'k'), item('Papel higiênico', '', 'Higiene', 'm'), item('Café', '500 g', 'Mercearia', 'm'),
    item('Queijo minas', '', 'Frios e laticínios', 'k', true), item('Arroz', '5 kg', 'Mercearia', 'k', true),
  ];
  for (const i of e.mercado) e.catalogo[i.nome_norm] = { nome: i.nome, secao: i.secao, vezes: 3, ultimo: hoje };
  const pend = (titulo, resp, dias, nota = '') => ({
    id: `exp${++n}`, titulo, resp, prazo: dias === null ? null : somarDias(hoje, dias), nota,
    criada_por: 'm', em: `${hoje}T08:00:00.000Z`, concluida_em: null, concluida_por: null, origem: 'exemplo',
  });
  e.pendencias = [
    pend('Pagar o IPTU', 'm', -2), pend('Vacina da Chihiro', 'k', 0), pend('Ligar pro encanador', null, 0, 'Vazamento embaixo da pia'),
    pend('Trocar filtro da água', 'm', 3), pend('Banho do Anakin', 'k', 5), pend('Doar roupas', null, null),
  ];
  e.registro = { m: { [hoje]: { humor: 4, energia: 3, destaque: 'Fechei a proposta do cliente e ainda deu tempo de correr no parque.', exemplo: true } }, k: {} };
  return e;
}
