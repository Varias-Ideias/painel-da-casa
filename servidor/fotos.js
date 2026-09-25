// Fotos do painel: de uma pasta pública do Pinterest (pelo feed RSS que o próprio Pinterest
// publica para pastas públicas) e/ou de uma pasta de fotos neste computador (dados/fotos/).
// O feed é lido no servidor (o navegador não pode, por CORS) e guardado em cache por 6 horas.
import fs from 'node:fs';
import path from 'node:path';

const SEIS_HORAS = 6 * 60 * 60 * 1000;

/** "https://br.pinterest.com/usuario/pasta/" → "https://br.pinterest.com/usuario/pasta.rss" */
export function urlFeed(pasta) {
  const u = new URL(pasta);
  if (!/(^|\.)pinterest\.[a-z.]+$/.test(u.hostname)) throw new Error('O link precisa ser de uma pasta do Pinterest');
  const partes = u.pathname.split('/').filter(Boolean);
  if (partes.length < 2) throw new Error('O link precisa ser de uma PASTA (pinterest.com/usuario/pasta)');
  return `${u.origin}/${partes[0]}/${partes[1]}.rss`;
}

/** Extrai as fotos do XML do feed, trocando a miniatura (236x) pela versão 736x. */
export function lerFeed(xml) {
  const fotos = [];
  for (const item of xml.split(/<item>/).slice(1)) {
    const img = item.match(/https:\/\/i\.pinimg\.com\/\d+x\/[0-9a-f/]+\.(?:jpg|jpeg|png|webp)/i);
    if (!img) continue;
    const titulo = (item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    fotos.push({ url: img[0].replace(/\/\d+x\//, '/736x/'), titulo: titulo.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim().slice(0, 120) });
  }
  return fotos;
}

export function criarFotos({ dados, config, baixar = (u) => fetch(u, { headers: { 'User-Agent': 'PainelDaCasa/1.0' } }) }) {
  const cacheArq = path.join(dados, 'fotos-cache.json');
  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(cacheArq, 'utf8')); } catch { /* sem cache ainda */ }
  let buscando = null;

  function locais() {
    const dir = path.join(dados, 'fotos');
    try {
      return fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()
        .map((f) => ({ url: `/fotos-locais/${encodeURIComponent(f)}`, titulo: '' }));
    } catch { return []; }
  }

  async function atualizar() {
    const pasta = config().fotos_pinterest;
    if (!pasta) return;
    const r = await baixar(urlFeed(pasta));
    if (!r.ok) throw new Error(`Pinterest respondeu ${r.status}`);
    const fotos = lerFeed(await r.text());
    cache = { pasta, em: Date.now(), fotos };
    fs.writeFileSync(cacheArq, JSON.stringify(cache));
  }

  /** Lista para o app: locais + Pinterest. Se o cache venceu, atualiza em segundo plano. */
  async function listar() {
    const pasta = config().fotos_pinterest;
    const vencido = pasta && (!cache || cache.pasta !== pasta || Date.now() - cache.em > SEIS_HORAS);
    if (vencido && !buscando) {
      buscando = atualizar().catch((e) => console.error('Fotos do Pinterest:', e.message)).finally(() => { buscando = null; });
      if (!cache || cache.pasta !== pasta) await buscando; // primeira vez: espera
    }
    const doPinterest = cache && cache.pasta === pasta ? cache.fotos : [];
    return [...locais(), ...doPinterest];
  }

  return { listar, pastaLocal: path.join(dados, 'fotos') };
}
