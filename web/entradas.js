// Entradas por toque: chips, contador (− +), grade de emojis, paleta de cores, prazos e carinhas.
// Tudo guarda o valor escolhido em data-valor no próprio grupo; `valor(raiz, nome)` lê.
// Regra da casa: texto só onde o texto É o conteúdo (nome de pendência, destaque, diário).
import { somarDias, diaDaSemana, formatoCurto } from '/dominio/datas.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Grupo de escolha única. lista: [[valor, rótulo(HTML), título?]] */
export function opcoes(nome, lista, atual, { classe = '', rotulo = '' } = {}) {
  const a = String(atual ?? '');
  return `<div class="grupo-op ${classe}" role="radiogroup" ${rotulo ? `aria-label="${esc(rotulo)}"` : ''} data-grupo="${esc(nome)}" data-valor="${esc(a)}">${lista.map(([v, r, t]) =>
    `<button type="button" role="radio" aria-checked="${String(v) === a}" data-op="${esc(v)}" class="${String(v) === a ? 'on' : ''}" ${t ? `title="${esc(t)}" aria-label="${esc(t)}"` : ''}>${r}</button>`).join('')}</div>`;
}

/** Contador: − valor + (com rótulo da unidade ao lado). */
export function contador(nome, valor, { passo = 1, min = 0, max = 100000, unidade = '' } = {}) {
  return `<div class="contador" data-stepper="${esc(nome)}" data-valor="${valor}" data-passo="${passo}" data-min="${min}" data-max="${max}">
    <button type="button" data-d="-1" aria-label="Menos">−</button><output>${Number(valor).toLocaleString('pt-BR')}</output><span class="un">${esc(unidade)}</span><button type="button" data-d="1" aria-label="Mais">+</button></div>`;
}

export const EMOJIS_ROTINA = ['💧', '🏃', '🏋️', '🧘', '🤸', '🚶', '🚴', '🏊', '📖', '📚', '✍️', '🎸', '🎨', '🧠', '💻', '📵',
  '🌙', '🛏️', '☀️', '🍎', '🥗', '🥦', '☕', '🍫', '🍷', '🚭', '💊', '🧴', '🦷', '🪥', '🧹', '🧺', '🌱', '🪴', '🌿', '🙏', '❤️',
  '💰', '📞', '🦮', '🥣', '🛁', '✂️', '🐕', '🐈'];
export const EMOJIS_PESSOA = ['🦉', '🌿', '🌻', '🌸', '🍀', '🌙', '☀️', '🐢', '🦊', '🐝', '🍄', '🌊', '🔥', '⭐', '🦋', '🌵', '🐕', '🐶', '🐈', '🐾'];
export const PALETA = [['#7FA66B', 'Musgo'], ['#4F8A5B', 'Samambaia'], ['#86C1CC', 'Rio'], ['#5B7DB1', 'Crepúsculo'], ['#C98B5A', 'Argila'],
  ['#D8B98F', 'Areia'], ['#B77FA8', 'Urze'], ['#E0B04F', 'Sol'], ['#8A6D4E', 'Casca'], ['#9CA38F', 'Pedra']];

export function gradeEmojis(nome, lista, atual) {
  const l = atual && !lista.includes(atual) ? [atual, ...lista] : lista;
  return opcoes(nome, l.map((e) => [e, e]), atual, { classe: 'emojis', rotulo: 'Emoji' });
}
export function paleta(nome, atual) {
  return opcoes(nome, PALETA.map(([c, n]) => [c, `<i style="background:${c}"></i>`, n]), atual, { classe: 'paleta', rotulo: 'Cor' });
}

/** Chips de prazo, a partir de hoje: Hoje, Amanhã, Sexta, Próxima semana, Sem prazo, 📅 outra data. */
export function prazos(nome, hoje, atual = null) {
  const sexta = somarDias(hoje, (5 - diaDaSemana(hoje) + 7) % 7 || 7);
  const segunda = somarDias(hoje, (1 - diaDaSemana(hoje) + 7) % 7 || 7);
  const lista = [['', 'Sem prazo'], [hoje, 'Hoje'], [somarDias(hoje, 1), 'Amanhã']];
  if (sexta !== somarDias(hoje, 1)) lista.push([sexta, 'Sexta']);
  if (segunda !== somarDias(hoje, 1)) lista.push([segunda, 'Próx. semana']);
  if (atual && !lista.some(([v]) => v === atual)) lista.push([atual, formatoCurto(atual)]);
  return `${opcoes(nome, lista, atual ?? '', { classe: 'prazos', rotulo: 'Prazo' })}
    <label class="outra-data">📅 <span>Outra data</span><input type="date" data-outra-data="${esc(nome)}" aria-label="Escolher outra data"></label>`;
}

/** Quem: Casa + cada membro com o emoji. */
export function quem(nome, membros, atual = null, { comCasa = true } = {}) {
  const l = [...(comCasa ? [['', '🏠 Casa']] : []), ...membros.map((m) => [m.id, `${esc(m.emoji)} ${esc(m.nome)}`])];
  return opcoes(nome, l, atual ?? '', { classe: 'quem-op', rotulo: 'Responsável' });
}

export const CARAS_HUMOR = ['😞', '😕', '😐', '🙂', '😄'];
export const CARAS_ENERGIA = ['🪫', '🥱', '😌', '💪', '⚡'];
const ROT_HUMOR = ['Péssimo', 'Ruim', 'Ok', 'Bom', 'Ótimo'];
const ROT_ENERGIA = ['Sem energia', 'Cansado', 'Normal', 'Disposto', 'A mil'];
/** Grade de carinhas (humor) ou ícones (energia); mantém data-campo/data-v da grade antiga. */
export function caras(campo, v) {
  const icones = campo === 'energia' ? CARAS_ENERGIA : CARAS_HUMOR;
  const rots = campo === 'energia' ? ROT_ENERGIA : ROT_HUMOR;
  return `<div class="escolha caras" data-campo="${campo}">${icones.map((ic, i) =>
    `<button type="button" class="${v === i + 1 ? 'on' : ''}" data-v="${i + 1}" aria-label="${campo}: ${rots[i]}"><span>${ic}</span><small>${rots[i]}</small></button>`).join('')}</div>`;
}

/** Liga os comportamentos (clique em chip, contador, data livre) dentro de `raiz`. */
export function ligarEntradas(raiz, aoMudar = () => {}) {
  raiz.addEventListener('click', (e) => {
    const b = e.target.closest('[data-grupo] [data-op]');
    if (b) {
      const g = b.closest('[data-grupo]');
      g.dataset.valor = b.dataset.op;
      g.querySelectorAll('[data-op]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
      aoMudar(g.dataset.grupo, b.dataset.op);
      return;
    }
    const s = e.target.closest('[data-stepper] [data-d]');
    if (s) {
      const c = s.closest('[data-stepper]');
      const passo = Number(c.dataset.passo), min = Number(c.dataset.min), max = Number(c.dataset.max);
      const v = Math.min(max, Math.max(min, Number(c.dataset.valor) + Number(s.dataset.d) * passo));
      c.dataset.valor = String(v);
      c.querySelector('output').textContent = v.toLocaleString('pt-BR');
      aoMudar(c.dataset.stepper, v);
    }
  });
  raiz.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-outra-data]');
    if (!inp || !inp.value) return;
    const g = raiz.querySelector(`[data-grupo="${inp.dataset.outraData}"]`);
    if (!g) return;
    let b = g.querySelector(`[data-op="${inp.value}"]`);
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.dataset.op = inp.value;
      b.textContent = formatoCurto(inp.value);
      g.append(b);
    }
    b.click();
  });
}
/** Lê o valor de um grupo ou contador. */
export function valor(raiz, nome) {
  const el = raiz.querySelector(`[data-grupo="${nome}"], [data-stepper="${nome}"]`);
  return el ? el.dataset.valor : undefined;
}
/** Muda o contador por fora (ex.: trocou a unidade). */
export function definirContador(raiz, nome, v, { passo, unidade } = {}) {
  const c = raiz.querySelector(`[data-stepper="${nome}"]`);
  if (!c) return;
  c.dataset.valor = String(v);
  if (passo) c.dataset.passo = String(passo);
  c.querySelector('output').textContent = Number(v).toLocaleString('pt-BR');
  if (unidade !== undefined) c.querySelector('.un').textContent = unidade;
}
