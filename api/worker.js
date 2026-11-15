/* =====================================================================
   API de pagamentos (Cloudflare Worker)

   Rotas
   POST /mp/iniciar        painel → link para o dono conectar a conta Mercado Pago
   GET  /mp/retorno        Mercado Pago → volta do login (OAuth)
   POST /mp/desconectar    painel → remove a conexão
   POST /pix               terminal → cria o Pix do pedido e devolve o QR
   POST /pix/verificar     terminal → confere no Mercado Pago se já foi pago
   POST /mp/aviso          Mercado Pago → aviso de pagamento (webhook)
   GET  /                  saúde

   Variáveis (Settings → Variables)
   FIREBASE_PROJECT  pdvmovel-95afb
   FIREBASE_DB       https://pdvmovel-95afb-default-rtdb.firebaseio.com
   MP_CLIENT_ID      Client ID da aplicação no Mercado Pago
   PAINEL_URL        https://adael-oliveira.github.io/pdvmovel/cliente/
   ADMIN_EMAIL       e-mail do administrador da plataforma

   Segredos (Settings → Variables → Secret)
   MP_CLIENT_SECRET  Client Secret da aplicação no Mercado Pago
   FIREBASE_SA       conteúdo do arquivo .json da conta de serviço do Firebase
   MP_WEBHOOK_SECRET (opcional) assinatura secreta dos avisos do Mercado Pago

   KV (Settings → Bindings): nome KV
   ===================================================================== */

const PIX_MINUTOS = 10;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    try {
      const r = await rotear(req, env, url, ctx);
      return cors(r);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e.stack || e);
      const msg = status >= 500 && !e.publico ? "Erro no servidor de pagamentos. Tente de novo." : (e.message || "Erro");
      return cors(json({ erro: msg }, status));
    }
  },
};

async function rotear(req, env, url, ctx) {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const M = req.method;
  if (M === "GET" && p === "/") return json({ ok: true, servico: "api-pagamentos" });
  if (M === "POST" && p === "/mp/iniciar") return mpIniciar(req, env, url);
  if (M === "GET" && p === "/mp/retorno") return mpRetorno(req, env, url);
  if (M === "POST" && p === "/mp/desconectar") return mpDesconectar(req, env);
  if (M === "POST" && p === "/pix") return pixCriar(req, env, url);
  if (M === "POST" && p === "/pix/verificar") return pixVerificar(req, env);
  if (M === "POST" && p === "/mp/aviso") return mpAviso(req, env, url, ctx);
  throw erro(404, "Rota não encontrada");
}

/* ---------------- utilidades ---------------- */
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8" } });
function cors(r) {
  const h = new Headers(r.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-headers", "authorization, content-type");
  h.set("access-control-allow-methods", "GET, POST, OPTIONS");
  return new Response(r.body, { status: r.status, headers: h });
}
const erro = (status, message) => Object.assign(new Error(message), { status, publico: true });
const emailKey = e => String(e || "").toLowerCase().replace(/\./g, ",");
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlTxt = s => b64url(new TextEncoder().encode(s));
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const aleatorio = (n = 24) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function corpo(req) { try { return await req.json(); } catch { throw erro(400, "Corpo inválido"); } }
const idValido = s => typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s);
const reais = c => Math.round(c) / 100;

/* ---------------- Firebase: login (ID token) ---------------- */
let jwksCache = null, jwksAte = 0;
async function chavesGoogle() {
  if (jwksCache && Date.now() < jwksAte) return jwksCache;
  const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  if (!r.ok) throw erro(502, "Não foi possível validar o login agora");
  jwksCache = (await r.json()).keys;
  const m = /max-age=(\d+)/.exec(r.headers.get("cache-control") || "");
  jwksAte = Date.now() + (m ? +m[1] * 1000 : 3600e3);
  return jwksCache;
}
async function usuario(req, env) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) throw erro(401, "Faça login de novo");
  const [h64, p64, s64] = tok.split(".");
  if (!h64 || !p64) throw erro(401, "Login inválido");
  const head = JSON.parse(new TextDecoder().decode(unb64url(h64)));
  const pay = JSON.parse(new TextDecoder().decode(unb64url(p64)));
  if (env.TESTE_EMULADOR === "1" && head.alg === "none") {
    /* só para testes locais com o emulador do Firebase */
  } else {
    if (head.alg !== "RS256") throw erro(401, "Login inválido");
    const jwk = (await chavesGoogle()).find(k => k.kid === head.kid);
    if (!jwk) throw erro(401, "Login expirado, entre de novo");
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64url(s64), new TextEncoder().encode(`${h64}.${p64}`));
    if (!ok) throw erro(401, "Login inválido");
  }
  const agora = Date.now() / 1000;
  if (pay.aud !== env.FIREBASE_PROJECT || pay.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT}`) throw erro(401, "Login de outro projeto");
  if (!(pay.exp > agora - 60) || !pay.sub) throw erro(401, "Login expirado, entre de novo");
  return { uid: pay.sub, email: pay.email || null, verificado: pay.email_verified === true };
}

/* ---------------- Firebase: banco (como administrador) ---------------- */
let fbToken = null, fbTokenAte = 0;
async function tokenServico(env) {
  if (fbToken && Date.now() < fbTokenAte) return fbToken;
  if (!env.FIREBASE_SA) throw erro(500, "Falta o segredo FIREBASE_SA");
  const sa = JSON.parse(env.FIREBASE_SA);
  const agora = Math.floor(Date.now() / 1000);
  const head = b64urlTxt(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlTxt(JSON.stringify({
    iss: sa.client_email, aud: "https://oauth2.googleapis.com/token", iat: agora, exp: agora + 3600,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claims}`));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${head}.${claims}.${b64url(sig)}`,
  });
  const d = await r.json();
  if (!r.ok) throw erro(500, "Conta de serviço do Firebase recusada: " + (d.error_description || d.error));
  fbToken = d.access_token; fbTokenAte = Date.now() + (d.expires_in - 120) * 1000;
  return fbToken;
}
async function db(env, metodo, caminho, dados) {
  let u = `${env.FIREBASE_DB}/${caminho}.json`;
  const headers = { "content-type": "application/json" };
  if (env.TESTE_EMULADOR === "1") { u += `?ns=${env.FIREBASE_PROJECT}-default-rtdb`; headers.authorization = "Bearer owner"; }
  else u += `?access_token=${encodeURIComponent(await tokenServico(env))}`;
  const r = await fetch(u, { method: metodo, headers, body: dados === undefined ? undefined : JSON.stringify(dados) });
  if (!r.ok) throw erro(502, `Banco de dados respondeu ${r.status}`);
  return r.json();
}
const TS = { ".sv": "timestamp" };

async function exigirDono(env, u, loja) {
  if (!idValido(loja)) throw erro(400, "Restaurante inválido");
  if (!u.email || !u.verificado) throw erro(403, "Entre com a conta Google do restaurante");
  if (env.ADMIN_EMAIL && u.email === env.ADMIN_EMAIL) return;
  const ok = await db(env, "GET", `lojas/${loja}/donos/${emailKey(u.email)}`);
  if (ok !== true) throw erro(403, "Esta conta não é dona deste restaurante");
}

/* ---------------- Mercado Pago ---------------- */
const MP_API = env => env.MP_API || "https://api.mercadopago.com";
const MP_AUTH = env => env.MP_AUTH || "https://auth.mercadopago.com/authorization";
const retornoUrl = (env, url) => env.MP_REDIRECT || `${url.origin}/mp/retorno`;

async function mp(env, metodo, caminho, token, dados, extraHeaders = {}) {
  const r = await fetch(MP_API(env) + caminho, {
    method: metodo,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    body: dados === undefined ? undefined : JSON.stringify(dados),
  });
  const txt = await r.text();
  let d; try { d = JSON.parse(txt); } catch { d = { message: txt }; }
  return { ok: r.ok, status: r.status, d };
}

/* lê a conexão da loja, renovando o acesso se estiver perto de vencer */
async function conexao(env, loja) {
  const raw = await env.KV.get("mp:" + loja);
  if (!raw) throw erro(409, "Mercado Pago não conectado. Conecte em Estabelecimento > Pagamentos no painel.");
  let c = JSON.parse(raw);
  if (c.expira && c.expira - Date.now() < 7 * 864e5 && c.refresh_token) {
    const r = await mp(env, "POST", "/oauth/token", null, {
      client_id: env.MP_CLIENT_ID, client_secret: env.MP_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: c.refresh_token,
    });
    if (r.ok) {
      c = { ...c, access_token: r.d.access_token, refresh_token: r.d.refresh_token || c.refresh_token, expira: Date.now() + (r.d.expires_in || 15552000) * 1000 };
      await env.KV.put("mp:" + loja, JSON.stringify(c));
    } else console.warn("renovação falhou", loja, r.status, r.d);
  }
  return c;
}

async function mpIniciar(req, env, url) {
  const u = await usuario(req, env);
  const { loja } = await corpo(req);
  await exigirDono(env, u, loja);
  if (!env.MP_CLIENT_ID) throw erro(500, "Falta configurar MP_CLIENT_ID");
  const state = aleatorio();
  await env.KV.put("estado:" + state, JSON.stringify({ loja, email: u.email }), { expirationTtl: 900 });
  const q = new URLSearchParams({ client_id: env.MP_CLIENT_ID, response_type: "code", platform_id: "mp", state, redirect_uri: retornoUrl(env, url) });
  return json({ url: `${MP_AUTH(env)}?${q}` });
}

async function mpRetorno(req, env, url) {
  const volta = (st, msg) => {
    const u = new URL(env.PAINEL_URL);
    u.searchParams.set("mp", st); if (msg) u.searchParams.set("msg", msg); u.hash = "pagamentos";
    return Response.redirect(u.toString(), 302);
  };
  const state = url.searchParams.get("state"), code = url.searchParams.get("code");
  if (!state) return volta("erro", "Conexão cancelada.");
  const raw = await env.KV.get("estado:" + state);
  if (!raw) return volta("erro", "O link de conexão expirou. Tente de novo.");
  await env.KV.delete("estado:" + state);
  const { loja } = JSON.parse(raw);
  if (!code) return volta("erro", "Conexão não autorizada no Mercado Pago.");
  const r = await mp(env, "POST", "/oauth/token", null, {
    client_id: env.MP_CLIENT_ID, client_secret: env.MP_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: retornoUrl(env, url),
  });
  if (!r.ok) { console.error("oauth", r.status, r.d); return volta("erro", "O Mercado Pago recusou a conexão. Tente de novo."); }
  const t = r.d;
  let conta = { id: t.user_id };
  const me = await mp(env, "GET", "/users/me", t.access_token);
  if (me.ok) conta = { id: me.d.id, nome: me.d.nickname || me.d.first_name || "", email: me.d.email || "" };
  await env.KV.put("mp:" + loja, JSON.stringify({
    access_token: t.access_token, refresh_token: t.refresh_token, user_id: t.user_id,
    expira: Date.now() + (t.expires_in || 15552000) * 1000, live_mode: t.live_mode !== false,
  }));
  await db(env, "PUT", `lojas/${loja}/pagamentos/mp`, {
    conectado: true, contaId: String(conta.id || ""), contaNome: conta.nome || "", contaEmail: conta.email || "",
    teste: t.live_mode === false, conectadoEm: TS,
  });
  await db(env, "PUT", `lojas/${loja}/config/versao`, TS);   /* terminal relê e liga o Pix */
  return volta("ok");
}

async function mpDesconectar(req, env) {
  const u = await usuario(req, env);
  const { loja } = await corpo(req);
  await exigirDono(env, u, loja);
  await env.KV.delete("mp:" + loja);
  await db(env, "DELETE", `lojas/${loja}/pagamentos/mp`);
  await db(env, "PUT", `lojas/${loja}/config/versao`, TS);
  return json({ ok: true });
}

/* ---------------- Pix ---------------- */
async function exigirTerminal(env, u, loja) {
  if (!idValido(loja)) throw erro(400, "Restaurante inválido");
  const l = await db(env, "GET", `terminais/${u.uid}`);
  if (l !== loja) throw erro(403, "Terminal não vinculado a este restaurante");
}

/* recalcula o total pelo cardápio, para ninguém mudar preço no caminho */
async function conferirTotal(env, loja, ped) {
  const prods = (await db(env, "GET", `lojas/${loja}/cardapio/produtos`)) || {};
  let soma = 0;
  for (const it of Object.values(ped.itens || {})) {
    const p = prods[it.id];
    if (!p || p.ativo === false) throw erro(409, `O produto "${it.nome}" não está mais disponível.`);
    if (Math.round(p.preco) !== Math.round(it.preco)) throw erro(409, `O preço de "${it.nome}" mudou. Refaça o pedido.`);
    soma += Math.round(p.preco) * Math.max(1, Math.min(99, Math.round(it.qtd)));
  }
  if (soma <= 0 || soma !== Math.round(ped.total)) throw erro(409, "O total do pedido não confere.");
  return soma;
}

async function pixCriar(req, env, url) {
  const u = await usuario(req, env);
  const { loja, pedido } = await corpo(req);
  await exigirTerminal(env, u, loja);
  if (!idValido(pedido)) throw erro(400, "Pedido inválido");
  const ped = await db(env, "GET", `lojas/${loja}/pedidos/${pedido}`);
  if (!ped) throw erro(404, "Pedido não encontrado");
  if (ped.status !== "aguardando_pagamento") throw erro(409, "Este pedido não está aguardando pagamento");
  if (ped.pix?.qr && ped.pix.expira > Date.now() + 30e3) return json({ qr: ped.pix.qr, expira: ped.pix.expira, total: ped.total });

  const total = await conferirTotal(env, loja, ped);
  const cfg = (await db(env, "GET", `lojas/${loja}/config`)) || {};
  if (cfg.bloqueado === true) throw erro(403, "Restaurante suspenso");
  const c = await conexao(env, loja);
  const expira = Date.now() + PIX_MINUTOS * 60e3;
  const r = await mp(env, "POST", "/v1/payments", c.access_token, {
    transaction_amount: reais(total),
    description: `${(cfg.nome || "Pedido").slice(0, 40)} - senha ${ped.senha}`,
    payment_method_id: "pix",
    payer: { email: env.PIX_EMAIL || "cliente@pdvmovel.com.br" },
    external_reference: `${loja}:${pedido}`,
    notification_url: `${url.origin}/mp/aviso?loja=${encodeURIComponent(loja)}`,
    date_of_expiration: new Date(expira).toISOString().replace("Z", "+00:00"),
  }, { "x-idempotency-key": `${loja}-${pedido}` });
  if (!r.ok) {
    console.error("pix", r.status, JSON.stringify(r.d));
    const sem_chave = JSON.stringify(r.d).toLowerCase().includes("key");
    throw erro(502, sem_chave ? "A conta Mercado Pago do restaurante precisa ter uma chave Pix cadastrada." : "O Mercado Pago não gerou o Pix. Tente de novo.");
  }
  const qr = r.d.point_of_interaction?.transaction_data?.qr_code;
  if (!qr) throw erro(502, "O Mercado Pago não devolveu o QR do Pix.");
  await db(env, "PATCH", `lojas/${loja}/pedidos/${pedido}`, { pix: { id: String(r.d.id), qr, expira } });
  await env.KV.put(`pag:${r.d.id}`, `${loja}:${pedido}`, { expirationTtl: 7 * 86400 });
  return json({ qr, expira, total });
}

/* confere o pagamento no Mercado Pago e, se aprovado, marca o pedido como pago */
async function confirmar(env, loja, pedido, pagamentoId) {
  const ped = await db(env, "GET", `lojas/${loja}/pedidos/${pedido}`);
  if (!ped) return { status: "inexistente" };
  if (ped.status !== "aguardando_pagamento" && ped.status !== "cancelado") return { status: ped.status };
  const id = pagamentoId || ped.pix?.id;
  if (!id) return { status: ped.status };
  const c = await conexao(env, loja);
  const r = await mp(env, "GET", `/v1/payments/${encodeURIComponent(id)}`, c.access_token);
  if (!r.ok) throw erro(502, "Não foi possível consultar o Mercado Pago");
  const p = r.d;
  if (p.external_reference !== `${loja}:${pedido}`) return { status: ped.status };
  if (p.status === "approved" && Math.round(p.transaction_amount * 100) === Math.round(ped.total)) {
    await db(env, "PATCH", `lojas/${loja}/pedidos/${pedido}`, {
      status: "pago", pagamento: "Pix", pagoEm: TS, "pix/status": "aprovado", "pix/id": String(p.id),
    });
    return { status: "pago" };
  }
  if (["cancelled", "rejected", "refunded"].includes(p.status) && ped.status === "aguardando_pagamento") {
    await db(env, "PATCH", `lojas/${loja}/pedidos/${pedido}`, { status: "cancelado", "pix/status": p.status });
    return { status: "cancelado" };
  }
  return { status: ped.status, mp: p.status };
}

async function pixVerificar(req, env) {
  const u = await usuario(req, env);
  const { loja, pedido } = await corpo(req);
  await exigirTerminal(env, u, loja);
  if (!idValido(pedido)) throw erro(400, "Pedido inválido");
  return json(await confirmar(env, loja, pedido));
}

/* assinatura do aviso (x-signature: ts=...,v1=...) */
async function assinaturaOk(req, env, dataId) {
  if (!env.MP_WEBHOOK_SECRET) return true;
  const sig = req.headers.get("x-signature");
  if (!sig) return true; /* avisos sem assinatura: a confirmação depende só da consulta ao MP */
  const partes = Object.fromEntries(sig.split(",").map(s => s.trim().split("=")));
  const manifesto = `id:${String(dataId).toLowerCase()};request-id:${req.headers.get("x-request-id") || ""};ts:${partes.ts};`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.MP_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifesto)))].map(b => b.toString(16).padStart(2, "0")).join("");
  const v1 = String(partes.v1 || "");
  if (v1.length !== mac.length) return false;
  let dif = 0;
  for (let i = 0; i < mac.length; i++) dif |= mac.charCodeAt(i) ^ v1.charCodeAt(i);
  return dif === 0;
}

async function mpAviso(req, env, url, ctx) {
  let b = {}; try { b = await req.json(); } catch {}
  const id = url.searchParams.get("data.id") || b?.data?.id || url.searchParams.get("id");
  const tipo = b?.type || b?.topic || url.searchParams.get("type") || url.searchParams.get("topic");
  if (!id || (tipo && tipo !== "payment")) return json({ ok: true, ignorado: true });
  if (!(await assinaturaOk(req, env, id))) return json({ erro: "assinatura" }, 401);
  const ref = await env.KV.get(`pag:${id}`);
  if (!ref) return json({ ok: true, desconhecido: true });
  const [loja, pedido] = ref.split(":");
  const res = await confirmar(env, loja, pedido, id);
  return json({ ok: true, ...res });
}
