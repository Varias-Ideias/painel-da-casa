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

## 25/09/2026 — pedidos do dono depois do primeiro uso

- **D21. Layout escolhido: C ("Agora").** O A e o B saíram do código. Foram acrescentados o cartão de
  fotos e o "Hoje" em faixas: cachorros primeiro, depois as pessoas em ordem alfabética (Karen, Matheus).
- **D22. Visual "floresta à noite", escuro por padrão:** musgo, samambaia, âmbar e rio; luz de folhas
  andando no fundo; cartões de vidro; Instrument Serif no relógio e nos títulos; anéis de progresso
  por tipo de hábito; fase da lua calculada no aparelho. O claro ("jardim de manhã") ficou como opção.
- **D23. Mercado: tocar marca, risca e o item sai da lista** para "🧺 no carrinho" (com Ver e Limpar),
  em vez de ficar riscado ocupando espaço. O desfazer continua no aviso.
- **D24. Fotos do painel vêm da pasta pública do Pinterest da Karen** (moodboard), pelo RSS que o
  Pinterest publica para pastas públicas, na versão 736 px e com cache de 6 h. O feed traz só os
  **25 pins mais recentes**. Também dá para usar uma pasta local, `dados/fotos/`.
- **D25. Descanso da tela:** depois de N minutos sem toque (padrão 3), a tela escurece e fica só o
  relógio, andando para não marcar a tela; entre 22h e 6h fica mais escura. O primeiro toque só
  acorda. A página **não controla o brilho** do iPad nem impede o bloqueio. Para isso: Bloqueio
  Automático → Nunca e **Modo Pouca Energia desligado** (com ele o iPad força bloqueio em 30 s).
- **D26. Backup no GitHub, cifrado** (AES-256-GCM + scrypt), num repositório privado separado. O
  diário e a gratidão não ficam legíveis no GitHub. Sem a senha, o backup não abre.
- **D27. Nuvem: vai ser um projeto Supabase novo, pausando o `patinhas`** (o dono liberou pausar
  patinhas e paperclip; pausa-se só o necessário, e o paperclip é a direção da plataforma). A pausa só
  acontece quando a migração começar, para não derrubar o patinhas à toa.

- **D28. O descanso entra em 15 s (novo padrão) e vira um quadro:** as fotos do Pinterest em tela
  cheia, trocando a cada 20 s, com a hora, a data e as pendências por cima. À noite o quadro escurece.
- **D29. Tocar no nome ou no emoji abre a pessoa:** o dia de hoje (humor, energia, destaque), a rotina
  (marcar, ver o histórico, editar, arquivar) e "+ Nova rotina". Nos cachorros, a rotina dos dois.
  "Hábito" passou a se chamar "rotina" na tela.
- **D30. O painel não rola com o dedo** (a página fica presa à tela); só as sheets rolam.
- **D31. Barra de status do iPad e bateria:** um app da Tela de Início não consegue esconder a barra
  de status, e o Safari não deixa página nenhuma ler a bateria. Por isso não há indicador de
  bateria (seria inventado). O botão ⛶ tenta a tela cheia e só aparece onde o navegador permite.
- **D32. O tema saiu dos Ajustes;** fica o ☾/☀ no painel.
- **D33. "Gerar 90 dias de exemplo" (Ajustes):** 9 rotinas a mais, histórico, humor, destaques,
  mercado e pendências, tudo marcado como exemplo. É determinístico e removível, e não toca no que
  é real.

- **D34. Entradas por toque, texto só onde ele é o conteúdo** (`web/entradas.js`): botão ＋ com blocos
  grandes (Mercado, Pendência, Dia de cada pessoa, Nova rotina); mercado numa grade por seção
  (acende = na lista); pendência com quem por avatar e prazo por chips (Hoje, Amanhã, Sexta, Próx.
  semana, 📅); rotina com grade de ícones, 4 cartões de tipo, contador − + e unidade em chips;
  humor e energia em carinhas; pessoas com grade de emojis e paleta da natureza. O que continua
  digitado: nome da pendência e da rotina, destaque, gratidão, diário e a barra "Anotar" (que aceita
  o 🎤 do teclado).

- **D35. O destaque do dia é privado, como o diário.** O painel mostra só humor e energia. Os
  destaques que já existiam foram movidos, uma vez, do registro (que a casa via) para o privado de
  cada pessoa (migração `destaque-privado`, testada).
- **D36. O mercado ganhou ✕ para tirar da lista** (com desfazer). Tocar no nome continua mandando
  para o carrinho.
- **D37. Item que cai em "Outros" gera a pergunta "Em que seção fica X?"**, com as seções em chips;
  um toque ensina o app. O dicionário de seções também cresceu bastante.
- **D38. Pendências também guardam datas:** 🎂 aniversário e 📌 data importante se repetem todo ano,
  aparecem só a partir de N dias antes ("em 5 dias") e, ao serem concluídas, voltam no ano seguinte.
  O aniversário pode criar junto "🎁 Comprar presente" alguns dias antes. As que ainda não chegaram
  ficam em "Próximas datas", no fim da lista.
- **D39. As pendências do painel rolam dentro do cartão**, como o mercado (sem "+N").
- **D40. "Teste de estresse" (Ajustes):** 42 rotinas, cerca de 57 itens e 48 pendências, removível. O
  layout aguentou; ajustes feitos: borda esmaecida nas faixas de rotina que passam da largura e texto
  com reticências nos mosaicos do celular.

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
