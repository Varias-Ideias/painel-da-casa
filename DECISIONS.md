# DECISIONS — Painel da Casa

Uma ou duas linhas por decisão: o quê e por quê. As mais novas ficam embaixo.

## 25/09/2026 — Fase 0

- **D1. A pasta mora em `C:\Users\User\varias-ideias\painel-da-casa`, fora do OneDrive.** O OneDrive
  sincronizando `.git/` e `node_modules/` gera lock e índice corrompido (ESTRUTURA.md do núcleo).
- **D2. Repositório só local por enquanto: privado, sem remoto e sem push.** Criar
  `Varias-Ideias/painel-da-casa` no GitHub fica para quando o dono pedir.
- **D3. O núcleo entra como pacote** (`npm install` de `build/plataforma`), nunca como cópia. Duas
  cópias mantidas à mão viram uma mentindo.
- **D4. A stack do briefing fica: Next.js, Supabase e Vercel, tudo no plano gratuito.** Segue a regra
  do `PARE.md` de usar o que já existe, de graça.
- **D5. Os cachorros são `members` com `kind = 'pet'`.** Não têm login nem registro do dia; podem ser
  responsáveis por pendência e ter hábitos que qualquer pessoa marca. É uma tabela só, sem caso
  especial.
- **D6. O diário e a gratidão são privados.** No painel aparecem só humor, energia e destaque. Como o
  RLS é por linha, os dados vão para duas tabelas: `daily_entries` (a casa lê) e `daily_private`
  (só o dono lê).
- **D7. A semana começa na segunda** (`households.week_start = 1`). Afeta os hábitos "X vezes por
  semana".
- **D8. As seções do mercado ganham "pet", antes de "outros".** São 10 seções, com ordem configurável.
- **D9. Os dois celulares são iPhone, então a voz no celular é Siri + Atalhos.** Alexa continua como
  experimento da Fase 5.
- **D10. Sem números do dia na partida.** A tabela `metric_*` fica no modelo; cada pessoa cria os seus
  depois.
- **D11. A Fase 0 cria só a casa do projeto** (`package.json` com o núcleo e os portões), sem código de
  produto. O briefing diz "sem código" para a Fase 0; o esqueleto do app é o item B1.

## 25/09/2026 — Fase 1, e além ("o mais pronto possível")

- **D12. Até decidir a nuvem, o app roda no computador da casa: Node puro, sem dependências, com
  dados em JSON.** O motivo: o npm ficou bloqueado nesta sessão (sem Next.js), e o Supabase grátis
  não tem vaga (ver abaixo). O dono pediu para seguir sem travar. Custo zero e nada na nuvem, como
  pede o `PARE.md`.
- **D13. A lógica fica isolada em `src/dominio/`** (datas, sequências, parser, mercado, ações), sem
  depender de servidor nem de framework. É ela que migra para a stack final (Next.js + Supabase)
  quando a nuvem for decidida. O servidor e a tela são descartáveis; a lógica e os 102 testes não.
- **D14. Toda mudança é uma ação** (`aplicar(estado, acao)`), com a mesma função no servidor e no
  aparelho. Por isso há resposta instantânea, fila offline, desfazer em tudo (cada ação devolve a
  inversa) e idempotência pelo id da ação.
- **D15. Tempo real por Server-Sent Events.** O servidor avisa a versão nova e cada aparelho recarrega
  o estado. No teste local, 33 ms entre dois aparelhos.
- **D16. Pareamento por link secreto por aparelho** (iPad da casa, Matheus, Karen), guardado só como
  hash; o texto puro fica em `dados/links.txt`, fora do git. O mesmo código serve de token da
  `/api/capture` para a Siri. O painel da casa não lê nem escreve diário e gratidão, e isso é
  cobrado pelo servidor e testado.
- **D17. Os três layouts viraram uma opção do app** (Ajustes → Layout do painel), em vez de
  protótipos separados: a escolha é feita usando de verdade. O padrão é o B.
- **D18. Backup diário automático** em `dados/backup/`, desde o primeiro dia (PARE: "dado apagado
  sem backup não volta").
- **D19. Os dados de exemplo são marcados** (`origem: 'exemplo'`) e saem por um botão, com desfazer.
  Hábitos e pessoas ficam.
- **D20. "Treinei" dito duas vezes não desmarca.** Por voz, marcar é sempre marcar; no toque, o
  segundo toque desmarca.

## Limites gratuitos (conferidos em 25/09/2026)

- **Vercel Hobby:** grátis, só para uso pessoal e não comercial, o que serve para a casa. Quem passa do
  limite fica pausado até 30 dias, sem cobrança. Os números que importam aqui são 100 deploys por dia,
  1 milhão de invocações e 100 GB de transferência.
- **Supabase Free:** 500 MB de banco, 50 mil usuários ativos por mês, 200 conexões Realtime
  simultâneas e 2 milhões de mensagens por mês. O projeto pausa depois de 7 dias com pouca atividade;
  o iPad sempre aberto deve evitar isso.
- **ABERTO (decidir antes da Fase 2): o Supabase Free permite só 2 projetos ativos por dono, e as
  duas vagas já estão ocupadas** (`patinhas` e `paperclip` ativos; `brasil` e `mrcx` pausados). Os
  caminhos são pausar um projeto, usar um schema separado dentro de um projeto existente, ou pagar o
  Pro. Pagar é item do `PARE.md`: decide o dono.
