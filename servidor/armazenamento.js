// Guarda o estado da casa num arquivo JSON, com escrita atômica e um backup por dia.
// "Dado apagado sem backup não volta" (PARE.md): por isso o backup diário existe desde o dia 1.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { semente } from '../src/dominio/semente.js';
import { hojeNoFuso } from '../src/dominio/datas.js';

export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const novoToken = () => crypto.randomBytes(24).toString('base64url');

export function abrir(dir) {
  fs.mkdirSync(path.join(dir, 'backup'), { recursive: true });
  const arquivo = path.join(dir, 'casa.json');
  let estado;
  /** tokens em texto puro só existem na primeira criação; vão para links.txt (fora do git) */
  let tokensNovos = null;
  if (fs.existsSync(arquivo)) {
    estado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } else {
    estado = semente(hojeNoFuso('America/Sao_Paulo'));
    tokensNovos = {};
    estado.tokens = [];
    for (const [membro, rotulo] of [['casa', 'iPad da casa'], ['m', 'Celular do Matheus'], ['k', 'Celular da Karen']]) {
      const t = novoToken();
      tokensNovos[membro] = t;
      estado.tokens.push({ id: crypto.randomUUID(), membro, rotulo, hash: hashToken(t), criado_em: new Date().toISOString(), ultimo_uso: null, revogado_em: null });
    }
    estado.capturas = [];
    estado.aplicadas = {};
  }
  estado.capturas ||= [];
  estado.aplicadas ||= {};

  function salvar() {
    const tmp = arquivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(estado));
    fs.renameSync(tmp, arquivo);
    const b = path.join(dir, 'backup', `casa-${hojeNoFuso(estado.casa.tz)}.json`);
    if (!fs.existsSync(b)) fs.copyFileSync(arquivo, b);
  }
  if (tokensNovos) salvar();

  function quemPeloToken(t) {
    if (!t) return null;
    const h = hashToken(t);
    const tok = estado.tokens.find((x) => x.hash === h && !x.revogado_em);
    if (!tok) return null;
    tok.ultimo_uso = new Date().toISOString();
    return tok.membro;
  }

  return { get estado() { return estado; }, salvar, quemPeloToken, tokensNovos };
}
