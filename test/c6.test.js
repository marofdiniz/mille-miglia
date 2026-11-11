const test = require("node:test");
const assert = require("node:assert");
const { credenciais, pem, ambiente, criar, referencia, corpoEmissao, lerStatus } = require("../bancos/c6.js");

const quatro = p => ({ [`${p}_CLIENT_ID`]: "id", [`${p}_CLIENT_SECRET`]: "s", [`${p}_CERT`]: "c", [`${p}_KEY`]: "k" });
const cob = {
  id: "p1_2026-11", valor: 4000, vencimento: "2026-11-20", descricao: "Aluguel 11/2026 - Paulista",
  pagador: { nome: "Fulano de Tal com um nome muito comprido demais", documento: "123.456.789-09", endereco: "Av. Paulista, 1",
    bairro: "Bela Vista", cep: "01310-100", cidade: "São Paulo", uf: "sp", email: "f@x.com" },
};

test("credenciais por empresa, avisando o que falta", () => {
  assert.strictEqual(credenciais("Mille Miglia", quatro("C6_MILLE_MIGLIA")).origem, "C6_MILLE_MIGLIA");
  assert.deepStrictEqual(credenciais("Explorer", { ...quatro("C6_EXPLORER"), C6_EXPLORER_KEY: "" }).faltam, ["C6_EXPLORER_KEY"]);
  assert.strictEqual(credenciais("Explorer", { ...quatro("C6_EXPLORER"), C6_EXPLORER_PIX_CHAVE: " abc " }).PIX_CHAVE, "abc");
});
test("pem recompõe certificado colado numa linha só", () => {
  const out = pem(`-----BEGIN CERTIFICATE----- ${"A".repeat(100)} -----END CERTIFICATE-----`);
  assert.strictEqual(out, `-----BEGIN CERTIFICATE-----\n${"A".repeat(64)}\n${"A".repeat(36)}\n-----END CERTIFICATE-----\n`);
});
test("sandbox é o padrão", () => {
  assert.strictEqual(ambiente({}), "sandbox");
  assert.strictEqual(ambiente({ C6_AMBIENTE: "Produção" }), "producao");
});
test("referência: 26 caracteres A-Z0-9, estável e muda por tentativa/valor", () => {
  const r = referencia(cob);
  assert.match(r, /^[A-Z0-9]{26}$/);
  assert.strictEqual(referencia(cob), r);
  assert.notStrictEqual(referencia(cob, 1), r);
  assert.notStrictEqual(referencia({ ...cob, valor: 4100 }), r);
});
test("corpo da emissão segue a API bolepix", () => {
  const c = corpoEmissao({ ...cob, ref: "R" }, { ambiente: "sandbox", pixChave: "chave", multa: "2", juros: "1", diasApos: 60 });
  assert.strictEqual(c.payment_method.bank_slip.billing_scheme, "21");
  assert.deepStrictEqual(c.payment_method.pix, { key: "chave", type: "EVP" });
  assert.strictEqual(c.payer.name.length, 40);
  assert.strictEqual(c.payer.tax_id, "12345678909");
  assert.deepStrictEqual(c.payer.address, { address: "Av. Paulista, 1", neighborhood: "Bela Vista", city: "São Paulo", state: "SP", zip_code: "01310100" });
  assert.deepStrictEqual(c.fees, { fine_type: "PERCENTAGE", fine_value: 2, fine_deadline: 1, interest_type: "MONTHLY_PERCENTAGE", interest_value: 1, interest_deadline: 1 });
  assert.strictEqual(c.payer_notification, undefined);
  const p = corpoEmissao({ ...cob, ref: "R" }, { ambiente: "producao", notificarEmail: true });
  assert.strictEqual(p.payment_method.bank_slip.billing_scheme, "15");
  assert.strictEqual(p.payment_method.pix, undefined);
  assert.strictEqual(p.payer_notification.length, 2);
});
test("status do C6", () => {
  assert.deepStrictEqual(lerStatus({ status: "PAID", amount: 4000, payments: [{ amount: "4080.00", payment_date: "2026-11-21" }] }), { status: "pago", valorPago: 4080, pagoEm: "2026-11-21" });
  assert.deepStrictEqual(lerStatus({ status: "CANCELED" }), { status: "cancelado" });
  assert.deepStrictEqual(lerStatus({ status: "CREATED" }), { status: "aberto" });
});

// C6 de mentira: guarda boletos por referência.
function c6Falso() {
  const boletos = {}, chamadas = [];
  return { boletos, chamadas, ambiente: "sandbox", pixChave: "k",
    async chamar(m, path, corpo) {
      chamadas.push(`${m} ${path}`);
      const ref = path.split("/")[3];
      if (m === "GET") return boletos[ref] ? { status: 200, json: boletos[ref] } : { status: 404 };
      if (m === "POST") {
        boletos[corpo.external_reference_id] = { ...corpo, status: "CREATED",
          payment_method: { bank_slip: { digitable_line: "33690.00009   1", bar_code: "336" }, pix: { qr_code: "000201" } } };
        return { status: 201, json: boletos[corpo.external_reference_id] };
      }
      if (m === "PUT") { boletos[ref].status = "CANCELED"; return { status: 204 }; }
    } };
}
test("emitir não duplica, cancelar e emitir de novo usa outra referência", async () => {
  const api = c6Falso();
  const b = criar("Explorer", { api, env: {} });
  const r1 = await b.emitir(cob);
  assert.deepStrictEqual([r1.linhaDigitavel, r1.pixCopiaECola], ["33690.00009 1", "000201"]);
  const r2 = await b.emitir(cob);
  assert.strictEqual(r2.id, r1.id);
  assert.strictEqual(Object.keys(api.boletos).length, 1);
  await b.cancelar({ ...cob, bancoId: r1.id });
  assert.deepStrictEqual(await b.consultar({ bancoId: r1.id }), { status: "cancelado" });
  const r3 = await b.emitir(cob);
  assert.notStrictEqual(r3.id, r1.id);
  assert.deepStrictEqual(await b.consultar({ bancoId: r3.id }), { status: "aberto" });
});
test("simulação não exige segredos", async () => {
  assert.deepStrictEqual(await criar("Explorer", { dry: true }).emitir({}), { id: "simulado" });
});
test("cancelamento recusado com 422 fica para depois", async () => {
  const api = { ambiente: "sandbox", pixChave: "", async chamar() { return { status: 422, json: { detail: "Título com pendência(s)" } }; } };
  assert.deepStrictEqual(await criar("Explorer", { api, env: {} }).cancelar({ bancoId: "X" }), { cancelado: false, motivo: "Título com pendência(s)" });
});
