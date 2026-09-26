// Servidor da casa: Node puro, sem dependências. Serve o app, guarda o estado e avisa todos os
// aparelhos em tempo real (Server-Sent Events). Toda mudança passa por src/dominio/acoes.js.
//
//   npm start                  → porta 8765, dados em ./dados
//   PORTA=9000 DADOS=/x npm start
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { abrir } from './armazenamento.js';
import { enviarBackup } from './backup-git.js';
import { criarFotos } from './fotos.js';
import { aplicar, filtrarPara, ErroAcao } from '../src/dominio/acoes.js';
import { hojeNoFuso } from '../src/dominio/datas.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.PORTA || 8765);
const DADOS = path.resolve(process.env.DADOS || path.join(RAIZ, 'dados'));
const WEB = path.join(RAIZ, 'web');
const DOMINIO = path.join(RAIZ, 'src', 'dominio');

/** Configuração desta máquina, em dados/config.json (fora do git). Tudo opcional. */
function lerConfig(dados) {
  try { return JSON.parse(fs.readFileSync(path.join(dados, 'config.json'), 'utf8')); } catch { return {}; }
}

export function criarServidor({ dados = DADOS, silencioso = false, ips = null, backupExtra, baixarFotos } = {}) {
  const config = lerConfig(dados);
  const aoBackup = (arquivo, nome) => {
    const c = lerConfig(dados);
    enviarBackup({ arquivo, nome, pasta: c.backup_git, senha: c.backup_senha })
      .then((r) => { if (r === 'enviado' && !silencioso) console.log(`Backup cifrado enviado: ${nome}.enc`); })
      .catch((e) => console.error('Aviso: backup cifrado não foi:', e.message));
  };
  const banco = abrir(dados, { backupExtra: backupExtra !== undefined ? backupExtra : config.backup_extra || null, aoBackup });
  const fotos = criarFotos({ dados, config: () => lerConfig(dados), ...(baixarFotos ? { baixar: baixarFotos } : {}) });
  const ouvintes = new Set();
  const limites = new Map(); // quem → [instantes] para o rate limit da captura

  const log = (...a) => { if (!silencioso) console.log(new Date().toLocaleTimeString('pt-BR'), ...a); };

  // Com id de ação, os ids novos derivam dele: o aparelho aplica a mesma ação localmente e chega
  // aos mesmos ids, então o "desfazer" calculado lá aponta para os itens certos aqui.
  function ctxDe(quem, idAcao) {
    const e = banco.estado;
    let n = 0;
    return { quem, agora: new Date().toISOString(), hoje: hojeNoFuso(e.casa.tz), novoId: () => (idAcao ? `${idAcao}.${n++}` : crypto.randomUUID()) };
  }

  function avisar() {
    const msg = `event: versao\ndata: ${banco.estado.versao}\n\n`;
    for (const res of ouvintes) res.write(msg);
  }

  /** Aplica uma ação com idempotência pelo id do cliente. */
  function executar(quem, acao) {
    const e = banco.estado;
    if (acao.id && e.aplicadas[acao.id]) return { ...e.aplicadas[acao.id], repetida: true };
    const r = aplicar(e, { tipo: acao.tipo, dados: acao.dados }, ctxDe(quem, acao.id));
    const mudou = r.desfazer !== null || acao.tipo !== 'captura';
    if (mudou) e.versao += 1;
    const resposta = { ok: true, versao: e.versao, resultado: r.resultado, fala: r.fala, desfazer: r.desfazer };
    if (acao.id) {
      e.aplicadas[acao.id] = { ok: true, versao: e.versao, fala: r.fala, desfazer: r.desfazer };
      const ids = Object.keys(e.aplicadas);
      if (ids.length > 2000) for (const id of ids.slice(0, ids.length - 2000)) delete e.aplicadas[id];
    }
    banco.salvar();
    if (mudou) avisar();
    return resposta;
  }

  function registrarCaptura(quem, origem, texto, resposta, erro) {
    const e = banco.estado;
    e.capturas.push({ em: new Date().toISOString(), quem, origem, texto, interpretacao: resposta?.resultado?.interpretacao || null, fala: resposta?.fala || null, erro: erro || null });
    if (e.capturas.length > 500) e.capturas.splice(0, e.capturas.length - 500);
  }

  function limitar(quem) {
    const agora = Date.now();
    const lista = (limites.get(quem) || []).filter((t) => agora - t < 60000);
    lista.push(agora);
    limites.set(quem, lista);
    return lista.length > 30;
  }

  const json = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  function lerCorpo(req) {
    return new Promise((ok, falha) => {
      let tam = 0; const partes = [];
      req.on('data', (c) => { tam += c.length; if (tam > 64 * 1024) { falha(new ErroAcao('Corpo grande demais', 413)); req.destroy(); } else partes.push(c); });
      req.on('end', () => {
        const txt = Buffer.concat(partes).toString('utf8');
        if (!txt) return ok({});
        try { ok(JSON.parse(txt)); } catch { falha(new ErroAcao('JSON inválido')); }
      });
      req.on('error', falha);
    });
  }

  const TIPOS = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
  function servirArquivo(res, base, rel) {
    const alvo = path.resolve(base, '.' + path.posix.normalize('/' + rel));
    if (!alvo.startsWith(base + path.sep) && alvo !== base) return json(res, 403, { erro: 'Proibido' });
    fs.readFile(alvo, (err, buf) => {
      if (err) return json(res, 404, { erro: 'Não encontrado' });
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  }

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://casa');
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('t') || '';
    try {
      // ---------- API ----------
      if (url.pathname.startsWith('/api/')) {
        const quem = banco.quemPeloToken(token);
        if (!quem) return json(res, 401, { erro: 'Aparelho não pareado. Abra o link de pareamento deste aparelho.' });

        if (url.pathname === '/api/estado' && req.method === 'GET') {
          const e = banco.estado;
          return json(res, 200, { eu: quem, hoje: hojeNoFuso(e.casa.tz), estado: filtrarPara(e, quem) });
        }
        if (url.pathname === '/api/eventos' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write(`retry: 2000\nevent: versao\ndata: ${banco.estado.versao}\n\n`);
          ouvintes.add(res);
          const pulso = setInterval(() => res.write(': pulso\n\n'), 25000);
          req.on('close', () => { clearInterval(pulso); ouvintes.delete(res); });
          return;
        }
        if (url.pathname === '/api/acao' && req.method === 'POST') {
          const corpo = await lerCorpo(req);
          if (!corpo.tipo) throw new ErroAcao('Falta o tipo da ação');
          const r = executar(quem, corpo);
          log(quem, corpo.tipo, r.repetida ? '(repetida)' : '');
          return json(res, 200, r);
        }
        // A porta única para Siri, Alexa, Home Assistant, bots: um JSON e um header.
        if (url.pathname === '/api/capture' && req.method === 'POST') {
          const corpo = await lerCorpo(req);
          const origem = String(corpo.origem || corpo.source || req.headers['x-origem'] || 'api').slice(0, 40);
          const id = corpo.id || req.headers['idempotency-key'] || null;
          if (limitar(quem)) return json(res, 429, { ok: false, fala: 'Muitas anotações seguidas. Espere um minuto.' });
          let acao, texto;
          if (corpo.type === 'grocery' && Array.isArray(corpo.items)) {
            texto = corpo.items.join(', ');
            acao = { id, tipo: 'mercado.adicionar', dados: { texto, origem } };
          } else {
            texto = String(corpo.text ?? corpo.texto ?? '').slice(0, 500);
            acao = { id, tipo: 'captura', dados: { texto, origem } };
          }
          try {
            const r = executar(quem, acao);
            registrarCaptura(quem, origem, texto, r);
            banco.salvar();
            log('captura', quem, origem, JSON.stringify(texto), '→', r.fala);
            return json(res, 200, { ok: true, fala: r.fala, feito: r.desfazer !== null, interpretacao: r.resultado?.interpretacao || null });
          } catch (err) {
            registrarCaptura(quem, origem, texto, null, err.message);
            banco.salvar();
            throw err;
          }
        }
        if (url.pathname === '/api/fotos' && req.method === 'GET') {
          return json(res, 200, { fotos: await fotos.listar() });
        }
        return json(res, 404, { erro: 'Rota desconhecida' });
      }

      // fotos da pasta dados/fotos/ (precisam do token na URL: <img> não manda header)
      if (url.pathname.startsWith('/fotos-locais/')) {
        if (!banco.quemPeloToken(token)) return json(res, 401, { erro: 'Aparelho não pareado' });
        return servirArquivo(res, fotos.pastaLocal, decodeURIComponent(url.pathname.slice('/fotos-locais/'.length)));
      }

      // ---------- pareamento: QR codes dos links, SÓ para quem está no próprio computador ----------
      if (url.pathname === '/parear') {
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        if (!local) return json(res, 403, { erro: 'A página de pareamento só abre no computador da casa (localhost).' });
        // depois da migração, os QR codes apontam para a nuvem (endereço fixo, HTTPS)
        const nuvem = lerConfig(dados).nuvem_url;
        return paginaParear(res, dados, ips || enderecos(), nuvem);
      }

      // ---------- arquivos ----------
      if (req.method !== 'GET') return json(res, 405, { erro: 'Método não permitido' });
      if (url.pathname.startsWith('/dominio/')) return servirArquivo(res, DOMINIO, url.pathname.slice('/dominio/'.length));
      if (url.pathname === '/' || url.pathname === '/index.html') return servirArquivo(res, WEB, 'index.html');
      return servirArquivo(res, WEB, url.pathname.slice(1));
    } catch (err) {
      const status = err instanceof ErroAcao ? err.status : 500;
      if (status === 500) console.error(err);
      return json(res, status, { ok: false, erro: err.message, fala: status === 500 ? 'Deu um erro no servidor.' : err.message });
    }
  });

  return { servidor, banco };
}

/**
 * Lê os códigos de dados/links.txt e mostra um QR por aparelho, montado com o IP ATUAL do
 * computador: o roteador pode trocar o IP (aconteceu em 25/09), e o link gravado no arquivo envelhece.
 * Os links nunca saem do computador por aqui.
 */
function paginaParear(res, dados, ips, nuvem = null) {
  let txt = '';
  try { txt = fs.readFileSync(path.join(dados, 'links.txt'), 'utf8'); } catch { /* sem arquivo */ }
  const codigos = new Map(); // aparelho → código
  for (const linha of txt.split('\n')) {
    const m = linha.match(/^(.+?)\s+https?:\/\/\S+?\/\?t=(\S+)\s*$/);
    if (m && !codigos.has(m[1].trim())) codigos.set(m[1].trim(), m[2]);
  }
  const porAparelho = new Map([...codigos].map(([nome, t]) => [nome, nuvem ? [`${nuvem}/?t=${t}`] : ips.map((ip) => `http://${ip}:${PORTA}/?t=${t}`)]));
  // rede de casa primeiro (192.168.x, 10.x, 172.16–31.x); o resto (ex.: Tailscale) vem como alternativa
  const casa = (u) => /\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u);
  const blocos = [...porAparelho].map(([nome, urls]) => {
    const ord = [...urls].sort((a, b) => casa(b) - casa(a));
    return { nome, principal: ord[0], outros: ord.slice(1) };
  });
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Parear aparelhos · Painel da Casa</title>
<style>body{font-family:system-ui,sans-serif;background:#EEF2F0;color:#16201D;margin:0;padding:24px}h1{margin:0 0 4px}p{max-width:70ch}
.grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:20px}
.c{background:#fff;border:1px solid #DCE4E0;border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:10px;align-items:center;text-align:center}
.qr{background:#fff;padding:10px}small{color:#5B6A64;word-break:break-all}</style></head><body>
<h1>Parear aparelhos</h1>
<p>Aponte a câmera de cada aparelho para o QR dele, <b>no mesmo Wi-Fi deste computador</b>. Cada link vale para um aparelho só: não compartilhe. Esta página só abre aqui no computador.</p>
${blocos.length ? '' : '<p><b>Não achei dados/links.txt.</b> Ele é criado na primeira vez que o servidor sobe com a pasta de dados vazia.</p>'}
<div class="grade">${blocos.map((b, i) => `<div class="c"><h2 style="margin:0">${b.nome}</h2><div class="qr" id="qr${i}"></div>
<small>${b.principal.replace(/t=.*/, 't=…')}</small>${b.outros.length ? `<small>Também: ${b.outros.map((u) => u.replace(/\?t=.*/, '')).join(' · ')}</small>` : ''}</div>`).join('')}</div>
<p><b>O IP do computador mudou?</b> Esta página sempre usa o IP de agora. Reinstale o app no iPad a partir do QR novo. Para não acontecer de novo, reserve o IP do computador no roteador.</p>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>const L=${JSON.stringify(blocos.map((b) => b.principal))};
if (window.QRCode) L.forEach((u,i)=>new QRCode(document.getElementById('qr'+i),{text:u,width:220,height:220,correctLevel:QRCode.CorrectLevel.M}));
else document.body.insertAdjacentHTML('beforeend','<p><b>Sem internet para desenhar os QR codes.</b> Abra dados/links.txt e mande o link de cada aparelho para ele.</p>');</script>
</body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end(html);
}

function enderecos() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

// Execução direta: `node servidor/servidor.js`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { servidor, banco } = criarServidor();
  servidor.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nA porta ${PORTA} já está em uso: provavelmente o Painel da Casa já está rodando em outra janela.`);
      console.error(`Feche a outra janela (ou use outra porta: set PORTA=8766 && npm start).\n`);
      process.exit(1);
    }
    throw err;
  });
  servidor.listen(PORTA, '0.0.0.0', () => {
    const ips = enderecos();
    console.log(`\nPainel da Casa rodando na porta ${PORTA}. Dados em ${DADOS}`);
    if (banco.tokensNovos) {
      const linhas = [];
      for (const [membro, t] of Object.entries(banco.tokensNovos)) {
        const rot = { casa: 'iPad da casa', m: 'Matheus', k: 'Karen' }[membro];
        for (const ip of ['localhost', ...ips]) linhas.push(`${rot.padEnd(14)} http://${ip}:${PORTA}/?t=${t}`);
        linhas.push('');
      }
      fs.writeFileSync(path.join(DADOS, 'links.txt'), '# Links de pareamento: cada aparelho abre o SEU link uma vez.\n# Este arquivo é segredo: fica fora do git.\n\n' + linhas.join('\n'));
      console.log(`Primeira execução: links de pareamento gravados em ${path.join(DADOS, 'links.txt')}`);
    } else {
      console.log(`Links de pareamento: ${path.join(DADOS, 'links.txt')}`);
    }
    console.log(`Na rede: ${ips.map((ip) => `http://${ip}:${PORTA}`).join('  ')}\n`);
  });
}
