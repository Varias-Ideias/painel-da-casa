// `npm run senha-backup`: gera uma senha forte para o backup cifrado, grava em dados/config.json
// e MOSTRA NA SUA TELA. Guarde num gerenciador de senhas: sem ela, o backup do GitHub não abre.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arq = path.join(RAIZ, 'dados', 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { /* novo */ }
if (config.backup_senha && !process.argv.includes('--trocar')) {
  console.log('Já existe uma senha de backup em dados/config.json. Para trocar: npm run senha-backup -- --trocar');
  console.log('(backups antigos continuam precisando da senha antiga)');
  process.exit(0);
}
const palavras = crypto.randomBytes(18).toString('base64url').match(/.{6}/g).join('-');
config.backup_senha = palavras;
fs.mkdirSync(path.dirname(arq), { recursive: true });
fs.writeFileSync(arq, JSON.stringify(config, null, 2) + '\n');
console.log('\nSenha do backup cifrado (guarde num gerenciador de senhas AGORA):\n');
console.log('   ' + palavras + '\n');
console.log('Gravada em dados/config.json (fora do git). Sem ela, os backups do GitHub não abrem.\n');
