// Backup diário CIFRADO num repositório git (ex.: Varias-Ideias/painel-da-casa-backup, privado).
// O backup tem diário e gratidão: no GitHub só vai o arquivo cifrado (AES-256-GCM, chave derivada
// da senha por scrypt). Sem a senha, o arquivo não abre, nem para o GitHub nem para ninguém.
//
// dados/config.json:
//   "backup_git": "C:\\...\\dados\\backup-git"   ← um clone do repositório de backup
//   "backup_senha": "…"                           ← gerada por `npm run senha-backup`
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

export function cifrar(buf, senha) {
  const sal = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const chave = crypto.scryptSync(senha, sal, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([c.update(buf), c.final()]);
  return JSON.stringify({
    formato: 'painel-da-casa-backup', v: 1, alg: 'aes-256-gcm', kdf: 'scrypt', N: 2 ** 15,
    sal: sal.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), dados: dados.toString('base64'),
  });
}

export function decifrar(texto, senha) {
  const o = JSON.parse(texto);
  if (o.formato !== 'painel-da-casa-backup' || o.v !== 1) throw new Error('Arquivo não é um backup do Painel da Casa');
  const chave = crypto.scryptSync(senha, Buffer.from(o.sal, 'base64'), 32, { N: o.N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const d = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(o.iv, 'base64'));
  d.setAuthTag(Buffer.from(o.tag, 'base64'));
  try {
    return Buffer.concat([d.update(Buffer.from(o.dados, 'base64')), d.final()]);
  } catch {
    throw new Error('Senha errada (ou arquivo corrompido)');
  }
}

const git = (cwd, args) => new Promise((ok, falha) => {
  execFile('git', args, { cwd, windowsHide: true }, (err, stdout, stderr) => (err ? falha(new Error(`git ${args[0]}: ${stderr || err.message}`)) : ok(stdout)));
});

/**
 * Cifra o backup do dia, grava no clone e empurra. Nunca derruba o servidor: erro vira aviso.
 * @returns {Promise<'enviado'|'sem-config'|'ja-existia'>}
 */
export async function enviarBackup({ arquivo, nome, pasta, senha, log = console.error }) {
  if (!pasta || !senha) return 'sem-config';
  if (!fs.existsSync(path.join(pasta, '.git'))) throw new Error(`${pasta} não é um clone git`);
  const alvo = path.join(pasta, `${nome}.enc`);
  if (fs.existsSync(alvo)) return 'ja-existia';
  fs.writeFileSync(alvo, cifrar(fs.readFileSync(arquivo), senha));
  await git(pasta, ['add', `${nome}.enc`]);
  await git(pasta, ['commit', '-m', `backup ${nome.replace(/\.json$/, '')}`]);
  try {
    await git(pasta, ['push']);
  } catch (e) {
    log(`Aviso: backup cifrado commitado mas não enviado (sem internet?). Vai no próximo envio. ${e.message}`);
  }
  return 'enviado';
}
