const test = require("node:test");
const assert = require("node:assert");
const { planejarMes, somarMes } = require("../gerar-mes.js");

const im = [{ nome: "Apto 12" }, { nome: "Casa" }];
const desp = [
  { imovel: "Apto 12", tipo: "Condomínio", mes: 9, ano: 2026, valor: 800, dia_venc: 10, recorrente: true },
  { imovel: "Apto 12", tipo: "Condomínio", mes: 10, ano: 2026, valor: 850, dia_venc: 10, recorrente: true },
  { imovel: "Apto 12", tipo: "IPTU", mes: 10, ano: 2026, valor: 120, dia_venc: 15, recorrente: false },
  { imovel: "Casa", tipo: "IPTU", mes: 11, ano: 2026, valor: 300, dia_venc: 7, recorrente: true },
  { imovel: "Apagado", tipo: "Luz", mes: 10, ano: 2026, valor: 50, dia_venc: 7, recorrente: true },
];

test("cria a partir do modelo mais recente e não duplica", () => {
  const n = planejarMes(desp, im, { mes: 11, ano: 2026 });
  assert.deepStrictEqual(n.map(x => [x.imovel, x.tipo, x.valor]), [["Apto 12", "Condomínio", 850]]);
  assert.strictEqual(n[0].status, "pendente");
  assert.strictEqual(n[0].confirmar_valor, true);
});
test("mês seguinte inclui os dois imóveis", () => {
  const n = planejarMes(desp, im, { mes: 12, ano: 2026 });
  assert.deepStrictEqual(n.map(x => x.tipo).sort(), ["Condomínio", "IPTU"]);
});
test("virada de ano", () => assert.deepStrictEqual(somarMes({ mes: 12, ano: 2026 }, 1), { mes: 1, ano: 2027 }));
test("robô carrega as regras de parcelas do index.html", () => {
  const fs = require("fs"), path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const bloco = html.split("// === FINANCEIRO (início) ===")[1].split("// === FINANCEIRO (fim) ===")[0];
  const F = new Function("module", bloco + "\nreturn Financeiro;")({});
  assert.strictEqual(typeof F.planejarParcelas, "function");
});
test("despesa geral da empresa e categoria seguem no robô", () => {
  const n = planejarMes([{ imovel: "Geral", tipo: "Sistema", mes: 10, ano: 2026, valor: 99, recorrente: true, categoria: "desp_fixas" }], im, { mes: 11, ano: 2026 });
  assert.deepStrictEqual(n.map(x => [x.imovel, x.categoria]), [["Geral", "desp_fixas"]]);
});
