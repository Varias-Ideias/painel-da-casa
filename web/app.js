// Painel da Casa — o app. Um só código para o painel do iPad/computador e para o celular.
//
// Como os dados andam:
//   servidor  = último estado confirmado pelo servidor (guardado no aparelho para abrir offline)
//   fila      = ações feitas aqui que o servidor ainda não confirmou (sobrevive a recarregar)
//   vista     = servidor + fila aplicada com o MESMO código do servidor (src/dominio/acoes.js)
// Toque → aplica na vista na hora → entra na fila → vai para o servidor → o servidor avisa todo
// mundo por SSE → cada aparelho recarrega o estado.
import { aplicar } from '/dominio/acoes.js';
import { estadoHabito, historico } from '/dominio/habitos.js';
import { hojeNoFuso, somarDias, diferencaDias, formatoCurto, formatoRelativo } from '/dominio/datas.js';
import { normalizar } from '/dominio/mercado.js';

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
  enviar();
  return r;
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
        res = await fetch('/api/acao', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(a) });
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
        toast(`Não salvou: ${j.erro || res.status}`, { erro: true });
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
    res = await fetch('/api/estado', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  } catch {
    setConexao('off');
    return;
  }
  if (res.status === 401) return mostrarParear();
  if (!res.ok) { setConexao('erro'); return; }
  const j = await res.json();
  servidor = j.estado;
  eu = j.eu;
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

let fonte = null;
function ouvir() {
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
  return `<div class="${cls}">
    <button type="button" class="alvo" data-hab-marcar="${esc(h.id)}" aria-label="${esc(rot)}">${alvo}</button>
    <button type="button" class="nome" data-hab-det="${esc(h.id)}">${s.tipo === 'evitar' ? esc(h.emoji || '') + ' ' : ''}${esc(h.nome)}${sub}</button>
    <div class="seq num">${seq}</div></div>`;
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
  return `<div class="tile ${s.tipo} ${s.feito ? 'feito' : ''} ${brilhou ? 'brilha' : ''}">
    <button type="button" data-hab-marcar="${esc(h.id)}" aria-label="${esc(rot)}" style="display:contents">
      <span class="anel">${svg}${dentro}</span></button>
    ${s.feito ? '<span class="ok" aria-hidden="true">✓</span>' : ''}
    <button type="button" data-hab-det="${esc(h.id)}" style="display:contents"><span class="t">${esc(h.nome)}</span><span class="s num">${sub}</span></button>
  </div>`;
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
function editarHab(id, membroPadrao = null) {
  const h = id ? vista.habitos.find((x) => x.id === id) : { nome: '', emoji: '', tipo: 'check', membro: membroPadrao || (eu !== 'casa' ? eu : pessoas()[0]?.id), meta: 2000, unidade: 'ml', passo: 250, vezes_semana: 3, apelidos: [] };
  sheet(`<h2>${id ? 'Editar rotina' : 'Nova rotina'}</h2>
    <form class="conteudo" style="display:flex;flex-direction:column;gap:14px" data-form-hab>
      <div class="grade2"><div class="campo"><label for="h-nome">Nome</label><input id="h-nome" type="text" required maxlength="40" value="${esc(h.nome)}"></div>
      <div class="campo"><label for="h-emoji">Emoji</label><input id="h-emoji" type="text" maxlength="4" value="${esc(h.emoji || '')}"></div></div>
      <div class="campo"><label for="h-membro">De quem</label><select id="h-membro">${vista.membros.map((m) => `<option value="${esc(m.id)}" ${m.id === h.membro ? 'selected' : ''}>${esc(m.emoji)} ${esc(m.nome)}</option>`).join('')}</select></div>
      <div class="campo"><label for="h-tipo">Tipo</label><select id="h-tipo">${Object.entries(TIPOS_HAB).map(([k, v]) => `<option value="${k}" ${k === h.tipo ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="grade2" data-so="qtd"><div class="campo"><label for="h-meta">Meta por dia</label><input id="h-meta" type="number" min="1" value="${esc(h.meta ?? 1)}"></div>
        <div class="campo"><label for="h-unidade">Unidade</label><input id="h-unidade" type="text" maxlength="10" value="${esc(h.unidade || '')}"></div>
        <div class="campo"><label for="h-passo">Botão soma</label><input id="h-passo" type="number" min="1" value="${esc(h.passo ?? 1)}"></div></div>
      <div class="campo" data-so="semana"><label for="h-vezes">Vezes por semana</label><input id="h-vezes" type="number" min="1" max="7" value="${esc(h.vezes_semana ?? 3)}"></div>
      <div class="campo"><label for="h-apelidos">Apelidos para voz</label><input id="h-apelidos" type="text" value="${esc((h.apelidos || []).join(', '))}"><span class="dica">Separados por vírgula. Ex.: treinei, academia, malhei</span></div>
      <button type="submit" class="botao">Salvar</button>
      ${id ? `<button type="button" class="botao ${h.arquivado ? 'sec' : 'perigo'}" data-arquivar>${h.arquivado ? 'Voltar para o painel' : 'Arquivar'}</button>` : ''}
    </form>`, (el, fechar) => {
    const f = $('form', el);
    const ajustar = () => { const t = $('#h-tipo', f).value; $$('[data-so]', f).forEach((x) => { x.hidden = x.dataset.so !== t; }); };
    ajustar();
    $('#h-tipo', f).addEventListener('change', ajustar);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const tipo = $('#h-tipo', f).value;
      const novo = {
        ...(id ? { id } : {}), nome: $('#h-nome', f).value.trim(), emoji: $('#h-emoji', f).value.trim(), membro: $('#h-membro', f).value, tipo,
        apelidos: $('#h-apelidos', f).value.split(',').map((x) => normalizar(x)).filter(Boolean),
      };
      if (tipo === 'qtd') Object.assign(novo, { meta: Number($('#h-meta', f).value) || 1, unidade: $('#h-unidade', f).value.trim(), passo: Number($('#h-passo', f).value) || 1 });
      if (tipo === 'semana') novo.vezes_semana = Math.min(7, Math.max(1, Number($('#h-vezes', f).value) || 1));
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
/** Item com bolinha: tocar marca, risca e o item sai da lista (vai para o carrinho, com desfazer). */
function itemRow(i, editar) {
  const btn = `<button type="button" class="item ${i.comprado_em ? 'no-carrinho' : ''}" data-item="${esc(i.id)}" aria-label="${i.comprado_em ? 'Tirar do carrinho' : 'Marcar como comprado'}: ${esc(i.nome)}">
    <span class="bola" aria-hidden="true">${i.comprado_em ? '✓' : ''}</span><span class="n">${esc(i.nome)}</span><span class="qtd">${esc(i.qtd)}</span></button>`;
  if (!editar) return btn;
  return `<div style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px">${btn}<button type="button" class="mexer" data-item-edit="${esc(i.id)}" aria-label="Editar ${esc(i.nome)}">⋯</button></div>`;
}
function renderMercado(el) {
  const agrupar = el.dataset.agrupar === '1';
  const editar = el.dataset.editar === '1';
  const soCarrinho = el.dataset.carrinho === '1';
  if (!el.dataset.pronto) {
    el.innerHTML = `<header><h2>${soCarrinho ? 'No carrinho' : 'Mercado'}</h2><span class="muted num cont"></span></header>
      ${el.dataset.semcampo || soCarrinho ? '' : `<form class="anotar" data-form="mercado"><input name="texto" list="catalogo-lista" autocomplete="off" enterkeyhint="done" placeholder="leite, pão e 2 dúzias de ovos" aria-label="Adicionar itens ao mercado"><button type="submit">Adicionar</button></form>`}
      <div class="chips"></div><div class="lista"></div><div class="carrinho"></div>`;
    el.dataset.pronto = '1';
  }
  const todos = itensOrdenados();
  const faltam = todos.filter((i) => !i.comprado_em);
  const noCarrinho = todos.filter((i) => i.comprado_em);
  const itens = soCarrinho ? noCarrinho : faltam;
  $('.cont', el).textContent = soCarrinho ? '' : faltam.length ? `${faltam.length} para comprar` : 'lista vazia';
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
  if (!itens.length) corpo = soCarrinho ? '<p class="vazio">Nada no carrinho.</p>' : '<p class="vazio">Nada na lista. Anote aqui em cima, pela barra “Anotar” ou pela voz.</p>';
  $('.lista', el).innerHTML = corpo;
  if (!agrupar) caber($('.lista', el), itens.length, 'itens', 'mais-merc');
  const naLista = new Set(faltam.map((i) => i.nome_norm));
  const freq = soCarrinho ? [] : Object.entries(vista.catalogo || {}).filter(([n]) => !naLista.has(n)).sort((a, b) => (b[1].vezes || 0) - (a[1].vezes || 0)).slice(0, Number(el.dataset.chips ?? 4));
  $('.chips', el).innerHTML = freq.map(([, c]) => `<button type="button" class="chip" data-chip="${esc(c.nome)}">+ ${esc(c.nome)}</button>`).join('');
  $('.carrinho', el).innerHTML = noCarrinho.length
    ? `<span>🧺 ${noCarrinho.length} no carrinho</span><span class="acoes">${soCarrinho ? '' : '<button type="button" data-a="ver-carrinho">Ver</button>'}<button type="button" data-a="limpar">Limpar</button></span>`
    : (soCarrinho ? '' : '<span class="dica">Toque num item quando pegar: ele sai da lista e vai para o carrinho.</span>');
}
function editarItem(id) {
  const i = vista.mercado.find((x) => x.id === id);
  if (!i) return;
  sheet(`<h2>${esc(i.nome)}</h2><form class="conteudo" style="display:flex;flex-direction:column;gap:14px">
    <div class="grade2"><div class="campo"><label for="i-nome">Nome</label><input id="i-nome" type="text" value="${esc(i.nome)}"></div>
    <div class="campo"><label for="i-qtd">Quantidade</label><input id="i-qtd" type="text" value="${esc(i.qtd)}"></div></div>
    <div class="campo"><label for="i-secao">Seção</label><select id="i-secao">${vista.secoes.map((s) => `<option ${s === i.secao ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
    <span class="dica">Mudar a seção ensina o app: da próxima vez, ${esc(i.nome.toLowerCase())} já cai aqui.</span></div>
    <p class="dica">Adicionado por ${esc(membro(i.adicionado_por)?.nome || 'painel da casa')} · ${new Date(i.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>
    <button type="submit" class="botao">Salvar</button><button type="button" class="botao perigo" data-remover>Remover da lista</button></form>`, (el, fechar) => {
    const f = $('form', el);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const campos = { id, nome: $('#i-nome', f).value, qtd: $('#i-qtd', f).value };
      if ($('#i-secao', f).value !== i.secao) campos.secao = $('#i-secao', f).value;
      if (agir('mercado.editar', campos)) fechar();
    });
    $('[data-remover]', f).addEventListener('click', () => { agir('mercado.remover', { id }); fechar(); });
  });
}

// ---------------------------------------------------------------- pendências
function pendOrdenadas() {
  const peso = (p) => (p.prazo ? diferencaDias(hoje(), p.prazo) : 99999);
  return vista.pendencias.filter((p) => !p.concluida_em).sort((a, b) => peso(a) - peso(b) || a.em.localeCompare(b.em));
}
function prazoTag(iso) {
  if (!iso) return '<span class="prazo">sem prazo</span>';
  const d = diferencaDias(hoje(), iso);
  if (d < 0) return `<span class="prazo atrasada">${d === -1 ? 'ontem' : `há ${-d} dias`}</span>`;
  if (d === 0) return '<span class="prazo hoje">hoje</span>';
  return `<span class="prazo">${d === 1 ? 'amanhã' : d < 7 ? formatoRelativo(iso, hoje()) : formatoCurto(iso)}</span>`;
}
function pendRow(p) {
  const r = p.resp ? membro(p.resp) : null;
  const sub = [r ? `${r.emoji} ${r.nome}` : 'Casa', p.nota].filter(Boolean).join(' · ');
  return `<div class="pend"><button type="button" class="box" data-pend-ok="${esc(p.id)}" aria-label="Concluir ${esc(p.titulo)}"></button>
    <button type="button" class="t" data-pend-edit="${esc(p.id)}" style="text-align:left">${esc(p.titulo)}<small>${esc(sub)}</small></button>${prazoTag(p.prazo)}</div>`;
}
function renderPend(el) {
  const lim = Number(el.dataset.limite) || 999;
  if (!el.dataset.pronto) {
    const opcoes = () => `<option value="">Casa</option>${vista.membros.map((m) => `<option value="${esc(m.id)}">${esc(m.emoji)} ${esc(m.nome)}</option>`).join('')}`;
    el.innerHTML = `<header><h2>Pendências</h2><span class="muted cont"></span></header>
      ${el.dataset.form === '1' ? `<form class="conteudo" data-form="pendencia" style="display:flex;flex-direction:column;gap:8px">
        <div class="anotar"><input name="titulo" autocomplete="off" enterkeyhint="done" placeholder="Nova pendência" aria-label="Nova pendência"><button type="submit">Anotar</button></div>
        <div class="grade2"><select name="resp" aria-label="Responsável" class="sel">${opcoes()}</select><input name="prazo" type="date" aria-label="Prazo" class="sel"></div></form>` : ''}
      <div class="lista"></div>`;
    el.dataset.pronto = '1';
  }
  const ps = pendOrdenadas();
  const atrasadas = ps.filter((p) => p.prazo && diferencaDias(hoje(), p.prazo) < 0).length;
  $('.cont', el).innerHTML = `${atrasadas ? `<b style="color:var(--late)">${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}</b> · ` : ''}${ps.length} aberta${ps.length === 1 ? '' : 's'}`;
  const filtro = el.dataset.ate ? ps.filter((p) => p.prazo && diferencaDias(hoje(), p.prazo) <= Number(el.dataset.ate)) : ps;
  let corpo = filtro.slice(0, lim).map(pendRow).join('');
  if (filtro.length > lim) corpo += `<button type="button" class="mais" data-a="mais-pend">+${filtro.length - lim} pendências</button>`;
  if (!filtro.length) corpo = `<p class="vazio">${el.dataset.ate ? 'Nada para hoje.' : 'Nenhuma pendência. 🎉'}</p>`;
  $('.lista', el).innerHTML = corpo;
  caber($('.lista', el), filtro.length, 'pendências', 'mais-pend');
}

/**
 * No painel nada rola: se a lista não couber no cartão, tira itens do fim até caber e mostra
 * "+N itens" (que abre a lista inteira). Mede o que o navegador desenhou, então vale para
 * paisagem, retrato e qualquer tamanho de fonte.
 */
function caber(lista, total, rotulo, acao) {
  if (!lista || !lista.closest('.painel')) return;
  const passa = () => lista.scrollHeight > lista.clientHeight + 1;
  if (!passa()) return;
  $('.mais', lista)?.remove();
  const itens = [...lista.children];
  const mais = document.createElement('button');
  mais.type = 'button';
  mais.className = 'mais';
  mais.dataset.a = acao;
  lista.append(mais);
  let n = itens.length;
  do { itens[--n]?.remove(); mais.textContent = `+${total - n} ${rotulo}`; } while (n > 0 && passa());
}
function editarPend(id) {
  const p = vista.pendencias.find((x) => x.id === id);
  if (!p) return;
  sheet(`<h2>Pendência</h2><form class="conteudo" style="display:flex;flex-direction:column;gap:14px">
    <div class="campo"><label for="p-titulo">Título</label><input id="p-titulo" type="text" required value="${esc(p.titulo)}"></div>
    <div class="grade2"><div class="campo"><label for="p-resp">Responsável</label><select id="p-resp"><option value="">Casa</option>${vista.membros.map((m) => `<option value="${esc(m.id)}" ${m.id === p.resp ? 'selected' : ''}>${esc(m.emoji)} ${esc(m.nome)}</option>`).join('')}</select></div>
    <div class="campo"><label for="p-prazo">Prazo</label><input id="p-prazo" type="date" value="${esc(p.prazo || '')}"></div></div>
    <div class="campo"><label for="p-nota">Nota</label><input id="p-nota" type="text" maxlength="140" value="${esc(p.nota || '')}"></div>
    <button type="submit" class="botao">Salvar</button><button type="button" class="botao sec" data-ok>Concluir</button><button type="button" class="botao perigo" data-remover>Remover</button></form>`, (el, fechar) => {
    const f = $('form', el);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (agir('pendencia.editar', { id, titulo: $('#p-titulo', f).value.trim(), resp: $('#p-resp', f).value || null, prazo: $('#p-prazo', f).value || null, nota: $('#p-nota', f).value })) fechar();
    });
    $('[data-ok]', f).addEventListener('click', () => { agir('pendencia.concluir', { id }); fechar(); });
    $('[data-remover]', f).addEventListener('click', () => { agir('pendencia.remover', { id }); fechar(); });
  });
}

// ---------------------------------------------------------------- registro do dia
function escala(rot, v) {
  return `<div class="escala"><span>${rot}</span><span class="p">${[1, 2, 3, 4, 5].map((n) => `<i class="${v && n <= v ? 'on' : ''}"></i>`).join('')}</span></div>`;
}
function renderRegistro(el) {
  const ids = el.dataset.pessoa ? [el.dataset.pessoa] : pessoas().map((p) => p.id);
  el.innerHTML = ids.map((id) => {
    const r = vista.registro?.[id]?.[hoje()] || {};
    const vazio = !r.humor && !r.energia && !r.destaque;
    return `${ids.length > 1 ? `<div class="sec">${esc(membro(id)?.emoji)} ${esc(membro(id)?.nome)}</div>` : ''}
      <button type="button" class="reg" data-reg="${esc(id)}" aria-label="Registro do dia de ${esc(membro(id)?.nome)}">
      ${vazio ? '<span class="vazio">Sem registro hoje · toque para registrar</span>' : escala('Humor', r.humor) + escala('Energia', r.energia) + (r.destaque ? `<span class="destaque">“${esc(r.destaque)}”</span>` : '')}</button>`;
  }).join('');
}
function gradeEscala(campo, v) {
  return `<div class="escolha" data-campo="${campo}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="${v === n ? 'on' : ''}" data-v="${n}" aria-label="${campo} ${n}">${n}</button>`).join('')}</div>`;
}
/** Editor do registro público (humor, energia, destaque). No painel, qualquer pessoa da casa. */
function editarReg(id, dia = hoje()) {
  const p = membro(id);
  if (!p) return;
  if (eu !== 'casa' && eu !== id) return toast(`Esse registro é de ${p.nome}: edite pelo aparelho de ${p.nome} ou pelo painel da casa.`);
  const r = vista.registro?.[id]?.[dia] || {};
  sheet(`<div class="quem"><div class="av" style="color:${esc(p.cor)}">${esc(p.emoji)}</div><strong>${dia === hoje() ? 'Hoje' : formatoCurto(dia)} · ${esc(p.nome)}</strong></div>
    <h3>Humor</h3>${gradeEscala('humor', r.humor)}<h3>Energia</h3>${gradeEscala('energia', r.energia)}
    <div class="campo"><label for="r-destaque">Destaque do dia</label><textarea id="r-destaque" maxlength="280" placeholder="O melhor do dia, em uma ou duas linhas">${esc(r.destaque || '')}</textarea></div>
    <p class="dica">Salva sozinho. Diário e gratidão ficam só no celular de cada pessoa; o painel da casa não mostra.</p>`, (el) => {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      const campo = b.parentElement.dataset.campo;
      const v = Number(b.dataset.v);
      const atual = vista.registro?.[id]?.[dia]?.[campo];
      agir('registro.salvar', { membro: id, data: dia, campos: { [campo]: atual === v ? null : v } }, { silencioso: true });
      $$('button', b.parentElement).forEach((x) => x.classList.toggle('on', x === b && atual !== v));
    });
    const salvar = debounce((v) => agir('registro.salvar', { membro: id, data: dia, campos: { destaque: v } }, { silencioso: true }), 700);
    $('#r-destaque', el).addEventListener('input', (e) => salvar(e.target.value));
  });
}

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
        <div class="campo"><label for="pm-destaque">Destaque do dia</label><textarea id="pm-destaque" maxlength="280" placeholder="O melhor do dia, em uma ou duas linhas">${esc(r.destaque || '')}</textarea></div>` : ''}
      <div class="linha" style="align-items:center"><h3>Rotina</h3><button type="button" class="chip" data-nova-rotina>+ Nova rotina</button></div>
      <div class="lista" style="overflow:visible">${hs.filter((h) => !h.arquivado).map((h) => `<div style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px">${habRow(h)}<button type="button" class="mexer" data-editar-rotina="${esc(h.id)}" aria-label="Editar ${esc(h.nome)}">✎</button></div>`).join('') || '<p class="vazio">Nenhuma rotina ainda.</p>'}</div>
      ${hs.some((h) => h.arquivado) ? `<details><summary class="dica">Arquivadas (${hs.filter((h) => h.arquivado).length})</summary>${hs.filter((h) => h.arquivado).map((h) => `<div class="linha-hab arq"><span>${esc(h.emoji || '•')}</span><span>${esc(h.nome)}</span><button type="button" class="chip" data-editar-rotina="${esc(h.id)}">Reativar</button></div>`).join('')}</details>` : ''}
      <p class="dica">Toque no círculo para marcar, no nome para ver o histórico e corrigir dias, e no ✎ para editar ou arquivar.</p>`;
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
    const salvar = debounce((v) => agir('registro.salvar', { membro: id, campos: { destaque: v } }, { silencioso: true }), 700);
    c.addEventListener('input', (e) => { if (e.target.id === 'pm-destaque') salvar(e.target.value); });
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
  return { ic, nome };
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
    <span class="data">${data.charAt(0).toUpperCase() + data.slice(1)}</span><span class="lua">${l.ic} ${l.nome}</span>`;
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
  el.innerHTML = html || '<p class="vazio">Nenhum hábito. Crie nos ajustes (⚙).</p>';
}
function renderSync(el) {
  const n = fila.length;
  const txt = conexao === 'ok' ? (n ? `enviando ${n}…` : 'ao vivo') : conexao === 'erro' ? 'erro no servidor' : (n ? `offline · ${n} na fila` : 'offline');
  el.innerHTML = `<span class="selo-sync ${conexao === 'ok' ? '' : conexao}"><i></i>${txt}</span>`;
}
function renderCaptura(el) {
  if (el.dataset.pronto) return;
  el.innerHTML = `<form class="anotar captura" data-form="captura"><input name="texto" autocomplete="off" enterkeyhint="send" placeholder="Anotar: “leite e pão”, “treinei”, “pendência: IPTU até sexta”" aria-label="Anotar rápido"><button type="submit">Anotar</button></form>`;
  el.dataset.pronto = '1';
}

// ---------------------------------------------------------------- fotos
// Carrossel no estilo das memórias do iPhone: troca a cada 12 s com zoom lento; tocar passa para a próxima.
let fotos = [], fotoI = 0, fotoTimer = null, fotosEm = 0;
async function carregarFotos() {
  if (!token) return;
  try {
    const r = await fetch('/api/fotos', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
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

function layoutPainel() {
  const grupo = (lado, dono) => `<div class="grupo"><div class="lado">${lado}</div><div class="fila" data-mod="habitos" data-dono="${esc(dono)}" data-rotulos="0"></div></div>`;
  const cachorros = pets().length ? grupo(`<div class="quem" data-pessoa-menu="pets" role="button" style="--cor:var(--pet)"><div class="av">🐶</div><strong>${esc(pets().map((p) => p.nome).join(' e '))}</strong></div>`, 'pets') : '';
  return `<main class="painel C">
    <section class="card" id="agora"><div class="linha"><div class="relogio" data-mod="relogio"></div>${botoesTopo()}</div>
      <div data-mod="captura"></div><div data-mod="pendencias"></div>
      <div class="linha"><span data-mod="sync"></span><span class="selo" data-mod="tela"></span></div></section>
    <section class="card" id="hab"><header><h2>Hoje</h2></header><div class="grupos">
      ${cachorros}
      ${pessoas().map((p) => grupo(`<div class="quem" data-mod="quem" data-pessoa="${esc(p.id)}"></div><div class="mini" data-mod="registro" data-pessoa="${esc(p.id)}"></div>`, p.id)).join('')}
    </div></section>
    <section class="card" id="merc" data-mod="mercado" data-chips="3" data-semcampo="1"></section>
    <section class="card" id="fotos" data-mod="fotos" data-a="foto"></section></main>`;
}

const ABAS = [['hoje', '☀', 'Hoje'], ['mercado', '🛒', 'Mercado'], ['pendencias', '✓', 'Pendências'], ['registro', '✎', 'Registro']];
function layoutCelular() {
  return `<div class="cel"><header class="cabeca"><h1 id="titulo-aba"></h1><div class="acoes"><span data-mod="sync"></span><button type="button" class="icone" data-a="ajustes" aria-label="Ajustes">⚙</button></div></header>
    <main id="aba"></main>
    <nav class="abas" aria-label="Seções">${ABAS.map(([id, ic, rot]) => `<button type="button" data-aba="${id}"><span aria-hidden="true">${ic}</span>${rot}</button>`).join('')}</nav></div>`;
}
function montarAba() {
  const m = $('#aba');
  if (!m) return;
  $$('[data-aba]').forEach((b) => b.setAttribute('aria-current', b.dataset.aba === aba ? 'page' : 'false'));
  $('#titulo-aba').textContent = ABAS.find((a) => a[0] === aba)?.[2] || '';
  const minha = eu !== 'casa' ? eu : null;
  if (aba === 'mercado') {
    m.innerHTML = `<section class="card" data-mod="mercado" data-agrupar="1" data-editar="1" data-chips="6"></section>`;
  } else if (aba === 'pendencias') {
    m.innerHTML = `<section class="card" data-mod="pendencias" data-form="1"></section>`;
  } else if (aba === 'registro') {
    montarRegistroCel(m, minha);
    return;
  } else {
    m.innerHTML = `<div data-mod="captura"></div>
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
      <div class="campo"><label for="c-destaque">Destaque do dia</label><textarea id="c-destaque" maxlength="280" placeholder="O melhor do dia">${esc(r.destaque || '')}</textarea><span class="dica">Aparece no painel da casa.</span></div></section>
    <section class="card"><div class="linha"><h3>Só seu</h3><span class="privado-tag">🔒 só você vê</span></div>
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
  const sDest = debounce((v) => agir('registro.salvar', { data: dia, campos: { destaque: v } }, { silencioso: true }), 700);
  const sGrat = debounce((v) => agir('privado.salvar', { data: dia, campos: { gratidao: v } }, { silencioso: true }), 700);
  const sDiar = debounce((v) => agir('privado.salvar', { data: dia, campos: { texto: v } }, { silencioso: true }), 900);
  $('#c-destaque', m).addEventListener('input', (e) => sDest(e.target.value));
  $('#c-grat', m).addEventListener('input', (e) => sGrat(e.target.value));
  $('#c-diario', m).addEventListener('input', (e) => sDiar(e.target.value));
  render();
}

// ---------------------------------------------------------------- ajustes
function ajustes() {
  const sou = eu === 'casa' ? 'Painel da casa' : membro(eu)?.nome || eu;
  const temExemplos = vista.habitos.some((h) => h.exemplo) || vista.eventos.some((e) => e.origem === 'exemplo') || vista.mercado.some((i) => i.origem === 'exemplo') || vista.pendencias.some((p) => p.origem === 'exemplo');
  const desenhar = (el) => {
    el.innerHTML = `<h2>Ajustes</h2>
    <div class="ajuste"><span class="rot">Este aparelho</span><p>${esc(sou)} · <span data-mod="sync"></span></p>
      <span class="rot">Tela</span><div class="opcoes" data-pref="modo">${[['auto', 'Automática'], ['painel', 'Painel'], ['celular', 'Celular']].map(([k, v]) => `<button type="button" data-v="${k}" class="${prefs.modo === k ? 'on' : ''}">${v}</button>`).join('')}</div>
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
      ${vista.membros.map((m) => `<form class="grade2" data-membro="${esc(m.id)}" style="grid-template-columns:64px 1fr 64px auto;align-items:center">
        <input type="text" name="emoji" maxlength="4" value="${esc(m.emoji)}" aria-label="Emoji de ${esc(m.nome)}" style="min-height:48px;border-radius:12px;border:2px solid var(--line);background:var(--surface-2);text-align:center">
        <input type="text" name="nome" maxlength="30" value="${esc(m.nome)}" aria-label="Nome" style="min-height:48px;border-radius:12px;border:2px solid var(--line);background:var(--surface-2);padding:0 12px">
        <input type="color" name="cor" value="${esc(m.cor)}" aria-label="Cor de ${esc(m.nome)}" style="min-height:48px;width:64px;border:0;background:none">
        <button type="submit" class="chip">Salvar</button></form>`).join('')}</div>
    <div class="ajuste"><span class="rot">Ordem das seções do mercado</span><span class="dica">A ordem do corredor do seu mercado.</span>
      ${vista.secoes.map((s, i) => `<div class="linha" style="align-items:center"><span>${esc(s)}</span><span class="opcoes"><button type="button" data-sec="${i}" data-dir="-1" aria-label="Subir ${esc(s)}" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-sec="${i}" data-dir="1" aria-label="Descer ${esc(s)}" ${i === vista.secoes.length - 1 ? 'disabled' : ''}>↓</button></span></div>`).join('')}</div>
    <div class="ajuste"><span class="rot">Dados de exemplo</span><span class="dica">Para ver como o painel fica com o tempo: 90 dias de hábitos, humor e destaques, mais rotinas, mercado e pendências. Tudo marcado como exemplo; o que é de vocês não é tocado.</span><div class="opcoes"><button type="button" data-exemplos-gerar>Gerar 90 dias de exemplo</button>${temExemplos ? '<button type="button" data-exemplos>Remover exemplos</button>' : ''}</div></div>
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
      if (e.target.closest('[data-exemplos-gerar]')) { agir('exemplos.gerar'); desenhar(c); }
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
  const chave = modo;
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
  $('#app').innerHTML = `<div class="parear"><h1>Painel da Casa</h1>
    <p>Este aparelho ainda não está pareado.</p>
    <p class="muted">No computador da casa, abra o arquivo <code>dados/links.txt</code> e abra neste aparelho o link dele (iPad da casa, Matheus ou Karen). Pode escanear o QR code ou colar o link aqui:</p>
    <form class="anotar" data-form="parear"><input name="link" placeholder="Cole o link de pareamento" aria-label="Link de pareamento"><button type="submit">Parear</button></form></div>`;
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('.veu') && !t.closest('[data-hab-marcar],[data-hab-det],[data-item],[data-item-edit],[data-chip],[data-pend-ok],[data-pend-edit],[data-a]')) return;
  let x;
  if ((x = t.closest('[data-hab-marcar]'))) return marcarHab(x.dataset.habMarcar);
  if ((x = t.closest('[data-hab-det]'))) return detalheHab(x.dataset.habDet);
  if ((x = t.closest('[data-item-edit]'))) return editarItem(x.dataset.itemEdit);
  if ((x = t.closest('[data-item]'))) {
    // risca e desliza para fora antes de sair da lista; depois a ação (com desfazer no aviso)
    if (x.classList.contains('saindo')) return;
    const id = x.dataset.item;
    if (x.classList.contains('no-carrinho')) return agir('mercado.alternar', { id });
    x.classList.add('saindo');
    setTimeout(() => agir('mercado.alternar', { id }), 650);
    return;
  }
  if ((x = t.closest('[data-chip]'))) return agir('mercado.adicionar', { texto: x.dataset.chip });
  if ((x = t.closest('[data-pend-ok]'))) return agir('pendencia.concluir', { id: x.dataset.pendOk });
  if ((x = t.closest('[data-pend-edit]'))) return editarPend(x.dataset.pendEdit);
  if ((x = t.closest('[data-pessoa-menu]'))) return pessoaMenu(x.dataset.pessoaMenu);
  if ((x = t.closest('[data-reg]'))) return pessoaMenu(x.dataset.reg);
  if ((x = t.closest('[data-aba]'))) { aba = x.dataset.aba; LS.set('painel-aba', aba); diaReg = null; montarAba(); window.scrollTo(0, 0); return; }
  if ((x = t.closest('[data-dia-nav]'))) { diaReg = somarDias(diaReg || hoje(), Number(x.dataset.diaNav)); if (diaReg > hoje()) diaReg = hoje(); montarAba(); return; }
  const a = t.closest('[data-a]')?.dataset.a;
  if (a === 'tema') { prefs.tema = prefs.tema === 'light' ? 'dark' : 'light'; salvarPrefs(); aplicarTema(); return; }
  if (a === 'ajustes') return ajustes();
  if (a === 'tela-cheia') return telaCheia();
  if (a === 'limpar') return agir('mercado.limpar');
  if (a === 'foto') { proximaFoto(); reiniciarFotos(); return; }
  if (a === 'ver-carrinho') return sheet('<section class="card" data-mod="mercado" data-carrinho="1" data-agrupar="1" style="border:0;padding:0;overflow:visible;background:none;box-shadow:none"></section><p class="dica">Tocou por engano? Toque no item para ele voltar para a lista.</p>', (s) => renderMercado($('[data-mod]', s)));
  if (a === 'mais-merc') return sheet('<section class="card" data-mod="mercado" data-agrupar="1" data-editar="1" data-semcampo="1" data-chips="0" style="border:0;padding:0;overflow:visible"></section>', (s) => renderMercado($('[data-mod]', s)));
  if (a === 'mais-pend') return sheet('<section class="card" data-mod="pendencias" style="border:0;padding:0;overflow:visible"></section>', (s) => renderPend($('[data-mod]', s)));
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
    if (!txt) return;
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
