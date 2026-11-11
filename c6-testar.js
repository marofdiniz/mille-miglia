// Teste de conexão com a API do C6, sem gerar nada.
// Para cada empresa: faz o login (mTLS + client_credentials), mostra as permissões (escopos)
// da chave e consulta o extrato dos últimos 7 dias, só para ver se a chamada passa.
// Nunca imprime segredo nem token.
//   EMPRESAS="Explorer,Mille Miglia"  C6_AMBIENTE=sandbox|producao
const { cliente } = require("./bancos/c6.js");

const ymd = d => d.toISOString().slice(0, 10);

async function testar(empresa) {
  console.log(`\n== ${empresa} ==`);
  let c;
  try { c = cliente(empresa); }
  catch (e) { console.log(`  ✗ ${e.message}`); return false; }
  console.log(`  Ambiente: ${c.ambiente} (${c.host}) · credenciais: ${c.origem}_*`);
  try {
    const t = await c.token();
    console.log("  ✓ Login ok");
    const escopos = t.scope.split(/\s+/).filter(Boolean);
    const cobranca = escopos.filter(s => /bankslip|pix|cob/i.test(s));
    console.log(`  Permissões de cobrança: ${cobranca.join(", ") || "nenhuma (pedir ao C6 boleto/Pix)"}`);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    if (e.detalhe) console.log("    Resposta do C6:", typeof e.detalhe === "string" ? e.detalhe : JSON.stringify(e.detalhe));
    return false;
  }
  const fim = new Date(), ini = new Date(Date.now() - 7 * 864e5);
  const r = await c.chamar("GET", `/v1/statement/?start_date=${ymd(ini)}&end_date=${ymd(fim)}`);
  if (r.status === 200) console.log(`  ✓ Extrato ok (${(r.json?.entries || []).length} lançamento(s) nos últimos 7 dias)`);
  else console.log(`  ! Extrato respondeu HTTP ${r.status} (o login funcionou; isso só importa para a conferência automática)`);
  return true;
}

async function main() {
  const empresas = String(process.env.EMPRESAS || "Explorer,Mille Miglia").split(",").map(s => s.trim()).filter(Boolean);
  let ok = true;
  for (const e of empresas) ok = (await testar(e)) && ok;
  console.log(ok ? "\nTudo certo." : "\nAlguma empresa falhou (veja acima).");
  if (!ok) process.exit(1);
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
