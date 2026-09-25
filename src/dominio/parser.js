// @ts-check
// Parser pt-BR da entrada universal. Camada 1: regras determinísticas. Se as regras não
// resolverem, devolve `ambiguo` com uma pergunta em vez de chutar. O fallback em LLM (camada 2)
// fica para a Fase 4, atrás de feature flag.
//
// interpretar(texto, ctx) → uma intenção:
//   { tipo: 'mercado', itens: [{nome, qtd}] }
//   { tipo: 'pendencia', titulo, prazo? }
//   { tipo: 'habito', habito, acao: 'marcar'|'somar'|'deslize', valor? }
//   { tipo: 'registro', campos: { humor?, energia?, destaque? } }
//   { tipo: 'privado', campos: { texto?, gratidao? } }
//   { tipo: 'ambiguo', pergunta, opcoes? }
// Quem aplica e monta a frase falada é `acoes.js` (a frase depende do resultado real).

import { normalizar, separarItens, itemConhecido, itemExato } from './mercado.js';
import { somarDias, diaDaSemana } from './datas.js';

/**
 * @typedef {{ id: string, nome: string, membro: string, tipo: string, apelidos?: string[], unidade?: string, passo?: number }} HabitoCtx
 * @typedef {{ hoje: string, quem: string, habitos: HabitoCtx[], membros: {id: string, nome: string}[], catalogo?: Record<string, any> }} Ctx
 */

const DIAS = { domingo: 0, segunda: 1, 'segunda-feira': 1, terca: 2, 'terca-feira': 2, quarta: 3, 'quarta-feira': 3, quinta: 4, 'quinta-feira': 4, sexta: 5, 'sexta-feira': 5, sabado: 6 };

/**
 * Acha um prazo no fim do texto ("até sexta", "amanhã", "dia 10") e devolve o texto sem ele.
 * @param {string} texto @param {string} hoje
 * @returns {{ resto: string, prazo: string|null }}
 */
export function extrairPrazo(texto, hoje) {
  const n = normalizar(texto);
  // Cada padrão começa numa fronteira de palavra ([\s,]+), para o "a" de "dentista" não virar artigo.
  const padroes = [
    /[\s,]+(?:(?:ate|pra|para|de)\s+)?(depois de amanha|amanha|hoje|hj)\s*$/,
    /[\s,]+(?:(?:ate|pra|para|na|no)\s+)?(?:(?:a|o|essa|esta|proxima)\s+)?(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\s*$/,
    /[\s,]+(?:(?:ate|pra|para|no)\s+)?(?:o\s+)?dia\s+(\d{1,2})(?:\/(\d{1,2}))?\s*$/,
    /[\s,]+(?:ate|pra|para|em)\s+(\d{1,2})\/(\d{1,2})\s*$/,
  ];
  for (const re of padroes) {
    const m = n.match(re);
    if (!m) continue;
    const resto = texto.slice(0, m.index).trim();
    const k = m[1];
    let prazo = null;
    if (k === 'hoje' || k === 'hj') prazo = hoje;
    else if (k === 'amanha') prazo = somarDias(hoje, 1);
    else if (k === 'depois de amanha') prazo = somarDias(hoje, 2);
    else if (k in DIAS) {
      const alvo = DIAS[/** @type {keyof typeof DIAS} */ (k)];
      const avanço = (alvo - diaDaSemana(hoje) + 7) % 7;
      prazo = somarDias(hoje, avanço);
    } else {
      const dia = Number(m[1]);
      const [a, mesHoje] = hoje.split('-').map(Number);
      let mes = m[2] ? Number(m[2]) : mesHoje;
      let ano = a;
      let cand = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      if (cand < hoje) {
        if (m[2]) ano += 1; else { mes += 1; if (mes > 12) { mes = 1; ano += 1; } }
        cand = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      }
      prazo = cand;
    }
    if (resto) return { resto, prazo };
  }
  return { resto: texto.trim(), prazo: null };
}

/** Frases de quantidade de água/líquido → ml. @param {string} n texto normalizado */
function quantidade(n) {
  const m = n.match(/(\d+(?:[.,]\d+)?|meio|meia|um|uma|dois|duas|tres)\s*(ml|mililitros?|l|litros?|copos?|garrafas?)\b/);
  if (!m) return null;
  const ext = { meio: 0.5, meia: 0.5, um: 1, uma: 1, dois: 2, duas: 2, tres: 3 };
  const v = m[1] in ext ? ext[/** @type {keyof typeof ext} */ (m[1])] : Number(m[1].replace(',', '.'));
  const u = m[2];
  if (u.startsWith('m')) return v;
  if (u.startsWith('l')) return v * 1000;
  if (u.startsWith('copo')) return v * 250;
  return v * 500; // garrafa
}

/** Achar hábitos pelos apelidos (palavra inteira), preferindo o apelido mais longo. */
function acharHabitos(/** @type {string} */ n, /** @type {HabitoCtx[]} */ habitos) {
  /** @type {{ h: HabitoCtx, len: number }[]} */
  const achados = [];
  for (const h of habitos) {
    const nomes = [h.nome, ...(h.apelidos || [])].map(normalizar);
    let melhor = 0;
    for (const a of nomes) {
      if (a && new RegExp(`(^|\\s)${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|[.,!?])`).test(n)) melhor = Math.max(melhor, a.length);
    }
    if (melhor) achados.push({ h, len: melhor });
  }
  if (!achados.length) return [];
  const max = Math.max(...achados.map((a) => a.len));
  return achados.filter((a) => a.len === max).map((a) => a.h);
}

const GATILHO_MERCADO = /^(?:(?:por|poe|coloca|adiciona|adicione|acrescenta|inclui|bota)\s+(?:ai\s+)?|(?:preciso comprar|precisa comprar|tem que comprar|temos que comprar|comprar|compra|faltando|faltou|falta|acabou(?:\s+(?:o|a|os|as))?)\s+|(?:mercado|lista de compras|lista)\s*:\s*)/;
const SUFIXO_MERCADO = /\s+(?:na lista(?: de compras| do mercado)?|no mercado|pra comprar|para comprar)\s*$/;
const GATILHO_PENDENCIA = /^(?:pendencia|pendencias|tarefa|todo|afazer)\s*[:\-]\s*|^(?:lembrar de|lembra de|lembrete:?|nao esquecer de)\s+|^(?:preciso|tenho que|temos que|tem que)\s+(?!comprar\b)/;

/**
 * @param {string} texto @param {Ctx} ctx
 */
export function interpretar(texto, ctx) {
  const original = texto.trim().replace(/\s+/g, ' ');
  const n = normalizar(original);
  if (!n) return { tipo: 'ambiguo', pergunta: 'Não ouvi nada. Pode repetir?' };

  // 1) Registro do dia: humor, energia, destaque (visíveis à casa)
  const humor = n.match(/\bhumor\s*(?:[:=]|de|e|esta|ta)?\s*([1-5])\b/);
  const energia = n.match(/\benergia\s*(?:[:=]|de|e|esta|ta)?\s*([1-5])\b/);
  if (humor || energia) {
    /** @type {Record<string, number>} */
    const campos = {};
    if (humor) campos.humor = Number(humor[1]);
    if (energia) campos.energia = Number(energia[1]);
    return { tipo: 'registro', campos };
  }
  const destaque = original.match(/^destaque(?:\s+do\s+dia)?\s*[:\-]\s*(.+)$/i);
  if (destaque) return { tipo: 'privado', campos: { destaque: destaque[1].trim() } }; // o destaque é privado (25/09)

  // 2) Privado: diário e gratidão (só a própria pessoa lê)
  const diario = original.match(/^di[áa]rio\s*[:\-]\s*(.+)$/i);
  if (diario) return { tipo: 'privado', campos: { texto: diario[1].trim() } };
  const grat = original.match(/^(?:gratid[ãa]o|grata|grato|agrade[çc]o)\s*(?:[:\-]|por|pelo|pela)?\s*(.+)$/i);
  if (grat) return { tipo: 'privado', campos: { gratidao: grat[1].trim() } };

  // 3) Números do dia (sono, peso…) ainda não existem: perguntar em vez de inventar
  if (/^dormi\b|\bpeso\s+\d|\bpesei\b/.test(n)) {
    return { tipo: 'ambiguo', pergunta: 'Ainda não existe um número do dia para isso. Quer criar nas configurações?' };
  }

  // 4) Pendência explícita
  if (GATILHO_PENDENCIA.test(n)) {
    const semGatilho = original.slice(original.length - n.replace(GATILHO_PENDENCIA, '').length);
    const { resto, prazo } = extrairPrazo(semGatilho, ctx.hoje);
    const titulo = resto.charAt(0).toUpperCase() + resto.slice(1);
    return { tipo: 'pendencia', titulo, prazo };
  }

  // 5) Mercado explícito ("adiciona X na lista", "comprar X", "acabou o café")
  const temGatilho = GATILHO_MERCADO.test(n);
  const temSufixo = SUFIXO_MERCADO.test(n);
  if (temGatilho || temSufixo) {
    let corpo = original.slice(original.length - n.replace(GATILHO_MERCADO, '').length);
    corpo = corpo.replace(new RegExp(SUFIXO_MERCADO.source, 'i'), '');
    // normalizar() pode ter mudado o tamanho (acentos compostos); se o corte ficou estranho, refaz no normalizado
    if (normalizar(corpo) !== n.replace(GATILHO_MERCADO, '').replace(SUFIXO_MERCADO, '')) {
      corpo = n.replace(GATILHO_MERCADO, '').replace(SUFIXO_MERCADO, '');
    }
    const itens = separarItens(corpo);
    if (itens.length) return { tipo: 'mercado', itens };
  }

  // 6) Hábitos
  const negado = /^(nao|não)\s/.test(n);
  const habs = acharHabitos(n, ctx.habitos);
  if (habs.length && !negado) {
    let candidatos = habs;
    if (habs.length > 1) {
      const meus = habs.filter((h) => h.membro === ctx.quem);
      if (meus.length === 1) candidatos = meus;
    }
    if (candidatos.length > 1) {
      const nomes = candidatos.map((h) => `${h.nome} (${ctx.membros.find((m) => m.id === h.membro)?.nome || h.membro})`);
      return { tipo: 'ambiguo', pergunta: `De quem? ${nomes.join(' ou ')}`, opcoes: candidatos.map((h) => h.id) };
    }
    const h = candidatos[0];
    // "água" sozinha: pode ser o hábito ou um item de mercado
    if (h.tipo === 'qtd') {
      const v = quantidade(n);
      const soNome = [h.nome, ...(h.apelidos || [])].map(normalizar).includes(n);
      if (v === null && soNome && itemExato(n, ctx.catalogo)) {
        return { tipo: 'ambiguo', pergunta: `${h.nome}: é para o mercado ou para o hábito?`, opcoes: ['mercado', h.id] };
      }
      return { tipo: 'habito', habito: h.id, acao: 'somar', valor: v ?? h.passo ?? 250 };
    }
    if (h.tipo === 'evitar') return { tipo: 'habito', habito: h.id, acao: 'deslize' };
    return { tipo: 'habito', habito: h.id, acao: 'marcar' };
  }
  if (negado) return { tipo: 'ambiguo', pergunta: 'Entendi uma negação. O que você quer anotar?' };

  // 7) Sem gatilho: lista de coisas conhecidas vira mercado ("leite, pão e 2 dúzias de ovos")
  const itens = separarItens(original);
  const conhecidos = itens.filter((i) => itemConhecido(i.nome, ctx.catalogo));
  if (itens.length && conhecidos.length === itens.length) return { tipo: 'mercado', itens };
  if (itens.length > 1 && conhecidos.length >= Math.ceil(itens.length / 2)) return { tipo: 'mercado', itens };

  return { tipo: 'ambiguo', pergunta: `Não entendi “${original}”. É mercado, pendência ou hábito?`, opcoes: ['mercado', 'pendencia'] };
}
