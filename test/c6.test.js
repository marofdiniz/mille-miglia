const test = require("node:test");
const assert = require("node:assert");
const { credenciais, pem, ambiente, criar } = require("../bancos/c6.js");

const quatro = p => ({ [`${p}_CLIENT_ID`]: "id", [`${p}_CLIENT_SECRET`]: "s", [`${p}_CERT`]: "c", [`${p}_KEY`]: "k" });

test("usa as credenciais da empresa e, sem elas, as gerais", () => {
  assert.strictEqual(credenciais("Mille Miglia", quatro("C6_MILLE_MIGLIA")).origem, "C6_MILLE_MIGLIA");
  assert.strictEqual(credenciais("Explorer", { ...quatro("C6"), ...quatro("C6_EXPLORER") }).origem, "C6_EXPLORER");
  assert.strictEqual(credenciais("Explorer", quatro("C6")).origem, "C6");
  assert.deepStrictEqual(credenciais("Explorer", {}).faltam, ["C6_EXPLORER_CLIENT_ID", "C6_EXPLORER_CLIENT_SECRET", "C6_EXPLORER_CERT", "C6_EXPLORER_KEY"]);
});
test("empresa com credencial incompleta avisa o que falta, sem cair nas gerais", () => {
  const env = { ...quatro("C6"), C6_EXPLORER_CLIENT_ID: "x" };
  assert.deepStrictEqual(credenciais("Explorer", env).faltam, ["C6_EXPLORER_CLIENT_SECRET", "C6_EXPLORER_CERT", "C6_EXPLORER_KEY"]);
});
test("pem recompõe certificado colado numa linha só", () => {
  const corpo = "A".repeat(100);
  const out = pem(`-----BEGIN CERTIFICATE----- ${corpo} -----END CERTIFICATE-----`);
  assert.strictEqual(out, `-----BEGIN CERTIFICATE-----\n${"A".repeat(64)}\n${"A".repeat(36)}\n-----END CERTIFICATE-----\n`);
});
test("sandbox é o padrão", () => {
  assert.strictEqual(ambiente({}), "sandbox");
  assert.strictEqual(ambiente({ C6_AMBIENTE: "Produção" }), "producao");
});
test("simulação não exige segredos", async () => {
  const b = criar("Explorer", { dry: true });
  assert.deepStrictEqual(await b.emitir({}), { id: "simulado" });
});
