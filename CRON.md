# Cron de índices — por que está assim

`vercel.json` não aceita comentário, então as decisões ficam aqui.

## Uma entrada, não duas

O handler decide o modo pelo dia do mês: **carga completa** nos dias 1 e 2,
**incremental** no resto. Isso evita uma segunda entrada no `vercel.json` com
query string no campo `path`, que não está confirmada como suportada.

- **incremental** — janela derivada da última competência no banco, com 3 meses
  de sobreposição. Medido: 150–196 bytes e ~18 linhas de upsert por execução.
- **completa** — desde o início de cada série. Captura revisão de valor antigo,
  que a sobreposição não alcança. Medido: 95 KB e ~3,4 s.

Dois dias de carga completa em vez de um porque a entrega da Vercel é
best-effort e ela **não retenta** — se o dia 1 for perdido, o dia 2 pega. O
upsert é idempotente por `(serie, competencia)`, então rodar duas vezes é
inócuo.

## `0 15 * * *` — e nunca entre 0 e 2 UTC

**O horário não é estético.** `primeiroDiaMesCorrente` em `lib/indices/sync.ts`
usa `getUTCMonth`. Às 21:30 BRT do último dia do mês — que é 00:30 UTC do dia
1 — o corte de "mês fechado" **já virou o mês**, e a Selic parcial (medido:
out/2026 = 0,56 contra set/2026 = 1,08) entraria no banco como definitiva. É
exatamente o que o filtro de mês aberto existe pra evitar.

No plano Hobby a precisão é **por hora**, com jitter de até 59 min — então
`0 2 * * *` também cai nessa faixa. 15:00 UTC = 12:00 BRT: fora da faixa, e em
horário comercial no Brasil, então se falhar tem gente por perto.

## Diário, e por que não mensal

1. No Hobby, **diário é o piso permitido** — qualquer coisa mais frequente faz
   o deploy FALHAR com "Hobby accounts are limited to daily cron jobs".
2. Diário dispensa acertar o dia de divulgação de cada fonte (o IBGE publica o
   IPCA entre os dias 9 e 12; o IPCA-15 do mês M sai nos dias 23–26 do próprio M).
3. A entrega é best-effort. Com janela estreita de dias, um deslize de
   calendário somado a uma execução perdida vira um mês de atraso — e
   `LIMITE_ATRASO_MESES = 2` dá só ~60 dias de folga antes de a precificação
   travar.

Uma execução que não tem nada a fazer custa ~1 s e ~600 bytes.

## Env vars no ambiente Production

- `CRON_SECRET` — **o nome é funcional**, não escolha nossa: a Vercel só manda
  o header `Authorization: Bearer <valor>` se a variável tiver exatamente esse
  nome. Com outro nome, nenhum header é enviado e o handler devolve 401 pra
  sempre. Gerar com `openssl rand -hex 32`.
- `SUPABASE_SERVICE_ROLE_KEY` — a escrita é do sistema, não de uma pessoa.

## A prova de que funciona não é build verde

```bash
curl -i https://<producao>/api/cron/indices
```

Tem que devolver **401 com corpo `{"erro":"nao_autorizado"}`**.

- Se vier **307**, o `proxy.ts` ainda está na frente — `/api/cron` saiu de
  `PUBLIC_ROUTES`. O cron da Vercel não segue redirect e não loga resposta
  redirecionada, então o job rodaria todo dia sem fazer nada e sem rastro.
  Coberto por `proxy.test.ts`.
- Se vier 401 com **corpo HTML ou página de SSO**, é Deployment Protection da
  Vercel, não o nosso gate.

Depois, com o segredo correto, tem que devolver 200 e o `coletado_em` das 6
séries tem que avançar em `/admin/indices`.

---

# Cron das regras automáticas — `/api/cron/regras`

Roda as regras (a) **follow-up** e (b) **lead parado** (`lib/regras`). Cada uma
só **cria tarefa para uma pessoa**; nenhuma manda mensagem pro cliente. As
chaves liga/desliga ficam em `/admin/regras` e nascem desligadas (migration 048).
A regra (c) **processo andou** não roda aqui: fica dentro do
`djen-acompanhamento`, que é quem sabe o que é publicação nova.

## Por que um cron separado

O `djen-acompanhamento` gasta até ~250 dos 270 s de prazo com o DJEN (20
consultas por minuto, ~75 processos) e devolve 500 quando falha inteiro. Um
erro de CRM lá dentro ficaria misturado ao do Diário no log, e um DJEN lento
deixaria as regras sem tempo. Separado, cada um falha sozinho, tem o próprio
log na Vercel e pode ser chamado à mão. Este custa ~1 s: cinco consultas em
lote e uma RPC por tarefa criada (`maxDuration = 60` sobra).

## `0 12 * * *` — 9h a 10h em Maceió

- Roda **depois** do DJEN (`0 11 * * *`), e as tarefas já estão lá quando o
  expediente começa.
- Fora da faixa 0–2 UTC, onde o dia em UTC e o dia em São Paulo divergem. O
  prazo da tarefa usa `hojeEmSaoPaulo`, mas não custa ficar longe da virada.

## Plano Hobby

Doc da Vercel (cron-jobs/usage-and-pricing, atualizada em 15/07/2026): até
**100 crons por projeto**, no máximo **uma vez por dia**, precisão **por hora**
(±59 min). Expressão mais frequente faz o deploy falhar. Com este, são 3.

## Execução perdida ou em dobro

- A Vercel **não repete** execução perdida. Os limites usam `>=` (2 dias, 7
  dias), então um dia perdido só atrasa a tarefa em um dia; ela não some.
- A Vercel também pode rodar duas vezes. Não duplica nada: toda tarefa passa
  por `criar_tarefa_de_regra`, que grava o disparo em `regras_disparos` com
  chave única `(regra, chave_ciclo)` na mesma transação da tarefa.

## Ordem de deploy

**Aplicar a 048 antes do deploy.** O código novo lê `status_desde`,
`motivo_perda_codigo`, `modelos_mensagem.uso` e as tabelas `regras_*`. A
leitura das regras falha fechada (sem a tabela, tudo conta como desligado e o
DJEN segue igual), mas o CRM passa a pedir a coluna `uso` dos modelos.

## A prova de que está ligado

```bash
curl -i https://<producao>/api/cron/regras
```

Tem que devolver **401** com `{"erro":"nao_autorizado"}` (307 = proxy na
frente; HTML = Deployment Protection, ver acima). Com `x-cron-secret`, devolve
200 e o resumo: `regrasLigadas`, `leadsAnalisados`, `tarefasCriadas`,
`jaExistiam`, `falhas`. Com tudo desligado, `regrasLigadas: []` e nenhuma
consulta além da config.
