// Banco C6 – boleto com Pix (bolecode) pela API do C6 Bank.
// Login: mTLS (certificado .crt + chave .key) + OAuth2 client_credentials em POST /v1/auth/.
//
// Boleto: API "Boleto com Liquidação via Barra ou Pix" (bolepix), /v2/bank_slips.
//
// A API não tem campo de conta: o boleto cai sempre na conta dona da chave. Por isso cada
// empresa tem as suas credenciais (segredos do GitHub, nome da empresa em maiúsculas):
//   C6_<EMPRESA>_CLIENT_ID, C6_<EMPRESA>_CLIENT_SECRET, C6_<EMPRESA>_CERT, C6_<EMPRESA>_KEY
//   C6_<EMPRESA>_PIX_CHAVE  (opcional) chave Pix ALEATÓRIA da empresa no C6; sem ela o boleto sai sem QR Code
//   (ex.: C6_EXPLORER_CLIENT_ID, C6_MILLE_MIGLIA_PIX_CHAVE)
// C6_AMBIENTE=producao troca para produção; sem isso, usa o sandbox.
// NOTIFICAR_EMAIL=1 pede ao C6 para mandar o boleto por e-mail ao inquilino (se tiver e-mail).

const https = require("node:https");

const HOSTS = { sandbox: "baas-api-sandbox.c6bank.info", producao: "baas-api.c6bank.info" };
const ambiente = (env = process.env) => (String(env.C6_AMBIENTE || "sandbox").toLowerCase().startsWith("prod") ? "producao" : "sandbox");

const chaveEmpresa = empresa => "C6_" + String(empresa).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "_");
const CAMPOS = ["CLIENT_ID", "CLIENT_SECRET", "CERT", "KEY"];

// Credenciais da empresa (todas as quatro são obrigatórias).
function credenciais(empresa, env = process.env) {
  const pre = chaveEmpresa(empresa);
  const cred = Object.fromEntries(CAMPOS.map(k => [k, env[`${pre}_${k}`]]));
  const faltam = CAMPOS.filter(k => !cred[k]).map(k => `${pre}_${k}`);
  if (faltam.length) return { faltam };
  return { ...cred, PIX_CHAVE: String(env[`${pre}_PIX_CHAVE`] || "").trim(), origem: pre };
}

// Recompõe um PEM que tenha perdido as quebras de linha ao ser colado.
function pem(txt) {
  if (!txt) return "";
  const s = String(txt).replace(/\\n/g, "\n").replace(/\r/g, "").trim();
  const blocos = s.match(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g) || [];
  return blocos.map(b => {
    const m = b.match(/^(-----BEGIN [^-]+-----)([\s\S]*?)(-----END [^-]+-----)$/);
    const corpo = m[2].replace(/\s+/g, "");
    return `${m[1]}\n${corpo.match(/.{1,64}/g).join("\n")}\n${m[3]}`;
  }).join("\n") + "\n";
}

// Cliente HTTP de uma empresa: login com mTLS, guarda o token até expirar.
function cliente(empresa, env = process.env) {
  const cred = credenciais(empresa, env);
  if (cred.faltam) throw new Error(`Faltam os segredos ${cred.faltam.join(", ")} para usar o C6 pela ${empresa}.`);
  const host = HOSTS[ambiente(env)];
  const cert = pem(cred.CERT), key = pem(cred.KEY);
  if (!cert.includes("BEGIN")) throw new Error(`O segredo ${cred.origem}_CERT não parece um certificado (.crt): falta a linha -----BEGIN ...-----.`);
  if (!key.includes("BEGIN")) throw new Error(`O segredo ${cred.origem}_KEY não parece uma chave (.key): falta a linha -----BEGIN ...-----.`);
  const agent = new https.Agent({ cert, key, keepAlive: true });

  const request = (method, path, { headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
    const req = https.request({ host, path, method, agent, headers, timeout: 20000 }, res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", c => (data += c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado falando com o C6.")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });

  let tok = null;
  async function token() {
    if (tok && tok.expira > Date.now()) return tok;
    const body = new URLSearchParams({ client_id: cred.CLIENT_ID.trim(), client_secret: cred.CLIENT_SECRET.trim(), grant_type: "client_credentials" }).toString();
    const r = await request("POST", "/v1/auth/", {
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) }, body,
    });
    if (r.status !== 200 || !r.json?.access_token) {
      const e = new Error(`Login no C6 (${empresa}, ${ambiente(env)}) falhou: HTTP ${r.status}.`);
      e.detalhe = r.json || String(r.text || "").slice(0, 500);
      throw e;
    }
    tok = { access_token: r.json.access_token, scope: r.json.scope || "", expira: Date.now() + (Number(r.json.expires_in || 300) - 30) * 1000 };
    return tok;
  }
  async function chamar(method, path, corpo) {
    const t = await token();
    const headers = { Authorization: `Bearer ${t.access_token}`, Accept: "application/json",
      "partner-software-name": "PJ Gestao de Imoveis", "partner-software-version": "1.0" };
    let body = null;
    if (corpo !== undefined) { body = JSON.stringify(corpo); headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(body); }
    return request(method, path, { headers, body });
  }
  return { empresa, host, ambiente: ambiente(env), origem: cred.origem, pixChave: cred.PIX_CHAVE, token, chamar };
}

// Identificador nosso da cobrança no C6: 26 letras/números, nunca reutilizável.
// Determinístico (mesma cobrança + mesma tentativa = mesmo id), para não duplicar boleto se o robô
// cair entre emitir no banco e gravar no Firestore.
function referencia(cob, tentativa = 0) {
  const h = require("node:crypto").createHash("sha256")
    .update(`${cob.id}|${Number(cob.valor).toFixed(2)}|${cob.vencimento}|${tentativa}`).digest();
  let n = BigInt("0x" + h.toString("hex")), out = "";
  const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  while (out.length < 26) { out += A[Number(n % 36n)]; n /= 36n; }
  return out;
}

const corta = (s, n) => String(s || "").normalize("NFC").trim().slice(0, n);
const num = v => Math.round((Number(v) || 0) * 100) / 100;

// Corpo do POST /v2/bank_slips.
function corpoEmissao(cob, { ambiente: amb, pixChave, multa, juros, diasApos = 60, notificarEmail = false }) {
  const p = cob.pagador;
  const corpo = {
    external_reference_id: cob.ref,
    amount: num(cob.valor),
    due_date: cob.vencimento,
    description: corta(cob.descricao, 100),
    days_after_due_date: diasApos,
    payer: {
      name: corta(p.nome, 40),
      tax_id: String(p.documento).replace(/\D/g, ""),
      address: {
        address: corta(p.endereco, 40), neighborhood: corta(p.bairro, 40), city: corta(p.cidade, 40),
        state: String(p.uf).toUpperCase(), zip_code: String(p.cep).replace(/\D/g, ""),
      },
    },
    payment_method: { bank_slip: { billing_scheme: amb === "producao" ? "15" : "21" } },
    origin: "aluguel",
  };
  if (p.email) corpo.payer.email = corta(p.email, 70);
  if (pixChave) corpo.payment_method.pix = { key: pixChave, type: "EVP" };
  const fees = {};
  if (Number(multa) > 0) Object.assign(fees, { fine_type: "PERCENTAGE", fine_value: num(multa), fine_deadline: 1 });
  if (Number(juros) > 0) Object.assign(fees, { interest_type: "MONTHLY_PERCENTAGE", interest_value: num(juros), interest_deadline: 1 });
  if (Object.keys(fees).length) corpo.fees = fees;
  if (notificarEmail && p.email) {
    corpo.payer_notification = ["ISSUE_DATE", "BEFORE_DUE_DATE"].map(m => ({ channel: "EMAIL", destination: p.email, notification_date: m }));
  }
  return corpo;
}

// Resposta do C6 → o que o robô grava.
function lerEmissao(r) {
  const bs = r?.payment_method?.bank_slip || {}, pix = r?.payment_method?.pix || {};
  return { linhaDigitavel: String(bs.digitable_line || "").replace(/\s+/g, " ").trim(), codigoBarras: bs.bar_code || "",
    nossoNumero: bs.our_number || "", pixCopiaECola: pix.qr_code || "", c6Id: r?.id || "" };
}
function lerStatus(r) {
  const pagos = (r?.payments || []).concat();
  const valorPago = pagos.length ? num(pagos.reduce((s, x) => s + Number(x.amount || 0), 0)) : num(r?.amount);
  const pagoEm = pagos.map(x => x.payment_date).filter(Boolean).sort().pop() || "";
  switch (r?.status) {
    case "PAID": case "WAITING_CONFIRMATION": return { status: "pago", valorPago, pagoEm };
    case "CANCELED": return { status: "cancelado" };
    default: return { status: "aberto" };
  }
}

const erroC6 = (oque, r) => {
  const e = new Error(`C6 recusou ${oque}: HTTP ${r.status}${r.json ? " " + JSON.stringify(r.json).slice(0, 400) : ""}`);
  e.status = r.status;
  return e;
};

function criar(empresa, { dry, multa, juros, env = process.env, api: apiPronta } = {}) {
  let c = apiPronta || null;
  const api = () => (c ||= cliente(empresa, env));
  const opcoes = () => ({
    ambiente: api().ambiente, pixChave: api().pixChave, multa, juros,
    diasApos: parseInt(env.DIAS_APOS_VENCIMENTO || "60") || 60, notificarEmail: env.NOTIFICAR_EMAIL === "1",
  });
  const consultarRef = async ref => {
    const r = await api().chamar("GET", `/v2/bank_slips/${ref}`);
    if (r.status === 404) return null;
    if (r.status !== 200) throw erroC6(`a consulta do boleto ${ref}`, r);
    return r.json;
  };
  return {
    async emitir(cob) {
      if (dry) return { id: "simulado" };
      const o = opcoes();
      if (!o.pixChave) console.log(`  ! ${empresa}: sem C6_..._PIX_CHAVE, boleto sai sem Pix.`);
      // Reaproveita um boleto já criado nesta mesma cobrança; se o anterior foi cancelado, usa nova referência.
      for (let t = 0; t < 10; t++) {
        const ref = referencia(cob, t);
        const existente = await consultarRef(ref);
        if (existente && existente.status === "CANCELED") continue;
        if (existente) return { id: ref, ...lerEmissao(existente) };
        const r = await api().chamar("POST", "/v2/bank_slips", corpoEmissao({ ...cob, ref }, o));
        if (r.status !== 201 && r.status !== 200) throw erroC6(`o boleto ${cob.descricao}`, r);
        return { id: ref, ...lerEmissao(r.json) };
      }
      throw new Error(`Boleto ${cob.descricao}: 10 tentativas canceladas, confira no C6.`);
    },
    async consultar(cob) {
      if (dry) return { status: "aberto" };
      const r = await consultarRef(cob.bancoId);
      if (!r) return { status: "cancelado" };
      return lerStatus(r);
    },
    async cancelar(cob) {
      if (dry) return;
      const r = await api().chamar("PUT", `/v2/bank_slips/${cob.bancoId}/cancel`);
      if (r.status === 204 || r.status === 200) return { cancelado: true };
      // Logo depois de emitir o título ainda está sendo registrado e o C6 responde 422
      // ("Título com pendência(s)..."). Fica para a próxima rodada.
      if (r.status === 422) return { cancelado: false, motivo: r.json?.detail || "título com pendência no C6" };
      throw erroC6(`o cancelamento do boleto ${cob.descricao}`, r);
    },
  };
}

module.exports = { criar, cliente, credenciais, pem, ambiente, HOSTS, referencia, corpoEmissao, lerEmissao, lerStatus };
