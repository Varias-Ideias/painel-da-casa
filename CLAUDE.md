# CLAUDE.md — Painel da Casa

Convenções duráveis. A fonte da verdade do produto é o `BRIEFING.md`; as decisões e os motivos
ficam no `DECISIONS.md`; a trava fica no `PARE.md`.

## Como trabalhar
- Converse e escreva a interface em **pt-BR**. Fuso `America/Sao_Paulo`, datas no formato brasileiro,
  semana começando na **segunda**.
- **Trabalhe por fases** (BRIEFING §9). Cada fase abre com um plano curto que o dono aprova e fecha
  com o que foi feito, como testar no iPad real e o que ficou pendente. O dono pediu, em 25/09,
  para seguir sem travar: pergunte só no que for item do `PARE.md` ou decisão irreversível.
- **Não suponha, e não afirme o que não testou.** Diga o que foi medido e o que ficou sem verificar.
- **`PARE.md` é trava.** Nuvem ou custo, ou dado real da casa: pare e pergunte.
- **`dados/` é da casa:** estado real e links secretos. Não leia `dados/links.txt` nem
  `dados/casa.json`; para testar, suba uma instância descartável com outra pasta de dados.
- Toda decisão nova vira uma ou duas linhas no `DECISIONS.md`. Se o briefing mudar, atualize-o.
- O backlog é `backlog.json`. Cada item tem o tamanho de uma sessão.

## Comandos
```bash
npm start            # servidor da casa na porta 8765 (dados em ./dados, fora do git)
npm test             # portões + testes de unidade e integração (node:test, sem dependências)
npm run unit         # só unidade
npx portao-contexto  # teto do caminho quente: 24 KB
```
Instância de teste: `criarServidor({ dados: <pasta temporária> })` de `servidor/servidor.js`.

## Estrutura
```
src/dominio/   lógica pura e portável: datas, habitos (sequências), mercado, parser, acoes, semente
servidor/      servidor Node sem dependências: API, SSE, /api/capture, /parear, armazenamento JSON
web/           o app (painel A/B/C + celular), PWA; importa src/dominio via /dominio/
test/unit/     regras de sequência, parser (tabela de 50 frases), ações e privacidade
test/integracao/ servidor real numa pasta temporária
docs/          ARQUITETURA.md
```

## Regras de código
- JavaScript ESM com `// @ts-check` no domínio. Toda mudança de estado passa por
  `src/dominio/acoes.js` (`aplicar`); cada ação devolve `fala` e a inversa em `desfazer`.
- **Nenhum segredo no cliente nem no git.** Tokens guardados com hash. A chave de LLM, quando
  existir, fica só no servidor.
- **iPad:** alvos de toque ≥ 48 px (ideal 56); `touch-action: manipulation`; safe areas; sem seleção
  de texto em botão; ação destrutiva sempre com desfazer, nunca com janela de confirmação.
- O diário e a gratidão são privados de cada pessoa e nunca aparecem no painel compartilhado
  (`filtrarPara` no servidor).
- **Cuidado com colisão de classe CSS:** `base.css` já usa `.barra` (a barra de progresso).

## Fechamento de fase
`npm test` verde; nenhum erro no console (exceto o do service worker no navegador embutido do app,
que não registra SW); teste no Safari do iPad (app na Tela de Início), no iPhone e no Windows.
