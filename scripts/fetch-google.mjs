// fetch-google.mjs — puxa a Google Ads API e reescreve ../data-google.json
// Rodado pelo GitHub Actions. Node 20+ (fetch global).
// Env obrigatórias (secrets): GOOGLE_REFRESH_TOKEN, GOOGLE_CLIENT_ID,
//                             GOOGLE_CLIENT_SECRET, GOOGLE_DEVELOPER_TOKEN
// Env opcionais: GOOGLE_CUSTOMER_ID, GOOGLE_LOGIN_CUSTOMER_ID, GOOGLE_SINCE, GOOGLE_API_VER

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// secrets colados no GitHub costumam trazer espaço/quebra de linha invisível
// no fim — o Google recusa ("OAuth client was not found"). Limpa antes de usar.
const env = k => (process.env[k] || "").trim();

const REFRESH  = env("GOOGLE_REFRESH_TOKEN");
const CLIENT   = env("GOOGLE_CLIENT_ID");
const SECRET   = env("GOOGLE_CLIENT_SECRET");
const DEV_TOK  = env("GOOGLE_DEVELOPER_TOKEN");
const CUSTOMER = (process.env.GOOGLE_CUSTOMER_ID || "2241532672").replace(/-/g, "");
// MCC pela qual o usuário do token enxerga a conta. "none" = acesso direto, sem MCC.
// Geoplas: a conta NÃO está vinculada à MCC 914-731-2925 — o usuário do token
// acessa a conta diretamente, então o padrão aqui é "none".
const MCC_RAW  = process.env.GOOGLE_LOGIN_CUSTOMER_ID || "none";
const MCC      = /^(none|direto)$/i.test(MCC_RAW.trim()) ? "" : MCC_RAW.replace(/-/g, "");
const SINCE    = process.env.GOOGLE_SINCE || "2026-01-01";
const API_VER  = process.env.GOOGLE_API_VER || "v25";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT  = join(ROOT, "data-google.json");

/* ── campanhas monitoradas ───────────────────────────────────────────────
   Para trocar/adicionar campanha: edite este bloco. Com `id` preenchido o
   vínculo é pelo ID da campanha — o nome pode mudar à vontade no Google.
   `match` (nome) é só referência legível, usado apenas quando `id` é null
   (maiúsculas, acentos, travessões e espaços extras são ignorados).       */
const PLAN = [
  { match: "00 - [PRINCIPAIS PRODUTOS] [ACRILICO E ACM]", id: "24279335437",
    key: "G1", tag: "G1",
    label: "Pesquisa · Acrílico e ACM",
    goal: "Capturar quem já está buscando acrílico e ACM no Google e transformar a busca em contato." },
  { match: "[C2] - [PMAX] - [GEO]", id: "23296324040",
    key: "G2", tag: "G2",
    label: "Performance Max · Geoplas",
    goal: "Buscar conversões em todas as redes do Google — Pesquisa, YouTube, Display, Gmail e Maps — com a mesma verba." },
];

/* ── API ─────────────────────────────────────────────────────────────── */
async function getAccessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", client_id: CLIENT,
      client_secret: SECRET, refresh_token: REFRESH,
    }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`OAuth: ${j.error_description || j.error}`);
  return j.access_token;
}

let TOKEN = null;
/* googleAds:search pagina de 10.000 em 10.000 via nextPageToken.
   (pageSize não é mais aceito nas versões atuais da API.)
   Devolve as linhas no formato aninhado da API: r.campaign.id, r.metrics.clicks… */
async function gaql(query) {
  const url = `https://googleads.googleapis.com/${API_VER}/customers/${CUSTOMER}/googleAds:search`;
  const headers = {
    "Authorization": `Bearer ${TOKEN}`,
    "developer-token": DEV_TOK,
    "Content-Type": "application/json",
  };
  if (MCC) headers["login-customer-id"] = MCC;
  let out = [], pageToken = null, guard = 0;
  do {
    const body = { query: query.replace(/\s+/g, " ").trim() };
    if (pageToken) body.pageToken = pageToken;
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const txt = await r.text();
    let j;
    try { j = JSON.parse(txt); } catch { throw new Error(`HTTP ${r.status}: ${txt.slice(0, 300)}`); }
    if (j.error) {
      const det = j.error.details?.[0]?.errors?.[0];
      throw new Error(`GAQL: ${det?.message || j.error.message}${det?.errorCode ? " " + JSON.stringify(det.errorCode) : ""}`);
    }
    out = out.concat(j.results || []);
    pageToken = j.nextPageToken || null;
  } while (pageToken && guard++ < 100);
  return out;
}

/* relatório secundário: se falhar, registra o aviso e segue sem ele */
const WARN = [];
async function optional(nome, fn, vazio = []) {
  try { return await fn(); }
  catch (e) { WARN.push(`${nome}: ${e.message}`); console.warn(`    aviso: ${nome} falhou — ${e.message}`); return vazio; }
}

/* ── helpers ─────────────────────────────────────────────────────────── */
// 4 casas: arredondar cada dia a centavos e depois somar desviava ~R$0,03 em
// 30 dias do total do gerenciador (que soma os micros antes de arredondar)
const money = micros => +(Number(micros || 0) / 1e6).toFixed(4);
const int   = v => Number(v || 0);
const dec   = v => +Number(v || 0).toFixed(2);   // conversões podem ser fracionadas (atribuição por dados)
const norm  = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // sem acento
  .replace(/[\u2010-\u2015\u2212]/g, "-")                                        // travessões viram hífen
  .replace(/\s+/g, " ").replace(/\s*([\[\]\-])\s*/g, "$1").toUpperCase().trim(); // espaço em volta de [ ] - não conta
const met   = m => ({ s: money(m?.costMicros), i: int(m?.impressions), ck: int(m?.clicks), cv: dec(m?.conversions), vl: dec(m?.conversionsValue) });
/* termo de pesquisa só entra se teve clique, custo ou conversão. Termos que só
   apareceram na tela eram ~90% das linhas (3,6 MB no PMax da Geoplas) sem
   nenhum gasto — não servem para negativar e deixavam o painel lento. */
const TERMO_UTIL = r => r.ck || r.cv || r.s;
/* grava só o que não é zero — deixa o JSON enxuto */
const lean  = o => { for (const k of Object.keys(o)) if (o[k] === 0 || o[k] == null) delete o[k]; return o; };

/* ── main ────────────────────────────────────────────────────────────── */
async function main() {
  if (!REFRESH || !CLIENT || !SECRET || !DEV_TOK) {
    throw new Error("defina os secrets GOOGLE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_DEVELOPER_TOKEN");
  }
  // confere o FORMATO de cada secret (sem imprimir o valor) — pega secret trocado de campo
  const forma = [
    ["GOOGLE_CLIENT_ID", CLIENT.endsWith(".apps.googleusercontent.com"), "deveria terminar em .apps.googleusercontent.com"],
    ["GOOGLE_CLIENT_SECRET", !SECRET.includes(".apps.googleusercontent.com"), "parece ser o Client ID, não a chave secreta"],
    ["GOOGLE_REFRESH_TOKEN", REFRESH.startsWith("1//"), "deveria começar com 1//"],
  ].filter(([, ok]) => !ok);
  if (forma.length) throw new Error("secret com formato estranho: " + forma.map(([k, , why]) => `${k} (${why})`).join("; "));
  TOKEN = await getAccessToken();
  const until = new Date().toISOString().slice(0, 10);
  const RANGE = `segments.date BETWEEN '${SINCE}' AND '${until}'`;

  // 1) resolve as campanhas do PLAN (por id fixado ou pelo nome)
  const allCamps = await gaql(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
           campaign_budget.amount_micros
    FROM campaign WHERE campaign.status != 'REMOVED'`);
  const resolved = PLAN.map(p => {
    const hit = allCamps.find(r => p.id ? String(r.campaign.id) === String(p.id) : norm(r.campaign.name) === norm(p.match));
    return { p, r: hit };
  });
  const faltando = resolved.filter(x => !x.r);
  if (faltando.length) {
    console.error("Campanhas do PLAN não encontradas: " + faltando.map(x => x.p.match).join(" | "));
    console.error("Campanhas existentes na conta:");
    for (const r of allCamps) console.error(`    ${r.campaign.id}  ${r.campaign.status.padEnd(8)} ${r.campaign.advertisingChannelType.padEnd(16)} ${r.campaign.name}`);
    if (faltando.length === PLAN.length) throw new Error("nenhuma campanha do PLAN encontrada — confira os nomes no bloco PLAN");
  }
  const ok = resolved.filter(x => x.r);
  const IDS = ok.map(x => String(x.r.campaign.id));
  const IN  = `campaign.id IN (${IDS.join(",")})`;

  const campaigns = ok.map(({ p, r }) => ({
    id: String(r.campaign.id), key: p.key, tag: p.tag,
    name: r.campaign.name, label: p.label, goal: p.goal,
    type: r.campaign.advertisingChannelType,          // SEARCH | PERFORMANCE_MAX
    status: r.campaign.status,                          // ENABLED | PAUSED
    daily_budget: r.campaignBudget?.amountMicros ? money(r.campaignBudget.amountMicros) : null,
  }));
  const isType = t => campaigns.filter(c => c.type === t).map(c => c.id);
  const SEARCH = isType("SEARCH"), PMAX = isType("PERFORMANCE_MAX");

  // 2) diário por campanha — base de KPIs, tendência e filtro de data
  const dRows = await gaql(`
    SELECT segments.date, campaign.id, metrics.cost_micros, metrics.impressions,
           metrics.clicks, metrics.conversions, metrics.conversions_value
    FROM campaign WHERE ${IN} AND ${RANGE}`);
  const daily = dRows
    .map(r => lean({ d: r.segments.date, c: String(r.campaign.id), ...met(r.metrics) }))
    .filter(r => r.i || r.s)
    .sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
  if (!daily.length) throw new Error("nenhuma linha com dados — confira GOOGLE_CUSTOMER_ID, a MCC e o período");

  // 3) o que é uma "conversão" — quebra por ação de conversão
  const conv_actions = await optional("conversões por ação", async () => (await gaql(`
      SELECT segments.date, campaign.id, segments.conversion_action_name, metrics.conversions
      FROM campaign WHERE ${IN} AND ${RANGE} AND metrics.conversions > 0`))
    .map(r => ({ d: r.segments.date, c: String(r.campaign.id), n: r.segments.conversionActionName, cv: dec(r.metrics.conversions) })));

  // 4) Search — anúncios, palavras-chave e termos de pesquisa
  let ads = [], ad_daily = [], keywords = [], kw_daily = [], search_terms = [];
  if (SEARCH.length) {
    const INS = `campaign.id IN (${SEARCH.join(",")})`;
    const adRows = await optional("anúncios", () => gaql(`
      SELECT segments.date, campaign.id, ad_group.id, ad_group.name, ad_group_ad.ad.id,
             ad_group_ad.status, ad_group_ad.ad.type, ad_group_ad.ad.responsive_search_ad.headlines,
             metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
      FROM ad_group_ad WHERE ${INS} AND ${RANGE}`));
    const adMeta = {};
    for (const r of adRows) {
      const id = String(r.adGroupAd.ad.id);
      const hl = r.adGroupAd.ad.responsiveSearchAd?.headlines || [];
      adMeta[id] ||= { id, c: String(r.campaign.id), ag: String(r.adGroup.id), agn: r.adGroup.name,
        title: hl.slice(0, 3).map(h => h.text).join(" | ") || `Anúncio ${id.slice(-5)}`,
        status: r.adGroupAd.status };
      const row = lean({ d: r.segments.date, a: id, c: String(r.campaign.id), ...met(r.metrics) });
      if (row.i || row.s) ad_daily.push(row);
    }
    ads = Object.values(adMeta).filter(a => ad_daily.some(r => r.a === a.id));

    const kwRows = await optional("palavras-chave", () => gaql(`
      SELECT segments.date, campaign.id, ad_group.id, ad_group.name, ad_group_criterion.criterion_id,
             ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status,
             metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
      FROM keyword_view WHERE ${INS} AND ${RANGE}`));
    const kwMeta = {};
    for (const r of kwRows) {
      const k = `${r.adGroup.id}~${r.adGroupCriterion.criterionId}`;
      kwMeta[k] ||= { id: k, c: String(r.campaign.id), agn: r.adGroup.name,
        kw: r.adGroupCriterion.keyword.text, mt: r.adGroupCriterion.keyword.matchType, status: r.adGroupCriterion.status };
      const row = lean({ d: r.segments.date, k, c: String(r.campaign.id), ...met(r.metrics) });
      if (row.i || row.s) kw_daily.push(row);
    }
    keywords = Object.values(kwMeta).filter(k => kw_daily.some(r => r.k === k.id));

    search_terms = await optional("termos de pesquisa (Search)", async () => (await gaql(`
        SELECT segments.date, campaign.id, search_term_view.search_term, search_term_view.status,
               segments.keyword.info.text,
               metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
        FROM search_term_view WHERE ${INS} AND ${RANGE}`))
      .map(r => lean({ d: r.segments.date, c: String(r.campaign.id), t: r.searchTermView.searchTerm,
        kw: r.segments.keyword?.info?.text, st: r.searchTermView.status === "NONE" ? null : r.searchTermView.status,
        ...met(r.metrics) }))
      .filter(TERMO_UTIL));
  }

  // 5) PMax — grupos de recursos e termos de pesquisa
  //    PMax não tem ad_group / ad_group_ad: a unidade é o asset_group.
  let asset_groups = [], ag_daily = [], pmax_terms_daily = true;
  if (PMAX.length) {
    const INP = `campaign.id IN (${PMAX.join(",")})`;
    const agRows = await optional("grupos de recursos (PMax)", () => gaql(`
      SELECT segments.date, campaign.id, asset_group.id, asset_group.name, asset_group.status,
             metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
      FROM asset_group WHERE ${INP} AND ${RANGE}`));
    const agMeta = {};
    for (const r of agRows) {
      const id = String(r.assetGroup.id);
      agMeta[id] ||= { id, c: String(r.campaign.id), name: r.assetGroup.name, status: r.assetGroup.status };
      const row = lean({ d: r.segments.date, g: id, c: String(r.campaign.id), ...met(r.metrics) });
      if (row.i || row.s) ag_daily.push(row);
    }
    asset_groups = Object.values(agMeta).filter(g => ag_daily.some(r => r.g === g.id));

    // Termos do PMax: tenta por dia (permite filtro de data). Se a API recusar
    // a segmentação diária, cai para o total do período e o painel avisa.
    const Q = (withDate) => `
      SELECT ${withDate ? "segments.date, " : ""}campaign.id, campaign_search_term_view.search_term,
             metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
      FROM campaign_search_term_view WHERE ${INP} AND ${RANGE}`;
    const mapT = r => lean({ d: r.segments?.date || null, c: String(r.campaign.id),
      t: r.campaignSearchTermView.searchTerm, ...met(r.metrics) });
    let pt = null;
    try { pt = (await gaql(Q(true))).map(mapT); }
    catch (e) {
      console.warn(`    aviso: termos PMax sem segmentação diária (${e.message}) — tentando total do período`);
      pmax_terms_daily = false;
      pt = await optional("termos de pesquisa (PMax)", async () => (await gaql(Q(false))).map(mapT));
    }
    search_terms = search_terms.concat(pt.filter(TERMO_UTIL));
  }

  const dates = daily.map(r => r.d);
  const data = {
    meta: {
      source: "google",
      account_id: CUSTOMER,
      account_label: CUSTOMER.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"),
      client: "Geoplas",
      currency: "BRL",
      tz: "America/Sao_Paulo",
      api_version: API_VER,
      updated_at: new Date().toISOString(),
      since: SINCE,
      first_date: dates[0],
      last_date: dates[dates.length - 1],
      pmax_terms_daily,
      warnings: WARN,
    },
    campaigns, daily, conv_actions,
    ads, ad_daily, keywords, kw_daily,
    asset_groups, ag_daily, search_terms,
  };
  writeFileSync(OUT, JSON.stringify(data) + "\n");

  console.log(`OK  Google Ads ${data.meta.account_label}  ${data.meta.first_date} → ${data.meta.last_date}  (API ${API_VER})`);
  for (const c of campaigns) {
    const rs = daily.filter(r => r.c === c.id);
    const s = rs.reduce((a, r) => a + (r.s || 0), 0), cv = rs.reduce((a, r) => a + (r.cv || 0), 0);
    console.log(`    ${c.tag} ${c.id} ${c.type.padEnd(16)} R$${s.toFixed(2).padStart(9)}  conversões: ${cv.toFixed(1)}  ${c.name}`);
  }
  console.log(`    anúncios=${ads.length}  palavras-chave=${keywords.length}  grupos PMax=${asset_groups.length}  linhas de termos=${search_terms.length}`);
  if (WARN.length) console.warn(`AVISO: ${WARN.length} relatório(s) secundário(s) falharam — o painel mostra o resto normalmente.`);
}

main().catch(e => { console.error("FALHA:", e.message); process.exit(1); });
