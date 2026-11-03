const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
// o código da conciliação mora dentro do index.html, entre os marcadores
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const bloco = html.split("// === CONCILIAÇÃO COM EXTRATO (início) ===")[1].split("// === CONCILIAÇÃO COM EXTRATO (fim) ===")[0];
const C = new Function("module", bloco + "\nreturn Conciliacao;")({});

const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261105120000[-3:BRT]<TRNAMT>3500.00<FITID>A1<MEMO>PIX RECEBIDO JOAO SILVA
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261110<TRNAMT>-850.00<FITID>A2<MEMO>PAGTO BOLETO COND ED SOL
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261112<TRNAMT>-99,90<FITID>A3<MEMO>TARIFA
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const CSV = `Extrato C6 Empresas
Período: 01/11/2026 a 30/11/2026
Data Lançamento;Data Contábil;Título;Descrição;Entrada(R$);Saída(R$);Saldo do Dia(R$)
05/11/2026;05/11/2026;Pix recebido;MARIA SOUZA;"2.800,00";;"10.000,00"
10/11/2026;10/11/2026;Pagamento de boleto;CONDOMINIO;;"850,00";"9.150,00"
`;

const base = {
  imoveis: [
    { nome: "Apto 12", inquilino: "João da Silva", aluguel: 3500, status: "ativo" },
    { nome: "Casa", inquilino: "Maria Souza", aluguel: 2800, status: "ativo" },
    { nome: "Sala", inquilino: "", aluguel: 0, status: "vago" },
  ],
  receitas: [],
  despesas: [
    { id: "d1", imovel: "Apto 12", tipo: "Condomínio", mes: 11, ano: 2026, dia_venc: 10, valor: 850, status: "pendente" },
    { id: "d2", imovel: "Casa", tipo: "IPTU", mes: 11, ano: 2026, dia_venc: 10, valor: 850, status: "pendente", pago_por: "inquilino" },
    { id: "d3", imovel: "Casa", tipo: "Luz", mes: 11, ano: 2026, dia_venc: 15, valor: 120, status: "pago" },
  ],
};

test("lê OFX", () => {
  const t = C.ler(OFX, "x.ofx");
  assert.deepStrictEqual(t.map(x => [x.id, x.data, x.valor]), [["ofx:A1", "2026-11-05", 3500], ["ofx:A2", "2026-11-10", -850], ["ofx:A3", "2026-11-12", -99.9]]);
});

test("lê CSV do C6 com entrada e saída separadas", () => {
  const t = C.ler(CSV, "extrato.csv");
  assert.deepStrictEqual(t.map(x => [x.data, x.valor]), [["2026-11-05", 2800], ["2026-11-10", -850]]);
  assert.match(t[0].desc, /MARIA SOUZA/);
});

test("CSV com coluna única de valor e sinal", () => {
  const t = C.ler("Data,Descrição,Valor\n2026-11-03,Pix João,\"1,234.50\"\n04/11/2026,Tarifa,-12.00\n");
  assert.deepStrictEqual(t.map(x => x.valor), [1234.5, -12]);
});

test("sugere aluguel pelo nome e valor, e despesa pelo valor exato", () => {
  const l = C.sugerir(C.ler(OFX, "x.ofx"), base);
  assert.strictEqual(l[0].sugestao, "rec:Apto 12");
  assert.strictEqual(l[1].sugestao, "desp:d1");          // d2 é paga pelo inquilino, d3 já paga
  assert.ok(!l[1].opcoes.some(o => o.chave === "desp:d2" || o.chave === "desp:d3"));
  assert.strictEqual(l[2].sugestao, "");                 // tarifa: nada a sugerir
});

test("não sugere de novo o que já foi conciliado nem aluguel já lançado", () => {
  const l = C.sugerir(C.ler(OFX, "x.ofx"), { ...base, receitas: [{ imovel: "Apto 12", mes: 11, ano: 2026, valor: 3500 }], despesas: [{ ...base.despesas[0], status: "pago", extrato_id: "ofx:A2" }] });
  assert.strictEqual(l[0].sugestao, "");
  assert.strictEqual(l[1].jaConciliado, true);
});

test("duas despesas iguais no mesmo dia: não chuta", () => {
  const d = [{ ...base.despesas[0] }, { ...base.despesas[0], id: "d9", imovel: "Casa" }];
  const l = C.sugerir(C.ler(OFX, "x.ofx"), { ...base, despesas: d });
  assert.strictEqual(l[1].sugestao, "");
  assert.strictEqual(l[1].opcoes.length, 2);
});
