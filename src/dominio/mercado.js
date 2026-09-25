// @ts-check
// Mercado: entender "leite, pão e 2 dúzias de ovos", normalizar nomes e achar a seção.
// A seção vem primeiro do que a casa já aprendeu (catálogo), depois do dicionário.

export const SECOES_PADRAO = ['Hortifrúti', 'Padaria', 'Açougue', 'Frios e laticínios', 'Mercearia', 'Bebidas', 'Limpeza', 'Higiene', 'Pet', 'Outros'];

/** @param {string} s */
export function normalizar(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Palavras (já normalizadas) → seção. Frases de duas palavras vêm antes das simples.
const DICIONARIO = {
  'Hortifrúti': 'banana tomate alface cebola alho batata maca laranja limao cenoura abobrinha brocolis pepino mamao manga uva morango abacate fruta frutas verdura legume cheiro-verde salsinha couve rucula melancia',
  'Padaria': 'pao paes bolo torrada biscoito bisnaguinha croissant',
  'Açougue': 'carne frango peixe linguica bife picanha costela file patinho moida',
  'Frios e laticínios': 'leite queijo iogurte manteiga presunto ovo ovos requeijao mussarela peito-de-peru creme-de-leite margarina',
  'Mercearia': 'arroz feijao cafe acucar macarrao oleo azeite farinha sal molho aveia granola cereal biscoito-de-agua atum sardinha milho ervilha tempero',
  'Bebidas': 'suco refrigerante cerveja vinho agua agua-com-gas agua-mineral cha',
  'Limpeza': 'sabao detergente amaciante desinfetante esponja agua-sanitaria alcool limpador multiuso saco-de-lixo vassoura',
  'Higiene': 'papel-higienico sabonete shampoo xampu condicionador pasta-de-dente escova-de-dente desodorante fio-dental absorvente cotonete',
  'Pet': 'racao petisco tapete-higienico areia antipulgas vermifugo sache osso',
};
const PARES = Object.entries(DICIONARIO).flatMap(([secao, ws]) => ws.split(' ').map((w) => [w.replace(/-/g, ' '), secao]))
  .sort((a, b) => b[0].length - a[0].length);

/**
 * @param {string} nome
 * @param {Record<string, { secao: string }>} [catalogo] nome normalizado → seção aprendida
 */
export function secaoDe(nome, catalogo = {}) {
  const n = normalizar(nome);
  if (catalogo[n]) return catalogo[n].secao;
  for (const [w, secao] of PARES) {
    if (n === w || n.startsWith(w + ' ') || n.endsWith(' ' + w) || n.includes(' ' + w + ' ')) return secao;
  }
  return 'Outros';
}

/** O texto é exatamente o nome de um item conhecido ("água", não "bebi água")? */
export function itemExato(/** @type {string} */ nome, /** @type {Record<string, any>} */ catalogo = {}) {
  const n = normalizar(nome);
  return Boolean(catalogo[n]) || PARES.some(([w]) => w === n);
}

/** A palavra é um item de mercado conhecido? @param {string} nome @param {Record<string, any>} [catalogo] */
export function itemConhecido(nome, catalogo = {}) {
  return Boolean(catalogo[normalizar(nome)]) || secaoDe(nome) !== 'Outros';
}

const UNIDADE = '(d[uú]zias?|kg|quilos?|g|gramas?|l|litros?|ml|pacotes?|caixas?|latas?|garrafas?|unidades?|p[eé]s?|cachos?|ma[cç]os?|potes?|sacos?|fardos?)';
const NUMERO_EXTENSO = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, quatro: 4, cinco: 5, seis: 6, meia: 0.5, meio: 0.5, dez: 10, doze: 12 };

/**
 * Quebra um texto em itens: "leite, pão e 2 dúzias de ovos".
 * @param {string} texto
 * @returns {{ nome: string, qtd: string }[]}
 */
export function separarItens(texto) {
  const partes = texto.split(/\s*,\s*|\s+e\s+|\s*;\s*|\n/i).map((x) => x.trim()).filter(Boolean);
  const itens = [];
  for (let p of partes) {
    p = p.replace(/^(uns|umas|o|a|os|as)\s+/i, '');
    let qtd = '';
    const ext = p.match(/^(\S+)\s+(.+)$/);
    const num = ext && NUMERO_EXTENSO[/** @type {keyof typeof NUMERO_EXTENSO} */ (normalizar(ext[1]))];
    if (num !== undefined && ext) p = `${String(num).replace('.', ',')} ${ext[2]}`;
    const m = p.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${UNIDADE}?\\s+(?:de\\s+)?(.+)$`, 'i'));
    if (m) {
      qtd = m[2] ? `${m[1]} ${m[2]}` : m[1];
      p = m[3];
    }
    const nome = p.trim().replace(/[.!?]+$/, '');
    if (!nome) continue;
    itens.push({ nome: nome.charAt(0).toUpperCase() + nome.slice(1), qtd });
  }
  return itens;
}
