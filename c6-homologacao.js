// Roda os testes do "Roteiro de Testes - C6 Developers v3.0" que o robô usa:
// AT_01 (autenticação) e BP_01..BP_06 (bolepix), no SANDBOX, para cada empresa.
// Imprime, para cada teste, o status e o corpo da resposta, entre as linhas
// ===HOMOLOGACAO=== e ===FIM===, em JSON, para preencher o roteiro.
// O access_token sai mascarado (o log do GitHub deste repositório é público).
const { cliente } = require("./bancos/c6.js");

const ymd = d => d.toISOString().slice(0, 10);
const espera = ms => new Promise(r => setTimeout(r, ms));
const mascara = t => (t ? `${String(t).slice(0, 12)}...(omitido)` : t);

async function homologar(empresa) {
  const c = cliente(empresa);
  if (c.ambiente !== "sandbox") throw new Error("Homologação só no sandbox.");
  const out = { empresa, testes: [] };
  const anota = (id, nome, r, corpo) => {
    const t = { id, nome, status: r.status, corpo: corpo !== undefined ? corpo : (r.json ?? r.text) };
    out.testes.push(t);
    console.log(`  ${id} ${nome}: HTTP ${r.status}`);
    return t;
  };

  // AT_01 – token (chamada crua, para registrar a resposta como veio)
  const tok = await c.token();
  anota("AT_01", "Geração do token de sessão", { status: 200 },
    { access_token: mascara(tok.access_token), expires_in: tok.expires_in, token_type: "Bearer", scope: tok.scope });

  // BP_01 – criar só com os campos obrigatórios
  const venc = ymd(new Date(Date.now() + 10 * 864e5));
  const r1 = await c.chamar("POST", "/v2/bank_slips", {
    amount: 10.0, due_date: venc, description: `Homologacao PJ Gestao de Imoveis - ${empresa}`,
    payer: { name: "Pagador Teste", tax_id: "12345678909",
      address: { address: "Av. Paulista, 1000", neighborhood: "Bela Vista", city: "Sao Paulo", state: "SP", zip_code: "01310100" } },
    payment_method: { bank_slip: { billing_scheme: "21" } },
  });
  anota("BP_01_01", "Criar cobrança com sucesso", r1);
  const ref = r1.json?.external_reference_id;
  if (!ref) { console.log("  Sem external_reference_id; parei aqui."); return out; }

  // BP_03 – consultar
  anota("BP_03", "Consultar cobrança", await c.chamar("GET", `/v2/bank_slips/${ref}`));

  // BP_04 – PDF
  const r4 = await c.chamar("GET", `/v2/bank_slips/${ref}/pdf`);
  anota("BP_04", "Consultar PDF", r4, r4.status === 200
    ? `PDF retornado (Content-Type: ${r4.headers["content-type"]}, ${r4.bytes.length} bytes)` : (r4.json ?? r4.text));

  // BP_06 – listar por vencimento
  const r6 = await c.chamar("GET", `/v2/bank_slips?due_date_from=${ymd(new Date())}&due_date_to=${venc}&size=5`);
  anota("BP_06", "Listar cobranças", r6);

  // BP_02 e BP_05 – logo após emitir o C6 responde 422 até o título registrar; tenta por até 10 min.
  const insiste = async (fn, ok) => {
    let r;
    for (let i = 0; i < 20; i++) {
      r = await fn();
      if (ok.includes(r.status) || r.status !== 422) return r;
      console.log(`    (422, título ainda registrando; nova tentativa em 30s)`);
      await espera(30000);
    }
    return r;
  };
  anota("BP_02", "Atualizar cobrança", await insiste(() => c.chamar("PATCH", `/v2/bank_slips/${ref}`,
    { amount: 12.5, description: `Homologacao PJ Gestao de Imoveis - ${empresa} (alterada)` }), [200]));
  anota("BP_05", "Cancelar cobrança (baixa)", await insiste(() => c.chamar("PUT", `/v2/bank_slips/${ref}/cancel`), [204, 200]));
  anota("BP_03", "Consultar cobrança depois da baixa", await c.chamar("GET", `/v2/bank_slips/${ref}`));
  return out;
}

async function main() {
  const empresas = String(process.env.EMPRESAS || "Explorer,Mille Miglia").split(",").map(s => s.trim()).filter(Boolean);
  for (const e of empresas) {
    console.log(`\n== ${e} ==`);
    let r;
    try { r = await homologar(e); } catch (err) { r = { empresa: e, erro: err.message, detalhe: err.detalhe }; console.log(`  ✗ ${err.message}`); }
    console.log("===HOMOLOGACAO===");
    console.log(JSON.stringify(r));
    console.log("===FIM===");
  }
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
