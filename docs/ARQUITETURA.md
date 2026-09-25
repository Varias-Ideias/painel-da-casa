# Arquitetura — Painel da Casa (proposta da Fase 0, aguardando aprovação)

## Visão geral

```
iPad (PWA, sessão de dispositivo) ─┐
iPhone Matheus / Karen (PWA) ──────┼─► Next.js (Vercel) ──► Supabase: Postgres + RLS + Realtime
Windows (Chrome/Edge, PWA) ────────┘        │
Siri / Atalhos / (Alexa) ──► POST /api/capture (token pessoal, hash) ──► parser pt-BR
```

- **Front:** Next.js App Router com TS estrito, Tailwind e shadcn/ui. PWA com manifest, ícones,
  splash e service worker.
- **Leitura ao vivo:** Supabase Realtime (`postgres_changes`) nas tabelas compartilhadas. A meta é
  ver a mudança no outro aparelho em até 2 s.
- **Offline (só o necessário):** cache de leitura do mercado e dos hábitos de hoje, mais uma fila de
  mutações em IndexedDB que é reenviada quando a conexão volta. As mutações são idempotentes, por
  `client_id` (UUID gerado no aparelho).

## Auth

- **Pessoas:** login próprio no celular com magic link por e-mail. Cada `auth.users` corresponde a
  um `members.user_id`.
- **iPad, o "dispositivo da casa":** um usuário Supabase dedicado, registrado em
  `household_devices`. A sessão é persistente (refresh token no armazenamento do PWA), então ele não
  pede login de novo. O pareamento é feito uma vez, com um código gerado no celular do dono.
- O dispositivo **lê e edita** os dados compartilhados (mercado, pendências, hábitos e
  `daily_entries` de todos) e **não enxerga** `daily_private`.

## RLS

```sql
-- verdadeiro se quem chama é pessoa ou dispositivo desta casa
create function is_household_member(hid uuid) returns boolean
  language sql security definer stable as $$
  select exists (select 1 from members where household_id = hid and user_id = auth.uid())
      or exists (select 1 from household_devices where household_id = hid and user_id = auth.uid()
                 and revoked_at is null)
$$;
```

- Tabelas compartilhadas (`grocery_*`, `tasks`, `habits`, `habit_events`, `daily_entries`,
  `metric_*`): `using (is_household_member(household_id))`.
- `daily_private`: só `member_id` cujo `user_id = auth.uid()`.
- `capture_tokens` e `capture_log`: o dono do token lê; a escrita acontece só no servidor (service
  role dentro da rota `/api/capture`, nunca no cliente).
- **Teste obrigatório:** um usuário de outra casa recebe 0 linhas em todas as tabelas.

## Modelo de dados

| tabela | campos principais | notas |
|---|---|---|
| `households` | nome, `tz = 'America/Sao_Paulo'`, `week_start = 1` | uma casa só na v1 |
| `members` | household, `kind` (`person`/`pet`), user_id?, nome, cor, emoji | pet não tem user_id |
| `household_devices` | household, user_id, rótulo, último acesso, revoked_at | o iPad |
| `habits` | member, tipo (`check`/`quantity`/`weekly`/`avoid`), meta, unidade, vezes_semana, apelidos[], ordem, arquivado | hábito de pet: qualquer pessoa marca |
| `habit_events` | habit, data (local), valor, origem, criado_por, client_id | o estado do dia vem da agregação |
| `grocery_sections` | household, nome, ordem | seed com 10 seções, incluindo pet |
| `grocery_items` | household, nome, nome_norm, qtd, seção, comprado_em/por, adicionado_por, origem, client_id | |
| `grocery_catalog` | household, nome_norm, seção aprendida, vezes, último uso | autocompletar e frequentes |
| `tasks` | household, título, responsável (member ou null = "casa"), prazo, nota, concluída_em/por, criada_por, origem | |
| `daily_entries` | member, data, humor, energia, destaque | a casa lê |
| `daily_private` | member, data, gratidão, texto | só o dono |
| `metric_definitions` / `metric_values` | member, nome, unidade / valor por dia | vazio na partida |
| `capture_tokens` | member, hash, rótulo, último uso, revogado_em | |
| `capture_log` | member, origem, texto, interpretação, resultado, idempotency_key | |

**Datas:** os dias são guardados como `date` no fuso da casa (não em UTC), para que "hoje" e a
virada de semana não dependam do aparelho. As regras de sequência são funções puras em
`src/lib/streaks/`, com testes de virada de semana e de fuso.

## Seed fictício (para os layouts da Fase 1)

- **Matheus** 🦉 azul: água 2 L (quantidade, +250 ml), treino 3x/semana, sem doce (evitar).
- **Karen** 🌿 verde: meditar (check), ler 20 min (check).
- **Anakin** 🐕 (pet): passear 1x/dia (check). **Chihiro** 🐾 (pet): remédio (check).
- **Mercado:** 12 itens em 6 seções, 3 já comprados.
- **Pendências:** 6, com 1 atrasada, 2 para hoje (incluindo "vacina da Chihiro"), 2 próximas e 1 sem
  prazo.
- **Registro:** humor, energia e destaque de hoje para os dois; um dia sem registro.

## Em aberto

- Onde o banco mora, dado o limite de 2 projetos no Supabase Free (ver `DECISIONS.md`). Decidir
  antes da Fase 2.
