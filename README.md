# PJ Gestão de Imóveis

App em um arquivo só (`index.html`) com dados no Firebase (projeto `mille-miglia-32367`).

## Login

O app agora pede e-mail e senha (Firebase Authentication). Cada pessoa tem o seu acesso.
As regras em `firestore.rules` e `storage.rules` fazem o banco só aceitar quem fez login.

Ordem para ligar sem ninguém ficar trancado para fora:

1. Firebase › Authentication › Sign-in method: ligar **E-mail/senha**.
2. Authentication › Users › Add user: criar um usuário para cada pessoa (Marô, financeiro, …).
3. Publicar este `index.html` no lugar do antigo e testar o login.
4. Só então colar as regras: Firestore › Rules (conteúdo de `firestore.rules`) e Storage › Rules (conteúdo de `storage.rules`) › Publicar.

## Conferir extrato (botão 🏦 em Receitas e Despesas)

Suba o extrato do C6 em OFX ou CSV. O app:

- reconhece os **aluguéis que entraram** pelo nome do inquilino e pelo valor do aluguel e cria a receita do mês;
- reconhece as **contas pagas** pelo valor e pela data perto do vencimento e marca a despesa como paga
  (despesas pagas pelo inquilino ficam de fora);
- mostra tudo numa lista para conferir. O que não reconheceu fica como "Ignorar" e dá para escolher à mão;
- guarda o código de cada movimentação (`extrato_id`), então subir o mesmo extrato de novo não lança duas vezes.

Se o valor pago for diferente do previsto, a despesa passa a ter o valor pago e guarda o previsto em `valor_previsto`.

## Financeiro de imobiliária

Tudo fica no mesmo Firebase. Os dados antigos continuam valendo: nada foi apagado nem convertido.

- **Plano de contas por natureza** (Relatórios › DRE › Plano de contas). Receitas: aluguel próprio, taxa de administração,
  taxa da 1ª locação, comissão de venda, vistoria/laudos, outras. Despesas: impostos, comissão de corretores, marketing/portais,
  fixas, custos dos imóveis, financeiro, outras. Lançamentos antigos sem categoria são classificados pelo tipo
  (Condomínio → custos dos imóveis, Carnê Leão → impostos...). Dá para escolher a conta ao lançar ou editar.
- **Cadastros** (aba Contratos): pessoas (proprietário, inquilino, comprador, corretor) e contratos.
  O botão "📥 Trazer aluguéis dos imóveis" cria um contrato para cada imóvel alugado que ainda não tem.
- **Contas a receber** (Contas › A receber): cada contrato de locação gera a parcela do mês (aluguel + encargos cobrados junto)
  e cada venda gera a comissão, que pode ser parcelada. "Receber" dá baixa; "Vincular" usa uma receita que já tinha sido
  lançada (extrato ou robô de cobrança) para não contar duas vezes. O "Conferir extrato" também reconhece parcelas.
- **Conta de terceiros** (Contas › Terceiros): em imóvel de terceiro o aluguel entra como dinheiro do proprietário, a taxa
  vira receita da empresa e o resto vira um repasse a pagar. Esse dinheiro fica fora do Início, das Receitas/Despesas, do DRE
  e do fluxo de caixa.
- **Venda**: ao receber cada parcela da comissão, a parte do corretor vira uma comissão a pagar.
- **Relatórios**: fluxo de caixa (realizado e previsto), DRE mensal ou anual, extrato do proprietário, inadimplência por
  faixa de atraso e comissões a pagar por corretor. Todos imprimem/salvam em PDF.

Coleções novas no Firestore: `pessoas`, `contratos`, `parcelas` (id `<contrato>_AAAA-MM` para aluguel e `<contrato>_pN` para venda).
As regras atuais já cobrem (qualquer coleção, só com login).

## Robô do mês (`gerar-mes.js`)

Todo dia às 6h (Brasília) o GitHub Actions garante que o mês atual e o próximo já tenham as despesas recorrentes
lançadas, igual ao botão "🔄 Gerar meses": usa a despesa recorrente mais recente de cada imóvel + tipo como modelo,
cria como pendente com "confirmar valor" e nunca duplica. Também cria as parcelas a receber dos contratos de locação
desses meses (mesma regra do botão "🔄 Gerar parcelas", lida do próprio `index.html`).

Segredo necessário (Settings › Secrets and variables › Actions): `FIREBASE_SERVICE_ACCOUNT`, o JSON da conta de
serviço do Firebase (Configurações do projeto › Contas de serviço › Gerar nova chave privada).

Para testar sem criar nada: Actions › Robô do mês › Run workflow, com "Só simular" marcado.

## Testes

`npm test`
