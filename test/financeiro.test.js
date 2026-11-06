const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
// o código mora dentro do index.html, entre os marcadores
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const bloco = html.split("// === FINANCEIRO (início) ===")[1].split("// === FINANCEIRO (fim) ===")[0];
const F = new Function("module", bloco + "\nreturn Financeiro;")({});

const proprio = { id: "c1", tipo: "locacao", imovel: "Lorena", aluguel: 3000, dia_vencimento: 31, inicio: "2026-11", terceiros: false };
const terceiro = { id: "c2", tipo: "locacao", imovel: "Apto 12", aluguel: 2000, encargos: 500, dia_vencimento: 10, inicio: "2026-11",
  terceiros: true, proprietario_id: "p1", taxa_adm_pct: 10, taxa_1a_pct: 50, dia_repasse: 15 };
const venda = { id: "v1", tipo: "venda", imovel: "Casa", valor_venda: 500000, comissao_pct: 6, parcelas: 3, primeiro_venc: "2026-11-20", corretor_id: "k1", corretor_pct: 30 };

test("categoria de lançamentos antigos sai do tipo", () => {
  assert.strictEqual(F.categoriaDespesa({ tipo: "Condomínio" }), "desp_imovel");
  assert.strictEqual(F.categoriaDespesa({ tipo: "Carnê Leão" }), "desp_impostos");
  assert.strictEqual(F.categoriaDespesa({ tipo: "Consórcio" }), "desp_financeiro");
  assert.strictEqual(F.categoriaDespesa({ tipo: "Algo novo" }), "desp_outras");
  assert.strictEqual(F.categoriaDespesa({ tipo: "Condomínio", categoria: "desp_fixas" }), "desp_fixas");
  assert.strictEqual(F.categoriaReceita({ valor: 10 }), "rec_aluguel");
});

test("parcelas de aluguel do mês, sem duplicar e respeitando o início", () => {
  const n = F.planejarParcelas([proprio, terceiro], [], { mes: 11, ano: 2026 });
  assert.deepStrictEqual(n.map(p => [p.id, p.valor, p.vencimento]), [["c1_2026-11", 3000, "2026-11-30"], ["c2_2026-11", 2500, "2026-11-10"]]);
  assert.strictEqual(F.planejarParcelas([proprio], n, { mes: 11, ano: 2026 }).length, 0);
  assert.strictEqual(F.planejarParcelas([proprio], [], { mes: 10, ano: 2026 }).length, 0);
  assert.strictEqual(F.planejarParcelas([{ ...proprio, fim: "2026-11" }], [], { mes: 12, ano: 2026 }).length, 0);
});

test("comissão de venda parcelada fecha no centavo", () => {
  const p = F.parcelasVenda(venda);
  assert.strictEqual(p.length, 3);
  assert.strictEqual(Math.round(p.reduce((s, x) => s + x.valor, 0) * 100), 3000000);
  assert.deepStrictEqual(p.map(x => x.vencimento), ["2026-11-20", "2026-12-20", "2027-01-20"]);
});

test("baixa de imóvel próprio vira receita de aluguel", () => {
  const [p] = F.planejarParcelas([proprio], [], { mes: 11, ano: 2026 });
  const b = F.baixaParcela(p, proprio, { data: "2026-11-30", valor: 3000 });
  assert.deepStrictEqual(b.receitas.map(r => [r.categoria, r.valor]), [["rec_aluguel", 3000]]);
  assert.strictEqual(b.despesas.length, 0);
});

test("baixa de imóvel de terceiro separa taxa e repasse", () => {
  const [, p1] = F.planejarParcelas([proprio, terceiro], [], { mes: 11, ano: 2026 });
  // 1º mês: taxa da 1ª locação (50% do aluguel), não a de administração
  const b1 = F.baixaParcela(p1, terceiro, { data: "2026-11-10", valor: 2500 });
  assert.deepStrictEqual(b1.receitas.map(r => [r.categoria, r.valor]), [["ter_recebido", 2500], ["rec_1locacao", 1000]]);
  assert.deepStrictEqual(b1.despesas.map(d => [d.categoria, d.valor, d.dia_venc, d.mes]), [["ter_repasse", 1500, 15, 11]]);
  // mês seguinte: 10% de administração só sobre o aluguel; pagou depois do dia do repasse → repasse no mês seguinte
  const [p2] = F.planejarParcelas([terceiro], [], { mes: 12, ano: 2026 });
  const b2 = F.baixaParcela(p2, terceiro, { data: "2026-12-20", valor: 2500 });
  assert.deepStrictEqual(b2.receitas.map(r => [r.categoria, r.valor]), [["ter_recebido", 2500], ["rec_adm", 200]]);
  assert.deepStrictEqual(b2.despesas.map(d => [d.valor, d.mes, d.ano]), [[2300, 1, 2027]]);

  const receitas = [...b1.receitas, ...b2.receitas], despesas = [{ ...b1.despesas[0], status: "pago" }, b2.despesas[0]];
  assert.deepStrictEqual(F.contaTerceiros(receitas, despesas), { entradas: 5000, taxas: 1200, repassado: 1500, aRepassar: 2300, saldo: 2300 });
  const ex = F.extratoProprietario({ proprietarioId: "p1", receitas, despesas, ano: 2026, mes: 11 });
  assert.deepStrictEqual(ex.totais, { recebido: 2500, taxas: 1000, repasse: 1500, repassado: 1500, aRepassar: 0 });
});

test("venda gera comissão do corretor a pagar", () => {
  const [p] = F.parcelasVenda(venda);
  const b = F.baixaParcela(p, venda, { data: "2026-11-20", valor: p.valor });
  assert.deepStrictEqual(b.receitas.map(r => [r.categoria, r.valor]), [["rec_venda", 10000]]);
  assert.deepStrictEqual(b.despesas.map(d => [d.categoria, d.valor, d.corretor_id]), [["desp_corretor", 3000, "k1"]]);
  const c = F.comissoes([b.despesas[0]], [{ id: "k1", nome: "Ana" }]);
  assert.deepStrictEqual(c.map(x => [x.nome, x.aPagar, x.pago]), [["Ana", 3000, 0]]);
});

test("DRE deixa de fora dinheiro de terceiros e o que o inquilino paga", () => {
  const receitas = [
    { ano: 2026, mes: 11, valor: 3000 },
    { ano: 2026, mes: 11, valor: 2500, categoria: "ter_recebido", terceiros: true },
    { ano: 2026, mes: 11, valor: 250, categoria: "rec_adm", retida: true },
    { ano: 2026, mes: 11, valor: 10000, categoria: "rec_venda" },
  ];
  const despesas = [
    { ano: 2026, mes: 11, valor: 600, tipo: "Carnê Leão", status: "pago" },
    { ano: 2026, mes: 11, valor: 3000, tipo: "Comissão de corretor", categoria: "desp_corretor", status: "pendente" },
    { ano: 2026, mes: 11, valor: 800, tipo: "Condomínio", status: "pago" },
    { ano: 2026, mes: 11, valor: 900, tipo: "Condomínio", pago_por: "inquilino", status: "pendente" },
    { ano: 2026, mes: 11, valor: 2250, categoria: "ter_repasse", terceiros: true, status: "pendente" },
  ];
  const r = F.dre(receitas, despesas, { ano: 2026, mes: 11 });
  assert.strictEqual(r.totais.receitaBruta, 13250);
  assert.strictEqual(r.totais.impostos, 600);
  assert.strictEqual(r.totais.custos, 3000);
  assert.strictEqual(r.totais.operacionais, 800);
  assert.strictEqual(r.totais.resultado, 8850);
  assert.deepStrictEqual(r.receitaPorNat, { locacao: 3250, venda: 10000, outras: 0 });

  const fc = F.fluxoCaixa({ receitas, despesas, parcelas: [{ ano: 2026, mes: 11, valor: 1000, status: "pendente" }], ano: 2026 })[10];
  assert.deepStrictEqual([fc.entrou, fc.saiu, fc.aEntrar, fc.aSair], [13250, 1400, 1000, 3000]);
});

test("inadimplência por faixa de atraso", () => {
  const ps = [
    { id: "a", status: "pendente", vencimento: "2026-11-01", valor: 100 },
    { id: "b", status: "pendente", vencimento: "2026-08-01", valor: 200 },
    { id: "c", status: "pago", vencimento: "2026-08-01", valor: 999 },
    { id: "d", status: "pendente", vencimento: "2026-12-01", valor: 999 },
  ];
  const r = F.inadimplencia(ps, "2026-11-06");
  assert.deepStrictEqual(r.lista.map(p => [p.id, p.atraso]), [["b", 97], ["a", 5]]);
  assert.strictEqual(r.total, 300);
  assert.strictEqual(r.faixas.find(f => f.faixa === "mais de 90 dias").valor, 200);
});

test("receita lançada à mão é reconhecida na parcela", () => {
  const [p] = F.planejarParcelas([proprio], [], { mes: 11, ano: 2026 });
  assert.ok(F.receitaJaLancada(p, [{ id: "r1", imovel: "Lorena", mes: 11, ano: 2026, valor: 3000, origem: "extrato" }]));
  assert.strictEqual(F.receitaJaLancada(p, [{ id: "r1", imovel: "Lorena", mes: 10, ano: 2026, valor: 3000 }]), null);
});

test("contratos a partir dos imóveis alugados", () => {
  const im = [
    { nome: "Lorena", status: "ativo", inquilino: "João", aluguel: 3000, dia_vencimento: 5, empresa: "Explorer" },
    { nome: "Vago", status: "vago", aluguel: 1000 },
    { nome: "Paulista", status: "ativo", inquilino: "Maria", aluguel: 4000 },
  ];
  const c = F.contratosDosImoveis(im, [{ tipo: "locacao", imovel: "Paulista" }], { mes: 11, ano: 2026 });
  assert.deepStrictEqual(c.map(x => [x.imovel, x.cliente_nome, x.aluguel, x.inicio]), [["Lorena", "João", 3000, "2026-11"]]);
});
