# Mille Miglia – Gestão de Imóveis

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

## Robô do mês (`gerar-mes.js`)

Todo dia às 6h (Brasília) o GitHub Actions garante que o mês atual e o próximo já tenham as despesas recorrentes
lançadas, igual ao botão "🔄 Gerar meses": usa a despesa recorrente mais recente de cada imóvel + tipo como modelo,
cria como pendente com "confirmar valor" e nunca duplica.

Segredo necessário (Settings › Secrets and variables › Actions): `FIREBASE_SERVICE_ACCOUNT`, o JSON da conta de
serviço do Firebase (Configurações do projeto › Contas de serviço › Gerar nova chave privada).

Para testar sem criar nada: Actions › Robô do mês › Run workflow, com "Só simular" marcado.

## Testes

`npm test`
