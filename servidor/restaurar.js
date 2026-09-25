// `npm run restaurar -- <arquivo.enc> [saida.json]`: abre um backup cifrado.
// A senha vem de dados/config.json ou da variável BACKUP_SENHA (para abrir noutra máquina).
// Para voltar a casa a um backup: pare o servidor e ponha a saída em dados/casa.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decifrar } from './backup-git.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [entrada, saida] = process.argv.slice(2);
if (!entrada) { console.error('Uso: npm run restaurar -- <arquivo.enc> [saida.json]'); process.exit(2); }
let senha = process.env.BACKUP_SENHA;
if (!senha) { try { senha = JSON.parse(fs.readFileSync(path.join(RAIZ, 'dados', 'config.json'), 'utf8')).backup_senha; } catch { /* sem config */ } }
if (!senha) { console.error('Sem senha: defina BACKUP_SENHA ou rode onde existe dados/config.json'); process.exit(2); }
try {
  const buf = decifrar(fs.readFileSync(entrada, 'utf8'), senha);
  const destino = saida || entrada.replace(/\.enc$/, '');
  fs.writeFileSync(destino, buf);
  console.log(`Aberto: ${destino}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
