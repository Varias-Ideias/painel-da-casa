# Painel da Casa

Hábitos, lista de mercado, pendências e registro do dia num painel sempre aberto no iPad da casa.
O mesmo app funciona no celular (iPhone) e no computador (Windows). Quem usa: Matheus e Karen; o
Anakin e a Chihiro aparecem como assunto.

- **Fonte da verdade:** [`BRIEFING.md`](BRIEFING.md)
- **O que nunca se decide sozinho:** [`PARE.md`](PARE.md)
- **Decisões e motivos:** [`DECISIONS.md`](DECISIONS.md) · **arquitetura:** [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)
- **Trabalho:** [`backlog.json`](backlog.json)

## Primeiro entregável

Duas ou três propostas clicáveis de layout do painel do iPad (paisagem e retrato) e a versão do
celular, com dados fictícios, para abrir no iPad real e escolher uma (Fase 1).

## Estado

Fase 0 (alinhamento) concluída, aguardando aprovação. Ainda não há app para rodar.

## Como rodar

```bash
npm install      # instala o núcleo @varias-ideias/plataforma
npm test         # por enquanto roda só os portões de contexto
```

Os comandos `dev`, `lint`, `typecheck` e os testes entram com o esqueleto Next.js (item B1).
