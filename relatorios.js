// Relatórios por e-mail – PJ Gestão de Imóveis
// Substitui as funções do site Netlify "millemigliarelatorios", que pararam de funcionar
// quando o banco passou a exigir login (o Firestore respondia 403 desde 2026-11-03).
// Aqui o robô usa a conta de serviço do Firebase, como o Robô do mês, e não depende das regras.
//
//   TIPO=mensal    todo dia 15: resumo do mês anterior (receitas, despesas, resultado por imóvel),
//                  contas a pagar do mês atual e aluguéis em atraso.
//   TIPO=lembrete  todo dia: contas que vencem nos próximos dias ou já venceram (só manda se houver).
//
// Variáveis de ambiente:
//   FIREBASE_SERVICE_ACCOUNT  JSON da conta de serviço do Firebase
//   RESEND_API_KEY            chave do Resend (envio de e-mail)
//   RELATORIO_PARA            e-mail(s) de destino, separados por vírgula
//   RELATORIO_DE              (opcional) remetente, padrão "PJ Gestão de Imóveis <onboarding@resend.dev>"
//   MES / ANO                 (opcional, mensal) mês do resumo; padrão: mês anterior
//   DIAS_LEMBRETE             (opcional) quantos dias à frente o lembrete olha (padrão 3)
//   DRY_RUN=1                 só mostra o e-mail no log, sem enviar

const TZ = "America/Sao_Paulo";
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const pad = n => String(n).padStart(2, "0");
const r2 = n => Math.round(n * 100) / 100;
const brl = v => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function hojeSP(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function somarDias(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function ultimoDia(ano, mes) { return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); }
const vencDespesa = d => `${d.ano}-${pad(d.mes)}-${pad(Math.min(Number(d.dia_venc) || 1, ultimoDia(d.ano, d.mes)))}`;
const fmtData = iso => iso.split("-").reverse().join("/");

function carregarFinanceiro() {
  const fs = require("fs"), path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const bloco = html.split("// === FINANCEIRO (início) ===")[1].split("// === FINANCEIRO (fim) ===")[0];
  return new Function("module", bloco + "\nreturn Financeiro;")({});
}

function tabela(cab, linhas, rodape) {
  const th = cab.map((c, i) => `<th style="text-align:${i ? "right" : "left"};padding:6px 8px;border-bottom:2px solid #1a3a2a;font-size:13px">${esc(c)}</th>`).join("");
  const tr = l => `<tr>${l.map((c, i) => `<td style="text-align:${i ? "right" : "left"};padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:13px">${esc(c)}</td>`).join("")}</tr>`;
  const tf = rodape ? `<tr>${rodape.map((c, i) => `<td style="text-align:${i ? "right" : "left"};padding:6px 8px;font-weight:bold;font-size:13px">${esc(c)}</td>`).join("")}</tr>` : "";
  return `<table style="border-collapse:collapse;width:100%;margin:6px 0 18px">${th ? `<tr>${th}</tr>` : ""}${linhas.map(tr).join("")}${tf}</table>`;
}
const h2 = t => `<h2 style="font-size:16px;color:#1a3a2a;margin:22px 0 4px">${esc(t)}</h2>`;
const p = t => `<p style="font-size:13px;color:#555;margin:4px 0 12px">${t}</p>`;
const moldura = (titulo, corpo) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:auto;color:#222">
<h1 style="font-size:20px;color:#1a3a2a;margin:0 0 4px">${esc(titulo)}</h1>${corpo}
<p style="font-size:12px;color:#888;margin-top:28px">PJ Gestão de Imóveis · <a href="https://imoveisfinanceiro.netlify.app">abrir o app</a></p></div>`;

// Contas a pagar da empresa (fora as pagas pelo inquilino e o dinheiro de terceiros)
const aPagar = (F, despesas) => despesas.filter(d => d.status !== "pago" && F.despesaDaEmpresa(d));

function montarMensal({ F, receitas, despesas, parcelas, mes, ano, hoje }) {
  const doMes = x => x.ano === ano && x.mes === mes;
  const recMes = receitas.filter(r => doMes(r) && !F.ehTerceiros(r, false));
  const despMes = despesas.filter(d => doMes(d) && F.despesaDaEmpresa(d));
  const porImovel = {};
  for (const r of recMes) (porImovel[r.imovel || "Geral"] ??= { rec: 0, desp: 0 }).rec += Number(r.valor || 0);
  for (const d of despMes) (porImovel[d.imovel || "Geral"] ??= { rec: 0, desp: 0 }).desp += Number(d.valor || 0);
  const linhasIm = Object.entries(porImovel).sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([im, v]) => [im, brl(v.rec), brl(v.desp), brl(v.rec - v.desp)]);
  const totRec = r2(recMes.reduce((s, r) => s + Number(r.valor || 0), 0));
  const totDesp = r2(despMes.reduce((s, d) => s + Number(d.valor || 0), 0));
  const pagas = r2(despMes.filter(d => d.status === "pago").reduce((s, d) => s + Number(d.valor || 0), 0));
  const dre = F.dre(receitas, despesas, { ano, mes }).totais;

  const [ha, hm] = hoje.split("-").map(Number);
  const pend = aPagar(F, despesas).filter(d => d.ano < ha || (d.ano === ha && d.mes <= hm))
    .map(d => ({ ...d, venc: vencDespesa(d) })).sort((a, b) => a.venc.localeCompare(b.venc));
  const totPend = r2(pend.reduce((s, d) => s + Number(d.valor || 0), 0));
  const inad = F.inadimplencia(parcelas, hoje);

  const nomeMes = `${MESES[mes - 1]} de ${ano}`;
  let corpo = p(`Resumo de <b>${nomeMes}</b> e o que está em aberto até hoje (${fmtData(hoje)}).`);
  corpo += h2(`Resultado de ${nomeMes}`);
  corpo += tabela(["", "Valor"], [
    ["Receitas", brl(totRec)],
    ["Despesas da empresa", brl(totDesp)],
    ["  pagas", brl(pagas)],
    ["  ainda em aberto", brl(totDesp - pagas)],
  ], ["Resultado (receitas − despesas)", brl(totRec - totDesp)]);
  if (dre.margem !== null) corpo += p(`Resultado da DRE: ${brl(dre.resultado)} (margem ${String(dre.margem).replace(".", ",")}%).`);
  corpo += h2("Por imóvel");
  corpo += linhasIm.length ? tabela(["Imóvel", "Receitas", "Despesas", "Resultado"], linhasIm) : p("Nenhum lançamento no mês.");
  corpo += h2(`Contas a pagar em aberto (${pend.length})`);
  corpo += pend.length
    ? tabela(["Conta", "Vencimento", "Valor"], pend.map(d => [`${d.tipo} – ${d.imovel}`, fmtData(d.venc) + (d.venc < hoje ? " ⚠ vencida" : ""), brl(d.valor)]), ["Total", "", brl(totPend)])
    : p("Nenhuma conta em aberto. 🎉");
  if (inad.lista.length) {
    corpo += h2(`Aluguéis em atraso (${inad.lista.length})`);
    corpo += tabela(["Parcela", "Atraso", "Valor"], inad.lista.map(x => [`${x.descricao || "Parcela"} – ${x.imovel || ""}`, `${x.atraso} dia(s)`, brl(x.valor)]), ["Total", "", brl(inad.total)]);
  }
  const assunto = `Relatório mensal – ${nomeMes} (resultado ${brl(totRec - totDesp)})`;
  return { assunto, html: moldura(`Relatório de ${nomeMes}`, corpo), resumo: { totRec, totDesp, pendentes: pend.length, atrasados: inad.lista.length } };
}

function montarLembrete({ F, despesas, parcelas, hoje, dias = 3 }) {
  const ate = somarDias(hoje, dias);
  const abertas = aPagar(F, despesas).map(d => ({ ...d, venc: vencDespesa(d) }));
  const vencidas = abertas.filter(d => d.venc < hoje).sort((a, b) => a.venc.localeCompare(b.venc));
  const proximas = abertas.filter(d => d.venc >= hoje && d.venc <= ate).sort((a, b) => a.venc.localeCompare(b.venc));
  const inad = F.inadimplencia(parcelas, hoje);
  if (!vencidas.length && !proximas.length && !inad.lista.length) return null;
  const linha = d => [`${d.tipo} – ${d.imovel}`, fmtData(d.venc) + (d.venc === hoje ? " (hoje)" : ""), brl(d.valor)];
  let corpo = "";
  if (proximas.length) corpo += h2(`Vencem até ${fmtData(ate)} (${proximas.length})`) + tabela(["Conta", "Vencimento", "Valor"], proximas.map(linha));
  if (vencidas.length) corpo += h2(`Já vencidas e não marcadas como pagas (${vencidas.length})`) + tabela(["Conta", "Vencimento", "Valor"], vencidas.map(linha));
  if (inad.lista.length) corpo += h2(`Aluguéis em atraso (${inad.lista.length})`) + tabela(["Parcela", "Atraso", "Valor"], inad.lista.map(x => [`${x.descricao || "Parcela"} – ${x.imovel || ""}`, `${x.atraso} dia(s)`, brl(x.valor)]));
  corpo += p("Se alguma já foi paga, marque como paga no app para sair deste lembrete.");
  const partes = [];
  if (proximas.length) partes.push(`${proximas.length} a vencer`);
  if (vencidas.length) partes.push(`${vencidas.length} vencida(s)`);
  if (inad.lista.length) partes.push(`${inad.lista.length} aluguel(is) em atraso`);
  return { assunto: `Lembrete de vencimentos – ${partes.join(", ")}`, html: moldura("Lembrete de vencimentos", corpo) };
}

async function enviar({ assunto, html }) {
  const para = (process.env.RELATORIO_PARA || "").split(/[,;\s]+/).filter(Boolean);
  if (!para.length) throw new Error("Falta o segredo RELATORIO_PARA (e-mail de destino).");
  if (!process.env.RESEND_API_KEY) throw new Error("Falta o segredo RESEND_API_KEY.");
  const de = process.env.RELATORIO_DE || "PJ Gestão de Imóveis <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: de, to: para, subject: assunto, html }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Resend respondeu ${r.status}: ${txt}`);
  console.log(`E-mail enviado para ${para.length} destinatário(s): ${txt}`);
}

async function main() {
  const tipo = (process.env.TIPO || "mensal").trim();
  const dry = process.env.DRY_RUN === "1";
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Falta o segredo FIREBASE_SERVICE_ACCOUNT.");
  const admin = require("firebase-admin");
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT.trim())) });
  const db = admin.firestore();
  const ler = async c => (await db.collection(c).get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const [receitas, despesas, parcelas] = await Promise.all([ler("receitas"), ler("despesas"), ler("parcelas")]);
  const F = carregarFinanceiro();
  const hoje = hojeSP();

  let email;
  if (tipo === "mensal") {
    const [ha, hm] = hoje.split("-").map(Number);
    const ant = F.somarMes({ mes: hm, ano: ha }, -1);
    const mes = Number(process.env.MES) || ant.mes, ano = Number(process.env.ANO) || ant.ano;
    email = montarMensal({ F, receitas, despesas, parcelas, mes, ano, hoje });
  } else if (tipo === "lembrete") {
    email = montarLembrete({ F, despesas, parcelas, hoje, dias: Number(process.env.DIAS_LEMBRETE) || 3 });
    if (!email) { console.log("Nada vencendo nem atrasado. Nenhum e-mail enviado."); return; }
  } else throw new Error(`TIPO desconhecido: ${tipo}`);

  console.log(`Assunto: ${email.assunto}`);
  if (dry) { console.log("Simulação: e-mail não enviado.\n" + email.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")); return; }
  await enviar(email);
}

module.exports = { montarMensal, montarLembrete, vencDespesa, somarDias, carregarFinanceiro };
if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
