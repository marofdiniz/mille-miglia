// Banco C6 – boleto com Pix (bolecode) pela API do C6 Bank.
// Login: mTLS (certificado .crt + chave .key) + OAuth2 client_credentials em POST /v1/auth/.
//
// Credenciais (segredos do GitHub). Para cada empresa o robô procura primeiro as dela,
// com o nome da empresa em maiúsculas, e, se não houver, usa as gerais:
//   C6_<EMPRESA>_CLIENT_ID, C6_<EMPRESA>_CLIENT_SECRET, C6_<EMPRESA>_CERT, C6_<EMPRESA>_KEY
//   (ex.: C6_EXPLORER_CLIENT_ID, C6_MILLE_MIGLIA_CLIENT_ID)
//   C6_CLIENT_ID, C6_CLIENT_SECRET, C6_CERT, C6_KEY   (gerais, se uma credencial servir para as duas)
// C6_AMBIENTE=producao troca para produção; sem isso, usa o sandbox.
//
// PENDENTE: emitir/consultar/cancelar boleto. Os caminhos e campos estão no portal
// developers.c6bank.com.br (/apis/bolepix e /apis/bankslip), que exige login. Assim que tivermos
// o arquivo .json (OpenAPI) dessas páginas, completar as três funções no fim deste arquivo.

const https = require("node:https");

const HOSTS = { sandbox: "baas-api-sandbox.c6bank.info", producao: "baas-api.c6bank.info" };
const ambiente = (env = process.env) => (String(env.C6_AMBIENTE || "sandbox").toLowerCase().startsWith("prod") ? "producao" : "sandbox");

const chaveEmpresa = empresa => "C6_" + String(empresa).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "_");
const CAMPOS = ["CLIENT_ID", "CLIENT_SECRET", "CERT", "KEY"];

// Credenciais da empresa: as próprias, se estiverem todas; senão as gerais.
function credenciais(empresa, env = process.env) {
  const pre = chaveEmpresa(empresa);
  const proprias = Object.fromEntries(CAMPOS.map(k => [k, env[`${pre}_${k}`]]));
  if (CAMPOS.every(k => proprias[k])) return { ...proprias, origem: pre };
  if (CAMPOS.some(k => proprias[k])) {
    const faltam = CAMPOS.filter(k => !proprias[k]).map(k => `${pre}_${k}`);
    return { faltam };
  }
  const gerais = Object.fromEntries(CAMPOS.map(k => [k, env[`C6_${k}`]]));
  if (CAMPOS.every(k => gerais[k])) return { ...gerais, origem: "C6" };
  return { faltam: CAMPOS.map(k => `${pre}_${k}`) };
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
    const headers = { Authorization: `Bearer ${t.access_token}`, Accept: "application/json" };
    let body = null;
    if (corpo !== undefined) { body = JSON.stringify(corpo); headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(body); }
    return request(method, path, { headers, body });
  }
  return { empresa, host, ambiente: ambiente(env), origem: cred.origem, token, chamar };
}

function criar(empresa, { dry }) {
  let c = null;
  const api = () => (c ||= cliente(empresa));
  const pendente = () => {
    api(); // já avisa se faltar segredo
    throw new Error("Emissão de boleto no C6 ainda não implementada (aguardando o arquivo .json da API bolepix do portal do C6).");
  };
  return {
    async emitir(cob) { if (dry) return { id: "simulado" }; return pendente(); },
    async consultar(cob) { if (dry) return { status: "aberto" }; return pendente(); },
    async cancelar(cob) { if (dry) return; return pendente(); },
  };
}

module.exports = { criar, cliente, credenciais, pem, ambiente, HOSTS };
