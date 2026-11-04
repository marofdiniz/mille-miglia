const test = require("node:test");
const assert = require("node:assert");
const { planejar, receitaDoPagamento, vencimentoDe } = require("../cobranca.js");

const ok = { cobranca_auto: true, empresa: "Explorer", inquilino: "Fulano", inquilino_doc: "123.456.789-09", aluguel: 4000,
  cep: "01310-100", cidade: "São Paulo", uf: "sp", endereco: "Av. Paulista, 1", dia_vencimento: 10, status: "ativo" };
const imoveis = [
  { id: "p1", nome: "Paulista", ...ok },
  { id: "l1", nome: "Lorena", ...ok, dia_vencimento: 28, inquilino_doc: "" },
  { id: "x1", nome: "Outro", ...ok, empresa: "Outra" },
  { id: "y1", nome: "Sem", ...ok, cobranca_auto: false },
];
const base = { imoveis, cobrancas: [], receitas: [], empresas: { Explorer: "c6" }, diasAntes: 10 };

test("gera só o que vence nos próximos 10 dias e pula cadastro incompleto", () => {
  const p = planejar({ ...base, hoje: "2026-11-04" });
  assert.deepStrictEqual(p.criar.map(c => [c.id, c.vencimento, c.valor, c.pagador.uf]), [["p1_2026-11", "2026-11-10", 4000, "SP"]]);
  assert.ok(p.pulados.some(x => x.imovel === "Lorena" && /CPF/.test(x.motivo)));
  assert.ok(p.pulados.some(x => x.imovel === "Outro" && /sem banco/.test(x.motivo)));
});
test("não duplica e não gera se o aluguel já foi lançado", () => {
  let p = planejar({ ...base, hoje: "2026-11-04", cobrancas: [{ id: "p1_2026-11", imovelId: "p1", status: "aberto", valor: 4000, mes: 11, ano: 2026 }] });
  assert.strictEqual(p.criar.length, 0);
  p = planejar({ ...base, hoje: "2026-11-04", receitas: [{ imovel: "Paulista", mes: 11, ano: 2026, valor: 4000 }] });
  assert.strictEqual(p.criar.length, 0);
});
test("valor mudou: cancela e gera de novo", () => {
  const p = planejar({ ...base, hoje: "2026-11-04", cobrancas: [{ id: "p1_2026-11", imovelId: "p1", status: "aberto", valor: 3800, mes: 11, ano: 2026, bancoId: "b1" }] });
  assert.deepStrictEqual(p.cancelar.map(c => c.motivo), ["valor do aluguel mudou"]);
  assert.deepStrictEqual(p.criar.map(c => c.valor), [4000]);
});
test("virada de mês: vencimento no começo do mês seguinte", () => {
  const p = planejar({ ...base, hoje: "2026-11-28", imoveis: [{ id: "p1", nome: "Paulista", ...ok, dia_vencimento: 5 }] });
  assert.deepStrictEqual(p.criar.map(c => c.id), ["p1_2026-12"]);
});
test("dia 31 em fevereiro e receita do pagamento", () => {
  assert.strictEqual(vencimentoDe({ dia_vencimento: 31 }, 2, 2027), "2027-02-28");
  const r = receitaDoPagamento({ id: "p1_2026-11", imovel: "Paulista", mes: 11, ano: 2026, valor: 4000 }, { valorPago: 4080, pagoEm: "2026-11-12" });
  assert.deepStrictEqual(r, { imovel: "Paulista", mes: 11, ano: 2026, valor: 4080, recebido_em: "2026-11-12", origem: "cobranca", cobranca_id: "p1_2026-11" });
});
