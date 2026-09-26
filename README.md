# Painel Geoplas · Meta + Google Ads

Dashboard estático de performance com **filtro de data livre**, que se atualiza sozinho de hora em hora.

```
index.html   →  lê  →  data.json  +  data-google.json   (GitHub Pages serve tudo)
                        ▲                 ▲
                        │ commit automático a cada hora
              .github/workflows/update-data.yml
                        │                 │
   scripts/fetch-meta.mjs → Meta API      scripts/fetch-google.mjs → Google Ads API
```

O HTML é 100% estático — nenhum servidor, nenhuma chave exposta no navegador. Quem chama a Meta e o Google é o **GitHub Actions**, usando credenciais guardadas como *secrets*.

---

## O que o painel mostra

| Campanha | Objetivo principal no painel | Métricas de apoio |
|---|---|---|
| **C1** · `CBO-Tráfego-A-VisitasAoPerfil-Filiais` | **Seguidores ganhos** e custo por seguidor | visitas ao perfil e custo por visita, cliques no link, % de visitas que viram seguidor |
| **C2** · `CBO-Reconhecimento-A-Visualização-Vídeo-Filiais` | **Pessoas que viram 50%+ do vídeo** e custo por visualização | ThruPlay e custo por ThruPlay, reproduções, % que chegou a 50 / 75 / 100% |
| **C3** · `CBO-Vendas-Quente-A-Depoimentos` | **Conversas iniciadas** e custo por conversa | conexões de mensagem, saudação vista, primeira resposta, responderam em 7 dias, trocaram 3+ e 5+ mensagens |

Em todas as abas, **CPM, CTR, CPC e frequência** ficam num painel discreto chamado *Diagnóstico de entrega* — servem para explicar o custo, não são a meta.

Cada campanha traz o **ranking de criativos**, ordenado do mais barato ao mais caro **no objetivo daquela campanha** (não no CTR), com selo `★ melhor` / `pior` e um comentário automático de realocação de verba. Criativos com menos de R$20 investidos no período recebem o selo `verba baixa` e ficam fora da comparação — pouco dado ainda não é sinal.

## Navegação e visual

Mesmo sistema de design do [painel Ricardo Mello](https://corvoassessoriatm.github.io/painel-ricardo-mello/): papel quente e ouro no claro, tinta no escuro, com **botão de tema** no topo (a escolha fica salva no navegador). Tipografia Fraunces nos títulos, Hanken Grotesk no texto e IBM Plex Mono nos números.

O painel tem **quatro abas**: *Visão geral* e uma por campanha. Cada aba de campanha traz o hero com o objetivo, oito KPIs, o **funil** daquela campanha (crescimento em C1, retenção de vídeo em C2, conversa em C3), a tendência diária e o ranking de criativos em tabela ou galeria. Os `?` ao lado dos rótulos explicam cada métrica em linguagem de cliente.

## Alcance: por que ele não aparece em intervalo personalizado

Alcance é **gente única**. Quem vê o anúncio em três dias é uma pessoa, não três — então o alcance de um período **não é a soma dos dias**. Somar inflava o número em até 90% na visão "Tudo".

Por isso o painel busca na Meta o alcance real de **cada atalho de período** (hoje, ontem, 7, 30, 90 dias, este mês, tudo), por conta e por campanha, e guarda em `data.json` → `reach.windows`. Quando você escolhe um atalho, o número exibido é o oficial da Meta.

Em **intervalo de datas personalizado** o alcance aparece como **—**, porque calcular gente única num intervalo arbitrário exige uma nova consulta à API. Inventar uma estimativa ali seria pior que não mostrar. Todo o resto — investimento, impressões, cliques, resultados e o ranking de criativos — continua funcionando normalmente em qualquer intervalo.

A frequência (impressões ÷ alcance) segue a mesma regra.

## Filtro de período

- **Atalhos:** hoje, ontem, 7, 30, 90 dias, este mês, tudo. Igual aos gerenciadores Meta e Google: **7, 30 e 90 dias terminam ontem** (o dia de hoje ainda está incompleto); Hoje, Este mês e Tudo vão até hoje. "Hoje" é a data em Brasília no momento da última coleta — `fetch-meta.mjs` (janelas do alcance) e `index.html` (`presetRange`) usam a mesma regra e precisam continuar iguais.
- **Data livre:** os dois campos de data no canto direito aceitam qualquer intervalo dentro do histórico disponível. Tudo na página (KPIs, gráfico, cards e ranking de criativos) é recalculado para o intervalo escolhido.

O recorte é feito no navegador a partir das linhas diárias por anúncio guardadas em `data.json` — por isso qualquer intervalo funciona, sem ida à API.

---

## Google Ads (aba "Google Ads")

| Campanha | Tipo | O que o painel mostra |
|---|---|---|
| **G1** · `00 - [PRINCIPAIS PRODUTOS] [ACRILICO E ACM]` | Pesquisa | conversões e custo por conversão · anúncios · **palavras-chave** · **termos de pesquisa** |
| **G2** · `[C2] - [PMAX] - [GEO]` | Performance Max | conversões e custo por conversão · **grupos de recursos** · termos de pesquisa do PMax |
| **G3, G4…** | qualquer tipo | todas as outras campanhas da conta que tiveram gasto desde `GOOGLE_SINCE` — pausadas e removidas incluídas — para o total bater com o "Total: conta" do gerenciador. Numeradas por ordem de ID (estável); só aparecem nas listas quando gastaram no período escolhido |

- **Filtro de campanha** no topo da aba (Todas · G1 · G2) recorta a página inteira. Clicar numa **palavra-chave** filtra os termos de pesquisa que ela acionou — o filtro vira um chip removível (mesmo padrão do painel Exponential).
- **O que está contando como conversão:** quebra das conversões por ação (WhatsApp, ligação, formulário…), para ninguém confundir "conversão" com venda.
- **Termos que gastam sem converter** (R$20+ no período, zero conversão) ganham selo — é a lista de candidatos a negativar.
- **PMax não tem anúncios nem palavras-chave fixas.** Por isso aparece por grupo de recursos. Os termos do PMax vêm de `campaign_search_term_view`; se a API não entregar esse relatório por dia, o script guarda o total do período e o painel avisa que esses termos não seguem o filtro de data.
- A **Visão geral** soma o investimento Meta + Google no destaque e lista G1/G2 em *Resultado por campanha* (clique leva para a aba Google). Alcance, CTR, CPC e o gráfico da visão geral seguem sendo só do Meta — o rótulo avisa.
- Se `data-google.json` não existir, o painel volta a ser só Meta, sem erro.
- Trocar/adicionar campanha: bloco `PLAN` no topo de `scripts/fetch-google.mjs`. As campanhas estão fixadas pelo **ID** (G1 `24279335437`, G2 `23296324040`) — renomear no Google Ads não quebra o painel.

### Ligar o Google Ads (~10 min)

**Nunca cole credenciais no chat nem em arquivo do repositório.** Tudo vai em *Settings → Secrets and variables → Actions*.

**Secrets** (aba *Secrets*):

| Nome | O que é |
|---|---|
| `GOOGLE_DEVELOPER_TOKEN` | token de desenvolvedor da MCC (Google Ads → Ferramentas → Central da API) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | cliente OAuth do Google Cloud (tipo *Desktop*) |
| `GOOGLE_REFRESH_TOKEN` | refresh token de um usuário com acesso à conta `224-153-2672` |

**Variables** (aba *Variables*, opcionais — não são segredo):

| Nome | Padrão | Quando mudar |
|---|---|---|
| `GOOGLE_CUSTOMER_ID` | `2241532672` | só se trocar de conta |
| `GOOGLE_LOGIN_CUSTOMER_ID` | `none` (acesso direto — a Geoplas não está vinculada à MCC 914-731-2925) | só se a conta passar a ser acessada por uma MCC: coloque o ID dela |
| `GOOGLE_SINCE` | `2026-01-01` | início do histórico puxado |

Antes disso, rode `node scripts/gerar-refresh-token.mjs` **no seu terminal** (não pelo chat): ele faz o login no Google, testa o acesso à conta e às campanhas do PLAN e mostra o refresh token para colar no GitHub. Nada é salvo em disco.

Depois: **Actions → Atualizar dados Geoplas (Meta + Google) → Run workflow** e confira o log do passo *Puxar Google Ads*. Ele lista G1/G2 com investimento e conversões; se algum nome do `PLAN` não bater, lista todas as campanhas da conta com ID para corrigir.

O passo do Google roda com `continue-on-error`: se ele falhar, o Meta continua sendo publicado normalmente e o passo aparece com ✕ no Actions.

---

## Passo a passo para ligar a atualização automática — Meta (~10 min)

### 1) Gerar o token da Meta (System User — não expira)

1. Acesse **[business.facebook.com](https://business.facebook.com)** → **Configurações do Negócio**.
2. **Usuários → Usuários do sistema** → *Adicionar* → crie um System User (função **Admin**).
3. Em **Ativos atribuídos**, adicione a conta de anúncios **`CA - Geoplas`** (ID `409508558303244`) com permissão total.
4. **Gerar novo token** → escolha o App → marque os escopos **`ads_read`** e **`read_insights`**.
5. Copie o token. *(System User token não expira — ideal para automação.)*

### 2) Guardar o token como secret do repositório

**Settings → Secrets and variables → Actions → New repository secret**

- **Name:** `META_TOKEN` · **Value:** _(cole o token)_
- *(Opcional)* `AD_ACCOUNT_ID` = `409508558303244` — já é o padrão no script.
- *(Opcional, em **Variables**)* `SINCE` = `2026-01-01` — data inicial do histórico puxado.

### 3) Ligar o GitHub Pages

**Settings → Pages → Source: _Deploy from a branch_ → Branch: `main` / `/ (root)` → Save.**
Em ~1 min o painel fica no ar em `https://<usuario>.github.io/<repo>/`.

> **Visibilidade:** o Pages só publica de repositório **público** no plano grátis (ou **privado** com GitHub Pro). Como o painel expõe métricas e verba do cliente, decida: manter privado (Pro) ou público com URL discreta.

### Rodar agora, sem esperar a hora cheia

**Actions → Atualizar dados Meta Ads → Run workflow.**

---

## Dados que já vêm no repositório

`data.json` foi semeado com o histórico real da conta, puxado da Meta e **conferido contra os agregados oficiais**: na janela de 29/05 a 26/08/2026 o investimento bate centavo a centavo nas três campanhas (R$2.703,87 · R$1.345,89 · R$2.232,76), assim como CPM, CTR, CPC, seguidores, ThruPlay e views de 50/75/100%.

- **1.632 linhas** diárias por anúncio · **16 anúncios** · **23/01/2026 → 27/08/2026**
- No seed, as métricas do funil de mensagens (C3) foram derivadas de `custo por ação` (`contagem = gasto ÷ custo`, que é exatamente como a Meta calcula). Na primeira execução do Actions elas passam a vir como contagem direta da API.
- As **capas dos criativos** já vêm no repositório (`thumbs/<ad_id>.jpg`), puxadas do frame de vídeo que a Meta expõe. São de **160 px** — o maior tamanho acessível sem token, porque as URLs do CDN são assinadas junto com o recorte. O `data.json` carrega a marca `thumbs_lowres: true`; na primeira execução do Actions o script ignora as capas existentes e baixa tudo de novo em 400 px, limpando a marca.
- Alguns vídeos começam num quadro escuro, então três capas saem quase pretas (AD07-Abastecimento-Industrial, AD03-WagnerBoaz, AD01-Cliente-Boaz). É o frame real que a Meta devolve; a rodada com token pode trazer o quadro preferido, que costuma ser melhor.

## Ajustes rápidos

- **Frequência de atualização:** `cron` em `.github/workflows/update-data.yml` (`0 * * * *` = de hora em hora; `0 */6 * * *` = a cada 6h).
- **Trocar / adicionar campanha monitorada:** bloco `PLAN` no topo de `scripts/fetch-meta.mjs` — é o único lugar que conhece a estratégia (qual campanha é C1/C2/C3 e qual é a métrica principal de cada uma).
- **Visual e textos:** tudo em `index.html`.

## Rodar local

`index.html` busca `data.json` via `fetch`, e o navegador bloqueia isso em `file://`. Use um servidor:

```bash
npx serve .
```

---

**Corvo Assessoria de Tráfego e Marketing** · conta `409508558303244`
