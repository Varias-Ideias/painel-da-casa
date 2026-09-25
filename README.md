# Painel da Casa

Hábitos, lista de mercado, pendências e o registro do dia, num painel sempre aberto no iPad da
casa. O mesmo app funciona no celular (iPhone) e no computador. Quem usa é a casa: Matheus e Karen.
O Anakin e a Chihiro aparecem como assunto de pendências e de hábitos.

- **Fonte da verdade:** [`BRIEFING.md`](BRIEFING.md)
- **O que nunca se decide sozinho:** [`PARE.md`](PARE.md)
- **Decisões e motivos:** [`DECISIONS.md`](DECISIONS.md)
- **Arquitetura:** [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)
- **Trabalho:** [`backlog.json`](backlog.json)

## Estado

O app funciona **na rede de casa**, com o computador como servidor. Ainda não existe nada na nuvem
(ver `DECISIONS.md`, D12). O que já roda:

- **Painel** com 3 layouts à escolha (Ajustes ⚙ → Layout do painel): A · Colunas, B · Pessoas, C · Agora.
  Funciona em paisagem e em retrato.
- **Celular** com as abas Hoje, Mercado, Pendências e Registro.
- **Tempo real:** o que um aparelho anota aparece nos outros. No teste local levou 33 ms; no Wi-Fi
  ainda não foi medido.
- **Hábitos** dos 4 tipos, com sequência, recorde, mapa de 8 semanas e correção de dias anteriores.
- **Mercado** com várias coisas numa linha só, seções automáticas que aprendem, sem duplicar,
  frequentes em um toque e "limpar comprados".
- **Pendências** com responsável e prazo, na ordem atrasadas → hoje → próximas → sem prazo.
- **Registro do dia**: humor, energia e destaque, que a casa vê; gratidão e diário, que só a pessoa vê.
- **Anotar rápido**, com o parser pt-BR ("leite e pão", "treinei", "pendência: IPTU até sexta").
- **Desfazer** em toda ação, **fila offline** e **backup diário** automático.
- **Entrada universal** `POST /api/capture`, pronta para Siri, Alexa, Home Assistant e bots.

## Como rodar

Precisa do Node 20 ou mais novo. O app não tem nenhuma dependência além do núcleo da empresa.

```bash
npm start
```

Na primeira vez, o servidor cria:

- `dados/casa.json`, o estado da casa. Nasce com os hábitos combinados e alguns **exemplos** no
  mercado e nas pendências. Para apagar só os exemplos: Ajustes ⚙ → "Remover dados de exemplo",
  que tem desfazer.
- `dados/links.txt`, com um link secreto por aparelho: iPad da casa, Matheus e Karen.
- `dados/backup/`, com uma cópia por dia.

A pasta `dados/` fica **fora do git** de propósito: tem dado real e segredo.

**Backup fora deste disco:** em `dados/config.json`, `"backup_extra"` aponta para uma segunda pasta
(hoje `OneDrive\Documentos\painel-da-casa-backup`). O servidor copia para lá o backup de cada dia.
Esse backup é o estado completo da casa, **inclusive diário e gratidão**; os links secretos não vão
(só o hash). Para tirar essa cópia, apague a linha.

### Em outro computador

```bash
git clone https://github.com/Varias-Ideias/painel-da-casa.git
cd painel-da-casa
npm install
npm test
```

O `npm install` baixa o núcleo do GitHub privado `Varias-Ideias/plataforma`, então a máquina precisa
de acesso a ele (`gh auth login`). Os **dados da casa não vêm junto**: para mudar o servidor de
máquina, copie a pasta `dados/` inteira, ou só um backup renomeado para `dados/casa.json`, mais o
`links.txt`.

### Parear os aparelhos (uma vez)

1. Com o servidor rodando, abra **no computador**: `http://localhost:8765/parear`
2. Com o iPad e os celulares **no mesmo Wi-Fi**, aponte a câmera de cada um para o QR dele.
3. No iPad: Compartilhar → **Adicionar à Tela de Início**. Abra sempre pelo ícone.

A página `/parear` só abre no próprio computador. Sem internet para desenhar os QR codes, mande o
link de cada aparelho a partir do `dados/links.txt`.

**Primeira vez no Windows:** o Firewall do Windows costuma perguntar se o Node.js pode usar a rede.
Escolha **Redes privadas** e permita. Sem isso, o iPad e os celulares não enxergam o computador.

### Limites deste jeito de rodar (até decidir a nuvem)

- O **computador precisa ficar ligado** com `npm start` rodando. Se ele dormir, o painel continua
  mostrando o último estado e guarda as marcações numa fila, mas só sincroniza quando o
  computador voltar.
- **Fora de casa**, o celular não alcança o computador. As marcações ficam na fila e entram quando
  você voltar ao Wi-Fi. O computador já tem Tailscale: com Tailscale nos celulares, funciona de
  qualquer lugar pelo endereço `100.x` do `links.txt`.
- **Tela sempre acesa:** o navegador só libera isso em HTTPS, e em casa rodamos em `http`.
  Plano B no iPad: **Ajustes → Tela e Brilho → Bloqueio Automático → Nunca**. Para travar o iPad no
  app, use **Ajustes → Acessibilidade → Acesso Guiado**.
- **IP do computador:** se o roteador trocar o IP do computador (aconteceu em 25/09: `.9` virou `.10`),
  o iPad perde o servidor. Abra de novo o `/parear` (ele sempre usa o IP atual) e reinstale. Para não
  repetir, reserve o IP do computador no roteador (DHCP fixo).
- **Abrir sem rede:** com o app já aberto, tudo segue funcionando e as marcações vão para a fila.
  Recarregar a página sem rede não funciona no iPad por `http`, porque o service worker exige HTTPS.

## Siri: atalho "Anotar no painel"

No iPhone ou no iPad, app **Atalhos** → **+**. Os nomes das ações podem variar um pouco conforme a
versão do iOS.

1. **Ditar Texto**, em português (Brasil).
2. **Obter Conteúdo do URL**:
   - URL: `http://192.168.0.9:8765/api/capture` (o IP do computador; está no `links.txt`)
   - Método: **POST**
   - Cabeçalhos: `Authorization` = `Bearer ` + o código depois de `?t=` no **seu** link
   - Corpo da Solicitação: **JSON**, com o campo `text` = *Texto Ditado* e o campo `origem` = `siri`
3. **Obter Valor do Dicionário**: chave `fala`.
4. **Falar Texto**: o valor do passo 3.

Dê ao atalho o nome **Anotar no painel** e diga "E aí Siri, anotar no painel". Exemplos:

- "leite, pão e duas dúzias de ovos"
- "bebi 500 ml de água"
- "treinei"
- "pendência: pagar o IPTU até sexta"
- "humor 4, energia 3"
- "diário: …"

Se a frase ficar ambígua, a resposta falada pergunta ("Água: é para o mercado ou para o hábito?")
e nada é gravado.

Use o link **da pessoa**, não o do iPad da casa: o diário só aceita o aparelho da própria pessoa.

### A API (para qualquer canal)

```bash
curl -X POST http://192.168.0.9:8765/api/capture -H "Authorization: Bearer SEU_CODIGO" -H "Content-Type: application/json" -d "{\"text\":\"comprar café\",\"origem\":\"teste\"}"
```

Resposta: `{ "ok": true, "fala": "Anotei café no mercado.", "feito": true, "interpretacao": {…} }`.
Também aceita `{ "type": "grocery", "items": ["leite", "pão"] }`. O header `Idempotency-Key`
evita duplicar quando o canal reenvia. Há um limite de 30 capturas por minuto por aparelho.

## Testes

```bash
npm test
```

O comando roda os portões de contexto e os testes com o `node:test` do próprio Node: 102 testes,
entre unidade e integração. A integração sobe o servidor de verdade numa pasta temporária.
