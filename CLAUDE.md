# CLAUDE.md — Painel da Casa

Convenções duráveis. A fonte da verdade do produto é o `BRIEFING.md`; as decisões e os motivos
ficam no `DECISIONS.md`; a trava fica no `PARE.md`.

## Como trabalhar
- Converse e escreva a interface em **pt-BR**. Fuso `America/Sao_Paulo`, datas no formato brasileiro,
  semana começando na **segunda**.
- **Trabalhe por fases** (BRIEFING §9). Cada fase abre com um plano curto que o dono aprova e fecha
  com o que foi feito, como testar no iPad real e o que ficou pendente. Não comece a fase seguinte
  sem o ok dele.
- **Não suponha.** Se algo estiver ambíguo, pergunte em rodadas de até 5 perguntas, com opções e
  uma recomendação.
- **`PARE.md` é trava.** Nuvem ou custo, ou dado real da casa: pare e pergunte.
- Toda decisão nova vira uma ou duas linhas no `DECISIONS.md`. Se o briefing mudar, atualize-o.
- O backlog é `backlog.json`. Cada item tem o tamanho de uma sessão.

## Comandos
```bash
npm install          # inclui o núcleo @varias-ideias/plataforma (pacote local, nunca cópia)
npm test             # portões (portao-contexto); lint/typecheck/unit/e2e entram a partir do B1
npx portao-contexto  # teto do caminho quente: 24 KB
```

## Estrutura (alvo; nasce no B1)
```
src/app/(painel)/      painel do iPad e do computador
src/app/(celular)/     abas Hoje, Mercado, Pendências, Registro
src/app/api/capture/   entrada universal (Fase 4)
src/components/        ui/ (shadcn) e módulos
src/lib/               streaks/ parser/ offline/ supabase/
supabase/              migrations/ e seed.sql
test/                  unit/ e e2e/ (Playwright)
docs/                  ARQUITETURA.md
```

## Regras de código
- TypeScript estrito, Zod nas bordas da API, migrations versionadas.
- **Nenhuma chave secreta no cliente.** Tokens de captura são guardados com hash. A chave do LLM
  fica só no servidor.
- **iPad:** alvos de toque ≥ 48 px (ideal 56); `touch-action: manipulation`; safe areas; sem seleção
  de texto em botão; ação destrutiva sempre com desfazer, nunca com janela de confirmação.
- O diário e a gratidão são privados de cada pessoa e nunca aparecem no painel compartilhado.

## Fechamento de fase
Lint, typecheck e testes passando; nenhum erro no console; teste no Safari do iPad (app na Tela de
Início), no iPhone e no Chrome ou Edge do Windows.
