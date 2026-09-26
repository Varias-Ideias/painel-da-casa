// Painel da Casa — o app. Um só código para o painel do iPad/computador e para o celular.
//
// Como os dados andam:
//   servidor  = último estado confirmado pelo servidor (guardado no aparelho para abrir offline)
//   fila      = ações feitas aqui que o servidor ainda não confirmou (sobrevive a recarregar)
//   vista     = servidor + fila aplicada com o MESMO código do servidor (src/dominio/acoes.js)
// Toque → aplica na vista na hora → entra na fila → vai para o servidor → o servidor avisa todo
// mundo por SSE → cada aparelho recarrega o estado.
import { aplicar, pendenciaVisivel } from '/dominio/acoes.js';
import { estadoHabito, historico } from '/dominio/habitos.js';
import { hojeNoFuso, somarDias, diferencaDias, formatoCurto, formatoRelativo } from '/dominio/datas.js';
import { normalizar } from '/dominio/mercado.js';
import { opcoes, contador, gradeEmojis, paleta, prazos, quem as quemOp, caras, CARAS_HUMOR, CARAS_ENERGIA, ligarEntradas, valor, definirContador, EMOJIS_ROTINA, EMOJIS_PESSOA } from '/entradas.js';

// ---------------------------------------------------------------- utilidades
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = (n) => Number(n).toLocaleString('pt-BR');
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento: segue só em memória */ } },
};
const gerarId = () => (crypto.randomUUID ? crypto.randomUUID() : 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const clone = (o) => JSON.parse(JSON.stringify(o));
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------------------------------------------------------------- onde está o servidor
// No PC da casa: mesma origem (/api/...). Na nuvem: edge function do Supabase (config.js).
const NUVEM = window.PAINEL?.api ? window.PAINEL : null;
const api = (p) => (NUVEM ? NUVEM.api + p : '/api' + p);

// ---------------------------------------------------------------- estado local
const params = new URLSearchParams(location.search);
let token = params.get('t') || LS.get('painel-token', null);
if (params.get('t')) LS.set('painel-token', token);
// estado e fila guardados por aparelho pareado: dois links no mesmo navegador não se misturam
const K = (k) => `${k}:${(token || '').slice(0, 10)}`;
let eu = LS.get(K('painel-eu'), null);
let servidor = LS.get(K('painel-estado'), null);
let fila = LS.get(K('painel-fila'), []);
let vista = null;
let conexao = 'off';
const prefs = Object.assign({ tema: 'dark', modo: 'auto', descanso: 0.25 }, LS.get('painel-prefs', {}));
if (!prefs.v2) { prefs.descanso = 0.25; prefs.v2 = true; LS.set('painel-prefs', prefs); } // novo padrão (25/09): descanso em 15 s
if (prefs.tema !== 'light') prefs.tema = 'dark'; // "auto" das versões antigas vira o escuro, o padrão
let aba = LS.get('painel-aba', 'hoje');
let diaReg = null;
let modoAtual = null;

const hoje = () => hojeNoFuso(vista?.casa?.tz || 'America/Sao_Paulo');
const membro = (id) => vista.membros.find((m) => m.id === id);
// Ordem da casa em todo lugar: cachorros primeiro, depois as pessoas; cada grupo em ordem alfabética.
const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
const pessoas = () => vista.membros.filter((m) => m.tipo === 'pessoa').sort(porNome);
const pets = () => vista.membros.filter((m) => m.tipo === 'pet').sort(porNome);
const membrosEmOrdem = () => [...pets(), ...pessoas()];
const habitosDe = (ids) => vista.habitos.filter((h) => !h.arquivado && ids.includes(h.membro)).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
const salvarPrefs = () => LS.set('painel-prefs', prefs);

function ctxLocal(id) {
  let n = 0;
  return { quem: eu, agora: new Date().toISOString(), hoje: hoje(), novoId: () => `${id}.${n++}` };
}

function recompor() {
  if (!servidor) { vista = null; return; }
  vista = clone(servidor);
  for (const a of fila) {
    try { aplicar(vista, a, ctxLocal(a.id)); } catch { /* o servidor vai recusar e avisar */ }
  }
}

// ---------------------------------------------------------------- ações
/**
 * Faz uma ação: aplica aqui na hora, põe na fila e manda para o servidor.
 * @returns o resultado local (com `fala` e `desfazer`), ou null se foi recusada aqui mesmo.
 */
function agir(tipo, dados = {}, { silencioso = false, semDesfazer = false } = {}) {
  if (!vista) return null;
  const acao = { id: gerarId(), tipo, dados };
  let r;
  try {
    r = aplicar(vista, acao, ctxLocal(acao.id));
  } catch (e) {
    recompor();
    toast(e.message, { erro: true });
    return null;
  }
  if (tipo === 'captura' && r.desfazer === null) {
    recompor();
    perguntar(r, dados.texto);
    return r;
  }
  fila.push(acao);
  LS.set(K('painel-fila'), fila);
  render();
  if (!silencioso) toast(r.fala, { desfazer: !semDesfazer && r.desfazer ? () => agir(r.desfazer.tipo, r.desfazer.dados, { semDesfazer: true }) : null });
  if (!silencioso && (tipo === 'mercado.adicionar' || tipo === 'captura')) perguntarSecao(r);
  enviar();
  return r;
}

/**
 * Item novo que o app não sabe onde fica (caiu em "Outros"): pergunta na hora, com as seções em
 * chips. Um toque e o app aprende — da próxima vez esse item já cai no lugar certo.
 */
function perguntarSecao(r) {
  const novos = r.resultado?.novos || [];
  const i = vista.mercado.find((x) => novos.includes(x.nome) && x.secao === 'Outros' && !x.comprado_em);
  if (!i) return;
  toast(`Em que seção fica ${i.nome.toLowerCase()}?`, {
    opcoes: [...vista.secoes.filter((s) => s !== 'Outros').map((s) => ({
      rotulo: s,
      fn: () => { agir('mercado.editar', { id: i.id, secao: s }, { silencioso: true }); toast(`Aprendi: ${i.nome.toLowerCase()} fica em ${s}.`); },
    })), { rotulo: 'Deixar em Outros', fn: () => {} }],
  });
}

let enviando = false;
async function enviar() {
  if (enviando || !token) return;
  enviando = true;
  let mandou = false;
  try {
    while (fila.length) {
      const a = fila[0];
      let res;
      try {
        res = await fetch(api('/acao'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(a) });
      } catch {
        setConexao('off');
        break;
      }
      if (res.status === 401) { mostrarParear(); break; }
      if (res.status >= 500) { setConexao('erro'); break; }
      fila.shift();
      LS.set(K('painel-fila'), fila);
      mandou = true;
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        // a tela é nova e o servidor ainda roda o código velho: dizer o que fazer, não o erro técnico
        if (/^Ação desconhecida/.test(j.erro || '')) toast('O servidor do computador está desatualizado. Lá: Ctrl+C e npm start, depois tente de novo.', { erro: true, tempo: 10000 });
        else toast(`Não salvou: ${j.erro || res.status}`, { erro: true });
      }
    }
  } finally {
    enviando = false;
  }
  if (mandou) carregar();
}

async function carregar() {
  if (!token) return mostrarParear();
  let res;
  try {
    res = await fetch(api('/estado'), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  } catch {
    setConexao('off');
    return;
  }
  if (res.status === 401) return mostrarParear();
  if (!res.ok) { setConexao('erro'); return; }
  const j = await res.json();
  servidor = j.estado;
  eu = j.eu;
  if (NUVEM) ouvirNuvem(j.casa);
  LS.set(K('painel-estado'), servidor);
  LS.set(K('painel-eu'), eu);
  setConexao('ok');
  recompor();
  render();
  if (fila.length) enviar();
}

function setConexao(c) {
  if (conexao === c) return;
  conexao = c;
  $$('[data-mod="sync"]').forEach(renderSync);
}

let fonte = null, canalNuvem = null;
/** Na nuvem: o servidor avisa a versão nova pelo Realtime do Supabase (canal casa-<id>). */
function ouvirNuvem(casaId) {
  if (canalNuvem || !casaId) return;
  if (!window.supabase) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
    s.onload = () => ouvirNuvem(casaId);
    s.onerror = () => setConexao('off');
    document.head.append(s);
    return;
  }
  const sb = window.supabase.createClient(NUVEM.supabaseUrl, NUVEM.supabaseKey);
  canalNuvem = sb.channel(`casa-${casaId}`)
    .on('broadcast', { event: 'versao' }, (m) => {
      setConexao('ok');
      if (!servidor || m.payload?.versao !== servidor.versao) carregar();
      if (fila.length) enviar();
    })
    .subscribe((st) => { if (st === 'SUBSCRIBED') setConexao('ok'); else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') setConexao('off'); });
}
function ouvir() {
  if (NUVEM) return; // na nuvem, ouvirNuvem() liga depois do primeiro carregar()
  if (!token || !('EventSource' in window)) return;
  fonte?.close();
  fonte = new EventSource(`/api/eventos?t=${encodeURIComponent(token)}`);
  fonte.addEventListener('versao', (e) => {
    const v = Number(e.data);
    setConexao('ok');
    if (!servidor || v !== servidor.versao) carregar();
    if (fila.length) enviar();
  });
  fonte.onerror = () => setConexao('off');
}

// ---------------------------------------------------------------- toast e pergunta
let toastTimer;
function toast(msg, { desfazer = null, erro = false, opcoes = null, tempo = 5000 } = {}) {
  if (!msg) return;
  $('.toast')?.remove();
  clearTimeout(toastTimer);
  const t = document.createElement('div');
  t.className = 'toast' + (erro ? ' erro' : '') + (opcoes ? ' pergunta' : '');
  t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  const botoes = opcoes || (desfazer ? [{ rotulo: 'Desfazer', fn: desfazer }] : []);
  if (botoes.length) {
    const box = document.createElement('div');
    box.className = 'opts';
    for (const b of botoes) {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = b.rotulo;
      el.onclick = () => { t.remove(); b.fn(); };
      box.append(el);
    }
    t.append(box);
  }
  document.body.append(t);
  toastTimer = setTimeout(() => t.remove(), opcoes ? 12000 : tempo);
}

/** A captura ficou ambígua: mostrar a pergunta com botões em vez de chutar. */
function perguntar(r, texto) {
  const it = r.resultado?.interpretacao;
  const ops = (it?.opcoes || []).map((o) => {
    if (o === 'mercado') return { rotulo: 'Mercado', fn: () => agir('mercado.adicionar', { texto }) };
    if (o === 'pendencia') return { rotulo: 'Pendência', fn: () => agir('pendencia.criar', { titulo: texto.charAt(0).toUpperCase() + texto.slice(1) }) };
    const h = vista.habitos.find((x) => x.id === o);
    if (!h) return null;
    const dono = membro(h.membro)?.nome || '';
    return { rotulo: `${h.emoji || ''} ${h.nome}${dono ? ` (${dono})` : ''}`, fn: () => marcarHab(h.id) };
  }).filter(Boolean);
  toast(r.fala, ops.length ? { opcoes: ops } : { tempo: 7000 });
}

// ---------------------------------------------------------------- sheet
function sheet(html, montar) {
  $('.veu')?.remove();
  const v = document.createElement('div');
  v.className = 'veu';
  v.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button type="button" class="icone fechar" aria-label="Fechar">✕</button>${html}</div>`;
  const fechar = () => { v.remove(); document.removeEventListener('keydown', esc_); render(); };
  const esc_ = (e) => { if (e.key === 'Escape') fechar(); };
  v.addEventListener('click', (e) => { if (e.target === v || e.target.closest('.fechar')) fechar(); });
  document.addEventListener('keydown', esc_);
  document.body.append(v);
  montar?.($('.sheet', v), fechar);
  return fechar;
}

// ---------------------------------------------------------------- hábitos
function estadoDe(h) {
  return estadoHabito(h, vista.eventos.filter((e) => e.habito === h.id), hoje(), vista.casa.inicio_semana);
}
function habRow(h) {
  const s = estadoDe(h);
  let alvo, sub = '', seq;
  if (s.tipo === 'check') {
    alvo = s.feito ? '✓' : esc(h.emoji || '•');
    seq = `${s.seq}<small>dias</small>`;
    const m = membro(h.membro);
    if (m?.tipo === 'pet' && s.feito) {
      const ult = vista.eventos.filter((e) => e.habito === h.id && e.data === hoje()).at(-1);
      const p = ult && membro(ult.por);
      if (p) sub = `<small>por ${esc(p.nome)}</small>`;
    }
  } else if (s.tipo === 'qtd') {
    alvo = s.feito ? '✓' : `+${h.unidade === 'ml' && h.passo >= 1000 ? h.passo / 1000 + 'L' : fmtN(h.passo || 1)}`;
    const pct = Math.min(100, (s.valor / s.meta) * 100);
    sub = `<small class="num">${fmtN(s.valor)} / ${fmtN(s.meta)} ${esc(h.unidade || '')}</small><div class="barra-prog"><i style="width:${pct}%"></i></div>`;
    seq = `${s.seq}<small>dias</small>`;
  } else if (s.tipo === 'semana') {
    alvo = s.feitoHoje ? '✓' : esc(h.emoji || '•');
    const pontos = Array.from({ length: s.meta }, (_, i) => `<i class="${i < s.feitosSemana ? 'on' : ''}"></i>`).join('');
    sub = `<small>${s.feitosSemana} de ${s.meta} na semana</small><span class="pontos">${pontos}</span>`;
    seq = `${s.seq}<small>${s.seq === 1 ? 'semana' : 'semanas'}</small>`;
  } else {
    alvo = 'deslizei';
    sub = `<small>recorde ${s.recorde} dias</small>`;
    seq = `${s.diasSem}<small>dias sem</small>`;
  }
  const cls = ['hab', s.tipo === 'evitar' ? 'evitar' : '', s.feito ? 'feito' : ''].join(' ');
  const rot = s.tipo === 'evitar' ? `Registrar deslize em ${h.nome}` : `Marcar ${h.nome}`;
  // a linha inteira marca; tocar e segurar abre o histórico
  return `<button type="button" class="${cls}" data-hab-marcar="${esc(h.id)}" data-segurar="${esc(h.id)}" aria-label="${esc(rot)}. Segure para ver o histórico">
    <span class="alvo">${alvo}</span>
    <span class="nome">${s.tipo === 'evitar' ? esc(h.emoji || '') + ' ' : ''}${esc(h.nome)}${sub}</span>
    <span class="seq num">${seq}</span></button>`;
}
/** Anel SVG: progresso de 0 a 1, ou `gomos` iguais (semana: 3 vezes = 3 gomos). */
function anel(p, gomos = 0, feitos = 0) {
  const r = 28, C = 2 * Math.PI * r;
  const base = `<circle class="fundo" cx="32" cy="32" r="${r}"/>`;
  if (gomos) {
    const seg = C / gomos, vao = gomos > 1 ? 6 : 0;
    const arcos = Array.from({ length: gomos }, (_, i) => `<circle class="${i < feitos ? 'prog' : 'fundo'}" cx="32" cy="32" r="${r}" stroke-dasharray="${seg - vao} ${C}" stroke-dashoffset="${-i * seg}"/>`).join('');
    return `<svg viewBox="0 0 64 64" aria-hidden="true">${arcos}</svg>`;
  }
  const v = Math.max(0, Math.min(1, p));
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${base}${v > 0 ? `<circle class="prog" cx="32" cy="32" r="${r}" stroke-dasharray="${v * C} ${C}"/>` : ''}</svg>`;
}
const brilho = {};
/** Hábito em mosaico (painel): o anel conta a história do tipo. Toque no mosaico marca; no nome, abre o detalhe. */
function habTile(h) {
  const s = estadoDe(h);
  let svg, dentro = `<span class="emoji">${esc(h.emoji || '•')}</span>`, sub;
  if (s.tipo === 'qtd') {
    svg = anel(s.valor / s.meta);
    sub = `${fmtN(h.unidade === 'ml' && s.meta >= 1000 ? s.valor / 1000 : s.valor)}/${fmtN(h.unidade === 'ml' && s.meta >= 1000 ? s.meta / 1000 : s.meta)} ${h.unidade === 'ml' && s.meta >= 1000 ? 'L' : esc(h.unidade || '')}`;
  } else if (s.tipo === 'semana') {
    svg = anel(0, s.meta, s.feitosSemana);
    sub = `${s.feitosSemana} de ${s.meta} · ${s.seq} sem.`;
  } else if (s.tipo === 'evitar') {
    svg = anel(Math.min(1, s.diasSem / Math.max(7, s.recorde || 7)));
    dentro = `<span class="dentro num">${s.diasSem}</span>`;
    sub = s.diasSem === 1 ? '1 dia sem' : `${s.diasSem} dias sem`;
  } else {
    svg = anel(s.feito ? 1 : 0);
    sub = s.seq ? `${s.seq} ${s.seq === 1 ? 'dia' : 'dias'}` : 'hoje';
  }
  // nos cachorros, dois "Passear" precisam dizer de quem é
  const dono = membro(h.membro);
  if (dono?.tipo === 'pet') sub = `${dono.nome} · ${sub}`;
  const brilhou = s.feito && Date.now() - (brilho[h.id] || 0) < 1500;
  const rot = s.tipo === 'evitar' ? `Registrar deslize em ${h.nome}` : s.tipo === 'qtd' ? `Somar ${h.passo} ${h.unidade || ''} em ${h.nome}` : `Marcar ${h.nome}`;
  // o mosaico inteiro marca; tocar e segurar abre o histórico
  return `<button type="button" class="tile ${s.tipo} ${s.feito ? 'feito' : ''} ${brilhou ? 'brilha' : ''}" data-hab-marcar="${esc(h.id)}" data-segurar="${esc(h.id)}" aria-label="${esc(rot)}. Segure para ver o histórico">
    <span class="anel">${svg}${dentro}</span>
    ${s.feito ? '<span class="ok" aria-hidden="true">✓</span>' : ''}
    <span class="t">${esc(h.nome)}</span><span class="s num">${sub}</span>
  </button>`;
}

function marcarHab(id) {
  const h = vista.habitos.find((x) => x.id === id);
  if (!h) return;
  brilho[id] = Date.now();
  const s = estadoDe(h);
  if (h.tipo === 'qtd') {
    if (s.feito) return toast(`${h.nome}: meta de hoje batida. Para corrigir, toque no nome.`);
    return agir('habito.somar', { habito: id, valor: h.passo || 1 });
  }
  if (h.tipo === 'evitar') return agir('habito.deslize', { habito: id });
  return agir('habito.marcar', { habito: id });
}
function detalheHab(id) {
  const h = vista.habitos.find((x) => x.id === id);
  if (!h) return;
  const dono = membro(h.membro);
  const desenhar = (el) => {
    const s = estadoDe(h);
    const eventos = vista.eventos.filter((e) => e.habito === h.id);
    const hist = historico(h, eventos, hoje(), 56);
    const principal = s.tipo === 'evitar' ? [s.diasSem, 'dias sem'] : [s.seq, s.tipo === 'semana' ? 'semanas seguidas' : 'dias seguidos'];
    const dias = hist.slice(-7).reverse().map((d) => {
      const rot = d.dia === hoje() ? 'Hoje' : d.dia === somarDias(hoje(), -1) ? 'Ontem' : formatoCurto(d.dia);
      let estado, botoes;
      if (h.tipo === 'qtd') {
        estado = `${fmtN(d.soma)} ${esc(h.unidade || '')}`;
        botoes = `<button type="button" class="chip" data-corr="menos" data-dia="${d.dia}" aria-label="Tirar ${h.passo}">−</button><button type="button" class="chip" data-corr="mais" data-dia="${d.dia}" aria-label="Somar ${h.passo}">+${fmtN(h.passo || 1)}</button>`;
      } else if (h.tipo === 'evitar') {
        estado = d.soma > 0 ? 'deslize' : 'sem deslize';
        botoes = `<button type="button" class="chip" data-corr="alternar" data-dia="${d.dia}">${d.soma > 0 ? 'Tirar deslize' : 'Marcar deslize'}</button>`;
      } else {
        estado = d.soma > 0 ? 'feito' : '—';
        botoes = `<button type="button" class="chip" data-corr="alternar" data-dia="${d.dia}">${d.soma > 0 ? 'Desmarcar' : 'Marcar'}</button>`;
      }
      return `<div class="dia"><span><b>${rot}</b> <span class="muted">· ${estado}</span></span><span class="opts" style="display:flex;gap:6px">${botoes}</span></div>`;
    }).join('');
    el.innerHTML = `<div class="quem"><div class="av" style="color:${esc(dono?.cor || 'var(--pet)')}">${esc(h.emoji || dono?.emoji || '')}</div><strong>${esc(h.nome)}</strong></div>
      <div style="display:flex;gap:28px">
        <div><div class="relogio"><span class="hora num" style="font-size:2.4rem">${principal[0]}</span></div><span class="muted">${principal[1]}</span></div>
        <div><div class="relogio"><span class="hora num" style="font-size:2.4rem">${s.recorde}</span></div><span class="muted">recorde</span></div>
        ${s.tipo === 'semana' ? `<div><div class="relogio"><span class="hora num" style="font-size:2.4rem">${s.feitosSemana}/${s.meta}</span></div><span class="muted">nesta semana</span></div>` : ''}
      </div>
      <h3>Últimas 8 semanas</h3><div class="heat" aria-label="Mapa das últimas 8 semanas">${hist.map((d) => `<i class="${d.ok && (h.tipo !== 'evitar' || d.dia >= (h.criado_em || '')) ? 'on' : ''}" title="${formatoCurto(d.dia)}"></i>`).join('')}</div>
      <h3>Corrigir dias anteriores</h3><div class="dias">${dias}</div>
      <button type="button" class="botao sec" data-editar-hab="${esc(h.id)}">Editar hábito</button>`;
  };
  sheet('<div class="conteudo" style="display:flex;flex-direction:column;gap:16px"></div>', (el, fechar) => {
    const c = $('.conteudo', el);
    desenhar(c);
    c.addEventListener('click', (e) => {
      const b = e.target.closest('[data-corr]');
      if (b) {
        const dia = b.dataset.dia;
        if (b.dataset.corr === 'alternar') agir('habito.marcar', { habito: h.id, data: dia }, { silencioso: true });
        else agir('habito.somar', { habito: h.id, data: dia, valor: (b.dataset.corr === 'menos' ? -1 : 1) * (h.passo || 1) }, { silencioso: true });
        desenhar(c);
        return;
      }
      if (e.target.closest('[data-editar-hab]')) { fechar(); editarHab(h.id); }
    });
  });
}
const TIPOS_HAB = { check: 'Feito / não feito', qtd: 'Com quantidade', semana: 'X vezes por semana', evitar: 'Evitar (conta dias sem)' };
const CARTOES_TIPO = [
  ['check', '✓', 'Feito ou não', 'meditar, skincare'],
  ['qtd', '💧', 'Com quantidade', '2 L de água, 20 min'],
  ['semana', '📅', 'Vezes por semana', 'treino 3x'],
  ['evitar', '🚫', 'Evitar', 'sem doce: conta os dias sem'],
];
// unidade → [meta padrão, passo do botão, passo do contador]
const UNIDADES = { ml: [2000, 250, 250], L: [2, 1, 1], min: [20, 10, 5], 'páginas': [10, 5, 5], vezes: [2, 1, 1], km: [5, 1, 1], passos: [8000, 1000, 1000] };
/** Rotina nova ou editada, toda por toque: só o nome é digitado. */
function editarHab(id, membroPadrao = null) {
  const h = id ? vista.habitos.find((x) => x.id === id) : { nome: '', emoji: '🌱', tipo: 'check', membro: membroPadrao || (eu !== 'casa' ? eu : pessoas()[0]?.id), meta: 2000, unidade: 'ml', passo: 250, vezes_semana: 3, apelidos: [] };
  const un = UNIDADES[h.unidade] ? h.unidade : 'ml';
  sheet(`<h2>${id ? 'Editar rotina' : 'Nova rotina'}</h2>
    <form class="conteudo" style="display:flex;flex-direction:column;gap:16px">
      <div class="campo"><label for="h-nome">Nome</label><input id="h-nome" type="text" required maxlength="40" value="${esc(h.nome)}" placeholder="Ex.: Alongar"></div>
      <div class="campo"><span class="rot">Ícone</span>${gradeEmojis('emoji', EMOJIS_ROTINA, h.emoji)}</div>
      <div class="campo"><span class="rot">De quem</span>${quemOp('membro', membrosEmOrdem(), h.membro, { comCasa: false })}</div>
      <div class="campo"><span class="rot">Como conta</span>${opcoes('tipo', CARTOES_TIPO.map(([k, ic, t, ex]) => [k, `<span class="ic">${ic}</span><b>${t}</b><small>${ex}</small>`]), h.tipo, { classe: 'cartoes' })}</div>
      <div class="campo" data-so="qtd"><span class="rot">Unidade</span>${opcoes('unidade', Object.keys(UNIDADES).map((u) => [u, u]), un)}
        <span class="rot">Meta por dia</span>${contador('meta', h.meta ?? UNIDADES[un][0], { passo: UNIDADES[un][2], min: 1, unidade: un })}
        <span class="rot">Cada toque soma</span>${contador('passo', h.passo ?? UNIDADES[un][1], { passo: UNIDADES[un][2], min: 1, unidade: un })}</div>
      <div class="campo" data-so="semana"><span class="rot">Vezes por semana</span>${opcoes('vezes', [1, 2, 3, 4, 5, 6, 7].map((n) => [n, `${n}x`]), h.vezes_semana ?? 3)}</div>
      <details class="campo"><summary class="rot">Palavras para a voz (opcional)</summary>
        <input id="h-apelidos" type="text" value="${esc((h.apelidos || []).join(', '))}" placeholder="treinei, academia, malhei"><span class="dica">Separadas por vírgula.</span></details>
      <button type="submit" class="botao">Salvar</button>
      ${id ? `<button type="button" class="botao ${h.arquivado ? 'sec' : 'perigo'}" data-arquivar>${h.arquivado ? 'Voltar para o painel' : 'Arquivar'}</button>` : ''}
    </form>`, (el, fechar) => {
    const f = $('form', el);
    const ajustar = () => { const t = valor(f, 'tipo'); $$('[data-so]', f).forEach((x) => { x.hidden = x.dataset.so !== t; }); };
    ajustar();
    ligarEntradas(f, (nome, v) => {
      if (nome === 'tipo') ajustar();
      if (nome === 'unidade') {
        const [meta, passo, pc] = UNIDADES[v];
        definirContador(f, 'meta', meta, { passo: pc, unidade: v });
        definirContador(f, 'passo', passo, { passo: pc, unidade: v });
      }
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const tipo = valor(f, 'tipo');
      const novo = {
        ...(id ? { id } : {}), nome: $('#h-nome', f).value.trim(), emoji: valor(f, 'emoji'), membro: valor(f, 'membro'), tipo,
        apelidos: $('#h-apelidos', f).value.split(',').map((x) => normalizar(x)).filter(Boolean),
      };
      if (tipo === 'qtd') Object.assign(novo, { meta: Number(valor(f, 'meta')), unidade: valor(f, 'unidade'), passo: Number(valor(f, 'passo')) });
      if (tipo === 'semana') novo.vezes_semana = Number(valor(f, 'vezes'));
      if (agir('habito.salvar', { habito: novo })) fechar();
    });
    $('[data-arquivar]', f)?.addEventListener('click', () => { agir('habito.arquivar', { id, arquivado: !h.arquivado }); fechar(); });
  });
}

// ---------------------------------------------------------------- mercado
function itensOrdenados() {
  const ord = (i) => { const k = vista.secoes.indexOf(i.secao); return k < 0 ? 99 : k; };
  return [...vista.mercado].sort((a, b) => (ord(a) - ord(b)) || a.nome.localeCompare(b.nome, 'pt-BR'));
}
/** Item com bolinha: tocar marca ✓, risca e o item some da lista (com desfazer no aviso). */
function itemRow(i, editar) {
  const btn = `<button type="button" class="item" data-item="${esc(i.id)}" aria-label="Pegou: ${esc(i.nome)}">
    <span class="bola" aria-hidden="true"></span><span class="n">${esc(i.nome)}</span></button>`;
  if (!editar) return btn;
  // no celular, ⋯ edita quantidade e seção
  return `<div class="linha-item">${btn}<button type="button" class="mexer" data-item-edit="${esc(i.id)}" aria-label="Editar ${esc(i.nome)}">⋯</button></div>`;
}
function renderMercado(el) {
  const agrupar = el.dataset.agrupar === '1';
  const editar = el.dataset.editar === '1';
  if (!el.dataset.pronto) {
    el.innerHTML = `<header><h2>Mercado</h2><button type="button" class="chip" data-a="mercado-rapido" aria-label="Escolher itens por toque">＋ Itens</button></header>
      ${el.dataset.semcampo ? '' : `<form class="anotar" data-form="mercado"><input name="texto" list="catalogo-lista" autocomplete="off" enterkeyhint="done" placeholder="leite, pão e 2 dúzias de ovos" aria-label="Adicionar itens ao mercado"><button type="submit">Adicionar</button></form>`}
      <div class="lista"></div>`;
    el.dataset.pronto = '1';
  }
  // só o que falta comprar; o que já foi pego some (fica guardado só para "desfazer" e para o app lembrar do item)
  const itens = itensOrdenados().filter((i) => !i.comprado_em);
  // item sem seção não pode ficar esquecido em "Outros": aviso no cabeçalho até alguém organizar
  const semSecao = itens.filter((i) => i.secao === 'Outros').length;
  let aviso = $('[data-a="organizar-secoes"]', el);
  if (semSecao && !aviso) { $('header', el).insertAdjacentHTML('beforeend', '<button type="button" class="chip alerta" data-a="organizar-secoes"></button>'); aviso = $('[data-a="organizar-secoes"]', el); }
  if (aviso) { if (semSecao) aviso.textContent = `Organizar ${semSecao}`; else aviso.remove(); }
  let corpo = '';
  if (agrupar) {
    let ultima = '';
    for (const i of itens) {
      if (i.secao !== ultima) { corpo += `<div class="sec">${esc(i.secao)}</div>`; ultima = i.secao; }
      corpo += itemRow(i, editar);
    }
  } else {
    corpo = itens.map((i) => itemRow(i, editar)).join('');
  }
  if (!itens.length) corpo = '<p class="vazio">Nada na lista. Toque em ＋ Itens ou escreva na barra do ＋.</p>';
  const lista = $('.lista', el);
  const rolagem = lista.scrollTop; // redesenhar (ex.: alguém marcou no celular) não pode jogar a lista para o topo
  lista.innerHTML = corpo;
  lista.scrollTop = rolagem;
}
/** Um item por vez: "Em que seção fica X?" com as seções em chips. Um toque e o app aprende. */
function organizarSecoes() {
  const desenhar = (c, fechar) => {
    const pend = vista.mercado.filter((i) => !i.comprado_em && i.secao === 'Outros');
    if (!pend.length) { fechar(); return toast('Tudo organizado. O app aprendeu as seções.'); }
    c.innerHTML = `<h2>Organizar</h2><p class="dica">Toque na seção de cada item. Da próxima vez, ele já cai no lugar certo.</p>
      ${pend.map((i) => `<div class="campo"><span class="rot">${esc(i.nome)}</span>${opcoes(`sec-${i.id}`, vista.secoes.filter((s) => s !== 'Outros').map((s) => [s, esc(s)]), '')}</div>`).join('')}`;
  };
  sheet('<div class="conteudo" style="display:flex;flex-direction:column;gap:16px"></div>', (s, fechar) => {
    const c = $('.conteudo', s);
    desenhar(c, fechar);
    c.addEventListener('click', (e) => {
      const b = e.target.closest('[data-grupo] [data-op]');
      if (!b) return;
      agir('mercado.editar', { id: b.closest('[data-grupo]').dataset.grupo.slice(4), secao: b.dataset.op }, { silencioso: true });
      desenhar(c, fechar);
    });
  });
}
function editarItem(id) {
  const i = vista.mercado.find((x) => x.id === id);
  if (!i) return;
  const QTDS = ['1', '2', '3', '4', '6', '12', '500 g', '1 kg', '2 kg', '1 L', '1 dúzia', '2 dúzias'];
  sheet(`<h2>${esc(i.nome)}</h2><form class="conteudo" style="display:flex;flex-direction:column;gap:16px">
    <div class="campo"><span class="rot">Quantidade</span>${opcoes('qtd', [['', 'Qualquer'], ...QTDS.map((q) => [q, q]), ...(i.qtd && !QTDS.includes(i.qtd) ? [[i.qtd, esc(i.qtd)]] : [])], i.qtd || '')}</div>
    <div class="campo"><span class="rot">Seção</span>${opcoes('secao', vista.secoes.map((s) => [s, esc(s)]), i.secao)}
    <span class="dica">Mudar a seção ensina o app: da próxima vez, ${esc(i.nome.toLowerCase())} já cai aqui.</span></div>
    <details class="campo"><summary class="rot">Renomear</summary><input id="i-nome" type="text" value="${esc(i.nome)}"></details>
    <p class="dica">Adicionado por ${esc(membro(i.adicionado_por)?.nome || 'painel da casa')} · ${new Date(i.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>
    <button type="submit" class="botao">Salvar</button><button type="button" class="botao perigo" data-remover>Tirar da lista</button></form>`, (el, fechar) => {
    const f = $('form', el);
    ligarEntradas(f);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const campos = { id, nome: $('#i-nome', f).value, qtd: valor(f, 'qtd') };
      if (valor(f, 'secao') !== i.secao) campos.secao = valor(f, 'secao');
      if (agir('mercado.editar', campos)) fechar();
    });
    $('[data-remover]', f).addEventListener('click', () => { agir('mercado.remover', { id }); fechar(); });
  });
}

// Sugestões por seção para a grade de toque (somam com o que a casa já comprou antes).
const SUGESTOES = {
  'Hortifrúti': ['Banana', 'Maçã', 'Tomate', 'Cebola', 'Alho', 'Batata', 'Alface', 'Limão', 'Abacate', 'Cenoura'],
  'Padaria': ['Pão francês', 'Pão de forma', 'Bisnaguinha'],
  'Açougue': ['Frango', 'Carne moída', 'Peixe'],
  'Frios e laticínios': ['Leite', 'Ovos', 'Queijo', 'Iogurte', 'Manteiga', 'Presunto'],
  'Mercearia': ['Arroz', 'Feijão', 'Café', 'Açúcar', 'Macarrão', 'Azeite', 'Aveia', 'Molho de tomate'],
  'Bebidas': ['Água com gás', 'Suco', 'Cerveja'],
  'Limpeza': ['Detergente', 'Sabão em pó', 'Amaciante', 'Esponja', 'Saco de lixo'],
  'Higiene': ['Papel higiênico', 'Sabonete', 'Pasta de dente', 'Shampoo'],
  'Pet': ['Ração', 'Petisco', 'Tapete higiênico'],
  'Outros': [],
};
/**
 * Mercado por toque: tudo o que a casa costuma comprar, por seção. Tocar põe na lista (fica
 * aceso); tocar de novo tira. Para o que não está aqui, um campo "Outro" no fim.
 */
function mercadoRapido() {
  let editando = false; // "Editar": tocar num item o esquece (digitado errado, não compra mais)
  const desenhar = (c) => {
    const naLista = new Map(vista.mercado.filter((i) => !i.comprado_em).map((i) => [i.nome_norm, i]));
    const porSecao = new Map(vista.secoes.map((s) => [s, new Map()]));
    for (const [s, nomes] of Object.entries(SUGESTOES)) for (const n of nomes) porSecao.get(s)?.set(normalizar(n), n);
    for (const [nn, cat] of Object.entries(vista.catalogo || {})) (porSecao.get(cat.secao) || porSecao.get('Outros'))?.set(nn, cat.nome);
    for (const i of naLista.values()) (porSecao.get(i.secao) || porSecao.get('Outros'))?.set(i.nome_norm, i.nome);
    const apagavel = (nn) => Boolean(vista.catalogo?.[nn]) || vista.mercado.some((i) => i.nome_norm === nn);
    c.innerHTML = `<div class="linha" style="align-items:center"><h2>Mercado</h2><button type="button" class="chip" data-rapido-editar>${editando ? 'Pronto' : '✎ Editar'}</button></div>
      <p class="dica">${editando ? 'Toque no ✕ para apagar um item (ex.: digitado errado). Dá para desfazer.' : 'Toque no que está faltando. Aceso = na lista. Toque de novo para tirar.'}</p>
      ${[...porSecao].filter(([, m]) => m.size).map(([s, m]) => `<div class="sec">${esc(s)}</div><div class="chips toque">${[...m].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')).map(([nn, nome]) => {
        if (editando) return apagavel(nn) ? `<button type="button" class="chip apagar" data-esquecer="${esc(nome)}" aria-label="Apagar ${esc(nome)}">✕ ${esc(nome)}</button>` : '';
        const it = naLista.get(nn);
        return `<button type="button" class="chip ${it ? 'on' : ''}" data-rapido="${esc(nome)}" ${it ? `data-rapido-id="${esc(it.id)}"` : ''} aria-pressed="${Boolean(it)}">${it ? '✓ ' : ''}${esc(nome)}</button>`;
      }).join('')}</div>`).join('')}
      <form class="anotar" data-rapido-outro style="margin-top:8px"><input name="texto" list="catalogo-lista" autocomplete="off" placeholder="Outro item…" aria-label="Outro item"><button type="submit">+</button></form>`;
  };
  sheet('<div class="conteudo" style="display:flex;flex-direction:column;gap:10px"></div>', (s) => {
    const c = $('.conteudo', s);
    desenhar(c);
    c.addEventListener('click', (e) => {
      if (e.target.closest('[data-rapido-editar]')) { editando = !editando; desenhar(c); return; }
      const x = e.target.closest('[data-esquecer]');
      if (x) { agir('catalogo.remover', { nome: x.dataset.esquecer }); desenhar(c); return; }
      const b = e.target.closest('[data-rapido]');
      if (!b) return;
      if (b.dataset.rapidoId) agir('mercado.remover', { id: b.dataset.rapidoId }, { silencioso: true });
      else agir('mercado.adicionar', { texto: b.dataset.rapido }, { silencioso: true });
      desenhar(c);
    });
    c.addEventListener('submit', (e) => {
      if (!e.target.closest('[data-rapido-outro]')) return;
      e.preventDefault();
      e.stopPropagation();
      const t = e.target.texto.value.trim();
      if (t) agir('mercado.adicionar', { texto: t });
      desenhar(c);
    });
  });
}

// ---------------------------------------------------------------- pendências
function pendOrdenadas() {
  const peso = (p) => (p.prazo ? diferencaDias(hoje(), p.prazo) : 99999);
  return vista.pendencias.filter((p) => pendenciaVisivel(p, hoje())).sort((a, b) => peso(a) - peso(b) || a.em.localeCompare(b.em));
}
/** Datas especiais ainda escondidas (fora da janela de aviso), para a lista completa. */
function proximasDatas() {
  return vista.pendencias.filter((p) => !p.concluida_em && !pendenciaVisivel(p, hoje())).sort((a, b) => a.prazo.localeCompare(b.prazo));
}
function prazoTag(iso, p = null) {
  if (!iso) return '<span class="prazo">sem prazo</span>';
  const d = diferencaDias(hoje(), iso);
  if (d < 0) return `<span class="prazo atrasada">${d === -1 ? 'ontem' : `há ${-d} dias`}</span>`;
  if (d === 0) return `<span class="prazo hoje">${p?.repete ? 'é hoje!' : 'hoje'}</span>`;
  // datas especiais contam os dias; tarefas mostram o dia
  if (p?.aviso_dias) return `<span class="prazo especial">${d === 1 ? 'amanhã' : `em ${d} dias`}</span>`;
  return `<span class="prazo">${d === 1 ? 'amanhã' : d < 7 ? formatoRelativo(iso, hoje()) : formatoCurto(iso)}</span>`;
}
function pendRow(p) {
  const r = p.resp ? membro(p.resp) : null;
  const sub = [p.repete ? `todo ano · ${formatoCurto(p.prazo).split(', ')[1]}` : (r ? `${r.emoji} ${r.nome}` : 'Casa'), p.nota].filter(Boolean).join(' · ');
  return `<div class="pend ${p.icone ? 'especial' : ''}"><button type="button" class="box" data-pend-ok="${esc(p.id)}" aria-label="${p.repete ? 'Feito este ano' : 'Concluir'}: ${esc(p.titulo)}">${p.icone ? `<span>${esc(p.icone)}</span>` : ''}</button>
    <button type="button" class="t" data-pend-edit="${esc(p.id)}" style="text-align:left">${esc(p.titulo)}<small>${esc(sub)}</small></button>${prazoTag(p.prazo, p)}</div>`;
}
function renderPend(el) {
  if (!el.dataset.pronto) {
    el.innerHTML = `<header><h2>Pendências</h2>${el.closest('.painel') ? '<button type="button" class="chip" data-a="nova-pendencia" aria-label="Nova pendência">＋</button>' : ''}</header>
      ${el.dataset.form === '1' ? '<button type="button" class="botao" data-a="nova-pendencia">＋ Nova pendência</button>' : ''}
      <div class="lista"></div>`;
    el.dataset.pronto = '1';
  }
  const ps = pendOrdenadas();
  const filtro = el.dataset.ate ? ps.filter((p) => p.prazo && diferencaDias(hoje(), p.prazo) <= Number(el.dataset.ate)) : ps;
  let corpo = filtro.map(pendRow).join('');
  if (!filtro.length) corpo = `<p class="vazio">${el.dataset.ate ? 'Nada para hoje.' : 'Nenhuma pendência. 🎉'}</p>`;
  // na lista completa (celular e "ver todas"), as datas especiais que ainda vão chegar
  if (el.dataset.proximas === '1') {
    const px = proximasDatas();
    if (px.length) corpo += `<div class="sec">Próximas datas</div>${px.map(pendRow).join('')}`;
  }
  const lista = $('.lista', el);
  const rolagem = lista.scrollTop;
  lista.innerHTML = corpo;
  lista.scrollTop = rolagem;
}

const TIPOS_PEND = [['tarefa', '✓ Tarefa'], ['aniversario', '🎂 Aniversário'], ['data', '📌 Data importante']];
/** Formulário por toque. Tarefa: quem e quando. Aniversário/data: dia, repete todo ano, avisar antes e (aniversário) presente. */
function formPendencia(p = null) {
  const tipo = p ? (p.repete ? (p.icone === '🎂' ? 'aniversario' : 'data') : 'tarefa') : 'tarefa';
  return `${p ? '' : `<div class="campo">${opcoes('tipo', TIPOS_PEND, tipo, { classe: 'tipos-pend' })}</div>`}
    <div class="campo"><label for="p-titulo" data-rot-titulo>${tipo === 'aniversario' ? 'De quem é o aniversário' : tipo === 'data' ? 'O que é' : 'O que precisa ser feito'}</label>
      <input id="p-titulo" type="text" required maxlength="80" enterkeyhint="done" value="${esc(p?.titulo || '')}" placeholder="${tipo === 'aniversario' ? 'Ex.: Ju' : 'Ex.: Pagar a conta de luz'}"></div>
    <div class="campo" data-so-tipo="tarefa"><span class="rot">Quem</span>${quemOp('resp', membrosEmOrdem(), p?.resp ?? '')}</div>
    <div class="campo" data-so-tipo="tarefa"><span class="rot">Quando</span>${prazos('prazo', hoje(), p?.repete ? '' : p?.prazo ?? '')}</div>
    <div class="campo" data-so-tipo="especial"><label for="p-dia">Dia</label><input id="p-dia" type="date" value="${esc(p?.repete ? p.prazo : '')}"><span class="dica">Repete todo ano.</span></div>
    <div class="campo" data-so-tipo="especial"><span class="rot">Começar a mostrar</span>${opcoes('aviso', [[3, '3 dias antes'], [7, '1 semana antes'], [14, '2 semanas antes'], [30, '1 mês antes']], p?.aviso_dias ?? 7)}</div>
    ${p ? '' : `<div class="campo" data-so-tipo="aniversario"><span class="rot">🎁 Lembrar de comprar presente</span>${opcoes('presente', [[0, 'Não'], [3, '3 dias antes'], [7, '1 semana antes'], [14, '2 semanas antes']], 7)}</div>`}
    <details class="campo" ${p?.nota ? 'open' : ''}><summary class="rot">Nota (opcional)</summary><input id="p-nota" type="text" maxlength="140" value="${esc(p?.nota || '')}"></details>`;
}
function ajustarTipoPend(f) {
  const t = valor(f, 'tipo') || f.dataset.tipo || 'tarefa';
  const especial = t === 'aniversario' || t === 'data';
  $$('[data-so-tipo]', f).forEach((x) => { const s = x.dataset.soTipo; x.hidden = !(s === t || (s === 'especial' && especial)); });
  const rot = $('[data-rot-titulo]', f);
  if (rot && valor(f, 'tipo')) {
    rot.textContent = t === 'aniversario' ? 'De quem é o aniversário' : t === 'data' ? 'O que é' : 'O que precisa ser feito';
    $('#p-titulo', f).placeholder = t === 'aniversario' ? 'Ex.: Ju' : t === 'data' ? 'Ex.: Aniversário de casamento' : 'Ex.: Pagar a conta de luz';
  }
}
function lerPendencia(f, p = null) {
  const t = $('#p-titulo', f).value.trim();
  const tipo = valor(f, 'tipo') || (p?.repete ? (p.icone === '🎂' ? 'aniversario' : 'data') : 'tarefa');
  const base = { nota: $('#p-nota', f).value };
  if (tipo === 'tarefa') return { ...base, tipo, titulo: t.charAt(0).toUpperCase() + t.slice(1), resp: valor(f, 'resp') || null, prazo: valor(f, 'prazo') || null, repete: null, aviso_dias: null, icone: p?.icone && !p.repete ? p.icone : null };
  const nome = t.charAt(0).toUpperCase() + t.slice(1);
  return {
    ...base, tipo, titulo: tipo === 'aniversario' && !p ? `Aniversário: ${nome}` : nome, resp: null, prazo: $('#p-dia', f).value || null,
    repete: 'anual', aviso_dias: Number(valor(f, 'aviso')), icone: tipo === 'aniversario' ? '🎂' : (p?.icone || '📌'), presente: Number(valor(f, 'presente') || 0), nomePessoa: nome,
  };
}
function novaPendencia() {
  sheet(`<h2>Nova pendência</h2><form class="conteudo" style="display:flex;flex-direction:column;gap:16px">${formPendencia()}<button type="submit" class="botao">Anotar</button></form>`, (el, fechar) => {
    const f = $('form', el);
    ajustarTipoPend(f);
    ligarEntradas(f, (nome) => { if (nome === 'tipo') ajustarTipoPend(f); });
    setTimeout(() => $('#p-titulo', f).focus(), 150);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = lerPendencia(f);
      if (d.tipo !== 'tarefa' && !d.prazo) return toast('Escolha o dia.', { erro: true });
      const { tipo, presente, nomePessoa, ...dados } = d;
      if (!agir('pendencia.criar', dados)) return;
      // aniversário com presente: uma segunda pendência anual, alguns dias antes, que aparece uma semana antes dela
      if (tipo === 'aniversario' && presente > 0) {
        agir('pendencia.criar', { titulo: `Comprar presente: ${nomePessoa}`, prazo: somarDias(dados.prazo, -presente), repete: 'anual', aviso_dias: 7, icone: '🎁', resp: eu !== 'casa' ? eu : null }, { silencioso: true });
        toast(`Anotei o aniversário de ${nomePessoa} e o lembrete do presente ${presente} dias antes.`);
      }
      fechar();
    });
  });
}
function editarPend(id) {
  const p = vista.pendencias.find((x) => x.id === id);
  if (!p) return;
  sheet(`<h2>Pendência</h2><form class="conteudo" style="display:flex;flex-direction:column;gap:16px">${formPendencia(p)}
    <button type="submit" class="botao">Salvar</button><button type="button" class="botao sec" data-ok>✓ Concluir</button><button type="button" class="botao perigo" data-remover>Remover</button></form>`, (el, fechar) => {
    const f = $('form', el);
    f.dataset.tipo = p.repete ? 'especial' : 'tarefa';
    ajustarTipoPend(f);
    ligarEntradas(f);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const { tipo, presente, nomePessoa, ...dados } = lerPendencia(f, p);
      if (p.repete && !dados.prazo) return toast('Escolha o dia.', { erro: true });
      if (agir('pendencia.editar', { id, ...dados })) fechar();
    });
    $('[data-ok]', f).addEventListener('click', () => { agir('pendencia.concluir', { id }); fechar(); });
    $('[data-remover]', f).addEventListener('click', () => { agir('pendencia.remover', { id }); fechar(); });
  });
}

/** O "+" do painel e do celular: blocos grandes para as entradas mais comuns. */
function adicionarRapido() {
  const ps = pessoas();
  sheet(`<h2>Adicionar</h2>
    <div class="rapido">
      <button type="button" data-rap="mercado"><span>🛒</span><b>Mercado</b><small>tocar no que falta</small></button>
      <button type="button" data-rap="pendencia"><span>✓</span><b>Pendência</b><small>o que precisa ser feito</small></button>
      ${ps.map((p) => `<button type="button" data-rap="dia" data-quem="${esc(p.id)}"><span>${esc(p.emoji)}</span><b>Dia de ${esc(p.nome)}</b><small>humor, energia, rotina</small></button>`).join('')}
      <button type="button" data-rap="rotina"><span>🌱</span><b>Nova rotina</b><small>para alguém da casa</small></button>
    </div>
    <p class="dica">Prefere falar? Toque na barra do ＋ e use o 🎤 do teclado: “leite e pão”, “treinei”, “pendência: IPTU até sexta”.</p>`, (el, fechar) => {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rap]');
      if (!b) return;
      fechar();
      const r = b.dataset.rap;
      if (r === 'mercado') mercadoRapido();
      else if (r === 'pendencia') novaPendencia();
      else if (r === 'dia') pessoaMenu(b.dataset.quem);
      else editarHab(null);
    });
  });
}

// ---------------------------------------------------------------- registro do dia
function escala(rot, v) {
  const ic = (rot === 'Energia' ? CARAS_ENERGIA : CARAS_HUMOR)[(v || 0) - 1];
  return `<div class="escala"><span>${rot}</span>${ic ? `<span class="cara">${ic}</span>` : ''}<span class="p">${[1, 2, 3, 4, 5].map((n) => `<i class="${v && n <= v ? 'on' : ''}"></i>`).join('')}</span></div>`;
}
function renderRegistro(el) {
  const ids = el.dataset.pessoa ? [el.dataset.pessoa] : pessoas().map((p) => p.id);
  el.innerHTML = ids.map((id) => {
    const r = vista.registro?.[id]?.[hoje()] || {};
    const vazio = !r.humor && !r.energia;
    // o destaque é privado: aqui (que a casa vê) só humor e energia
    return `${ids.length > 1 ? `<div class="sec">${esc(membro(id)?.emoji)} ${esc(membro(id)?.nome)}</div>` : ''}
      <button type="button" class="reg" data-reg="${esc(id)}" aria-label="Como está o dia de ${esc(membro(id)?.nome)}">
      ${vazio ? '<span class="vazio">Como está o dia? Toque para marcar</span>' : escala('Humor', r.humor) + escala('Energia', r.energia)}</button>`;
  }).join('');
}
function gradeEscala(campo, v) { return caras(campo, v); }

// ---------------------------------------------------------------- menu da pessoa
/**
 * Tocar no nome ou no emoji de alguém (ou dos cachorros) abre tudo daquela pessoa: o dia de hoje
 * (humor, energia, destaque — só para pessoas), a rotina com marcar/editar/arquivar, e "+ Nova rotina".
 * @param {string} id id do membro, ou 'pets' para os cachorros juntos
 */
function pessoaMenu(id) {
  const ehPets = id === 'pets';
  const p = ehPets ? null : membro(id);
  if (!ehPets && !p) return;
  const donos = ehPets ? pets().map((x) => x.id) : [id];
  const podeRegistro = !ehPets && p.tipo === 'pessoa' && (eu === 'casa' || eu === id);
  const desenhar = (el) => {
    const r = podeRegistro ? vista.registro?.[id]?.[hoje()] || {} : null;
    const hs = vista.habitos.filter((h) => donos.includes(h.membro)).sort((a, b) => (a.arquivado - b.arquivado) || (a.ordem ?? 0) - (b.ordem ?? 0));
    el.innerHTML = `<div class="quem" style="--cor:${esc(ehPets ? 'var(--pet)' : p.cor)}"><div class="av">${ehPets ? '🐶' : esc(p.emoji)}</div><strong>${ehPets ? esc(pets().map((x) => x.nome).join(' e ')) : esc(p.nome)}</strong></div>
      ${r ? `<h3>Hoje</h3><div class="rot">Humor</div>${gradeEscala('humor', r.humor)}<div class="rot">Energia</div>${gradeEscala('energia', r.energia)}
        ${eu === id ? `<div class="campo"><label for="pm-destaque">Destaque do dia <span class="privado-tag">🔒 só você vê</span></label><textarea id="pm-destaque" maxlength="280" placeholder="O melhor do dia, em uma ou duas linhas">${esc(vista.privado?.[id]?.[hoje()]?.destaque || '')}</textarea></div>` : ''}` : ''}
      <div class="linha" style="align-items:center"><h3>Rotina</h3><button type="button" class="chip" data-nova-rotina>+ Nova rotina</button></div>
      <div class="lista" style="overflow:visible">${hs.filter((h) => !h.arquivado).map((h) => `<div style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px">${habRow(h)}<button type="button" class="mexer" data-editar-rotina="${esc(h.id)}" aria-label="Editar ${esc(h.nome)}">✎</button></div>`).join('') || '<p class="vazio">Nenhuma rotina ainda.</p>'}</div>
      ${hs.some((h) => h.arquivado) ? `<details><summary class="dica">Arquivadas (${hs.filter((h) => h.arquivado).length})</summary>${hs.filter((h) => h.arquivado).map((h) => `<div class="linha-hab arq"><span>${esc(h.emoji || '•')}</span><span>${esc(h.nome)}</span><button type="button" class="chip" data-editar-rotina="${esc(h.id)}">Reativar</button></div>`).join('')}</details>` : ''}
      <p class="dica">Toque na rotina para marcar; segure para ver o histórico e corrigir dias; ✎ para editar ou arquivar.</p>`;
  };
  sheet('<div class="conteudo" style="display:flex;flex-direction:column;gap:14px"></div>', (s, fechar) => {
    const c = $('.conteudo', s);
    desenhar(c);
    c.addEventListener('click', (e) => {
      const b = e.target.closest('.escolha [data-v]');
      if (b) {
        const campo = b.parentElement.dataset.campo, v = Number(b.dataset.v);
        const atual = vista.registro?.[id]?.[hoje()]?.[campo];
        agir('registro.salvar', { membro: id, campos: { [campo]: atual === v ? null : v } }, { silencioso: true });
        $$('button', b.parentElement).forEach((x) => x.classList.toggle('on', x === b && atual !== v));
        return;
      }
      if (e.target.closest('[data-hab-marcar]')) { setTimeout(() => desenhar(c), 50); return; }
      if (e.target.closest('[data-nova-rotina]')) { fechar(); return editarHab(null, ehPets ? pets()[0]?.id : id); }
      const ed = e.target.closest('[data-editar-rotina]');
      if (ed) { fechar(); return editarHab(ed.dataset.editarRotina); }
    });
    const salvarDestaque = debounce((v) => agir('privado.salvar', { campos: { destaque: v } }, { silencioso: true }), 700);
    c.addEventListener('input', (e) => { if (e.target.id === 'pm-destaque') salvarDestaque(e.target.value); });
  });
}

// ---------------------------------------------------------------- módulos pequenos
/** Fase da lua, calculada aqui mesmo (sem internet): idade desde uma lua nova conhecida. */
function lua(agora = new Date()) {
  const SINODICO = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const idade = (((agora - ref) / 86400000) % SINODICO + SINODICO) % SINODICO;
  const fases = [[1.85, '🌑', 'Lua nova'], [5.54, '🌒', 'Lua crescente'], [9.23, '🌓', 'Quarto crescente'], [12.92, '🌔', 'Crescente gibosa'],
    [16.61, '🌕', 'Lua cheia'], [20.30, '🌖', 'Minguante gibosa'], [23.99, '🌗', 'Quarto minguante'], [27.68, '🌘', 'Lua minguante'], [99, '🌑', 'Lua nova']];
  const [, ic, nome] = fases.find(([lim]) => idade < lim);
  const ate = Math.round(idade < 14.77 ? 14.77 - idade : SINODICO - idade);
  return { ic, nome, dias: ate <= 1 ? (idade < 14.77 ? 'cheia hoje ou amanhã' : 'nova hoje ou amanhã') : idade < 14.77 ? `cheia em ${ate} dias` : `nova em ${ate} dias` };
}
function horaDaCasa(agora = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: vista?.casa?.tz || 'America/Sao_Paulo' }).format(agora));
}
function renderRelogio(el) {
  const agora = new Date();
  const tz = vista?.casa?.tz || 'America/Sao_Paulo';
  const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(agora);
  const data = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(agora);
  const h = horaDaCasa(agora);
  const saud = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
  const l = lua(agora);
  el.innerHTML = `<span class="saudacao">${saud}, casa</span><span class="hora num">${hora}</span>
    <span class="data">${data.charAt(0).toUpperCase() + data.slice(1)}</span><span class="lua"><i aria-hidden="true">${l.ic}</i><span><b>${l.nome}</b>${l.dias}</span></span>`;
}
function renderQuem(el) {
  const p = membro(el.dataset.pessoa);
  if (!p) return;
  const hs = habitosDe([p.id]);
  const n = hs.filter((h) => estadoDe(h).feito).length;
  const conta = hs.filter((h) => h.tipo !== 'evitar').length;
  el.style.setProperty('--cor', p.cor);
  el.dataset.pessoaMenu = p.id;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `Rotina e dia de ${p.nome}`);
  el.innerHTML = `<div class="av">${esc(p.emoji)}</div><strong>${esc(p.nome)}</strong>${conta ? `<span class="muted num" style="margin-left:auto">${n} de ${conta} hoje</span>` : ''}`;
}
function renderHabitos(el) {
  const d = el.dataset.dono;
  const donos = d === 'pets' ? pets().map((p) => p.id) : d === 'todos' ? membrosEmOrdem().map((m) => m.id) : [d === 'eu' ? eu : d];
  const mosaico = el.classList.contains('fila');
  let html = '';
  for (const id of donos) {
    const hs = habitosDe([id]);
    if (!hs.length) continue;
    if (donos.length > 1 && el.dataset.rotulos !== '0') html += `<div class="sec">${esc(membro(id)?.emoji)} ${esc(membro(id)?.nome)}</div>`;
    html += hs.map(mosaico ? habTile : habRow).join('');
  }
  el.innerHTML = html || '<p class="vazio">Nenhuma rotina ainda. Toque no nome para criar.</p>';
  if (mosaico) el.classList.toggle('transborda', el.scrollWidth > el.clientWidth + 2);
}
function renderSync(el) {
  const n = fila.length;
  const txt = conexao === 'ok' ? (n ? `enviando ${n}…` : 'ao vivo') : conexao === 'erro' ? 'erro no servidor' : (n ? `offline · ${n} na fila` : 'offline');
  el.innerHTML = `<span class="selo-sync ${conexao === 'ok' ? '' : conexao}"><i></i>${txt}</span>`;
}
function renderCaptura(el) {
  if (el.dataset.pronto) return;
  el.innerHTML = `<form class="anotar captura" data-form="captura"><input name="texto" autocomplete="off" enterkeyhint="send" placeholder="Escreva ou fale: “leite e pão”, “treinei”…" aria-label="Anotar rápido"><button type="submit" class="mais-barra" aria-label="Adicionar">＋</button></form>`;
  el.dataset.pronto = '1';
}

// ---------------------------------------------------------------- fotos
// Carrossel no estilo das memórias do iPhone: troca a cada 12 s com zoom lento; tocar passa para a próxima.
let fotos = [], fotoI = 0, fotoTimer = null, fotosEm = 0;
async function carregarFotos() {
  if (!token) return;
  try {
    const r = await fetch(api('/fotos'), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    const lista = j.fotos.map((f) => ({ ...f, url: f.url.startsWith('/fotos-locais/') ? `${f.url}?t=${encodeURIComponent(token)}` : f.url }));
    // embaralha uma vez por carga, para não começar sempre pela mesma
    for (let i = lista.length - 1; i > 0; i--) { const j2 = Math.floor(Math.random() * (i + 1)); [lista[i], lista[j2]] = [lista[j2], lista[i]]; }
    fotos = lista;
    fotosEm = Date.now();
    if (!lista.length) setTimeout(carregarFotos, 30000); // Pinterest lento ou fora do ar: tenta de novo
    fotoI = 0;
    $$('[data-mod="fotos"]').forEach((el) => { delete el.dataset.pronto; renderFotos(el); });
  } catch { /* sem rede: fica com as que já tinha */ }
}
function renderFotos(el) {
  if (el.dataset.pronto) return;
  el.dataset.pronto = '1';
  if (!fotos.length) {
    el.innerHTML = `<div class="fotos"><div class="vazio-fotos">As fotos da pasta do Pinterest aparecem aqui.<br><span class="dica">Configure em dados/config.json → fotos_pinterest</span></div></div>`;
    return;
  }
  el.innerHTML = `<div class="fotos" role="img" aria-label="Fotos da casa"><img alt="" decoding="async"><img alt="" decoding="async"><div class="legenda"><span class="txt"></span><span class="pts"></span></div></div>`;
  mostrarFoto(el, true);
}
function mostrarFoto(el, primeira = false) {
  const box = $('.fotos', el);
  if (!box || !fotos.length) return;
  const [a, b] = $$('img', box);
  const atual = a.classList.contains('on') ? a : b;
  const prox = atual === a ? b : a;
  const f = fotos[fotoI % fotos.length];
  prox.onload = () => { atual.classList.remove('on'); prox.classList.remove('on'); void prox.offsetWidth; prox.classList.add('on'); };
  prox.onerror = () => { fotos.splice(fotoI % fotos.length, 1); if (fotos.length) mostrarFoto(el); };
  prox.src = f.url;
  $('.legenda .txt', box).textContent = f.titulo || '';
  const n = Math.min(fotos.length, 8), k = fotoI % fotos.length;
  $('.legenda .pts', box).innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i === Math.floor((k / fotos.length) * n) ? 'on' : ''}"></i>`).join('');
  // pré-carrega a seguinte
  const seg = fotos[(fotoI + 1) % fotos.length];
  if (seg) { const pre = new Image(); pre.src = seg.url; }
  if (!primeira) return;
}
function proximaFoto() {
  if (!fotos.length) return;
  fotoI = (fotoI + 1) % fotos.length;
  $$('[data-mod="fotos"]').forEach((el) => mostrarFoto(el));
}
const RENDER = { relogio: renderRelogio, quem: renderQuem, habitos: renderHabitos, registro: renderRegistro, mercado: renderMercado, pendencias: renderPend, sync: renderSync, captura: renderCaptura, tela: renderTela, fotos: renderFotos };

// ---------------------------------------------------------------- layout do painel ("Agora", o C)
// Tela cheia: o iPad só deixa se o navegador tiver a API; onde não tem, o botão nem aparece.
const podeTelaCheia = () => Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
function telaCheia() {
  const el = document.documentElement;
  const dentro = document.fullscreenElement || document.webkitFullscreenElement;
  if (dentro) return (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  p?.catch?.(() => toast('Este aparelho não deixou entrar em tela cheia.'));
}
const botoesTopo = () => `<div class="acoes">${podeTelaCheia() ? '<button type="button" class="icone" data-a="tela-cheia" aria-label="Tela cheia">⛶</button>' : ''}<button type="button" class="icone" data-a="tema" aria-label="Trocar tema">${prefs.tema === 'light' ? '☀' : '☾'}</button><button type="button" class="icone" data-a="ajustes" aria-label="Ajustes">⚙</button></div>`;

// Layouts do painel (⚙ → Layout do painel). Todos usam os mesmos módulos; muda só o arranjo.
const LAYOUTS = [['agora', 'Agora'], ['quadro', 'Quadro vivo']];
function layoutPainel() {
  const L = LAYOUTS.some(([k]) => k === prefs.layout) ? prefs.layout : 'agora';
  const grupo = (lado, dono) => `<div class="grupo"><div class="lado">${lado}</div><div class="fila" data-mod="habitos" data-dono="${esc(dono)}" data-rotulos="0"></div></div>`;
  const quemPets = `<div class="quem" data-pessoa-menu="pets" role="button" style="--cor:var(--pet)"><div class="av">🐶</div><strong>${esc(pets().map((p) => p.nome).join(' e '))}</strong></div>`;
  const quemPessoa = (p) => `<div class="quem" data-mod="quem" data-pessoa="${esc(p.id)}"></div><div class="mini" data-mod="registro" data-pessoa="${esc(p.id)}"></div>`;
  const hoje = `<section class="card" id="hab"><header><h2>Hoje</h2></header><div class="grupos">
      ${pets().length ? grupo(quemPets, 'pets') : ''}${pessoas().map((p) => grupo(quemPessoa(p), p.id)).join('')}</div></section>`;
  const relogioBloco = `<div class="linha"><div class="relogio" data-mod="relogio"></div>${botoesTopo()}</div>`;
  const rodape = '<div class="linha rodape"><span data-mod="sync"></span><span class="selo" data-mod="tela"></span></div>';
  const pend = '<section class="card" id="pend"><div data-mod="pendencias" data-proximas="1"></div></section>';
  const merc = '<section class="card" id="merc" data-mod="mercado" data-semcampo="1"></section>';
  const fotos = '<section class="card" id="fotos" data-mod="fotos" data-a="foto"></section>';
  // foto com o relógio por cima (quadro vivo, coluna por pessoa)
  const fotoComRelogio = `<section class="card" id="quadro"><div class="fotos-fundo" data-mod="fotos" data-a="foto"></div>
      <div class="sobre">${relogioBloco}${rodape}</div></section>`;

  if (L === 'quadro') return `<main class="painel L-quadro">${fotoComRelogio}${pend}${hoje}${merc}</main>`;
  // 1 · Agora (padrão)
  return `<main class="painel C">
    <section class="card" id="agora">${relogioBloco}<div data-mod="pendencias" data-proximas="1"></div>${rodape}</section>
    ${hoje}${merc}${fotos}</main>`;
}

const ABAS = [['hoje', '☀', 'Hoje'], ['mercado', '🛒', 'Mercado'], ['pendencias', '✓', 'Pendências'], ['registro', '✎', 'Registro']];
function layoutCelular() {
  return `<div class="cel"><header class="cabeca"><h1 id="titulo-aba"></h1><div class="acoes"><span data-mod="sync"></span><button type="button" class="icone mais-rapido" data-a="adicionar" aria-label="Adicionar">＋</button><button type="button" class="icone" data-a="ajustes" aria-label="Ajustes">⚙</button></div></header>
    <main id="aba"></main>
    <nav class="abas" aria-label="Seções">${ABAS.map(([id, ic, rot]) => `<button type="button" data-aba="${id}"><span aria-hidden="true">${ic}</span>${rot}</button>`).join('')}</nav></div>`;
}
function montarAba() {
  const m = $('#aba');
  if (!m) return;
  $$('[data-aba]').forEach((b) => b.setAttribute('aria-current', b.dataset.aba === aba ? 'page' : 'false'));
  document.body.dataset.abaAtual = aba; // (não "data-aba": o clique procura [data-aba] para trocar de aba)
  $('#titulo-aba').textContent = ABAS.find((a) => a[0] === aba)?.[2] || '';
  const minha = eu !== 'casa' ? eu : null;
  if (aba === 'mercado') {
    m.innerHTML = `<section class="card" data-mod="mercado" data-agrupar="1" data-editar="1"></section>`;
  } else if (aba === 'pendencias') {
    m.innerHTML = `<section class="card" data-mod="pendencias" data-form="1" data-proximas="1"></section>`;
  } else if (aba === 'registro') {
    montarRegistroCel(m, minha);
    return;
  } else {
    m.innerHTML = `
      ${minha && pets().length ? `<section class="card"><header><h2 data-pessoa-menu="pets" role="button">🐶 ${esc(pets().map((p) => p.nome).join(' e '))}</h2></header><div class="fila" data-mod="habitos" data-dono="pets" data-rotulos="0"></div></section>` : ''}
      ${minha ? `<section class="card"><div class="quem" data-mod="quem" data-pessoa="${esc(minha)}"></div><div class="fila" data-mod="habitos" data-dono="${esc(minha)}"></div></section>` : `<section class="card"><header><h2>Hábitos</h2></header><div class="lista" data-mod="habitos" data-dono="todos"></div></section>`}
      <section class="card" data-mod="pendencias" data-ate="0"></section>
      <section class="card"><header><h2>A casa hoje</h2></header><div data-mod="registro"></div></section>`;
  }
  render();
}
function montarRegistroCel(m, minha) {
  if (!minha) { m.innerHTML = '<p class="vazio">O registro do dia é pessoal: abra no celular de cada pessoa.</p>'; return; }
  diaReg ||= hoje();
  const r = vista.registro?.[minha]?.[diaReg] || {};
  const pv = vista.privado?.[minha]?.[diaReg] || {};
  const rot = diaReg === hoje() ? 'Hoje' : diaReg === somarDias(hoje(), -1) ? 'Ontem' : formatoCurto(diaReg);
  m.innerHTML = `<div class="navdia"><button type="button" class="icone" data-dia-nav="-1" aria-label="Dia anterior">‹</button><strong>${rot}</strong>
      <button type="button" class="icone" data-dia-nav="1" aria-label="Dia seguinte" ${diaReg >= hoje() ? 'disabled' : ''}>›</button></div>
    <section class="card"><h3>Humor</h3>${gradeEscala('humor', r.humor)}<h3>Energia</h3>${gradeEscala('energia', r.energia)}
      <span class="dica">Humor e energia aparecem no painel da casa.</span></section>
    <section class="card"><div class="linha"><h3>Só seu</h3><span class="privado-tag">🔒 só você vê</span></div>
      <div class="campo"><label for="c-destaque">Destaque do dia</label><textarea id="c-destaque" maxlength="280" placeholder="O melhor do dia" style="min-height:70px">${esc(pv.destaque || '')}</textarea></div>
      <div class="campo"><label for="c-grat">Gratidão</label><textarea id="c-grat" maxlength="500" placeholder="Uma ou duas linhas" style="min-height:70px">${esc(pv.gratidao || '')}</textarea></div>
      <div class="campo"><label for="c-diario">Diário</label><textarea id="c-diario" maxlength="5000" placeholder="Escreva à vontade. Salva sozinho.">${esc(pv.texto || '')}</textarea></div></section>`;
  const dia = diaReg;
  m.querySelectorAll('.escolha').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const campo = g.dataset.campo, v = Number(b.dataset.v);
    const atual = vista.registro?.[minha]?.[dia]?.[campo];
    agir('registro.salvar', { data: dia, campos: { [campo]: atual === v ? null : v } }, { silencioso: true });
    $$('button', g).forEach((x) => x.classList.toggle('on', x === b && atual !== v));
  }));
  const sDest = debounce((v) => agir('privado.salvar', { data: dia, campos: { destaque: v } }, { silencioso: true }), 700);
  const sGrat = debounce((v) => agir('privado.salvar', { data: dia, campos: { gratidao: v } }, { silencioso: true }), 700);
  const sDiar = debounce((v) => agir('privado.salvar', { data: dia, campos: { texto: v } }, { silencioso: true }), 900);
  $('#c-destaque', m).addEventListener('input', (e) => sDest(e.target.value));
  $('#c-grat', m).addEventListener('input', (e) => sGrat(e.target.value));
  $('#c-diario', m).addEventListener('input', (e) => sDiar(e.target.value));
  render();
}

// ---------------------------------------------------------------- ajustes
/** Pessoa ou bicho: emoji e cor por toque; o nome fica guardado atrás de "Renomear". */
function editarMembro(id) {
  const m = membro(id);
  if (!m) return;
  sheet(`<div class="quem" style="--cor:${esc(m.cor)}" id="mb-previa"><div class="av">${esc(m.emoji)}</div><strong>${esc(m.nome)}</strong></div>
    <form class="conteudo" style="display:flex;flex-direction:column;gap:16px">
      <div class="campo"><span class="rot">Emoji</span>${gradeEmojis('emoji', EMOJIS_PESSOA, m.emoji)}</div>
      <div class="campo"><span class="rot">Cor</span>${paleta('cor', m.cor)}</div>
      <details class="campo"><summary class="rot">Renomear</summary><input id="mb-nome" type="text" maxlength="30" value="${esc(m.nome)}"></details>
      <button type="submit" class="botao">Salvar</button></form>`, (el, fechar) => {
    const f = $('form', el);
    const previa = $('#mb-previa', el);
    ligarEntradas(f, (nome, v) => {
      if (nome === 'emoji') $('.av', previa).textContent = v;
      if (nome === 'cor') previa.style.setProperty('--cor', v);
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (agir('membro.salvar', { id, nome: $('#mb-nome', f).value, emoji: valor(f, 'emoji'), cor: valor(f, 'cor') })) { fechar(); modoAtual = null; montar(); }
    });
  });
}
function ajustes() {
  const sou = eu === 'casa' ? 'Painel da casa' : membro(eu)?.nome || eu;
  const temExemplos = vista.habitos.some((h) => h.exemplo) || vista.eventos.some((e) => e.origem === 'exemplo') || vista.mercado.some((i) => i.origem === 'exemplo') || vista.pendencias.some((p) => p.origem === 'exemplo');
  const desenhar = (el) => {
    el.innerHTML = `<h2>Ajustes</h2>
    <div class="ajuste"><span class="rot">Este aparelho</span><p>${esc(sou)} · <span data-mod="sync"></span></p>
      <span class="rot">Tela</span><div class="opcoes" data-pref="modo">${[['auto', 'Automática'], ['painel', 'Painel'], ['celular', 'Celular']].map(([k, v]) => `<button type="button" data-v="${k}" class="${prefs.modo === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <span class="rot">Layout do painel</span><div class="opcoes" data-pref="layout">${LAYOUTS.map(([k, v]) => `<button type="button" data-v="${k}" class="${(prefs.layout || 'agora') === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <span class="rot">Economia de bateria</span><div class="opcoes" data-pref="economia">${[['nao', 'Visual completo'], ['sim', 'Econômico']].map(([k, v]) => `<button type="button" data-v="${k}" class="${(prefs.economia || 'nao') === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <span class="dica">Econômico: sem animação no fundo, sem desfoque nos cartões, fotos sem zoom. Mesmo no visual completo, nada anima enquanto a tela descansa.</span>
      <span class="rot">Descansar a tela depois de</span><div class="opcoes" data-pref="descanso">${[[0.25, '15 s'], [1, '1 min'], [3, '3 min'], [10, '10 min'], [0, 'Nunca']].map(([k, v]) => `<button type="button" data-v="${k}" class="${Number(prefs.descanso) === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <span class="dica">No descanso, as fotos do Pinterest viram um quadro em tela cheia, com a hora por cima; entre 22h e 6h fica bem mais escuro. O primeiro toque só acorda. O bloqueio automático do iPad é do iPadOS: com o Modo Pouca Energia ligado ele bloqueia em 30 s, e nenhum app muda isso.</span>
      <span class="dica" data-mod="tela"></span></div>
    <div class="ajuste"><div class="linha"><span class="rot">Hábitos</span><button type="button" class="chip" data-novo-hab>+ Novo</button></div>
      ${vista.habitos.slice().sort((a, b) => (a.arquivado - b.arquivado) || (a.ordem ?? 0) - (b.ordem ?? 0)).map((h) => `<div class="linha-hab ${h.arquivado ? 'arq' : ''}"><span style="font-size:1.4rem">${esc(h.emoji || '•')}</span>
        <span><b>${esc(h.nome)}</b><br><small class="muted">${esc(membro(h.membro)?.nome || '')} · ${TIPOS_HAB[h.tipo]}${h.arquivado ? ' · arquivado' : ''}</small></span>
        <button type="button" class="chip" data-editar-hab="${esc(h.id)}">Editar</button></div>`).join('')}</div>
    <div class="ajuste"><span class="rot">Pessoas e bichos</span>
      ${membrosEmOrdem().map((m) => `<div class="linha-hab"><div class="quem" style="--cor:${esc(m.cor)}"><div class="av">${esc(m.emoji)}</div></div>
        <span><b>${esc(m.nome)}</b><br><small class="muted">${m.tipo === 'pet' ? 'cachorro' : 'pessoa'}</small></span>
        <button type="button" class="chip" data-editar-membro="${esc(m.id)}">Editar</button></div>`).join('')}</div>
    <div class="ajuste"><span class="rot">Ordem das seções do mercado</span><span class="dica">A ordem do corredor do seu mercado.</span>
      ${vista.secoes.map((s, i) => `<div class="linha" style="align-items:center"><span>${esc(s)}</span><span class="opcoes"><button type="button" data-sec="${i}" data-dir="-1" aria-label="Subir ${esc(s)}" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-sec="${i}" data-dir="1" aria-label="Descer ${esc(s)}" ${i === vista.secoes.length - 1 ? 'disabled' : ''}>↓</button></span></div>`).join('')}</div>
    <div class="ajuste"><span class="rot">Dados de exemplo</span><span class="dica">Para ver como o painel fica com o tempo: 90 dias de hábitos, humor e destaques, mais rotinas, mercado e pendências. Tudo marcado como exemplo; o que é de vocês não é tocado.</span><div class="opcoes"><button type="button" data-exemplos-gerar>Gerar 90 dias de exemplo</button><button type="button" data-exemplos-estresse>Teste de estresse</button>${temExemplos ? '<button type="button" data-exemplos>Remover exemplos</button>' : ''}</div></div>
    <div class="ajuste"><span class="rot">Voz (Siri)</span><span class="dica">O atalho “Anotar no painel” manda o que você ditar para este endereço, com o seu link de pareamento. Passo a passo no README do projeto.</span>
      <code style="font-size:.85rem;word-break:break-all">POST ${esc(location.origin)}/api/capture</code></div>`;
    $$('[data-mod]', el).forEach((x) => RENDER[x.dataset.mod]?.(x));
  };
  sheet('<div class="conteudo" style="display:flex;flex-direction:column;gap:14px"></div>', (s, fechar) => {
    const c = $('.conteudo', s);
    desenhar(c);
    c.addEventListener('click', (e) => {
      const pref = e.target.closest('[data-pref] [data-v]');
      if (pref) {
        const k = pref.closest('[data-pref]').dataset.pref;
        prefs[k] = k === 'descanso' ? Number(pref.dataset.v) : pref.dataset.v;
        salvarPrefs();
        acordar();
        aplicarTema();
        modoAtual = null;
        montar();
        desenhar(c);
        return;
      }
      if (e.target.closest('[data-novo-hab]')) { fechar(); return editarHab(null); }
      const em = e.target.closest('[data-editar-membro]');
      if (em) { fechar(); return editarMembro(em.dataset.editarMembro); }
      const eh = e.target.closest('[data-editar-hab]');
      if (eh) { fechar(); return editarHab(eh.dataset.editarHab); }
      const sec = e.target.closest('[data-sec]');
      if (sec) {
        const i = Number(sec.dataset.sec), j = i + Number(sec.dataset.dir);
        const nova = [...vista.secoes];
        [nova[i], nova[j]] = [nova[j], nova[i]];
        agir('secoes.ordenar', { secoes: nova }, { silencioso: true });
        desenhar(c);
        return;
      }
      if (e.target.closest('[data-exemplos]')) { agir('exemplos.remover'); desenhar(c); return; }
      if (e.target.closest('[data-exemplos-gerar]')) { agir('exemplos.gerar'); desenhar(c); return; }
      if (e.target.closest('[data-exemplos-estresse]')) { agir('exemplos.gerar', { estresse: true }); desenhar(c); }
    });
    c.addEventListener('submit', (e) => {
      const f = e.target.closest('[data-membro]');
      if (!f) return;
      e.preventDefault();
      agir('membro.salvar', { id: f.dataset.membro, nome: f.nome.value, emoji: f.emoji.value, cor: f.cor.value });
      modoAtual = null;
      montar();
    });
  });
}

// ---------------------------------------------------------------- tema e tela acesa
function aplicarTema() {
  if (prefs.tema === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  document.body.classList.toggle('economia', prefs.economia === 'sim');
  $$('[data-a="tema"]').forEach((b) => { b.textContent = prefs.tema === 'light' ? '☀' : '☾'; });
}

// ---------------------------------------------------------------- descanso
// Depois de um tempo sem toque, o painel vira um quadro: as fotos do Pinterest em tela cheia,
// trocando devagar, com a hora por cima. À noite (22h–6h) o quadro fica bem mais escuro.
// A página não controla o brilho nem o bloqueio do iPad (isso é do iPadOS).
let ultimoToque = Date.now(), descansando = false, quadroI = 0, quadroTimer = null;
function noite() { const h = horaDaCasa(); return h >= 22 || h < 6; }
function descansar() {
  if (descansando || !$('.painel')) return;
  descansando = true;
  const d = document.createElement('div');
  d.className = 'descanso' + (noite() ? ' noite' : '') + (fotos.length ? ' com-fotos' : '');
  d.setAttribute('aria-label', 'Tela em descanso. Toque para acordar.');
  d.innerHTML = `<div class="quadro"><img alt="" decoding="async"><img alt="" decoding="async"></div>
    <div class="dorme"><div class="hora num"></div><div class="sub"></div></div>`;
  document.body.append(d);
  document.body.classList.add('dormindo'); // para tudo que anima por baixo
  quadroI = fotoI;
  trocarQuadro();
  clearInterval(quadroTimer);
  quadroTimer = setInterval(trocarQuadro, 20000);
  atualizarDescanso();
}
function trocarQuadro() {
  const d = $('.descanso');
  if (!d || !fotos.length) return;
  if (!d.classList.contains('com-fotos')) { d.classList.add('com-fotos'); $('.dorme', d).style.transform = ''; }
  const [a, b] = $$('.quadro img', d);
  const atual = a.classList.contains('on') ? a : b;
  const prox = atual === a ? b : a;
  const f = fotos[quadroI++ % fotos.length];
  prox.onload = () => { atual.classList.remove('on'); prox.classList.remove('on'); void prox.offsetWidth; prox.classList.add('on'); };
  prox.src = f.url;
}
function atualizarDescanso() {
  const d = $('.descanso');
  if (!d) return;
  const tz = vista?.casa?.tz || 'America/Sao_Paulo';
  $('.hora', d).textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date());
  const abertas = vista ? pendOrdenadas().filter((p) => p.prazo && diferencaDias(hoje(), p.prazo) <= 0).length : 0;
  const data = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date());
  $('.sub', d).textContent = [data.charAt(0).toUpperCase() + data.slice(1), abertas ? `${abertas} pendência${abertas > 1 ? 's' : ''} para hoje` : `${lua().ic} ${lua().nome}`].join(' · ');
  d.classList.toggle('noite', noite());
  if (!fotos.length) {
    // sem fotos: só o relógio, andando devagar para não marcar a tela
    $('.dorme', d).style.transform = `translate(${Math.round((Math.random() - .5) * 30)}vw, ${Math.round((Math.random() - .5) * 30)}vh)`;
  }
}
function acordar() {
  ultimoToque = Date.now();
  if (!descansando) return false;
  descansando = false;
  clearInterval(quadroTimer);
  $('.descanso')?.remove();
  document.body.classList.remove('dormindo');
  render();
  return true;
}
// o primeiro toque só acorda (não marca nada por engano)
document.addEventListener('pointerdown', (e) => {
  if (descansando) { e.preventDefault(); e.stopPropagation(); acordar(); }
  else ultimoToque = Date.now();
}, { capture: true });
document.addEventListener('click', (e) => { if (e.target.closest?.('.descanso')) { e.preventDefault(); e.stopPropagation(); } }, { capture: true });
let ultimaHoraDescanso = 0;
setInterval(() => {
  const seg = Number(prefs.descanso) * 60;
  if (!descansando && seg > 0 && !$('.veu') && Date.now() - ultimoToque > seg * 1000) descansar();
  if (descansando && Date.now() - ultimaHoraDescanso > 20000) { ultimaHoraDescanso = Date.now(); atualizarDescanso(); }
}, 3000);
let lock = null, telaMsg = '';
async function segurarTela() {
  if (!('wakeLock' in navigator)) { telaMsg = window.isSecureContext ? 'Tela sempre acesa: este navegador não suporta' : 'Tela sempre acesa: precisa de HTTPS (use o plano B do README)'; }
  else {
    try {
      lock = await navigator.wakeLock.request('screen');
      telaMsg = 'Tela sempre acesa: ativa';
      lock.addEventListener('release', () => { telaMsg = 'Tela sempre acesa: liberada'; $$('[data-mod="tela"]').forEach(renderTela); });
    } catch { telaMsg = 'Tela sempre acesa: recusada pelo sistema'; }
  }
  $$('[data-mod="tela"]').forEach(renderTela);
}
function renderTela(el) { el.textContent = telaMsg; }

// ---------------------------------------------------------------- montagem e render
function modoDesejado() {
  if (prefs.modo === 'painel' || prefs.modo === 'celular') return prefs.modo;
  return eu === 'casa' || window.innerWidth >= 900 ? 'painel' : 'celular';
}
function montar() {
  if (!vista) return;
  const modo = modoDesejado();
  const chave = modo + (modo === 'painel' ? prefs.layout || '' : '');
  if (chave === modoAtual) return render();
  modoAtual = chave;
  document.body.classList.toggle('modo-painel', modo === 'painel');
  $('#app').innerHTML = modo === 'painel' ? layoutPainel() : layoutCelular();
  if (modo === 'celular') montarAba();
  aplicarTema();
  render();
}
function render() {
  if (!vista) return;
  if (!modoAtual) return montar();
  for (const el of $$('[data-mod]')) {
    try { RENDER[el.dataset.mod]?.(el); } catch (e) { console.error('render', el.dataset.mod, e); }
  }
  atualizarCatalogo();
}

// ---------------------------------------------------------------- pareamento
function mostrarParear() {
  modoAtual = null;
  fonte?.close();
  $('#app').innerHTML = `<div class="parear"><h1>mrcx</h1>
    <p>Este aparelho ainda não está pareado.</p>
    <p class="muted">No computador da casa, abra o arquivo <code>dados/links.txt</code> e abra neste aparelho o link dele (iPad da casa, Matheus ou Karen). Pode escanear o QR code ou colar o link aqui:</p>
    <form class="anotar" data-form="parear"><input name="link" placeholder="Cole o link de pareamento" aria-label="Link de pareamento"><button type="submit">Parear</button></form></div>`;
}

// ---------------------------------------------------------------- eventos
// Tocar e segurar numa rotina (~0,5 s) abre o histórico; o toque normal marca.
let segurou = false, timerSegurar = null, pontoIni = null;
const soltar = () => { clearTimeout(timerSegurar); $$('.segurando').forEach((x) => x.classList.remove('segurando')); };
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest?.('[data-segurar]');
  if (!el || descansando) return;
  segurou = false;
  pontoIni = [e.clientX, e.clientY];
  soltar();
  el.classList.add('segurando');
  timerSegurar = setTimeout(() => { segurou = true; el.classList.remove('segurando'); detalheHab(el.dataset.segurar); }, 550);
});
document.addEventListener('pointermove', (e) => { if (pontoIni && Math.hypot(e.clientX - pontoIni[0], e.clientY - pontoIni[1]) > 10) soltar(); });
document.addEventListener('pointerup', soltar);
document.addEventListener('pointercancel', soltar);
document.addEventListener('contextmenu', (e) => { if (e.target.closest?.('[data-segurar]')) e.preventDefault(); });

document.addEventListener('click', (e) => {
  const t = e.target;
  if (segurou) { segurou = false; e.preventDefault(); return; } // o clique que termina o "segurar" não marca
  if (t.closest('.veu') && !t.closest('[data-hab-marcar],[data-hab-det],[data-item],[data-item-edit],[data-chip],[data-pend-ok],[data-pend-edit],[data-a]')) return;
  let x;
  if ((x = t.closest('[data-hab-marcar]'))) return marcarHab(x.dataset.habMarcar);
  if ((x = t.closest('[data-hab-det]'))) return detalheHab(x.dataset.habDet);
  if ((x = t.closest('[data-item-edit]'))) return editarItem(x.dataset.itemEdit);
  if ((x = t.closest('[data-item]'))) {
    // risca e desliza para fora antes de sair da lista; depois a ação (com desfazer no aviso)
    if (x.classList.contains('saindo')) return;
    const id = x.dataset.item;
    x.classList.add('saindo');
    setTimeout(() => agir('mercado.alternar', { id }), 650);
    return;
  }
  if ((x = t.closest('[data-chip]'))) return agir('mercado.adicionar', { texto: x.dataset.chip });
  if ((x = t.closest('[data-pend-ok]'))) {
    // igual ao mercado: ✓ na bolinha, risca, desliza e sai; depois a ação (com desfazer)
    const linha = x.closest('.pend');
    if (linha.classList.contains('saindo')) return;
    const id = x.dataset.pendOk;
    linha.classList.add('saindo');
    setTimeout(() => agir('pendencia.concluir', { id }), 650);
    return;
  }
  if ((x = t.closest('[data-pend-edit]'))) return editarPend(x.dataset.pendEdit);
  if ((x = t.closest('[data-pessoa-menu]'))) return pessoaMenu(x.dataset.pessoaMenu);
  if ((x = t.closest('[data-reg]'))) return pessoaMenu(x.dataset.reg);
  if ((x = t.closest('[data-aba]'))) { aba = x.dataset.aba; LS.set('painel-aba', aba); diaReg = null; montarAba(); window.scrollTo(0, 0); return; }
  if ((x = t.closest('[data-dia-nav]'))) { diaReg = somarDias(diaReg || hoje(), Number(x.dataset.diaNav)); if (diaReg > hoje()) diaReg = hoje(); montarAba(); return; }
  const a = t.closest('[data-a]')?.dataset.a;
  if (a === 'tema') { prefs.tema = prefs.tema === 'light' ? 'dark' : 'light'; salvarPrefs(); aplicarTema(); return; }
  if (a === 'ajustes') return ajustes();
  if (a === 'adicionar') return adicionarRapido();
  if (a === 'mercado-rapido') return mercadoRapido();
  if (a === 'nova-pendencia') return novaPendencia();
  if (a === 'organizar-secoes') return organizarSecoes();
  if (a === 'tela-cheia') return telaCheia();
  if (a === 'limpar') return agir('mercado.limpar');
  if (a === 'foto') { proximaFoto(); reiniciarFotos(); return; }
  if (a === 'mais-pend') return sheet('<section class="card" data-mod="pendencias" data-proximas="1" style="border:0;padding:0;overflow:visible"></section>', (s) => renderPend($('[data-mod]', s)));
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const tipo = f.dataset.form;
  if (tipo === 'parear') {
    const v = f.link.value.trim();
    let t = v;
    try { t = new URL(v).searchParams.get('t') || v; } catch { /* colaram só o código */ }
    if (!t) return;
    LS.set('painel-token', t);
    location.href = `/?t=${encodeURIComponent(t)}`;
    return;
  }
  if (tipo === 'captura') {
    const txt = f.texto.value.trim();
    if (!txt) return adicionarRapido(); // campo vazio: o ＋ abre o menu de adicionar
    agir('captura', { texto: txt, origem: 'app' });
    f.texto.value = '';
    return;
  }
  if (tipo === 'mercado') {
    const txt = f.texto.value.trim();
    if (!txt) return;
    agir('mercado.adicionar', { texto: txt });
    f.texto.value = '';
    return;
  }
  if (tipo === 'pendencia') {
    const titulo = f.titulo.value.trim();
    if (!titulo) return;
    if (agir('pendencia.criar', { titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1), resp: f.resp.value || null, prazo: f.prazo.value || null })) {
      f.titulo.value = ''; f.prazo.value = ''; f.resp.value = '';
    }
  }
});

// autocompletar do mercado pelo histórico da casa
function atualizarCatalogo() {
  let dl = $('#catalogo-lista');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'catalogo-lista'; document.body.append(dl); }
  dl.innerHTML = Object.values(vista?.catalogo || {}).map((c) => `<option value="${esc(c.nome)}"></option>`).join('');
}

window.addEventListener('resize', debounce(() => { if (prefs.modo === 'auto') montar(); }, 200));
window.addEventListener('online', () => { enviar(); carregar(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  carregar();
  if (!lock || lock.released) segurarTela();
});
document.addEventListener('pointerdown', () => { if (!lock || lock.released) segurarTela(); }, { passive: true, once: false });

// relógio, virada do dia e reenvio da fila
let diaVisto = null;
setInterval(() => {
  $$('[data-mod="relogio"]').forEach(renderRelogio);
  if (vista && hoje() !== diaVisto) { diaVisto = hoje(); render(); }
  if (fila.length) enviar();
}, 15000);

// ---------------------------------------------------------------- atualização sozinha
// Uma vez por hora, confere se o app mudou (novo deploy). Se mudou, recarrega só quando ninguém está
// mexendo: tela em descanso ou 5 min sem toque. Assim o iPad preso na parede nunca fica velho.
let assinaturaApp = null, temVersaoNova = false;
async function assinaturaAtual() {
  const r = await fetch(`app.js?v=${Date.now()}`, { cache: 'no-store' });
  const t = await r.text();
  let h = 0;
  for (let i = 0; i < t.length; i += 7) h = (h * 31 + t.charCodeAt(i)) | 0;
  return `${t.length}:${h}`;
}
async function conferirVersao() {
  try {
    const a = await assinaturaAtual();
    if (assinaturaApp === null) assinaturaApp = a;
    else if (a !== assinaturaApp) temVersaoNova = true;
  } catch { /* sem rede: tenta depois */ }
}
setInterval(conferirVersao, 60 * 60000); // uma vez por hora basta
setInterval(() => {
  const parado = descansando || Date.now() - ultimoToque > 5 * 60000;
  if (temVersaoNova && parado && !fila.length && !$('.veu')) location.reload();
}, 30000);
conferirVersao();

// fotos: troca a cada 12 s (parado no descanso); a lista do Pinterest é relida a cada 30 min
function reiniciarFotos() {
  clearInterval(fotoTimer);
  fotoTimer = setInterval(() => { if (!descansando && document.visibilityState === 'visible') proximaFoto(); }, 12000);
}
setInterval(() => { if (Date.now() - fotosEm > 30 * 60000) carregarFotos(); }, 5 * 60000);

// ---------------------------------------------------------------- partida
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
aplicarTema();
if (!token) mostrarParear();
else {
  recompor();
  if (vista) { diaVisto = hoje(); montar(); }
  carregar().then(() => { diaVisto = hoje(); carregarFotos(); });
  ouvir();
  segurarTela();
  reiniciarFotos();
}
