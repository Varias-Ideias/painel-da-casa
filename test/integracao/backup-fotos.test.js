import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cifrar, decifrar, enviarBackup } from '../../servidor/backup-git.js';
import { urlFeed, lerFeed, criarFotos } from '../../servidor/fotos.js';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('cifra: ida e volta; senha errada não abre; o texto não aparece no arquivo', () => {
  const orig = Buffer.from(JSON.stringify({ privado: { k: { '2026-09-25': { texto: 'segredo da Karen' } } } }));
  const enc = cifrar(orig, 'senha-boa');
  assert.ok(!enc.includes('segredo'));
  assert.deepEqual(decifrar(enc, 'senha-boa'), orig);
  assert.throws(() => decifrar(enc, 'senha-ruim'), /Senha errada/);
  const adulterado = JSON.parse(enc); adulterado.dados = Buffer.from('xx').toString('base64');
  assert.throws(() => decifrar(JSON.stringify(adulterado), 'senha-boa'));
});

test('backup no git: cifra, commita e empurra para o remoto; não repete no mesmo dia', async () => {
  const base = tmp('bkgit-');
  const remoto = path.join(base, 'remoto.git');
  const clone = path.join(base, 'clone');
  execFileSync('git', ['init', '--bare', '-q', remoto]);
  execFileSync('git', ['clone', '-q', remoto, clone]);
  execFileSync('git', ['-C', clone, 'config', 'user.email', 'teste@exemplo']);
  execFileSync('git', ['-C', clone, 'config', 'user.name', 'Teste']);
  const arquivo = path.join(base, 'casa-2026-09-25.json');
  fs.writeFileSync(arquivo, '{"diario":"segredo"}');
  const r = await enviarBackup({ arquivo, nome: 'casa-2026-09-25.json', pasta: clone, senha: 's', log: () => {} });
  assert.equal(r, 'enviado');
  const noRemoto = execFileSync('git', ['--git-dir', remoto, 'show', 'HEAD:casa-2026-09-25.json.enc']).toString();
  assert.ok(!noRemoto.includes('segredo'));
  assert.equal(decifrar(noRemoto, 's').toString(), '{"diario":"segredo"}');
  assert.equal(await enviarBackup({ arquivo, nome: 'casa-2026-09-25.json', pasta: clone, senha: 's' }), 'ja-existia');
  assert.equal(await enviarBackup({ arquivo, nome: 'x.json', pasta: null, senha: 's' }), 'sem-config');
  fs.rmSync(base, { recursive: true, force: true });
});

test('fotos: link da pasta vira feed; miniatura vira 736x; título limpo', () => {
  assert.equal(urlFeed('https://br.pinterest.com/karencristine04/moodboard/'), 'https://br.pinterest.com/karencristine04/moodboard.rss');
  assert.equal(urlFeed('https://www.pinterest.com/karencristine04/moodboard/?invite_code=abc'), 'https://www.pinterest.com/karencristine04/moodboard.rss');
  assert.throws(() => urlFeed('https://exemplo.com/a/b'), /Pinterest/);
  assert.throws(() => urlFeed('https://br.pinterest.com/karencristine04/'), /PASTA/);
  const xml = `<rss><channel><item><title>Casa &amp; jardim</title><description><![CDATA[<img src="https://i.pinimg.com/236x/aa/bb/cc/aabbcc.jpg">]]></description></item>
    <item><title>sem foto</title></item><item><title><![CDATA[Floresta]]></title><description>&lt;img src="https://i.pinimg.com/236x/11/22/33/112233.png"&gt;</description></item></channel></rss>`;
  assert.deepEqual(lerFeed(xml), [
    { url: 'https://i.pinimg.com/736x/aa/bb/cc/aabbcc.jpg', titulo: 'Casa & jardim' },
    { url: 'https://i.pinimg.com/736x/11/22/33/112233.png', titulo: 'Floresta' },
  ]);
});

test('fotos: busca uma vez, usa o cache, junta com a pasta local', async () => {
  const dados = tmp('fotos-');
  fs.mkdirSync(path.join(dados, 'fotos'));
  fs.writeFileSync(path.join(dados, 'fotos', 'cachorros.jpg'), 'x');
  let chamadas = 0;
  const baixar = async () => { chamadas++; return { ok: true, text: async () => '<item><title>A</title>https://i.pinimg.com/236x/aa/aa.jpg</item>' }; };
  const f = criarFotos({ dados, config: () => ({ fotos_pinterest: 'https://br.pinterest.com/u/p/' }), baixar });
  const l1 = await f.listar();
  const l2 = await f.listar();
  assert.equal(chamadas, 1);
  assert.deepEqual(l1.map((x) => x.url), ['/fotos-locais/cachorros.jpg', 'https://i.pinimg.com/736x/aa/aa.jpg']);
  assert.deepEqual(l2, l1);
  fs.rmSync(dados, { recursive: true, force: true });
});

test('fotos: Pinterest fora do ar não quebra; mostra só as locais', async () => {
  const dados = tmp('fotos2-');
  const erro = console.error; console.error = () => {};
  try {
    const f = criarFotos({ dados, config: () => ({ fotos_pinterest: 'https://br.pinterest.com/u/p/' }), baixar: async () => { throw new Error('sem rede'); } });
    assert.deepEqual(await f.listar(), []);
  } finally { console.error = erro; }
  fs.rmSync(dados, { recursive: true, force: true });
});
