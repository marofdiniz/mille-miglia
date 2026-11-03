// Robô do mês – Mille Miglia
// Roda todo dia (GitHub Actions) e garante que o mês atual e o próximo já tenham
// as despesas recorrentes lançadas (condomínio, IPTU, carnê leão...).
// É o mesmo que o botão "🔄 Gerar meses" do app faz, só que sozinho:
//   - pega as despesas marcadas como recorrentes e usa a mais recente de cada
//     imóvel + tipo como modelo (valor, dia do vencimento, quem paga);
//   - cria a despesa do mês como "pendente" e com "confirmar valor" ligado;
//   - nunca duplica: se já existe despesa daquele imóvel + tipo no mês, pula.
// Os aluguéis não são criados aqui: eles entram como receita quando o dinheiro
// cai (pela conferência do extrato no app).
//
// Variáveis de ambiente:
//   FIREBASE_SERVICE_ACCOUNT  JSON da conta de serviço do Firebase (projeto mille-miglia-32367)
//   MESES_A_FRENTE            (opcional) quantos meses além do atual garantir (padrão 1)
//   DRY_RUN=1                 só mostra o que criaria, sem gravar nada

const TZ = "America/Sao_Paulo";

function mesAtualSP(now = new Date()) {
  const [ano, mes] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" })
    .format(now).split("-").map(Number);
  return { mes, ano };
}

function somarMes({ mes, ano }, n) {
  const t = ano * 12 + (mes - 1) + n;
  return { mes: (t % 12) + 1, ano: Math.floor(t / 12) };
}

// Modelo de cada imóvel + tipo: a despesa recorrente mais recente.
function modelosRecorrentes(despesas) {
  const base = {};
  for (const d of despesas) {
    if (!d.recorrente) continue;
    const k = `${d.imovel}||${d.tipo}`;
    const e = base[k];
    if (!e || d.ano > e.ano || (d.ano === e.ano && d.mes > e.mes)) base[k] = d;
  }
  return Object.values(base);
}

// Lista as despesas que faltam criar no mês/ano (mesma regra do botão do app).
function planejarMes(despesas, imoveis, { mes, ano }) {
  // imóvel apagado do app não gera mais despesa
  const existentes = new Set(imoveis.map(i => i.nome));
  const novas = [];
  for (const r of modelosRecorrentes(despesas)) {
    if (imoveis.length && !existentes.has(r.imovel)) continue;
    // o modelo não pode ser de um mês depois do alvo
    if (r.ano > ano || (r.ano === ano && r.mes >= mes)) continue;
    const existe = despesas.some(d => d.imovel === r.imovel && d.tipo === r.tipo && d.mes === mes && d.ano === ano);
    if (existe) continue;
    novas.push({
      imovel: r.imovel, tipo: r.tipo, mes, ano,
      dia_venc: Number(r.dia_venc) || 1,
      valor: Number(r.valor) || 0,
      status: "pendente",
      pago_por: r.pago_por || "proprietario",
      recorrente: false,
      confirmar_valor: true,
      criado_por: "robo",
    });
  }
  return novas;
}

async function main() {
  const dry = process.env.DRY_RUN === "1";
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Falta o segredo FIREBASE_SERVICE_ACCOUNT.");
  const admin = require("firebase-admin");
  let conta;
  try { conta = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT.trim()); }
  catch { throw new Error("O segredo FIREBASE_SERVICE_ACCOUNT não é um JSON válido. Abra o arquivo baixado do Firebase no Bloco de Notas e cole o conteúdo inteiro, começando em { e terminando em }."); }
  admin.initializeApp({ credential: admin.credential.cert(conta) });
  const db = admin.firestore();

  const [despSnap, imSnap] = await Promise.all([db.collection("despesas").get(), db.collection("imoveis").get()]);
  const despesas = despSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const imoveis = imSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const aFrente = Math.max(0, parseInt(process.env.MESES_A_FRENTE ?? "1") || 0);
  const hoje = mesAtualSP();
  let total = 0;
  for (let i = 0; i <= aFrente; i++) {
    const alvo = somarMes(hoje, i);
    const novas = planejarMes(despesas, imoveis, alvo);
    console.log(`${String(alvo.mes).padStart(2, "0")}/${alvo.ano}: ${novas.length} despesa(s) a criar`);
    for (const n of novas) {
      console.log(`  • ${n.tipo} – ${n.imovel} – dia ${n.dia_venc} – R$ ${n.valor.toFixed(2)}`);
      if (!dry) await db.collection("despesas").add({ ...n, criado_em: admin.firestore.FieldValue.serverTimestamp() });
      despesas.push(n);
      total++;
    }
  }
  console.log(dry ? `Simulação: criaria ${total} despesa(s).` : `Pronto: ${total} despesa(s) criada(s).`);
}

module.exports = { planejarMes, modelosRecorrentes, somarMes };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
