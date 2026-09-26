// gerar-refresh-token.mjs — gera o GOOGLE_REFRESH_TOKEN e testa o acesso à conta.
// Rodar NO SEU TERMINAL (não pelo chat do Claude):   node scripts/gerar-refresh-token.mjs
//
// O que faz:
//  1. pede Client ID, Client Secret e Developer Token (digitados aqui, nunca salvos)
//  2. abre o navegador para você autorizar com a conta Google que acessa a MCC
//  3. testa o acesso à conta Google Ads e confere se as campanhas do painel existem
//  4. mostra o refresh token para você colar no GitHub → Settings → Secrets
//
// Nada é gravado em disco. Reutilizável para outros clientes: mude CUSTOMER/MCC ao rodar.

import http from "node:http";
import { exec } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const API_VER = "v25";
const SCOPE = "https://www.googleapis.com/auth/adwords";
const CAMPANHAS_ESPERADAS = [
  "00 - [PRINCIPAIS PRODUTOS] [ACRILICO E ACM]",
  "[C2] - [PMAX] - [GEO]",
];

const rl = createInterface({ input: stdin, output: stdout });
const ask = async (q, def = "") => ((await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim() || def);
const norm = s => String(s || "").toUpperCase().replace(/\s+/g, " ").trim();

console.log("\n=== Gerar refresh token do Google Ads ===\n");
const CLIENT_ID     = await ask("Client ID (termina em .apps.googleusercontent.com)");
const CLIENT_SECRET = await ask("Client Secret");
const DEV_TOKEN     = await ask("Developer Token (Central de API da MCC)");
const CUSTOMER      = (await ask("ID da conta do cliente", "224-153-2672")).replace(/-/g, "");
const MCC           = (await ask("ID da MCC", "914-731-2925")).replace(/-/g, "");
rl.close();
if (!CLIENT_ID || !CLIENT_SECRET || !DEV_TOKEN) { console.error("\nFaltou Client ID, Client Secret ou Developer Token."); process.exit(1); }

/* ── 1) login no navegador (fluxo loopback do OAuth para app Desktop) ── */
const code = await new Promise((resolve, reject) => {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const c = u.searchParams.get("code"), err = u.searchParams.get("error");
    if (!c && !err) { res.end(); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h2 style="font-family:sans-serif">${c ? "Pronto! Pode fechar esta aba e voltar ao terminal." : "Autorização recusada: " + err}</h2>`);
    srv.close();
    c ? resolve({ code: c, redirect: srv.redirect }) : reject(new Error("autorização recusada: " + err));
  });
  srv.listen(0, "127.0.0.1", () => {
    srv.redirect = `http://127.0.0.1:${srv.address().port}`;
    const auth = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: srv.redirect, response_type: "code",
      scope: SCOPE, access_type: "offline", prompt: "consent",
    });
    console.log("\nAbrindo o navegador. Entre com a conta Google que tem acesso à MCC e clique em Permitir.");
    console.log("Se não abrir sozinho, copie este link no navegador:\n\n" + auth + "\n");
    const cmd = process.platform === "win32" ? `start "" "${auth}"` : process.platform === "darwin" ? `open "${auth}"` : `xdg-open "${auth}"`;
    exec(cmd);
  });
});

const tok = await (await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ code: code.code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    redirect_uri: code.redirect, grant_type: "authorization_code" }),
})).json();
if (tok.error) { console.error("\nFALHA ao trocar o código:", tok.error_description || tok.error); process.exit(1); }
if (!tok.refresh_token) { console.error("\nO Google não devolveu refresh token. Remova o acesso do app em myaccount.google.com/permissions e rode de novo."); process.exit(1); }

/* ── 2) teste de acesso ── */
async function search(query, withMcc) {
  const headers = { Authorization: `Bearer ${tok.access_token}`, "developer-token": DEV_TOKEN, "Content-Type": "application/json" };
  if (withMcc && MCC) headers["login-customer-id"] = MCC;
  const r = await fetch(`https://googleads.googleapis.com/${API_VER}/customers/${CUSTOMER}/googleAds:search`,
    { method: "POST", headers, body: JSON.stringify({ query }) });
  const j = await r.json().catch(() => ({}));
  if (j.error) {
    const det = j.error.details?.[0]?.errors?.[0];
    throw new Error((det?.message || j.error.message) + (det?.errorCode ? " " + JSON.stringify(det.errorCode) : ""));
  }
  return j.results || [];
}

const Q = "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign WHERE campaign.status != 'REMOVED'";
let rows = null, via = null, erros = [];
for (const withMcc of [true, false]) {
  if (!withMcc && !MCC) continue;
  try { rows = await search(Q, withMcc); via = withMcc ? "MCC" : "direto"; break; }
  catch (e) { erros.push(`${withMcc ? "via MCC " + MCC : "acesso direto"}: ${e.message}`); }
}

console.log("\n==================== RESULTADO DO TESTE (pode colar isto no Claude) ====================");
console.log(`API ${API_VER} · conta ${CUSTOMER}`);
if (!rows) {
  console.log("✗ Não consegui ler a conta:");
  erros.forEach(e => console.log("   - " + e));
  console.log("\nCausas comuns: developer token só com 'Acesso de teste'; a conta Google usada no login");
  console.log("não tem acesso à MCC/conta; ou a Google Ads API não foi ativada no projeto do Google Cloud.");
} else {
  console.log(`✓ Acesso OK (${via === "MCC" ? "via MCC " + MCC + " — não precisa mudar nada" : "DIRETO, sem MCC — no GitHub crie a variável GOOGLE_LOGIN_CUSTOMER_ID com o valor none"})`);
  for (const nome of CAMPANHAS_ESPERADAS) {
    const hit = rows.find(r => norm(r.campaign.name) === norm(nome));
    console.log(hit ? `✓ achei "${nome}" → id ${hit.campaign.id}, ${hit.campaign.status}, ${hit.campaign.advertisingChannelType}`
                    : `✗ NÃO achei "${nome}"`);
  }
  console.log("\nCampanhas ativas na conta:");
  rows.filter(r => r.campaign.status === "ENABLED")
      .forEach(r => console.log(`   ${r.campaign.id}  ${r.campaign.advertisingChannelType.padEnd(16)} ${r.campaign.name}`));
}
console.log("========================================================================================");

/* ── 3) o token ── */
console.log("\n>>> NÃO cole o que está abaixo no chat. Cole só no GitHub (Settings → Secrets → Actions).");
console.log(">>> Nome do secret: GOOGLE_REFRESH_TOKEN\n");
console.log(tok.refresh_token);
console.log("");
