// Cobrança automática do aluguel – PJ Gestão de Imóveis
// Roda algumas vezes por dia (GitHub Actions). A cada rodada:
//   1. Confere no banco as cobranças em aberto. As pagas viram receita do imóvel no mês
//      (o aluguel entra sozinho, sem ninguém lançar).
//   2. Cancela cobranças que não fazem mais sentido (imóvel saiu da cobrança automática,
//      aluguel já lançado por outro meio, ou o valor do aluguel mudou).
//   3. Gera boleto com Pix para os imóveis com "cobrança automática" ligada, DIAS_ANTES dias
//      antes do vencimento, pela conta da empresa dona do imóvel.
// Tudo fica em Firestore, coleção "cobrancas" (um documento por imóvel e mês). O app lê de lá
// a linha digitável e o Pix copia e cola para mandar ao inquilino.
//
// Cada empresa tem o seu banco. Hoje: Explorer e Mille Miglia → C6 (bancos/c6.js).
//
// Variáveis de ambiente:
//   FIREBASE_SERVICE_ACCOUNT  JSON da conta de serviço do Firebase
//   EMPRESAS                  quais empresas cobrar e por qual banco, ex.: "Explorer=c6,Mille Miglia=c6"
//   C6_<EMPRESA>_CLIENT_ID/_CLIENT_SECRET/_CERT/_KEY/_PIX_CHAVE
//                             credenciais da API do C6 de cada empresa (ver bancos/c6.js)
//   C6_AMBIENTE               sandbox (padrão) ou producao
//   DIAS_ANTES                (opcional) quantos dias antes do vencimento gerar (padrão 10)
//   MULTA_PERCENTUAL          (opcional) multa por atraso em %, ex.: 2
//   JUROS_MES_PERCENTUAL      (opcional) juros ao mês em %, ex.: 1
//   DRY_RUN=1                 só mostra o que faria, sem falar com o banco nem gravar nada

const TZ = "America/Sao_Paulo";
const digits = s => String(s || "").replace(/\D/g, "");
const round2 = v => Math.round((Number(v) || 0) * 100) / 100;
const pad = n => String(n).padStart(2, "0");

function hojeSP(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function somarDias(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
function vencimentoDe(im, mes, ano) {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${pad(mes)}-${pad(Math.min(parseInt(im.dia_vencimento) || 5, ultimo))}`;
}
const idCobranca = (im, mes, ano) => `${im.id}_${ano}-${pad(mes)}`;

// O que falta no cadastro para conseguir emitir o boleto.
function faltando(im) {
  const f = [];
  if (!im.empresa) f.push("empresa");
  if (!im.inquilino) f.push("nome do inquilino");
  if (![11, 14].includes(digits(im.inquilino_doc).length)) f.push("CPF/CNPJ");
  if (!(Number(im.aluguel) > 0)) f.push("valor do aluguel");
  if (digits(im.cep).length !== 8) f.push("CEP");
  if (!im.bairro) f.push("bairro");
  if (!im.cidade || String(im.uf || "").length !== 2) f.push("cidade/UF");
  if (!im.endereco) f.push("endereço");
  return f;
}

// Decide o que fazer nesta rodada. Não fala com banco nem banco de dados: só planeja.
//   empresas: { "Explorer": "c6" }
function planejar({ imoveis, cobrancas, receitas, hoje, diasAntes = 10, empresas }) {
  const criar = [], cancelar = [], pulados = [];
  const porId = Object.fromEntries(cobrancas.map(c => [c.id, c]));
  const temReceita = (im, mes, ano) => receitas.some(r => r.imovel === im.nome && r.mes === mes && r.ano === ano && r.origem !== "cobranca");

  // cancelamentos
  for (const c of cobrancas) {
    if (c.status !== "aberto") continue;
    const im = imoveis.find(i => i.id === c.imovelId);
    let motivo = "";
    if (!im) motivo = "imóvel apagado";
    else if (!im.cobranca_auto) motivo = "cobrança automática desligada";
    else if (temReceita(im, c.mes, c.ano)) motivo = "aluguel já lançado por outro meio";
    else if (round2(im.aluguel) !== round2(c.valor)) motivo = "valor do aluguel mudou";
    if (motivo) cancelar.push({ ...c, motivo });
  }
  const cancelados = new Set(cancelar.map(c => c.id));

  // novas cobranças: mês atual e próximo
  const limite = somarDias(hoje, diasAntes);
  const [ya, ma] = hoje.split("-").map(Number);
  const meses = [{ mes: ma, ano: ya }, ma === 12 ? { mes: 1, ano: ya + 1 } : { mes: ma + 1, ano: ya }];
  for (const im of imoveis) {
    if (!im.cobranca_auto || im.status === "vago" || im.status === "proprio") continue;
    const banco = empresas[im.empresa];
    if (!banco) { pulados.push({ imovel: im.nome, motivo: `empresa "${im.empresa || "—"}" sem banco configurado` }); continue; }
    const f = faltando(im);
    if (f.length) { pulados.push({ imovel: im.nome, motivo: "falta " + f.join(", ") }); continue; }
    for (const { mes, ano } of meses) {
      const venc = vencimentoDe(im, mes, ano);
      if (venc < hoje || venc > limite) continue;
      const id = idCobranca(im, mes, ano);
      const existente = porId[id];
      if (existente && !(existente.status === "aberto" && cancelados.has(id)) && existente.status !== "cancelado") continue;
      if (temReceita(im, mes, ano)) continue;
      criar.push({
        id, imovelId: im.id, imovel: im.nome, empresa: im.empresa, banco, mes, ano,
        vencimento: venc, valor: round2(im.aluguel),
        pagador: {
          nome: im.inquilino, documento: digits(im.inquilino_doc),
          endereco: im.endereco, bairro: im.bairro, cep: digits(im.cep), cidade: im.cidade, uf: String(im.uf).toUpperCase(),
          email: im.inquilino_email || "", whatsapp: digits(im.inquilino_whatsapp),
        },
        // identificador nosso no banco (até 15 caracteres): AAMM + 8 primeiros do id do imóvel
        seuNumero: `${String(ano).slice(2)}${pad(mes)}${String(im.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 8)}`.toUpperCase(),
        descricao: `Aluguel ${pad(mes)}/${ano} - ${im.nome}`,
      });
    }
  }
  return { criar, cancelar, pulados };
}

// Receita que entra quando o banco confirma o pagamento.
function receitaDoPagamento(c, pagamento) {
  return {
    imovel: c.imovel, mes: c.mes, ano: c.ano,
    valor: round2(pagamento.valorPago || c.valor),
    recebido_em: pagamento.pagoEm || "", origem: "cobranca", cobranca_id: c.id,
  };
}

async function main() {
  const dry = process.env.DRY_RUN === "1";
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Falta o segredo FIREBASE_SERVICE_ACCOUNT.");
  const admin = require("firebase-admin");
  let conta;
  try { conta = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT.trim()); }
  catch { throw new Error("O segredo FIREBASE_SERVICE_ACCOUNT não é um JSON válido."); }
  admin.initializeApp({ credential: admin.credential.cert(conta) });
  const db = admin.firestore();

  const empresas = Object.fromEntries(String(process.env.EMPRESAS || "").split(",").map(s => s.trim()).filter(Boolean)
    .map(p => p.split("=").map(x => x.trim())));
  const bancos = {};
  const bancoDe = (empresa, nome) => {
    const k = `${nome}:${empresa}`;
    if (!bancos[k]) bancos[k] = require(`./bancos/${nome}.js`).criar(empresa, { dry, multa: process.env.MULTA_PERCENTUAL, juros: process.env.JUROS_MES_PERCENTUAL });
    return bancos[k];
  };

  const [imS, cobS, recS] = await Promise.all(["imoveis", "cobrancas", "receitas"].map(c => db.collection(c).get()));
  const imoveis = imS.docs.map(d => ({ id: d.id, ...d.data() }));
  const cobrancas = cobS.docs.map(d => ({ id: d.id, ...d.data() }));
  const receitas = recS.docs.map(d => ({ id: d.id, ...d.data() }));
  const hoje = hojeSP();
  console.log(`Hoje ${hoje}. Empresas com cobrança: ${Object.entries(empresas).map(([e, b]) => `${e} (${b})`).join(", ") || "nenhuma"}`);

  // 1. conferir as abertas
  let pagas = 0;
  for (const c of cobrancas.filter(c => c.status === "aberto" && c.bancoId)) {
    const banco = bancoDe(c.empresa, c.banco);
    const r = await banco.consultar(c);
    if (r.status === "pago") {
      pagas++;
      console.log(`  ✓ paga: ${c.descricao} (${r.valorPago})`);
      if (!dry) {
        await db.collection("receitas").add(receitaDoPagamento(c, r));
        await db.collection("cobrancas").doc(c.id).update({ status: "pago", pagoEm: r.pagoEm || hoje, valorPago: r.valorPago || c.valor });
      }
      c.status = "pago";
    } else if (r.status === "cancelado" || r.status === "expirado") {
      if (!dry) await db.collection("cobrancas").doc(c.id).update({ status: r.status });
      c.status = r.status;
    }
  }

  // 2 e 3. planejar cancelamentos e novas
  const plano = planejar({ imoveis, cobrancas, receitas, hoje, diasAntes: parseInt(process.env.DIAS_ANTES || "10") || 10, empresas });
  for (const p of plano.pulados) console.log(`  – pulei ${p.imovel}: ${p.motivo}`);
  const adiadas = new Set(); // cancelamento que o banco ainda não aceitou: não gerar outro no lugar
  for (const c of plano.cancelar) {
    console.log(`  ✗ cancelar ${c.descricao}: ${c.motivo}`);
    if (!dry) {
      if (c.bancoId) {
        const r = await bancoDe(c.empresa, c.banco).cancelar(c, c.motivo);
        if (r && r.cancelado === false) { console.log(`    (o banco ainda não deixou cancelar: ${r.motivo}; tento na próxima rodada)`); adiadas.add(c.id); continue; }
      }
      await db.collection("cobrancas").doc(c.id).update({ status: "cancelado", motivo: c.motivo });
    }
  }
  for (const n of plano.criar) {
    if (adiadas.has(n.id)) { console.log(`  … ${n.descricao}: espero o boleto antigo ser cancelado para gerar o novo`); continue; }
    console.log(`  + gerar ${n.descricao} · vence ${n.vencimento} · R$ ${n.valor.toFixed(2)} · ${n.empresa}/${n.banco}`);
    if (dry) continue;
    const r = await bancoDe(n.empresa, n.banco).emitir(n);
    await db.collection("cobrancas").doc(n.id).set({
      ...n, status: "aberto", bancoId: r.id, linhaDigitavel: r.linhaDigitavel || "", pixCopiaECola: r.pixCopiaECola || "",
      codigoBarras: r.codigoBarras || "", nossoNumero: r.nossoNumero || "",
      pdf: r.pdf || "", criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  console.log(`${dry ? "Simulação: " : ""}${pagas} paga(s), ${plano.cancelar.length} cancelada(s), ${plano.criar.length} nova(s).`);
}

module.exports = { planejar, receitaDoPagamento, faltando, vencimentoDe };
if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
