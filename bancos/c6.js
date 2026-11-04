// Banco C6 – boleto com Pix (bolecode) pela API do C6 Bank.
// As credenciais de cada empresa ficam em segredos do GitHub, com o nome da empresa em maiúsculas:
//   C6_<EMPRESA>_CLIENT_ID, C6_<EMPRESA>_CLIENT_SECRET, C6_<EMPRESA>_CERT, C6_<EMPRESA>_KEY
// ex.: C6_EXPLORER_CLIENT_ID
//
// PENDENTE: os endereços e campos exatos da API só aparecem no portal developers.c6bank.com.br
// depois do login da empresa. Assim que a Explorer ativar as APIs, preencher emitir/consultar/cancelar.
// Enquanto isso, em simulação (DRY_RUN=1) o robô roda sem falar com o banco.

function criar(empresa, { dry }) {
  const chave = "C6_" + String(empresa).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const cred = ["CLIENT_ID", "CLIENT_SECRET", "CERT", "KEY"].map(k => [k, process.env[`${chave}_${k}`]]);
  const faltam = cred.filter(([, v]) => !v).map(([k]) => `${chave}_${k}`);
  const pronto = () => {
    if (faltam.length) throw new Error(`Faltam os segredos ${faltam.join(", ")} para cobrar pela ${empresa} no C6.`);
    throw new Error("Integração com a API do C6 ainda não implementada (aguardando a documentação do portal do C6).");
  };
  return {
    async emitir(c) { if (dry) return { id: "simulado" }; return pronto(); },
    async consultar(c) { if (dry) return { status: "aberto" }; return pronto(); },
    async cancelar(c) { if (dry) return; return pronto(); },
  };
}
module.exports = { criar };
