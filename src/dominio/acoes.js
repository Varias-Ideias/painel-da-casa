// @ts-check
// Todas as mudanças de estado passam por aqui: `aplicar(estado, acao, ctx)`. O mesmo código roda
// no servidor (a verdade) e no aparelho (resposta instantânea e fila offline). Cada ação devolve o
// resultado, uma frase curta pronta para ser falada e a ação que a desfaz.

import { normalizar, separarItens, secaoDe, SECOES_PADRAO } from './mercado.js';
import { interpretar } from './parser.js';
import { estadoHabito } from './habitos.js';
import { formatoRelativo } from './datas.js';

export class ErroAcao extends Error {
  /** @param {string} msg @param {number} [status] */
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

/** Estado vazio de uma casa. @param {string} tz */
export function estadoVazio(tz = 'America/Sao_Paulo') {
  return {
    versao: 0,
    casa: { nome: 'Casa', tz, inicio_semana: 1 },
    membros: /** @type {any[]} */ ([]),
    habitos: /** @type {any[]} */ ([]),
    eventos: /** @type {any[]} */ ([]),
    secoes: [...SECOES_PADRAO],
    mercado: /** @type {any[]} */ ([]),
    catalogo: /** @type {Record<string, any>} */ ({}),
    pendencias: /** @type {any[]} */ ([]),
    registro: /** @type {Record<string, Record<string, any>>} */ ({}),
    privado: /** @type {Record<string, Record<string, any>>} */ ({}),
  };
}

/** O que cada aparelho pode ver: nada de tokens nem log; o privado só do próprio dono. */
export function filtrarPara(estado, quem) {
  const { tokens, capturas, aplicadas, privado, ...resto } = estado;
  return { ...resto, privado: quem !== 'casa' && privado?.[quem] ? { [quem]: privado[quem] } : {} };
}

const lista = (/** @type {string[]} */ xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);
const fmt = (/** @type {number} */ n) => n.toLocaleString('pt-BR');

function habito(estado, id) {
  const h = estado.habitos.find((x) => x.id === id);
  if (!h) throw new ErroAcao('Hábito não encontrado', 404);
  return h;
}
function membro(estado, id) {
  return estado.membros.find((m) => m.id === id);
}
function falaHabito(estado, h, hoje) {
  const ev = estado.eventos.filter((e) => e.habito === h.id);
  const s = estadoHabito(h, ev, hoje, estado.casa.inicio_semana);
  if (s.tipo === 'qtd') {
    const u = h.unidade === 'ml' && s.meta >= 1000 ? { v: s.valor / 1000, m: s.meta / 1000, u: 'litros' } : { v: s.valor, m: s.meta, u: h.unidade || '' };
    return s.feito ? `${h.nome}: meta batida, ${fmt(u.v)} de ${fmt(u.m)} ${u.u}.` : `${h.nome}: ${fmt(u.v)} de ${fmt(u.m)} ${u.u}.`;
  }
  if (s.tipo === 'semana') return `${h.nome} marcado. ${s.feitosSemana} de ${s.meta} na semana.`;
  if (s.tipo === 'evitar') return `Deslize em ${h.nome.toLowerCase()} anotado. O contador recomeça.`;
  return s.seq > 1 ? `${h.nome} marcado. ${s.seq} dias seguidos.` : `${h.nome} marcado.`;
}

/**
 * @param {ReturnType<typeof estadoVazio> & Record<string, any>} estado  (é modificado)
 * @param {{ tipo: string, dados?: any }} acao
 * @param {{ quem: string, agora: string, hoje: string, novoId: () => string }} ctx
 * @returns {{ resultado: any, fala: string, desfazer: any }}
 */
export function aplicar(estado, acao, ctx) {
  const d = acao.dados || {};
  const dia = d.data || ctx.hoje;
  const por = ctx.quem;

  switch (acao.tipo) {
    // ---------------- hábitos ----------------
    case 'habito.marcar': {
      const h = habito(estado, d.habito);
      const doDia = estado.eventos.filter((e) => e.habito === h.id && e.data === dia);
      if (doDia.length) {
        estado.eventos = estado.eventos.filter((e) => !doDia.includes(e));
        return { resultado: { removidos: doDia.length }, fala: `${h.nome} desmarcado.`, desfazer: { tipo: 'habito.restaurar_eventos', dados: { eventos: doDia } } };
      }
      const e = { id: ctx.novoId(), habito: h.id, data: dia, valor: 1, por, em: ctx.agora, origem: d.origem || 'app' };
      estado.eventos.push(e);
      return { resultado: { evento: e.id }, fala: falaHabito(estado, h, ctx.hoje), desfazer: { tipo: 'habito.remover_eventos', dados: { ids: [e.id] } } };
    }
    case 'habito.somar':
    case 'habito.deslize': {
      const h = habito(estado, d.habito);
      const valor = acao.tipo === 'habito.deslize' ? 1 : Number(d.valor ?? h.passo ?? 1);
      if (!Number.isFinite(valor) || valor === 0) throw new ErroAcao('Valor inválido');
      const e = { id: ctx.novoId(), habito: h.id, data: dia, valor, por, em: ctx.agora, origem: d.origem || 'app' };
      estado.eventos.push(e);
      return { resultado: { evento: e.id }, fala: falaHabito(estado, h, ctx.hoje), desfazer: { tipo: 'habito.remover_eventos', dados: { ids: [e.id] } } };
    }
    case 'habito.remover_eventos': {
      const ids = new Set(d.ids || []);
      const removidos = estado.eventos.filter((e) => ids.has(e.id));
      estado.eventos = estado.eventos.filter((e) => !ids.has(e.id));
      return { resultado: {}, fala: 'Desfeito.', desfazer: { tipo: 'habito.restaurar_eventos', dados: { eventos: removidos } } };
    }
    case 'habito.restaurar_eventos': {
      const existentes = new Set(estado.eventos.map((e) => e.id));
      const novos = (d.eventos || []).filter((e) => !existentes.has(e.id));
      estado.eventos.push(...novos);
      return { resultado: {}, fala: 'Desfeito.', desfazer: { tipo: 'habito.remover_eventos', dados: { ids: novos.map((e) => e.id) } } };
    }
    case 'habito.salvar': {
      const campos = d.habito || {};
      if (!campos.nome || !String(campos.nome).trim()) throw new ErroAcao('O hábito precisa de nome');
      if (!['check', 'qtd', 'semana', 'evitar'].includes(campos.tipo)) throw new ErroAcao('Tipo de hábito inválido');
      if (!membro(estado, campos.membro)) throw new ErroAcao('Dono do hábito inválido');
      const existente = campos.id && estado.habitos.find((x) => x.id === campos.id);
      if (existente) {
        const antes = { ...existente };
        Object.assign(existente, campos);
        return { resultado: { id: existente.id }, fala: `${existente.nome} atualizado.`, desfazer: { tipo: 'habito.salvar', dados: { habito: antes } } };
      }
      const novo = { ordem: estado.habitos.length, arquivado: false, apelidos: [], criado_em: ctx.hoje, ...campos, id: campos.id || ctx.novoId() };
      estado.habitos.push(novo);
      return { resultado: { id: novo.id }, fala: `${novo.nome} criado.`, desfazer: { tipo: 'habito.arquivar', dados: { id: novo.id, arquivado: true } } };
    }
    case 'habito.arquivar': {
      const h = habito(estado, d.id);
      const antes = h.arquivado;
      h.arquivado = Boolean(d.arquivado);
      return { resultado: {}, fala: h.arquivado ? `${h.nome} arquivado.` : `${h.nome} de volta.`, desfazer: { tipo: 'habito.arquivar', dados: { id: h.id, arquivado: antes } } };
    }

    // ---------------- mercado ----------------
    case 'mercado.adicionar': {
      const itens = d.itens || separarItens(d.texto || '');
      const novos = [], repetidos = [], voltaram = [];
      /** @type {string[]} */ const ids = [];
      for (const it of itens) {
        const nn = normalizar(it.nome);
        if (!nn) continue;
        const ja = estado.mercado.find((i) => i.nome_norm === nn);
        if (ja && !ja.comprado_em) {
          if (it.qtd && it.qtd !== ja.qtd) { ja.qtd = it.qtd; }
          repetidos.push(ja.nome);
          continue;
        }
        if (ja) { ja.comprado_em = null; ja.comprado_por = null; voltaram.push(ja.id); novos.push(ja.nome); continue; }
        const cat = estado.catalogo[nn];
        const item = {
          id: ctx.novoId(), nome: it.nome, nome_norm: nn, qtd: it.qtd || '', secao: secaoDe(it.nome, estado.catalogo),
          adicionado_por: por, em: ctx.agora, comprado_em: null, comprado_por: null, origem: d.origem || 'app',
        };
        estado.mercado.push(item);
        estado.catalogo[nn] = { nome: it.nome, secao: item.secao, vezes: (cat?.vezes || 0), ultimo: ctx.hoje };
        ids.push(item.id);
        novos.push(it.nome);
      }
      const partes = [];
      if (novos.length) partes.push(`Anotei ${lista(novos.map((x) => x.toLowerCase()))} no mercado.`);
      if (repetidos.length) partes.push(`${lista(repetidos)} já ${repetidos.length > 1 ? 'estavam' : 'estava'} na lista.`);
      return {
        resultado: { novos, repetidos }, fala: partes.join(' ') || 'Nada para anotar.',
        desfazer: { tipo: 'mercado.desfazer_adicao', dados: { ids, voltaram } },
      };
    }
    case 'mercado.desfazer_adicao': {
      const ids = new Set(d.ids || []);
      const removidos = estado.mercado.filter((i) => ids.has(i.id));
      estado.mercado = estado.mercado.filter((i) => !ids.has(i.id));
      for (const id of d.voltaram || []) {
        const i = estado.mercado.find((x) => x.id === id);
        if (i) { i.comprado_em = ctx.agora; i.comprado_por = por; }
      }
      return { resultado: {}, fala: 'Desfeito.', desfazer: { tipo: 'mercado.restaurar', dados: { itens: removidos } } };
    }
    case 'mercado.alternar': {
      const i = estado.mercado.find((x) => x.id === d.id);
      if (!i) throw new ErroAcao('Item não encontrado', 404);
      if (i.comprado_em) { i.comprado_em = null; i.comprado_por = null; }
      else {
        i.comprado_em = ctx.agora; i.comprado_por = por;
        const c = estado.catalogo[i.nome_norm];
        if (c) { c.vezes = (c.vezes || 0) + 1; c.ultimo = ctx.hoje; }
      }
      return { resultado: {}, fala: i.comprado_em ? `${i.nome} comprado.` : `${i.nome} voltou para a lista.`, desfazer: { tipo: 'mercado.alternar', dados: { id: i.id } } };
    }
    case 'mercado.limpar': {
      const comprados = estado.mercado.filter((i) => i.comprado_em);
      estado.mercado = estado.mercado.filter((i) => !i.comprado_em);
      return { resultado: { removidos: comprados.length }, fala: `${comprados.length} comprados removidos.`, desfazer: { tipo: 'mercado.restaurar', dados: { itens: comprados } } };
    }
    case 'mercado.remover': {
      const i = estado.mercado.find((x) => x.id === d.id);
      if (!i) throw new ErroAcao('Item não encontrado', 404);
      estado.mercado = estado.mercado.filter((x) => x !== i);
      return { resultado: {}, fala: `${i.nome} removido.`, desfazer: { tipo: 'mercado.restaurar', dados: { itens: [i] } } };
    }
    case 'mercado.restaurar': {
      const ids = new Set(estado.mercado.map((i) => i.id));
      const novos = (d.itens || []).filter((i) => !ids.has(i.id));
      estado.mercado.push(...novos);
      return { resultado: {}, fala: 'Desfeito.', desfazer: { tipo: 'mercado.desfazer_adicao', dados: { ids: novos.map((i) => i.id) } } };
    }
    case 'mercado.editar': {
      const i = estado.mercado.find((x) => x.id === d.id);
      if (!i) throw new ErroAcao('Item não encontrado', 404);
      const antes = { nome: i.nome, qtd: i.qtd, secao: i.secao };
      if (d.secao !== undefined) {
        if (!estado.secoes.includes(d.secao)) throw new ErroAcao('Seção inválida');
        i.secao = d.secao;
        // aprende: da próxima vez este item cai nesta seção
        estado.catalogo[i.nome_norm] = { ...(estado.catalogo[i.nome_norm] || { nome: i.nome, vezes: 0 }), secao: d.secao };
      }
      if (d.qtd !== undefined) i.qtd = String(d.qtd);
      if (d.nome !== undefined && String(d.nome).trim()) { i.nome = String(d.nome).trim(); i.nome_norm = normalizar(i.nome); }
      return { resultado: {}, fala: `${i.nome} atualizado.`, desfazer: { tipo: 'mercado.editar', dados: { id: i.id, ...antes } } };
    }
    case 'secoes.ordenar': {
      const nova = d.secoes || [];
      if (nova.length !== estado.secoes.length || !nova.every((s) => estado.secoes.includes(s))) throw new ErroAcao('Ordem de seções inválida');
      const antes = estado.secoes;
      estado.secoes = [...nova];
      return { resultado: {}, fala: 'Ordem das seções salva.', desfazer: { tipo: 'secoes.ordenar', dados: { secoes: antes } } };
    }

    // ---------------- pendências ----------------
    case 'pendencia.criar': {
      const titulo = String(d.titulo || '').trim();
      if (!titulo) throw new ErroAcao('A pendência precisa de título');
      const p = {
        id: ctx.novoId(), titulo, resp: d.resp || null, prazo: d.prazo || null, nota: d.nota || '',
        criada_por: por, em: ctx.agora, concluida_em: null, concluida_por: null, origem: d.origem || 'app',
      };
      estado.pendencias.push(p);
      const quando = p.prazo ? ` para ${formatoRelativo(p.prazo, ctx.hoje)}` : '';
      return { resultado: { id: p.id }, fala: `Anotei a pendência ${titulo.charAt(0).toLowerCase() + titulo.slice(1)}${quando}.`, desfazer: { tipo: 'pendencia.remover', dados: { id: p.id } } };
    }
    case 'pendencia.editar': {
      const p = estado.pendencias.find((x) => x.id === d.id);
      if (!p) throw new ErroAcao('Pendência não encontrada', 404);
      const antes = { titulo: p.titulo, resp: p.resp, prazo: p.prazo, nota: p.nota };
      for (const k of ['titulo', 'resp', 'prazo', 'nota']) if (d[k] !== undefined) p[k] = d[k] === '' && k !== 'nota' && k !== 'titulo' ? null : d[k];
      if (!String(p.titulo || '').trim()) { Object.assign(p, antes); throw new ErroAcao('A pendência precisa de título'); }
      return { resultado: {}, fala: 'Pendência atualizada.', desfazer: { tipo: 'pendencia.editar', dados: { id: p.id, ...antes } } };
    }
    case 'pendencia.concluir':
    case 'pendencia.reabrir': {
      const p = estado.pendencias.find((x) => x.id === d.id);
      if (!p) throw new ErroAcao('Pendência não encontrada', 404);
      const concluir = acao.tipo === 'pendencia.concluir';
      p.concluida_em = concluir ? ctx.agora : null;
      p.concluida_por = concluir ? por : null;
      return { resultado: {}, fala: concluir ? `Concluída: ${p.titulo}.` : `${p.titulo} reaberta.`, desfazer: { tipo: concluir ? 'pendencia.reabrir' : 'pendencia.concluir', dados: { id: p.id } } };
    }
    case 'pendencia.remover': {
      const p = estado.pendencias.find((x) => x.id === d.id);
      if (!p) throw new ErroAcao('Pendência não encontrada', 404);
      estado.pendencias = estado.pendencias.filter((x) => x !== p);
      return { resultado: {}, fala: `${p.titulo} removida.`, desfazer: { tipo: 'pendencia.restaurar', dados: { pendencia: p } } };
    }
    case 'pendencia.restaurar': {
      if (!estado.pendencias.some((x) => x.id === d.pendencia?.id)) estado.pendencias.push(d.pendencia);
      return { resultado: {}, fala: 'Desfeito.', desfazer: { tipo: 'pendencia.remover', dados: { id: d.pendencia.id } } };
    }

    // ---------------- registro do dia ----------------
    case 'registro.salvar': {
      const alvo = d.membro || por;
      if (!membro(estado, alvo) || membro(estado, alvo).tipo !== 'pessoa') throw new ErroAcao('Pessoa inválida');
      if (por !== 'casa' && por !== alvo) throw new ErroAcao('Só dá para editar o próprio registro', 403);
      const campos = {};
      for (const k of ['humor', 'energia']) if (d.campos?.[k] !== undefined) {
        const v = d.campos[k] === null ? null : Number(d.campos[k]);
        if (v !== null && !(v >= 1 && v <= 5)) throw new ErroAcao(`${k} vai de 1 a 5`);
        campos[k] = v;
      }
      if (d.campos?.destaque !== undefined) campos.destaque = String(d.campos.destaque).slice(0, 280);
      estado.registro[alvo] ||= {};
      const antes = { ...(estado.registro[alvo][dia] || {}) };
      estado.registro[alvo][dia] = { ...antes, ...campos };
      const partes = [];
      if (campos.humor) partes.push(`humor ${campos.humor}`);
      if (campos.energia) partes.push(`energia ${campos.energia}`);
      if (campos.destaque) partes.push('o destaque do dia');
      const antesCampos = Object.fromEntries(Object.keys(campos).map((k) => [k, antes[k] ?? null]));
      return { resultado: {}, fala: partes.length ? `Registrei ${lista(partes)}.` : 'Registro salvo.', desfazer: { tipo: 'registro.salvar', dados: { membro: alvo, data: dia, campos: antesCampos } } };
    }
    case 'privado.salvar': {
      if (por === 'casa') throw new ErroAcao('Diário e gratidão só pelo aparelho da própria pessoa', 403);
      const campos = {};
      if (d.campos?.texto !== undefined) campos.texto = String(d.campos.texto).slice(0, 5000);
      if (d.campos?.gratidao !== undefined) campos.gratidao = String(d.campos.gratidao).slice(0, 500);
      estado.privado[por] ||= {};
      const antes = { ...(estado.privado[por][dia] || {}) };
      const anexar = d.anexar === true;
      const novo = { ...antes };
      for (const [k, v] of Object.entries(campos)) novo[k] = anexar && antes[k] ? `${antes[k]}\n${v}` : v;
      estado.privado[por][dia] = novo;
      const antesCampos = Object.fromEntries(Object.keys(campos).map((k) => [k, antes[k] ?? '']));
      return { resultado: {}, fala: campos.texto !== undefined ? 'Anotei no seu diário.' : 'Anotei a sua gratidão.', desfazer: { tipo: 'privado.salvar', dados: { data: dia, campos: antesCampos } } };
    }

    // ---------------- membros ----------------
    case 'membro.salvar': {
      const m = membro(estado, d.id);
      if (!m) throw new ErroAcao('Membro não encontrado', 404);
      const antes = { nome: m.nome, cor: m.cor, emoji: m.emoji };
      for (const k of ['nome', 'cor', 'emoji']) if (d[k] !== undefined && String(d[k]).trim()) m[k] = String(d[k]).trim();
      return { resultado: {}, fala: `${m.nome} atualizado.`, desfazer: { tipo: 'membro.salvar', dados: { id: m.id, ...antes } } };
    }

    // ---------------- dados de exemplo ----------------
    case 'exemplos.remover': {
      const removido = {
        eventos: estado.eventos.filter((x) => x.origem === 'exemplo'),
        mercado: estado.mercado.filter((x) => x.origem === 'exemplo'),
        pendencias: estado.pendencias.filter((x) => x.origem === 'exemplo'),
        registro: /** @type {any[]} */ ([]),
      };
      estado.eventos = estado.eventos.filter((x) => x.origem !== 'exemplo');
      estado.mercado = estado.mercado.filter((x) => x.origem !== 'exemplo');
      estado.pendencias = estado.pendencias.filter((x) => x.origem !== 'exemplo');
      for (const [m, dias] of Object.entries(estado.registro)) for (const [dd, r] of Object.entries(dias)) {
        if (r.exemplo) { removido.registro.push({ m, dd, r }); delete dias[dd]; }
      }
      const total = removido.eventos.length + removido.mercado.length + removido.pendencias.length + removido.registro.length;
      return { resultado: { total }, fala: total ? 'Dados de exemplo removidos.' : 'Não havia dados de exemplo.', desfazer: { tipo: 'exemplos.restaurar', dados: removido } };
    }
    case 'exemplos.restaurar': {
      estado.eventos.push(...(d.eventos || []));
      estado.mercado.push(...(d.mercado || []));
      estado.pendencias.push(...(d.pendencias || []));
      for (const { m, dd, r } of d.registro || []) { estado.registro[m] ||= {}; estado.registro[m][dd] = r; }
      return { resultado: {}, fala: 'Exemplos de volta.', desfazer: { tipo: 'exemplos.remover', dados: {} } };
    }

    // ---------------- entrada universal ----------------
    case 'captura': {
      const ctxParser = {
        hoje: ctx.hoje, quem: por,
        habitos: estado.habitos.filter((h) => !h.arquivado),
        membros: estado.membros, catalogo: estado.catalogo,
      };
      const it = interpretar(String(d.texto || ''), ctxParser);
      const origem = d.origem || 'captura';
      if (it.tipo === 'ambiguo') return { resultado: { interpretacao: it }, fala: it.pergunta, desfazer: null };
      /** @type {{tipo: string, dados: any}} */
      let interna;
      if (it.tipo === 'mercado') interna = { tipo: 'mercado.adicionar', dados: { itens: it.itens, origem } };
      else if (it.tipo === 'pendencia') interna = { tipo: 'pendencia.criar', dados: { titulo: it.titulo, prazo: it.prazo, origem } };
      else if (it.tipo === 'habito') {
        const t = it.acao === 'marcar' ? 'habito.marcar' : it.acao === 'deslize' ? 'habito.deslize' : 'habito.somar';
        // "treinei" duas vezes não deve desmarcar: por voz, marcar é sempre marcar
        if (t === 'habito.marcar' && estado.eventos.some((e) => e.habito === it.habito && e.data === ctx.hoje)) {
          const h = habito(estado, it.habito);
          return { resultado: { interpretacao: it }, fala: `${h.nome} já estava marcado hoje.`, desfazer: null };
        }
        interna = { tipo: t, dados: { habito: it.habito, valor: it.valor, origem } };
      } else if (it.tipo === 'registro') interna = { tipo: 'registro.salvar', dados: { campos: it.campos, membro: por === 'casa' ? undefined : por } };
      else interna = { tipo: 'privado.salvar', dados: { campos: it.campos, anexar: true } };
      if (interna.tipo === 'registro.salvar' && por === 'casa') {
        return { resultado: { interpretacao: it }, fala: 'De quem é esse registro? Registre pelo celular da pessoa ou toque no nome dela no painel.', desfazer: null };
      }
      const r = aplicar(estado, interna, ctx);
      return { resultado: { interpretacao: it, ...r.resultado }, fala: r.fala, desfazer: r.desfazer };
    }

    default:
      throw new ErroAcao(`Ação desconhecida: ${acao.tipo}`);
  }
}
