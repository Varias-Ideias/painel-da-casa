// Sobe o servidor de verdade numa pasta temporária e fala com ele por HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { criarServidor } from '../../servidor/servidor.js';

let srv, banco, base, dir, T;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-'));
  // IPs "atuais" fixos para o teste: o computador mudou de .9 para .10, e o Tailscale continua
  ({ servidor: srv, banco } = criarServidor({ dados: dir, silencioso: true, ips: ['100.85.1.2', '192.168.0.10'] }));
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${srv.address().port}`;
  T = banco.tokensNovos;
});
after(() => { srv.closeAllConnections?.(); srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const req = async (metodo, rota, { token, corpo, headers = {} } = {}) => {
  const r = await fetch(base + rota, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const txt = await r.text();
  let json = null; try { json = JSON.parse(txt); } catch {}
  return { status: r.status, json, txt };
};

test('sem token: 401 na API', async () => {
  assert.equal((await req('GET', '/api/estado')).status, 401);
  assert.equal((await req('GET', '/api/estado', { token: 'errado' })).status, 401);
});

test('tokens ficam só como hash no disco', () => {
  const disco = fs.readFileSync(path.join(dir, 'casa.json'), 'utf8');
  for (const t of Object.values(T)) assert.ok(!disco.includes(t), 'token em texto puro no disco');
});

test('estado: cada aparelho vê o que pode', async () => {
  await req('POST', '/api/acao', { token: T.m, corpo: { tipo: 'privado.salvar', dados: { campos: { texto: 'diário do Matheus' } } } });
  const casa = (await req('GET', '/api/estado', { token: T.casa })).json;
  assert.equal(casa.eu, 'casa');
  assert.deepEqual(casa.estado.privado, {});
  assert.equal(casa.estado.tokens, undefined);
  const k = (await req('GET', '/api/estado', { token: T.k })).json;
  assert.deepEqual(k.estado.privado, {});
  const m = (await req('GET', '/api/estado', { token: T.m })).json;
  assert.equal(Object.values(m.estado.privado.m)[0].texto, 'diário do Matheus');
});

test('ação idempotente: o mesmo id aplicado duas vezes muda uma vez', async () => {
  const corpo = { id: 'cli-1', tipo: 'mercado.adicionar', dados: { texto: 'tapioca' } };
  const a = await req('POST', '/api/acao', { token: T.k, corpo });
  const b = await req('POST', '/api/acao', { token: T.k, corpo });
  assert.equal(a.status, 200);
  assert.equal(b.json.repetida, true);
  assert.equal(banco.estado.mercado.filter((i) => i.nome === 'Tapioca').length, 1);
});

test('ação inválida: 400 com mensagem, sem derrubar o servidor', async () => {
  const r = await req('POST', '/api/acao', { token: T.k, corpo: { tipo: 'pendencia.criar', dados: { titulo: '' } } });
  assert.equal(r.status, 400);
  assert.match(r.json.erro, /título/);
  assert.equal((await req('POST', '/api/acao', { token: T.k, corpo: { tipo: 'privado.salvar', dados: {} }, headers: {} })).status, 200);
  assert.equal((await req('POST', '/api/acao', { token: T.casa, corpo: { tipo: 'privado.salvar', dados: {} } })).status, 403);
});

test('/api/capture: texto livre devolve frase falável', async () => {
  const r = await req('POST', '/api/capture', { token: T.m, corpo: { text: 'adiciona leite condensado e pão de forma na lista', origem: 'siri' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.feito, true);
  assert.match(r.json.fala, /^Anotei /);
  assert.equal(banco.estado.capturas.at(-1).origem, 'siri');
});

test('/api/capture: payload estruturado', async () => {
  const r = await req('POST', '/api/capture', { token: T.m, corpo: { type: 'grocery', items: ['alface', 'cenoura'] } });
  assert.match(r.json.fala, /alface e cenoura/);
});

test('/api/capture: ambíguo pergunta e não muda nada', async () => {
  const v = banco.estado.versao;
  const r = await req('POST', '/api/capture', { token: T.m, corpo: { text: 'bla bla' } });
  assert.equal(r.json.feito, false);
  assert.match(r.json.fala, /Não entendi/);
  assert.equal(banco.estado.versao, v);
});

test('/api/capture: Idempotency-Key evita anotar duas vezes num reenvio', async () => {
  const opts = { token: T.m, corpo: { text: 'comprar abacate' }, headers: { 'Idempotency-Key': 'siri-42' } };
  await req('POST', '/api/capture', opts);
  await req('POST', '/api/capture', opts);
  assert.equal(banco.estado.mercado.filter((i) => i.nome === 'Abacate').length, 1);
});

test('tempo real: quem está ouvindo recebe a nova versão', async () => {
  const recebida = new Promise((ok, falha) => {
    const r = http.get(`${base}/api/eventos?t=${T.casa}`, (res) => {
      let buf = '', n = 0;
      res.on('data', (c) => {
        buf += c;
        const versoes = [...buf.matchAll(/event: versao\ndata: (\d+)/g)].map((m) => Number(m[1]));
        if (versoes.length >= 2 && n++ === 0) { r.destroy(); ok(versoes); }
      });
    });
    r.on('error', () => {});
    setTimeout(() => falha(new Error('não chegou evento em 2 s')), 2000);
  });
  await new Promise((ok) => setTimeout(ok, 100));
  await req('POST', '/api/acao', { token: T.k, corpo: { tipo: 'mercado.adicionar', dados: { texto: 'kiwi' } } });
  const [inicial, nova] = await recebida;
  assert.ok(nova > inicial);
});

test('arquivos: app servido e sem escapar da pasta', async () => {
  const r = await req('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.txt, /Painel da Casa/);
  const dom = await req('GET', '/dominio/parser.js');
  assert.equal(dom.status, 200);
  const fuga = await req('GET', '/dominio/../../servidor/armazenamento.js');
  assert.notEqual(fuga.status, 200);
  const fuga2 = await req('GET', '/%2e%2e/dados/casa.json');
  assert.notEqual(fuga2.status, 200);
});

test('/parear abre no próprio computador e não quebra sem links.txt', async () => {
  const r = await req('GET', '/parear');
  assert.equal(r.status, 200);
  assert.match(r.txt, /Parear aparelhos/);
  assert.match(r.txt, /Não achei dados\/links.txt/);
});

test('/parear usa o IP ATUAL (o links.txt tem o antigo) e prefere a rede de casa', async () => {
  const falso = [
    '# Links de pareamento', '',
    `${'iPad da casa'.padEnd(14)} http://localhost:8765/?t=AAA`, `${'iPad da casa'.padEnd(14)} http://100.85.1.2:8765/?t=AAA`, `${'iPad da casa'.padEnd(14)} http://192.168.0.9:8765/?t=AAA`, '',
    `${'Matheus'.padEnd(14)} http://localhost:8765/?t=MMM`, `${'Matheus'.padEnd(14)} http://192.168.0.9:8765/?t=MMM`, '',
    `${'Karen'.padEnd(14)} http://localhost:8765/?t=KKK`, `${'Karen'.padEnd(14)} http://192.168.0.9:8765/?t=KKK`, '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'links.txt'), falso);
  const r = await req('GET', '/parear');
  const links = JSON.parse(r.txt.match(/const L=(\[.*?\]);/)[1]);
  assert.deepEqual(links, ['http://192.168.0.10:8765/?t=AAA', 'http://192.168.0.10:8765/?t=MMM', 'http://192.168.0.10:8765/?t=KKK']);
  assert.match(r.txt, /Também: http:\/\/100\.85\.1\.2:8765\//);
  assert.match(r.txt, /<h2 style="margin:0">Matheus<\/h2>/);
  fs.rmSync(path.join(dir, 'links.txt'));
});

test('backup extra: cópia do dia vai para a segunda pasta, e falha nela não derruba nada', async () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'painel2-'));
  const extra = path.join(d2, 'onedrive', 'painel-backup');
  const { servidor: s2 } = criarServidor({ dados: d2, silencioso: true, backupExtra: extra });
  assert.equal(fs.readdirSync(extra).length, 1);
  assert.match(fs.readdirSync(extra)[0], /^casa-\d{4}-\d{2}-\d{2}\.json$/);
  s2.close();
  // pasta extra impossível (um arquivo no caminho): só avisa
  const bloqueio = path.join(d2, 'arquivo');
  fs.writeFileSync(bloqueio, 'x');
  const erroOriginal = console.error; console.error = () => {};
  try { assert.doesNotThrow(() => criarServidor({ dados: fs.mkdtempSync(path.join(os.tmpdir(), 'painel3-')), silencioso: true, backupExtra: path.join(bloqueio, 'sub') })); }
  finally { console.error = erroOriginal; }
  fs.rmSync(d2, { recursive: true, force: true });
});

test('backup diário existe desde a primeira gravação', () => {
  const b = fs.readdirSync(path.join(dir, 'backup'));
  assert.equal(b.length, 1);
});
