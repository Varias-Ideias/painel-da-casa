// Edge function "api" do Painel da Casa: o mesmo papel do servidor/servidor.js, na nuvem.
// As regras (aplicar, filtrarPara) vêm do MESMO código do app, servido pelo jsDelivr a partir do GitHub, fixado num commit.
// Rotas: GET /estado · POST /acao · POST /capture · GET /fotos · POST /importar (uso único)
// Auth: token do aparelho no header Authorization (Bearer), conferido pelo hash na tabela tokens.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { aplicar, filtrarPara } from 'https://cdn.jsdelivr.net/gh/Varias-Ideias/painel-da-casa@4f792117cefcdda687bc54a78b3c523e310e01e1/src/dominio/acoes.js';
import { hojeNoFuso } from 'https://cdn.jsdelivr.net/gh/Varias-Ideias/painel-da-casa@4f792117cefcdda687bc54a78b3c523e310e01e1/src/dominio/datas.js';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const CHAVE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(URL_SB, CHAVE, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, idempotency-key, x-origem, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function quem(req: Request) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!t) return null;
  const { data } = await db.from('tokens').select('casa_id, membro, revogado_em').eq('hash', await sha256(t)).maybeSingle();
  if (!data || data.revogado_em) return null;
  db.from('tokens').update({ ultimo_uso: new Date().toISOString() }).eq('hash', await sha256(t)).then(() => {});
  return { casa: data.casa_id as string, membro: data.membro as string };
}

async function avisar(casa: string, versao: number) {
  await fetch(`${URL_SB}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic: `casa-${casa}`, event: 'versao', payload: { versao } }] }),
  }).catch(() => {});
}

/** Aplica uma ação com trava otimista (versão) e idempotência pelo id da ação. */
async function executar(casa: string, membro: string, acao: { id?: string; tipo: string; dados?: unknown }) {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const { data: linha, error } = await db.from('casas').select('estado, versao').eq('id', casa).single();
    if (error || !linha) throw Object.assign(new Error('Casa não encontrada'), { status: 404 });
    const e = linha.estado;
    e.aplicadas ||= {};
    if (acao.id && e.aplicadas[acao.id]) return { ...e.aplicadas[acao.id], repetida: true };
    let n = 0;
    const ctx = { quem: membro, agora: new Date().toISOString(), hoje: hojeNoFuso(e.casa.tz), novoId: () => (acao.id ? `${acao.id}.${n++}` : crypto.randomUUID()) };
    const r = aplicar(e, { tipo: acao.tipo, dados: acao.dados }, ctx);
    const mudou = r.desfazer !== null || acao.tipo !== 'captura';
    if (mudou) e.versao = (e.versao || 0) + 1;
    const resposta = { ok: true, versao: e.versao, resultado: r.resultado, fala: r.fala, desfazer: r.desfazer };
    if (acao.id) {
      e.aplicadas[acao.id] = { ok: true, versao: e.versao, fala: r.fala, desfazer: r.desfazer };
      const ids = Object.keys(e.aplicadas);
      if (ids.length > 2000) for (const id of ids.slice(0, ids.length - 2000)) delete e.aplicadas[id];
    }
    const { data: gravou } = await db.from('casas').update({ estado: e, versao: e.versao, atualizado_em: new Date().toISOString() })
      .eq('id', casa).eq('versao', linha.versao).select('id');
    if (!gravou?.length) continue; // alguém gravou no meio: tenta de novo com o estado novo
    const dia = hojeNoFuso(e.casa.tz);
    db.from('backups').upsert({ casa_id: casa, dia, estado: e }, { onConflict: 'casa_id,dia', ignoreDuplicates: true }).then(() => {});
    if (mudou) await avisar(casa, e.versao);
    return resposta;
  }
  throw Object.assign(new Error('Muita gente mexendo ao mesmo tempo, tente de novo'), { status: 409 });
}

// Fotos: feed RSS da pasta pública do Pinterest (cache por instância, 6 h)
let cacheFotos: { pasta: string; em: number; fotos: unknown[] } | null = null;
async function fotos(pasta?: string) {
  if (!pasta) return [];
  if (cacheFotos && cacheFotos.pasta === pasta && Date.now() - cacheFotos.em < 6 * 3600e3) return cacheFotos.fotos;
  const u = new URL(pasta);
  const [usuario, nome] = u.pathname.split('/').filter(Boolean);
  const r = await fetch(`${u.origin}/${usuario}/${nome}.rss`, { headers: { 'User-Agent': 'PainelDaCasa/1.0' } });
  if (!r.ok) return cacheFotos?.fotos || [];
  const xml = await r.text();
  const lista = [];
  for (const item of xml.split(/<item>/).slice(1)) {
    const img = item.match(/https:\/\/i\.pinimg\.com\/\d+x\/[0-9a-f/]+\.(?:jpg|jpeg|png|webp)/i);
    if (!img) continue;
    const titulo = (item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    lista.push({ url: img[0].replace(/\/\d+x\//, '/736x/'), titulo: titulo.replace(/&amp;/g, '&').trim().slice(0, 120) });
  }
  cacheFotos = { pasta, em: Date.now(), fotos: lista };
  return lista;
}

const limites = new Map<string, number[]>();
function passouDoLimite(chave: string) {
  const agora = Date.now();
  const l = (limites.get(chave) || []).filter((t) => agora - t < 60000);
  l.push(agora);
  limites.set(chave, l);
  return l.length > 30;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const rota = new URL(req.url).pathname.replace(/^.*\/api/, '') || '/';
  try {
    // importação única do estado que estava no computador
    if (rota === '/importar' && req.method === 'POST') {
      const corpo = await req.json();
      const h = await sha256(String(corpo.codigo || ''));
      const { data: cod } = await db.from('importacao').select('usado_em').eq('codigo_hash', h).maybeSingle();
      if (!cod || cod.usado_em) return json(403, { erro: 'Código de importação inválido ou já usado' });
      const { tokens, capturas, ...estado } = corpo.estado || {};
      if (!estado.casa || !Array.isArray(estado.membros)) return json(400, { erro: 'Estado inválido' });
      const casa = corpo.casa_id || 'casa';
      await db.from('casas').upsert({ id: casa, estado: { ...estado, config: corpo.config || {} }, versao: estado.versao || 0 });
      await db.from('tokens').delete().eq('casa_id', casa);
      const linhas = (tokens || []).map((t: { hash: string; membro: string; rotulo?: string; revogado_em?: string }) => ({ hash: t.hash, casa_id: casa, membro: t.membro, rotulo: t.rotulo, revogado_em: t.revogado_em || null }));
      if (linhas.length) await db.from('tokens').insert(linhas);
      await db.from('importacao').update({ usado_em: new Date().toISOString() }).eq('codigo_hash', h);
      return json(200, { ok: true, tokens: linhas.length });
    }

    const eu = await quem(req);
    if (!eu) return json(401, { erro: 'Aparelho não pareado. Abra o link de pareamento deste aparelho.' });

    if (rota === '/estado' && req.method === 'GET') {
      const { data } = await db.from('casas').select('estado').eq('id', eu.casa).single();
      const e = data!.estado;
      return json(200, { eu: eu.membro, casa: eu.casa, hoje: hojeNoFuso(e.casa.tz), estado: filtrarPara(e, eu.membro) });
    }
    if (rota === '/acao' && req.method === 'POST') {
      const acao = await req.json();
      if (!acao.tipo) return json(400, { erro: 'Falta o tipo da ação' });
      return json(200, await executar(eu.casa, eu.membro, acao));
    }
    if (rota === '/capture' && req.method === 'POST') {
      if (passouDoLimite(eu.membro)) return json(429, { ok: false, fala: 'Muitas anotações seguidas. Espere um minuto.' });
      const corpo = await req.json();
      const origem = String(corpo.origem || corpo.source || req.headers.get('x-origem') || 'api').slice(0, 40);
      const id = corpo.id || req.headers.get('idempotency-key') || undefined;
      const acao = corpo.type === 'grocery' && Array.isArray(corpo.items)
        ? { id, tipo: 'mercado.adicionar', dados: { texto: corpo.items.join(', '), origem } }
        : { id, tipo: 'captura', dados: { texto: String(corpo.text ?? corpo.texto ?? '').slice(0, 500), origem } };
      const r = await executar(eu.casa, eu.membro, acao);
      return json(200, { ok: true, fala: r.fala, feito: r.desfazer !== null, interpretacao: r.resultado?.interpretacao || null });
    }
    if (rota === '/fotos' && req.method === 'GET') {
      const { data } = await db.from('casas').select('estado').eq('id', eu.casa).single();
      return json(200, { fotos: await fotos(data?.estado?.config?.fotos_pinterest) });
    }
    return json(404, { erro: 'Rota desconhecida' });
  } catch (err) {
    // deno-lint-ignore no-explicit-any
    const e = err as any;
    const status = e.status || (e.name === 'ErroAcao' || e.constructor?.name === 'ErroAcao' ? e.status || 400 : 500);
    if (status === 500) console.error(err);
    return json(status, { ok: false, erro: e.message, fala: status === 500 ? 'Deu um erro no servidor.' : e.message });
  }
});
