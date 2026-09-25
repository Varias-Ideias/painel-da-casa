// Guarda o estado da casa num arquivo JSON, com escrita atômica e um backup por dia.
// "Dado apagado sem backup não volta" (PARE.md): por isso o backup diário existe desde o dia 1.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { semente } from '../src/dominio/semente.js';
import { hojeNoFuso } from '../src/dominio/datas.js';

export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const novoToken = () => crypto.randomBytes(24).toString('base64url');

/**
 * @param {string} dir pasta de dados
 * @param {{ backupExtra?: string|null }} [op] segunda pasta para o backup diário, fora deste disco
 *   (ex.: uma pasta do OneDrive). Vem de dados/config.json → "backup_extra".
 */
export function abrir(dir, op = {}) {
  fs.mkdirSync(path.join(dir, 'backup'), { recursive: true });
  const extra = op.backupExtra || null;
  const aoBackup = op.aoBackup || null; // ex.: enviar o backup cifrado para o git
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
    const nome = `casa-${hojeNoFuso(estado.casa.tz)}.json`;
    const b = path.join(dir, 'backup', nome);
    if (!fs.existsSync(b)) fs.copyFileSync(arquivo, b);
    copiarExtra(b, nome);
  }
  /** Cópia do backup do dia na pasta extra. Se falhar (OneDrive fora, disco cheio), avisa e segue. */
  function copiarExtra(b, nome) {
    if (aoBackup) aoBackup(b, nome);
    if (!extra) return;
    const alvo = path.join(extra, nome);
    if (fs.existsSync(alvo)) return;
    try {
      fs.mkdirSync(extra, { recursive: true });
      fs.copyFileSync(b, alvo);
    } catch (err) {
      console.error(`Aviso: não consegui copiar o backup para ${extra}: ${err.message}`);
    }
  }
  if (tokensNovos) salvar();
  else {
    // ao subir: garante o backup de hoje, também na pasta extra, mesmo sem nenhuma ação ainda
    const nome = `casa-${hojeNoFuso(estado.casa.tz)}.json`;
    const b = path.join(dir, 'backup', nome);
    if (!fs.existsSync(b)) fs.copyFileSync(arquivo, b);
    copiarExtra(b, nome);
  }

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
