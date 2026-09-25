# Briefing — Painel da Casa

> Nome provisório. Hábitos, lista de mercado, pendências e registro do dia num painel sempre aberto no iPad, que também funciona no celular e no computador.

## 0. Como você (Claude Code) deve trabalhar comigo

- Leia este documento inteiro antes de agir. Ele é a fonte da verdade do projeto: quando algo mudar, atualize-o ou registre em `DECISIONS.md`.
- Converse e escreva a interface em **pt-BR**.
- **Não suponha.** Se algo estiver ambíguo, faltando ou em conflito, pergunte. Faça rodadas curtas, com no máximo 5 perguntas, sempre com opções e a sua recomendação.
- Trabalhe **por fases** (seção 9). Cada fase começa com um plano curto que eu aprovo. Termina com o que foi feito, como eu testo no iPad real (link de preview) e o que ficou pendente. Não comece a fase seguinte sem o meu ok.
- Não crie recursos na nuvem nem nada que possa gerar custo (projeto Supabase, plano Vercel, domínio, chave de API) sem me perguntar antes.
- Mantenha um `CLAUDE.md` com as convenções duráveis do projeto (idioma, comandos, estrutura de pastas, como rodar os testes). Mantenha também um `DECISIONS.md` com cada decisão e o motivo, em uma ou duas linhas.
- Se discordar de algo deste briefing, diga e argumente antes de fazer diferente.

## 1. Contexto

- Hoje registro hábitos e o meu dia no Notion, mas inserir coisas lá é lento. Quero algo direto ao ponto: abrir, tocar e pronto.
- O aparelho principal é um **iPad Pro 12.9"**, que vai ficar sempre aberto em casa como um painel. O mesmo app precisa funcionar bem no **celular** e no **computador (Windows)**.
- **Quem usa é a casa:** eu e outras pessoas (a quantidade e os nomes ainda vou confirmar).
  - **Mercado e pendências são compartilhados.**
  - **Hábitos e registro do dia são de cada pessoa.**
- **Começamos do zero:** nada será importado do Notion.
- **Voz é desejável, mas não obrigatória.** Entra depois que o app estiver funcionando:
  - Siri primeiro, porque é o caminho garantido.
  - Alexa como experimento, com um teste de viabilidade antes de investir.
  - Se a Alexa não der certo, o projeto segue sem ela.

## 2. Princípios de produto (use para desempatar decisões)

1. **Registrar leva no máximo 3 segundos:** até 2 toques ou uma frase.
2. **Tudo visível de relance, como um dashboard.** O essencial aparece sem navegar. Texto longo aparece cortado ou resumido, e o detalhe abre ao tocar.
3. **Toque grande e seguro.** Alvos de pelo menos 48 px no painel (o ideal é 56 px ou mais). Toda ação destrutiva tem desfazer, em vez de janela de confirmação.
4. **Tempo real:** o que alguém adiciona no celular aparece no iPad em até ~2 segundos.
5. **Zero atrito no iPad:** não pede login de novo, a tela não apaga sozinha e o app abre direto no painel.
6. **Tudo em pt-BR,** no fuso `America/Sao_Paulo`, com datas no formato brasileiro.
7. **Simples antes de esperto:** regras determinísticas primeiro, e IA só onde as regras não resolverem.

## 3. Módulos da v1

### 3.1 Hábitos (por pessoa)

Quatro tipos:

| Tipo | Exemplo | Como registra | Como conta a sequência |
|---|---|---|---|
| Feito / não feito | meditar | 1 toque | dias seguidos feitos |
| Com quantidade | 2 L de água | botões de incremento (ex.: +250 ml) ou valor digitado | dias seguidos em que bateu a meta |
| X vezes por semana | treino 3x/semana | 1 toque no dia em que fez | semanas seguidas que bateram a meta; dias livres não quebram |
| Evitar | sem doce | registra o deslize | dias desde o último deslize |

- **Campos:** nome, emoji, cor, tipo, meta (valor e unidade) ou vezes por semana, ordem e arquivado. Também **apelidos para voz** ("água", "beber água").
- **No painel:** o estado de hoje e a sequência atual. O estado de hoje depende do tipo: check, progresso, "2 de 3 na semana" ou dias sem.
- **No detalhe (ao tocar):** recorde, heatmap das últimas semanas e histórico editável.
- **Corrigir dias anteriores** tem que ser fácil (esqueci de marcar ontem).
- As regras de sequência precisam de testes unitários, incluindo a virada de semana e o fuso.

### 3.2 Mercado (compartilhado)

- **Adicionar rápido:** um campo que aceita vários itens de uma vez ("leite, pão, 2 dúzias de ovos"), com quantidade opcional.
- **Autocompletar** pelo histórico, com os **itens frequentes** em chips de um toque.
- **Seções do mercado:** hortifrúti, padaria, açougue, frios e laticínios, mercearia, bebidas, limpeza, higiene, pet e outros, em ordem configurável. A categorização é automática, por dicionário, e aprende quando alguém move um item de seção.
- **Sem duplicar:** se "leite" já está na lista, avisa ou soma a quantidade.
- **Modo mercado no celular:**
  - lista agrupada por seção;
  - riscar com um toque, e os comprados descem;
  - botão "limpar comprados" e desfazer.
- **Funciona com sinal ruim:** a lista abre offline, e as marcações entram numa fila que sincroniza quando a conexão volta.
- Registra quem adicionou cada item e quando.

### 3.3 Pendências (compartilhadas)

- Cada pendência tem título e, opcionalmente, responsável (uma pessoa ou "casa"), prazo e nota curta.
- Ordem: atrasadas, depois hoje, depois próximas, depois sem prazo. Concluir leva um toque e tem desfazer.
- Fora da v1: projetos, tags, subtarefas e recorrência.

### 3.4 Registro do dia (por pessoa)

- **Humor e energia:** escala de 1 a 5, um toque para cada.
- **Destaque** e **gratidão:** uma ou duas linhas cada.
- **Texto livre:** diário curto, com salvamento automático.
- **Números do dia:** campos que cada pessoa define, com nome e unidade (ex.: sono em horas, peso em kg).
- Dá para navegar entre os dias e editar dias anteriores.

### 3.5 Painel do iPad (tela principal)

- **Alvo:** iPad Pro 12.9", com o app instalado na Tela de Início (PWA em tela cheia). O viewport é **1366×1024** em paisagem e **1024×1366** em retrato, e as duas orientações precisam funcionar.
- **Tudo na tela ao mesmo tempo:**
  - os hábitos de hoje de cada pessoa, visíveis juntos e compactos;
  - o mercado;
  - as pendências;
  - o registro do dia de cada pessoa, em resumo.
- Quando algo não couber, use contadores como "+7 itens". O detalhe abre em painel lateral ou sheet ao tocar.
- **O layout vem antes do código de verdade (Fase 1):** 2 ou 3 propostas diferentes, com dados fictícios realistas, para eu abrir no iPad e escolher.
- **Tela sempre ligada:** use a Screen Wake Lock API e teste no iPad real, com o app instalado na Tela de Início. Se não segurar a tela, documente o plano B no README: Bloqueio Automático em "Nunca" e Acesso Guiado.
- **Modo descanso:** a tela escurece depois de X minutos sem toque e num horário noturno configurável. Um toque acorda.
- Tema claro e escuro.
- **Detalhes de iPad que não podem faltar:**
  - `touch-action: manipulation`, para o duplo toque não dar zoom;
  - nada de rolagem elástica atrapalhando;
  - respeitar as safe areas;
  - nada de seleção de texto acidental nos botões;
  - ícones e splash de PWA.

### 3.6 Celular e computador

- É o mesmo app, responsivo.
- **No celular:** abas (Hoje, Mercado, Pendências, Registro), com o campo de adicionar sempre à mão.
- **No computador:** um painel parecido com o do iPad, e o app pode ser instalado pelo Chrome ou pelo Edge.

## 4. Entrada universal — a peça central para a voz

A voz não fica acoplada ao app. Tudo entra por **uma porta só**, que qualquer canal pode chamar: a interface, a Siri, a Alexa, o Home Assistant ou um bot.

- **Endpoint:** `POST /api/capture`, autenticado por **token pessoal**. Há um token por pessoa ou dispositivo, gerado e revogado nas configurações e guardado com hash.
- **Entrada:** aceita texto livre, como `{ "text": "adiciona leite e pão no mercado" }`, ou um payload estruturado, como `{ "type": "grocery", "items": ["leite", "pão"] }`.
- **Resposta:** diz o que foi feito e traz **uma frase curta pronta para ser falada** ("Anotei leite e pão no mercado.").
- **Parser pt-BR em camadas:**
  1. Regras determinísticas: palavras-gatilho, apelidos de hábitos, dicionário de itens e datas relativas ("até sexta").
  2. Só se as regras não resolverem: fallback num LLM leve da Anthropic. Fica atrás de uma feature flag, desligado por padrão, e o ID do modelo atual deve ser confirmado na skill `claude-api`.
  3. Se ainda assim ficar ambíguo, o sistema pergunta em vez de chutar.
- O **mesmo parser** alimenta uma barra "anotar rápido" na interface.
- **Robustez:**
  - idempotência, porque o canal pode reenviar;
  - log de capturas com origem, texto original, interpretação e resultado;
  - rate limit simples.
- **Testes do parser:** uma tabela com pelo menos 40 frases reais em pt-BR, incluindo as ambíguas. Exemplos:
  - "leite, pão e 2 dúzias de ovos" / "adiciona sabão em pó na lista" / "comprar papel higiênico"
  - "pendência: pagar o IPTU até sexta" / "lembrar de ligar pro encanador"
  - "bebi 500 ml de água" / "treinei hoje" / "meditei" / "comi doce" (deslize num hábito a evitar)
  - "humor 4, energia 3" / "dormi 7 horas" / "destaque do dia: ..." / "diário: ..."

## 5. Voz (fase posterior; por enquanto só planeje)

### 5.1 Siri + Atalhos (caminho garantido)

Um guia passo a passo no README para criar o Atalho "Anotar no painel": Ditar texto → Obter conteúdo do URL (POST com o token) → Falar a resposta. Funciona no iPad e no iPhone.

### 5.2 Alexa: prova de viabilidade, com prazo de 1 dia, antes de qualquer investimento

**O que já foi verificado:**
- Desde julho de 2024, a Amazon não permite que apps leiam ou escrevam nas listas nativas da Alexa.
- O caminho oficial é uma **skill personalizada** em pt-BR, no estágio de desenvolvimento (só na minha conta), com frases como "Alexa, pede pro [nome] adicionar leite".
- Há relatos de 2026 de skills em desenvolvimento que não abrem em contas com Alexa+. Teste com a Alexa clássica e com a Alexa+.

**O mínimo do teste:**
- Um nome de invocação curto e fácil de falar.
- Intents para mercado, pendência, hábito e diário, todas repassando o texto para o mesmo parser da `/api/capture`.
- Para o texto livre, verifique se o slot `AMAZON.SearchQuery` existe em pt-BR. Se não existir, use um slot customizado.
- Endpoint HTTPS no próprio app, validando a assinatura e o timestamp das requisições da Alexa. Se for mais simples, use uma skill Alexa-hosted.
- Para os hábitos, teste também rotinas do app Alexa com frase própria ("Alexa, treinei") disparando a skill.

**Critério de sucesso:** 10 comandos seguidos na Echo real, com pelo menos 9 certos e resposta em menos de 3 segundos. Se falhar, registre o motivo em `DECISIONS.md` e siga sem a Alexa.

### 5.3 Outros canais possíveis no futuro (não construir agora)

Home Assistant (via `rest_command`) e bots de mensagem. A `/api/capture` precisa ser simples o bastante para ser chamada só com um JSON e um header.

## 6. Stack proposta (pode contestar)

- **Next.js (App Router), TypeScript estrito, Tailwind e shadcn/ui**, como **PWA** (manifest, ícones e service worker).
- **Supabase:** Postgres, Auth, Realtime e RLS isolando os dados por casa.
- **Vercel** para o deploy, com preview por branch para eu testar no iPad.

**Por quê:**
- um código só para iPad, celular e Windows;
- o Realtime resolve a lista compartilhada;
- as contas de Supabase e Vercel já estão conectadas; use os conectores quando fizer sentido, sempre pedindo aprovação;
- os planos gratuitos devem bastar (confirme os limites).

**Detalhes de implementação:**
- **Auth:** cada pessoa tem login próprio no celular. O iPad fica numa sessão persistente de "dispositivo da casa", que vê e edita os dados da casa sem pedir login de novo. Proponha o desenho e as regras de RLS antes de implementar.
- **Offline:** só o necessário. Cache de leitura e fila de mutações (IndexedDB) para o mercado e o check de hábitos.
- Validação com Zod nas bordas da API, migrations versionadas e seed com dados fictícios.

### Modelo de dados (rascunho para você validar)

- `households` (fuso, início da semana)
- `members` (casa, usuário, nome, cor, emoji)
- `habits` (membro, tipo, meta, unidade, vezes por semana, apelidos, ordem, arquivado)
- `habit_events` (hábito, data, valor, origem). O estado do dia vem da agregação desses eventos.
- `grocery_items` (casa, nome, nome normalizado, quantidade, seção, comprado em, comprado por, adicionado por, origem)
- `grocery_catalog` (casa, nome normalizado, seção aprendida, vezes comprado, último uso). Alimenta o autocompletar e os frequentes.
- `grocery_sections` (casa, nome, ordem)
- `tasks` (casa, título, responsável, prazo, nota, concluída em, concluída por, criada por, origem)
- `daily_entries` (membro, data, humor, energia, destaque, gratidão, texto). Uma linha por membro por dia.
- `metric_definitions` e `metric_values` (os números do dia)
- `capture_tokens` (membro, hash, rótulo, último uso, revogado em)
- `capture_log` (membro, origem, texto original, interpretação, resultado)

## 7. Fora do escopo da v1

- importar do Notion ou sincronizar com ele;
- calendário;
- notificações push e lembretes;
- gamificação;
- app nativo;
- várias casas;
- compartilhamento público;
- IA além do fallback do parser.

## 8. Qualidade

- **Testes obrigatórios:**
  - testes unitários do parser e das regras de sequência;
  - um smoke E2E com Playwright: adicionar um item, marcar um hábito e ver o outro dispositivo atualizar;
  - teste de RLS: alguém de outra casa não lê nada desta.
- **Segurança:** nenhuma chave secreta no cliente, tokens de captura guardados com hash e a chave do LLM só no servidor.
- **Toda fase fecha com:**
  - lint, typecheck e testes passando;
  - nenhum erro no console;
  - teste no Safari do iPad (com o app instalado na Tela de Início), no Safari ou Chrome do celular e no Chrome ou Edge do Windows.

## 9. Fases e critérios de pronto

| Fase | Entrega | Pronto quando |
|---|---|---|
| **0. Alinhamento** (sem código) | Perguntas da seção 10, arquitetura final, modelo de dados, estrutura de pastas, `CLAUDE.md` e `DECISIONS.md` | eu aprovar o plano |
| **1. Layout** | 2 ou 3 propostas do painel do iPad (paisagem e retrato) e a versão do celular, clicáveis, com dados fictícios, em preview na Vercel | eu escolher uma |
| **2. Base** | Auth, casa e membros; mercado e pendências com realtime; PWA instalável; wake lock | um item adicionado no celular aparece no iPad em até 2 s; 3 itens entram numa linha só; um item marcado offline sincroniza quando a conexão volta |
| **3. Hábitos e registro** | Os 4 tipos de hábito, o registro do dia completo, os resumos no painel e a edição de dias anteriores | as regras de sequência estão testadas; o painel mostra todo mundo sem rolar |
| **4. Entrada universal** | `/api/capture`, parser, tokens, log e a barra "anotar rápido" | pelo menos 40 frases de teste passando; toda captura devolve uma resposta falável |
| **5. Voz** | Guia do Atalho da Siri e prova de viabilidade da Alexa, com relatório de seguir ou parar | a Siri anota de verdade; a decisão sobre a Alexa está registrada |
| **6. Polimento** | Modo descanso, histórico e gráficos simples (humor em 30 dias, heatmap), acessibilidade e performance | eu usar uma semana sem voltar para o Notion |

## 10. Perguntas que você deve me fazer na Fase 0 (não suponha as respostas)

1. Quantas pessoas moram na casa? Qual o nome, a cor e o emoji de cada uma?
2. O iPad vai ficar em paisagem ou em retrato? A que distância a gente costuma olhar para ele?
3. O texto do diário de cada pessoa pode aparecer no iPad compartilhado, ou lá só aparecem humor e destaque?
4. Qual é a lista inicial de hábitos de cada pessoa (nome, tipo e meta)?
5. Quais "números do dia" cada pessoa quer registrar?
6. Quais seções do mercado vocês usam, e em que ordem (a do mercado que vocês frequentam)?
7. O celular de cada pessoa é iPhone ou Android? Isso define o caminho de voz no celular.
8. Qual vai ser o nome do app? E, se a Fase 5 seguir, qual vai ser o nome de invocação na Alexa?
9. A semana começa no domingo ou na segunda?

### Respostas (Fase 0, 25/09/2026)

1. **Casa:** Matheus e Karen. Os cachorros Anakin (branco) e Chihiro (preta) entram como responsáveis e assuntos de pendências e hábitos, sem registro do dia. Cores e emojis provisórios: Matheus azul 🦉, Karen verde 🌿, Anakin 🐕, Chihiro 🐾. Dá para trocar nas configurações.
2. **iPad:** em paisagem, olhado de 1 a 2 m. O retrato continua funcionando.
3. **Diário no iPad:** só humor e destaque. Texto livre e gratidão ficam privados de cada pessoa.
4. **Hábitos iniciais:** por enquanto, o exemplo fictício de `docs/ARQUITETURA.md`. Os reais entram na Fase 3.
5. **Números do dia:** nenhum por enquanto. O recurso continua no modelo.
6. **Seções do mercado:** hortifrúti, padaria, açougue, frios e laticínios, mercearia, bebidas, limpeza, higiene, **pet**, outros.
7. **Celulares:** os dois são iPhone. Siri + Atalhos cobre os dois.
8. **Nome:** Painel da Casa. A invocação da Alexa fica para antes da Fase 5.
9. **A semana começa na segunda.**
