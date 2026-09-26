// `npm run migrar-nuvem -- <codigo>`: leva a casa do computador para a nuvem, UMA vez.
// Envia dados/casa.json (tokens vão só como hash: os mesmos links continuam valendo, só muda o
// endereço), grava dados/links-nuvem.txt e marca a nuvem em dados/config.json, para o /parear
// passar a mostrar os QR codes da nuvem. O código é de uso único (o servidor recusa o segundo uso).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DADOS = path.join(RAIZ, 'dados');
const API = 'https://xbzeoueiipieoadidibc.supabase.co/functions/v1/api';
const SITE = 'https://mrcx.vercel.app';

const codigo = process.argv[2];
if (!codigo) { console.error('Uso: npm run migrar-nuvem -- <codigo>'); process.exit(2); }
const estado = JSON.parse(fs.readFileSync(path.join(DADOS, 'casa.json'), 'utf8'));
let config = {};
try { config = JSON.parse(fs.readFileSync(path.join(DADOS, 'config.json'), 'utf8')); } catch { /* sem config */ }

const r = await fetch(`${API}/importar`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ codigo, estado, config: { fotos_pinterest: config.fotos_pinterest || null } }),
});
const j = await r.json().catch(() => ({}));
if (!r.ok) { console.error(`A nuvem recusou: ${j.erro || r.status}`); process.exit(1); }
console.log(`Casa enviada para a nuvem (${j.tokens} aparelhos).`);

// mesmos códigos, endereço novo
const links = fs.readFileSync(path.join(DADOS, 'links.txt'), 'utf8');
const vistos = new Map();
for (const linha of links.split('\n')) {
  const m = linha.match(/^(.+?)\s+https?:\/\/\S+?\/\?t=(\S+)\s*$/);
  if (m && !vistos.has(m[1].trim())) vistos.set(m[1].trim(), m[2]);
}
fs.writeFileSync(path.join(DADOS, 'links-nuvem.txt'), '# Links de pareamento NA NUVEM (segredo: não compartilhe)\n\n' +
  [...vistos].map(([nome, t]) => `${nome.padEnd(14)} ${SITE}/?t=${t}`).join('\n') + '\n');
config.nuvem_url = SITE;
fs.writeFileSync(path.join(DADOS, 'config.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`Links novos em dados/links-nuvem.txt. Abra http://localhost:8765/parear para ver os QR codes da nuvem.`);
