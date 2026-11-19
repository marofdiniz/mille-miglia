const test = require("node:test");
const assert = require("node:assert");
const { montarMensal, montarLembrete, vencDespesa, carregarFinanceiro } = require("../relatorios.js");
const F = carregarFinanceiro();

const receitas = [
  { imovel: "Lorena", mes: 10, ano: 2026, valor: 3000 },
  { imovel: "Paulista", mes: 10, ano: 2026, valor: 2000 },
  { imovel: "Lorena", mes: 10, ano: 2026, valor: 2500, terceiros: true },
];
const despesas = [
  { imovel: "Lorena", tipo: "Condomínio", mes: 10, ano: 2026, dia_venc: 10, valor: 800, status: "pago" },
  { imovel: "Lorena", tipo: "IPTU", mes: 10, ano: 2026, dia_venc: 10, valor: 100, status: "pago", pago_por: "inquilino" },
  { imovel: "Paulista", tipo: "Condomínio", mes: 11, ano: 2026, dia_venc: 10, valor: 700, status: "pendente" },
  { imovel: "Paulista", tipo: "IPTU", mes: 11, ano: 2026, dia_venc: 20, valor: 150, status: "pendente" },
  { imovel: "Paulista", tipo: "Luz", mes: 12, ano: 2026, dia_venc: 5, valor: 90, status: "pendente" },
];

test("mensal soma só o que é da empresa e lista as contas em aberto", () => {
  const r = montarMensal({ F, receitas, despesas, parcelas: [], mes: 10, ano: 2026, hoje: "2026-11-15" });
  assert.deepStrictEqual([r.resumo.totRec, r.resumo.totDesp, r.resumo.pendentes], [5000, 800, 2]);
  assert.match(r.assunto, /outubro de 2026/);
  assert.match(r.html, /Condomínio – Paulista/);
  assert.doesNotMatch(r.html, /Luz – Paulista/);
});
test("lembrete pega o que vence nos próximos dias e o vencido", () => {
  const r = montarLembrete({ F, despesas, parcelas: [], hoje: "2026-11-18", dias: 3 });
  assert.match(r.html, /IPTU – Paulista/);
  assert.match(r.html, /Já vencidas/);
  assert.match(r.assunto, /1 a vencer, 1 vencida/);
});
test("lembrete sem nada não manda e-mail", () => {
  assert.strictEqual(montarLembrete({ F, despesas: [], parcelas: [], hoje: "2026-11-18" }), null);
});
test("vencimento dia 31 em mês curto", () => {
  assert.strictEqual(vencDespesa({ ano: 2026, mes: 2, dia_venc: 31 }), "2026-02-28");
});
