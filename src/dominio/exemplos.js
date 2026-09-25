// @ts-check
// Dados de exemplo ricos: 90 dias de história da casa, para ver como o painel fica com o tempo.
// Tudo marcado (origem 'exemplo' / exemplo: true) e removível pelo botão nos Ajustes.
// Determinístico: a mesma casa no mesmo dia gera exatamente os mesmos dados no aparelho e no
// servidor (a ação roda nos dois; ids e valores precisam bater).
import { somarDias, inicioDaSemana } from './datas.js';
import { normalizar, secaoDe } from './mercado.js';

/** Gerador pseudoaleatório com semente (mulberry32). */
function rng(sementeTxt) {
  let s = 0;
  for (const c of sementeTxt) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const HABITOS_EXEMPLO = [
  { id: 'ex-k-skincare', membro: 'k', nome: 'Skincare', emoji: '🧴', tipo: 'check', apelidos: ['skincare', 'fiz skincare'] },
  { id: 'ex-k-yoga', membro: 'k', nome: 'Yoga', emoji: '🤸', tipo: 'semana', vezes_semana: 2, apelidos: ['yoga', 'fiz yoga'] },
  { id: 'ex-k-agua', membro: 'k', nome: 'Água', emoji: '💧', tipo: 'qtd', meta: 2000, unidade: 'ml', passo: 250, apelidos: [] },
  { id: 'ex-k-cafe', membro: 'k', nome: 'Sem café à noite', emoji: '☕', tipo: 'evitar', apelidos: ['tomei cafe a noite'] },
  { id: 'ex-m-ler', membro: 'm', nome: 'Ler 10 páginas', emoji: '📚', tipo: 'check', apelidos: [] },
  { id: 'ex-m-dormir', membro: 'm', nome: 'Dormir antes das 23h', emoji: '🌙', tipo: 'check', apelidos: ['dormi cedo'] },
  { id: 'ex-a-racao', membro: 'a', nome: 'Ração', emoji: '🥣', tipo: 'qtd', meta: 2, unidade: 'vezes', passo: 1, apelidos: ['dei racao pro anakin'] },
  { id: 'ex-c-passeio', membro: 'c', nome: 'Passear', emoji: '🦮', tipo: 'check', apelidos: ['passeei com a chihiro'] },
  { id: 'ex-c-dentes', membro: 'c', nome: 'Escovar dentes', emoji: '🪥', tipo: 'semana', vezes_semana: 3, apelidos: ['escovei os dentes da chihiro'] },
];

// chance de fazer em um dia qualquer, e sequência atual garantida (para o painel ter vida)
const RITMO = {
  agua: [0.8, 6], treino: [0.45, 0], doce: [0.07, 0], meditar: [0.78, 9], ler: [0.55, 2], passeio: [0.88, 12], remedio: [0.95, 15],
  'ex-k-skincare': [0.7, 4], 'ex-k-yoga': [0.3, 0], 'ex-k-agua': [0.72, 3], 'ex-k-cafe': [0.1, 0],
  'ex-m-ler': [0.5, 1], 'ex-m-dormir': [0.45, 0], 'ex-a-racao': [0.97, 20], 'ex-c-passeio': [0.8, 5], 'ex-c-dentes': [0.4, 0],
};

const DESTAQUES = {
  m: ['Fechei a proposta do cliente e ainda deu tempo de correr no parque.', 'Almoço demorado com a Karen, sem celular.', 'Consertei a torneira sozinho.',
    'Treino bom, bati meu recorde no agachamento.', 'Dia tranquilo, li no sol da tarde.', 'Reunião difícil, mas resolvi.', 'Anakin aprendeu a dar a pata.',
    'Cozinhei risoto pela primeira vez.', 'Terminei aquele livro de ficção.', 'Choveu e ficamos vendo filme.'],
  k: ['Aula de yoga no parque com a luz da manhã.', 'Plantei as mudas de manjericão.', 'Chihiro dormiu no meu colo a tarde toda.', 'Terminei o projeto antes do prazo.',
    'Café com a minha mãe.', 'Caminhada longa com os cachorros.', 'Organizei o armário, que alívio.', 'Pintei um pouco à noite.',
    'Recebi um elogio da equipe.', 'Pão caseiro deu certo!'],
};

const MERCADO = [
  ['Leite', '2', 'Frios e laticínios'], ['Pão francês', '6', 'Padaria'], ['Ovos', '2 dúzias', 'Frios e laticínios'], ['Banana', '1 cacho', 'Hortifrúti'],
  ['Tomate', '', 'Hortifrúti'], ['Abacate', '', 'Hortifrúti'], ['Manjericão', '', 'Hortifrúti'], ['Ração', '10 kg', 'Pet'], ['Petisco dental', '', 'Pet'],
  ['Sabão em pó', '', 'Limpeza'], ['Detergente', '2', 'Limpeza'], ['Papel higiênico', '', 'Higiene'], ['Café', '500 g', 'Mercearia'], ['Aveia', '', 'Mercearia'],
  ['Azeite', '', 'Mercearia'], ['Iogurte natural', '4', 'Frios e laticínios'], ['Frango', '1 kg', 'Açougue'], ['Água com gás', '6', 'Bebidas'],
];

const PENDENCIAS = [
  ['Pagar o IPTU', 'm', -2, ''], ['Vacina da Chihiro', 'k', 0, 'Clínica da Rua das Flores'], ['Ligar pro encanador', null, 0, 'Vazamento embaixo da pia'],
  ['Trocar filtro da água', 'm', 3, ''], ['Banho do Anakin', 'k', 5, ''], ['Doar roupas', null, null, ''], ['Renovar seguro do carro', 'm', 12, ''],
  ['Marcar dentista', 'k', 7, ''], ['Comprar presente da Ju', 'k', 9, 'Aniversário dia 10'], ['Consertar a porta do armário', 'm', null, ''],
  ['Levar Anakin no veterinário', 'm', 2, 'Coceira na orelha'], ['Separar reciclagem', null, 1, ''],
];

/**
 * Gera os exemplos para `hoje`. Não mexe em nada que não seja exemplo.
 * @param {any} estado @param {string} hoje
 */
// Teste de estresse: muito de tudo, para ver o layout no limite.
const ESTRESSE_ROTINAS = [['Alongar', '🤸', 'check'], ['Vitamina', '💊', 'check'], ['Sem celular na cama', '📵', 'check'], ['Caminhar', '🚶', 'qtd'],
  ['Pedalar', '🚴', 'semana'], ['Estudar inglês', '🧠', 'check'], ['Regar plantas', '🪴', 'check'], ['Sem refrigerante', '🍷', 'evitar'],
  ['Journaling', '✍️', 'check'], ['Violão', '🎸', 'semana']];
const ESTRESSE_PET = [['Escovar pelo', '🪮', 'semana'], ['Petisco dental', '🦴', 'check'], ['Brincar', '🎾', 'check']];
const ESTRESSE_MERCADO = ['Maçã', 'Cebola', 'Alho', 'Batata', 'Alface', 'Limão', 'Cenoura', 'Brócolis', 'Pepino', 'Mamão', 'Manga', 'Uva', 'Morango',
  'Pão de forma', 'Bisnaguinha', 'Carne moída', 'Peixe', 'Linguiça', 'Queijo', 'Manteiga', 'Presunto', 'Requeijão', 'Arroz', 'Feijão', 'Açúcar',
  'Macarrão', 'Molho de tomate', 'Farinha', 'Atum', 'Milho', 'Granola', 'Suco de uva', 'Refrigerante', 'Cerveja', 'Vinho', 'Amaciante',
  'Desinfetante', 'Esponja', 'Saco de lixo', 'Álcool', 'Sabonete', 'Shampoo', 'Condicionador', 'Pasta de dente', 'Fio dental', 'Desodorante',
  'Areia', 'Tapete higiênico', 'Antipulgas', 'Pilhas'];
const ESTRESSE_PENDENCIAS = ['Revisar orçamento do mês', 'Trocar lâmpada da cozinha', 'Agendar revisão do carro', 'Pagar condomínio', 'Devolver livro da Ju',
  'Ligar para a operadora', 'Comprar ração', 'Lavar as cortinas', 'Consertar a descarga', 'Renovar passaporte', 'Levar roupa na costureira',
  'Organizar fotos', 'Cancelar assinatura', 'Marcar oftalmologista', 'Trocar óleo', 'Pintar a varanda', 'Montar prateleira', 'Declarar imposto',
  'Enviar documentos do banco', 'Tirar medida da janela', 'Doar livros', 'Lavar o carro', 'Comprar vaso novo', 'Checar extintor',
  'Imprimir boletos', 'Arrumar a gaveta', 'Trocar senha do Wi-Fi', 'Ver seguro residencial', 'Levar Chihiro no banho', 'Vacina do Anakin'];

export function gerarExemplos(estado, hoje, { estresse = false } = {}) {
  const r = rng(`painel-${hoje}${estresse ? '-estresse' : ''}`);
  const DIAS = 90;
  const inicio = somarDias(hoje, -DIAS);
  const extras = [];
  if (estresse) {
    for (const m of estado.membros) {
      const base = m.tipo === 'pet' ? ESTRESSE_PET : ESTRESSE_ROTINAS;
      base.forEach(([nome, emoji, tipo], i) => extras.push({
        id: `ex-st-${m.id}-${i}`, membro: m.id, nome, emoji, tipo, apelidos: [],
        ...(tipo === 'qtd' ? { meta: 30, unidade: 'min', passo: 10 } : {}), ...(tipo === 'semana' ? { vezes_semana: 2 } : {}),
      }));
    }
  }
  const habitos = [...HABITOS_EXEMPLO, ...extras]
    .filter((h) => estado.membros.some((m) => m.id === h.membro))
    .map((h, i) => ({ arquivado: false, criado_em: inicio, ordem: 100 + i, exemplo: true, ...h }));
  const todos = [...estado.habitos.filter((h) => !h.exemplo && !h.arquivado), ...habitos];
  const eventos = [];
  let n = 0;
  const ev = (habito, data, valor, por) => eventos.push({ id: `ex-ev-${++n}`, habito, data, valor, por, em: `${data}T12:00:00.000Z`, origem: 'exemplo' });
  const quemFaz = (h) => (estado.membros.find((m) => m.id === h.membro)?.tipo === 'pet' ? (r() < 0.5 ? 'k' : 'm') : h.membro);
  for (const h of todos) {
    const [p, seqAtual] = RITMO[h.id] || [0.6, 2];
    const jaTemHoje = estado.eventos.some((e) => e.habito === h.id && e.data === hoje);
    for (let i = DIAS; i >= 0; i--) {
      const d = somarDias(hoje, -i);
      if (i === 0 && jaTemHoje) continue;
      if (h.tipo === 'evitar') {
        if (i > 0 && r() < p) ev(h.id, d, 1, h.membro);
        continue;
      }
      const garantido = i > 0 && i <= seqAtual;
      const hojeSim = i === 0 && r() < p * 0.6;
      if (!(garantido || hojeSim || (i > seqAtual && r() < p))) continue;
      if (h.tipo === 'qtd') {
        const meta = h.meta || 1, passo = h.passo || 1;
        const vezes = Math.ceil(meta / passo) + (r() < 0.3 ? 1 : 0) - (i === 0 ? 2 : 0);
        for (let v = 0; v < Math.max(1, vezes); v++) ev(h.id, d, passo, quemFaz(h));
      } else {
        ev(h.id, d, 1, quemFaz(h));
      }
    }
    // semana: garante a meta nas semanas fechadas mais recentes, para a sequência de semanas aparecer
    if (h.tipo === 'semana' && (RITMO[h.id]?.[0] ?? 0) < 0.5) {
      const semana = inicioDaSemana(hoje, estado.casa.inicio_semana ?? 1);
      for (let s = 1; s <= 3; s++) for (let k = 0; k < (h.vezes_semana || 1); k++) ev(h.id, somarDias(semana, -7 * s + k * 2), 1, quemFaz(h));
    }
  }

  // humor e energia (a casa vê) e destaque (privado de cada um)
  const registro = {}, privado = {};
  for (const m of estado.membros.filter((x) => x.tipo === 'pessoa')) {
    let humor = 3 + Math.round(r()), energia = 3;
    registro[m.id] = {};
    privado[m.id] = {};
    const frases = DESTAQUES[m.id] || DESTAQUES.m;
    for (let i = DIAS; i >= 1; i--) {
      if (r() < 0.15) continue; // dia sem registro
      humor = Math.max(1, Math.min(5, humor + Math.round((r() - 0.5) * 2)));
      energia = Math.max(1, Math.min(5, energia + Math.round((r() - 0.5) * 2)));
      const dd = somarDias(hoje, -i);
      registro[m.id][dd] = { humor, energia, exemplo: true };
      if (r() < 0.6) privado[m.id][dd] = { destaque: frases[Math.floor(r() * frases.length)], exemplo: true };
    }
  }

  const listaMercado = estresse ? [...MERCADO, ...ESTRESSE_MERCADO.map((n) => [n, r() < 0.3 ? String(1 + Math.floor(r() * 4)) : '', null])] : MERCADO;
  const mercado = listaMercado.map(([nome, qtd, secao], i) => ({
    id: `ex-mer-${i}`, nome, nome_norm: normalizar(nome), qtd, secao: secao || secaoDe(nome), adicionado_por: i % 2 ? 'k' : 'm', em: `${hoje}T09:00:00.000Z`,
    comprado_em: i % 6 === 5 ? `${hoje}T10:00:00.000Z` : null, comprado_por: i % 6 === 5 ? 'k' : null, origem: 'exemplo',
  }));
  const pessoasIds = estado.membros.filter((x) => x.tipo === 'pessoa').map((x) => x.id);
  const listaPend = estresse
    ? [...PENDENCIAS, ...ESTRESSE_PENDENCIAS.map((t, i) => [t, i % 3 === 0 ? null : pessoasIds[i % pessoasIds.length] || null, i % 5 === 0 ? null : Math.floor(r() * 40) - 6, ''])]
    : PENDENCIAS;
  const pendencias = listaPend.map(([titulo, resp, dias, nota], i) => ({
    id: `ex-pen-${i}`, titulo, resp, prazo: dias === null ? null : somarDias(hoje, dias), nota, repete: null, aviso_dias: null, icone: null,
    criada_por: i % 2 ? 'k' : 'm', em: `${somarDias(hoje, -3)}T08:00:00.000Z`, concluida_em: null, concluida_por: null, origem: 'exemplo',
  }));
  // datas especiais: aniversários que se repetem e só aparecem perto do dia, com o lembrete do presente antes
  const datas = [['Aniversário da Ju', 6, '🎂'], ['Aniversário de casamento', 20, '💍'], ['Aniversário do Anakin', 45, '🐕'], ['Aniversário da mãe da Karen', 3, '🎂']];
  datas.forEach(([titulo, emDias, icone], i) => {
    const dia = somarDias(hoje, emDias);
    pendencias.push({ id: `ex-dat-${i}`, titulo, resp: null, prazo: dia, nota: '', repete: 'anual', aviso_dias: 14, icone,
      criada_por: 'k', em: `${somarDias(hoje, -30)}T08:00:00.000Z`, concluida_em: null, concluida_por: null, origem: 'exemplo' });
    if (icone === '🎂') pendencias.push({ id: `ex-pre-${i}`, titulo: `Comprar presente: ${titulo.replace(/^Aniversário (da |do |de )?/, '')}`, resp: 'k', prazo: somarDias(dia, -5),
      nota: '', repete: 'anual', aviso_dias: 7, icone: '🎁', criada_por: 'k', em: `${somarDias(hoje, -30)}T08:00:00.000Z`, concluida_em: null, concluida_por: null, origem: 'exemplo' });
  });
  return { habitos, eventos, registro, privado, mercado, pendencias };
}
