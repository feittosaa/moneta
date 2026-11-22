<p align="center">
  <img src="docs/logo.png" alt="Logo da Moneta: perfil de uma figura clássica com coroa de louros, dentro de um círculo, como em uma moeda" width="160">
</p>

<h1 align="center">Moneta</h1>

Moneta é um painel de finanças pessoais que roda no seu computador ou celular Android. Ela se conecta aos seus bancos, cartões e corretoras por meio da [Pluggy](https://pluggy.ai), uma plataforma de Open Finance, e guarda tudo num banco local cifrado. Assim você acompanha receitas, despesas, faturas e patrimônio sem enviar seus dados a um serviço de terceiros além da própria Pluggy.

<p align="center">
  <a href="https://github.com/feittosaa/moneta/releases/latest/download/Moneta-Setup.exe"><b>⬇ Baixar para Windows</b></a>
  &nbsp;·&nbsp;
  <a href="#linux"><b>Instalar no Linux</b></a>
  &nbsp;·&nbsp;
  <a href="https://feittosaa.github.io/moneta/"><b>Abrir no iPhone e iPad</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/feittosaa/moneta/releases/latest/download/Moneta-Android-arm64.apk"><b>⬇ Baixar para Android</b></a>
</p>

- **Local e de usuário único:** o painel escuta apenas em `127.0.0.1` e não tem contas de usuário. O banco fica cifrado em disco, com backups diários testados.
- **Janela própria:** abre como um aplicativo, sem navegador e, no Windows, sem terminal. Fechado, continua sincronizando em segundo plano.
- **Sem dependências no servidor:** usa só Node.js 22 (servidor HTTP e `node:sqlite` nativos) e HTML, CSS e JavaScript puros na interface. A janela é feita com [Tauri](https://tauri.app).
- **Interface em português**, com valores em várias moedas mantidos separados.

> **Primeira vez?** Instale pelo link acima e siga o [Guia de conexão](docs/guia/conectar-bancos.md): ele mostra, passo a passo e com imagens, como criar as contas gratuitas na Pluggy e conectar seus bancos. Não é preciso saber programar. O mesmo guia abre dentro da Moneta, no menu **Guia**.
>
> **No celular?** Siga o guia de instalação e uso para [Android](docs/guia-celular.md#android) ou para [iPhone e iPad](docs/guia-celular.md#iphone-e-ipad). Ele explica como instalar, proteger o cofre com a digital ou o Face ID e sincronizar com o computador.

## Capturas de tela

As imagens usam uma base de demonstração com dados fictícios e o modo que oculta os valores.

![Visão geral com o resumo do mês, o fluxo mensal e as despesas por categoria](docs/screenshots/visao-geral.png)

| | |
| --- | --- |
| ![Visão geral no tema claro](docs/screenshots/visao-geral-claro.png) | ![Evolução do patrimônio e dos investimentos ao longo do ano](docs/screenshots/patrimonio.png) |
| ![Lista de transações com conta, categoria e situação](docs/screenshots/transacoes.png) | ![Fatura do cartão de crédito com as compras do ciclo](docs/screenshots/cartoes.png) |
| ![Vales cadastrados e créditos do mês](docs/screenshots/vales.png) | ![Regras de categorização com filtro de origem, ordenação e exportação](docs/screenshots/regras.png) |

## Instalação

Os instaladores já trazem tudo o que a Moneta precisa e não pedem senha de administrador.

### Celular e tablet

Aponte a câmera do celular para o QR do seu aparelho. Se você já usa a Moneta no computador, os mesmos QRs aparecem em **Configuração → Sincronização entre aparelhos → Mostrar QR de vínculo**.

| iPhone e iPad | Android |
| :---: | :---: |
| <img src="docs/qr/iphone.svg" alt="QR para abrir a Moneta no iPhone e iPad" width="160"> | <img src="docs/qr/android.svg" alt="QR para baixar a Moneta para Android" width="160"> |
| [feittosaa.github.io/moneta](https://feittosaa.github.io/moneta/) | [Moneta-Android-arm64.apk](https://github.com/feittosaa/moneta/releases/latest/download/Moneta-Android-arm64.apk) |

### Android e sincronização local

A Moneta para Android 9 ou posterior (ARM64) inclui o motor da Moneta e guarda um cofre no próprio celular. Você pode começar pelo celular, conectar os bancos pela Pluggy e registrar lançamentos com o PC desligado.

1. Baixe o [Moneta-Android-arm64.apk](https://github.com/feittosaa/moneta/releases/latest/download/Moneta-Android-arm64.apk) no celular, pelo link ou pelo QR acima.
2. Abra o arquivo baixado. O app não vem da Play Store, então o Android pede para permitir a instalação de apps dessa fonte. Se o Play Protect avisar que não conhece o app, toque em **Instalar mesmo assim**.
3. Para atualizar, baixe e abra o APK da versão nova. Ele instala por cima e mantém os dados.

Cada Moneta funciona sozinha, e você pode vincular quantos aparelhos quiser. Na primeira abertura, a Moneta pergunta se você quer usá-la em outro aparelho. A opção também fica em **Configuração → Sincronização entre aparelhos**. No mesmo Wi-Fi, os aparelhos trocam as alterações enquanto a Moneta está aberta nos dois. Se o mesmo item mudar em dois deles, vale a edição mais recente. Cada aparelho mantém sua senha, sua chave de recuperação e suas credenciais da Pluggy.

O uso no celular está no [guia para celular e tablet](docs/guia-celular.md), e as instruções de compilação, nos [detalhes técnicos](docs/mobile.md).

### iPhone e iPad

**Versão de teste.** A Moneta funciona offline e conecta os bancos sozinha, sem computador. O passo a passo completo, com o vínculo ao computador, está no [guia para celular e tablet](docs/guia-celular.md).

1. No **Safari**, abra [feittosaa.github.io/moneta](https://feittosaa.github.io/moneta/), ou leia o QR acima com o app **Câmera**.
2. Toque em **Compartilhar** → **Adicionar à Tela de Início**. Se aparecer **Abrir como App da Web**, deixe ativado, e toque em **Adicionar**.
3. Abra a **Moneta** pelo ícone na Tela de Início e só então crie a senha. O Safari e o app guardam dados separados, então o que for criado numa aba do Safari não aparece no app.
4. Espere aparecer **Disponível offline** no rodapé.
5. Na primeira abertura, escolha **Usar só neste aparelho** ou **Sim, ler QR Code** para sincronizar com a Moneta do computador. O vínculo pede, uma única vez, a instalação de um perfil com o certificado da Moneta. Veja [Vincular ao computador](docs/guia-celular.md#vincular-ao-computador).

Para conectar bancos no próprio aparelho, veja [Conectar bancos no celular](docs/guia-celular.md#conectar-bancos-no-celular).

### Windows

Para Windows 10 ou 11, de 64 bits.

1. Baixe o [Moneta-Setup.exe](https://github.com/feittosaa/moneta/releases/latest/download/Moneta-Setup.exe) e abra.
2. O instalador não tem assinatura digital paga, então o Windows pode mostrar "O Windows protegeu o computador". Clique em **Mais informações** e depois em **Executar assim mesmo**.
3. Deixe marcada a opção **Iniciar com o Windows, em segundo plano** para que a Moneta sincronize sozinha desde o login, e conclua.

A Moneta abre numa janela própria e cria atalhos no menu Iniciar e na área de trabalho. Fechar a janela deixa a Moneta na bandeja, ao lado do relógio, sincronizando. Clique no ícone para voltar, ou clique com o botão direito em **Encerrar a Moneta** para desligar.

A Moneta usa o Microsoft Edge WebView2, que já vem no Windows 11 e no Windows 10 atualizado. Se faltar, o instalador avisa e abre a página da Microsoft para instalar. Para remover, use **Configurações → Aplicativos**.

### Linux

Para Linux x86_64. Abra o terminal e cole:

```sh
curl -fsSL https://github.com/feittosaa/moneta/releases/latest/download/install.sh | sh -s -- --iniciar-com-o-sistema
```

O comando baixa a versão mais recente, confere o arquivo, cria o atalho **Moneta** no menu de aplicativos e deixa a Moneta ligada em segundo plano a cada login, sincronizando. Abra pelo menu, pela barra de tarefas ou com o comando `moneta`.

- Prefere que ela só ligue quando você abrir? Use o mesmo comando sem `-s -- --iniciar-com-o-sistema`. Para desligar o início automático depois: `systemctl --user disable --now moneta`.
- A janela usa o WebKitGTK 4.1, que já vem na maioria das distribuições com GNOME ou KDE (`webkit2gtk4.1` no Fedora, `libwebkit2gtk-4.1-0` no Debian e no Ubuntu). Sem ele, a Moneta abre no navegador.
- Sem terminal: baixe o [Moneta-x86_64.AppImage](https://github.com/feittosaa/moneta/releases/latest/download/Moneta-x86_64.AppImage), marque como executável (nas propriedades do arquivo, **Permitir executar como programa**) e abra com dois cliques. Se não abrir, instale o pacote `fuse3` da sua distribuição, ou use o comando acima, que não precisa dele.
- Para desligar a Moneta até o próximo login, use **Configuração → Encerrar a Moneta**.
- Para remover, mantendo os seus dados:

```sh
curl -fsSL https://github.com/feittosaa/moneta/releases/latest/download/install.sh | sh -s -- --remover
```

### Atualizar

- **Windows:** baixe e abra o [Moneta-Setup.exe](https://github.com/feittosaa/moneta/releases/latest/download/Moneta-Setup.exe) mais recente. Ele fecha a Moneta aberta, guardando tudo, e instala por cima.
- **Linux:** rode o comando de instalação de novo. O serviço em segundo plano reinicia com a versão nova.

Atualizar ou remover nunca apaga os dados. Eles ficam em `%LOCALAPPDATA%\Moneta` no Windows e em `~/.local/share/moneta` no Linux. As novidades de cada versão ficam em [Releases](https://github.com/feittosaa/moneta/releases), com as somas de verificação dos arquivos.

## Primeiros passos

O [Guia de conexão](docs/guia/conectar-bancos.md) detalha cada passo abaixo, inclusive a criação das contas na Pluggy e no Meu Pluggy. Em resumo:

1. Em **Configuração**, informe o Client ID e o Client Secret e clique em **Validar e salvar**. As credenciais passam a valer assim que a Pluggy as aceita.
2. Em **Conexões**, clique em **Conectar instituição**, escolha **MeuPluggy** no widget da Pluggy e autorize o acesso aos bancos que você conectou no Meu Pluggy.
3. A Moneta sincroniza a nova conexão logo em seguida. Depois disso, use **Sincronizar** quando quiser atualizar. Com a Moneta ligada, uma sincronização automática ocorre a cada 6 horas.
4. Em **Configuração → Cofre do banco**, clique em **Mostrar chave de recuperação** e guarde a chave num gerenciador de senhas ou no papel. Ela abre o banco se você trocar de computador.
5. De vez em quando, em **Configuração → Backups**, baixe um backup e guarde fora do computador.

A sincronização lê todo o histórico disponível na Pluggy e só grava o resultado depois de ler todas as conexões. Se algo falhar no meio do caminho, a cópia anterior é mantida.

## Rodar pelo código

Para desenvolver ou rodar sem instalador. Precisa de Docker com Docker Compose **ou** Node.js 22.16 ou superior, além de uma aplicação na Pluggy (veja o [Guia de conexão](docs/guia/conectar-bancos.md)). Nesse modo, a Moneta abre no navegador, e o endereço de entrada aparece no log ao iniciar.

### Com Docker Compose

Na raiz do projeto:

```sh
mkdir -p -m 700 data
docker compose up -d --build
```

Abra http://127.0.0.1:4173. Para parar, use `docker compose down`.

A pasta `./data` é montada no container e guarda o banco e as credenciais, por isso os dados sobrevivem a recriações do container. O serviço roda com UID/GID 1000. Se o seu usuário no Linux tiver outros IDs, crie um arquivo `.env` com os valores de `id -u` e `id -g`:

```sh
MONETA_UID=1001
MONETA_GID=1001
```

Quem já usava o Docker e passou para o app instalado pode levar os dados: pare o container (`docker compose down`) e copie o conteúdo de `data/` para a pasta de dados do app. Na primeira abertura, as chaves que estavam em arquivo comum são lacradas pelo sistema.

### Com Node.js

```sh
node --env-file-if-exists=.env server.mjs
```

Abra http://127.0.0.1:4173. Não é preciso instalar pacotes: o projeto não tem dependências npm.

Encerre uma das formas de execução antes de iniciar a outra, pois ambas usam a mesma porta.

### Variáveis de ambiente

Todas são opcionais.

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `4173` | Porta do servidor. |
| `MONETA_SECRET_STORE` | automático | Use `arquivo` para guardar as credenciais em JSON `0600` em vez de lacrá-las pelo sistema. |
| `MONETA_DATA_DIR` | `./data` | Pasta do banco e das credenciais. O app instalado usa a pasta de dados do usuário. |
| `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` | vazio | Credenciais da Pluggy. Valem até que outro par seja salvo pela interface. |
| `MONETA_UID` e `MONETA_GID` | `1000` | Usuário e grupo do container (somente Docker). |
| `MONETA_DEVICE_NAME` | nome do computador | Nome deste aparelho na lista de vínculos dos outros. |
| `MONETA_WEB_PORT` | `4175` | Porta HTTPS da sincronização com a Moneta Web. |
| `MONETA_WEB_ORIGIN` | `https://feittosaa.github.io` | Endereços onde a Moneta Web está publicada, separados por vírgula. Só eles sincronizam. |

## Telas

### Visão geral

- **Resumo mensal:** receitas, despesas, resultado e despesas por categoria do mês escolhido. No mês atual, o card **Fatura em aberto** soma as faturas dos cartões que ainda não fecharam. Débitos e créditos em conta contam na data do lançamento. Compras no cartão contam pelo total da fatura no mês do vencimento, inclusive parcelas. Quando a instituição não informa a fatura, a Moneta a reconstrói a partir dos pagamentos identificados e avisa que a cobertura pode estar incompleta. Em **Despesas por categoria**, as faturas aparecem agrupadas em uma linha só, **Faturas de cartão**. Escolha **Somente faturas** para ver a composição delas por categoria.
- **Patrimônio:** posição da última sincronização e sua evolução diária. O **bruto** soma saldos positivos e investimentos brutos. O **líquido** usa investimentos líquidos e desconta dívidas de cartão e saldos negativos. O valor aplicado automaticamente pelo banco é descontado do saldo da conta para não ser contado duas vezes. Valores que a instituição não informou aparecem como indisponíveis.

### Transações

Lista os lançamentos de todas as contas. Você pode:

- escolher o **Período**: o mês selecionado no topo da página ou **Todos os meses**, para ver o histórico inteiro na moeda selecionada;
- buscar pela descrição e filtrar por conta, cartão ou categoria;
- clicar em uma transação para mudar a categoria, escrever uma nota ou criar uma regra a partir dela. Escolha **Automática** para devolver a transação às regras.

Valores positivos aparecem em negrito.

### Carteira

Registra dinheiro em espécie, que não passa pela Pluggy. **Adicionar saldo** e **Retirar saldo** só ajustam o saldo da carteira. **Receita em dinheiro** e **Despesa em dinheiro** também entram no resultado do mês.

Ao lado do saldo em dinheiro, **Saldo nos bancos** soma as contas bancárias na moeda selecionada, como as instituições informaram na última sincronização. As três maiores aparecem logo abaixo do total. Passe o mouse sobre o cartão, ou selecione-o pelo teclado, para ver todas as contas.

### Cartões

Mostra cada cartão de crédito com as compras do ciclo (inclusive parcelas), a situação da fatura (fechada, em aberto ou estimada), o limite total e o limite utilizado. Faturas fechadas continuam disponíveis mesmo depois que saem da janela de histórico da Pluggy.

### Vales

Vale-transporte, vale-alimentação e outros benefícios não chegam pela Pluggy. Na página **Vales**, clique em **Adicionar vale** e informe o nome, o valor de cada crédito, a categoria do gasto e a recorrência:

- **Mensal:** todo mês no dia do primeiro crédito. Nos meses sem esse dia (31, por exemplo), cai no último dia do mês;
- **Semanal:** toda semana no mesmo dia da semana do primeiro crédito;
- **Diária:** todos os dias, ou só de segunda a sexta com **Só dias úteis**, como num vale-transporte;
- **Uso único:** um crédito só, como um bônus.

Cada crédito, até a data de hoje, entra no mês como receita na categoria **Benefícios** e, na mesma data, como despesa na categoria do vale. O total de despesas passa a incluir o que foi pago com vale, com um item próprio, **Vales**, e o resultado do mês não muda. A página mostra o total creditado no mês, os vales cadastrados e cada crédito do mês selecionado.

Para parar um vale recorrente sem perder o histórico, edite-o e informe o **Último crédito**. Editar o valor ou a recorrência recalcula todos os créditos do vale. Para mudar só daqui em diante, encerre o vale atual e crie outro. **Excluir** remove o vale e todos os créditos já lançados por ele.

### Categorias

Crie, renomeie, recolora ou remova categorias. Uma categoria marcada como **interna** fica fora do fluxo mensal. Use esse tipo para movimentos que não são receita nem despesa, como pagamentos de fatura e aplicações e resgates de investimentos.

Filtre a lista pela **Origem**: categorias criadas por você (inclusive as criadas ao importar regras) ou que já vêm com a Moneta.

### Regras

Regras classificam lançamentos automaticamente. Cada regra combina condições sobre a descrição, o valor, a data, o tipo, a situação ou o CPF/CNPJ do destinatário. As condições podem exigir que todas coincidam ou que qualquer uma coincida. Os operadores disponíveis são: contém, não contém, começa com, termina com, igual, diferente, expressão regular e comparações numéricas (maior, menor, maior ou igual, menor ou igual).

Filtre a lista pela **Origem**. Regras criadas na Moneta e regras importadas contam como suas; as do catálogo padrão aparecem como **Moneta**.

**Aplicar regras ao histórico** reavalia todos os lançamentos com as regras ativas, preservando as escolhas manuais. Antes de aplicar, a Moneta mostra uma prévia com cada lançamento que muda de categoria, a categoria atual e a nova. Nada muda até você confirmar. Se os dados mudarem entre a prévia e a confirmação (por uma sincronização, por exemplo), a aplicação é recusada e você revisa a prévia de novo.

Nas tabelas de regras e de categorias, clique no título de uma coluna para ordenar. O primeiro clique ordena de forma crescente, o segundo de forma decrescente e o terceiro volta à ordem padrão. A seta ao lado do título mostra a ordenação ativa.

### Configuração

Define a moeda padrão, o tema (igual ao sistema, que é o padrão, escuro ou claro) e as credenciais da Pluggy. Também mostra a chave de recuperação do **Cofre do banco**, os **Backups** (baixar e restaurar), o **Modo cofre** (senha para abrir a Moneta) e permite reiniciar ou encerrar o servidor.

### Guia

Abaixo de Configuração, o **Guia** mostra o [Guia de conexão](docs/guia/conectar-bancos.md) dentro do app. O texto e as imagens ficam em `docs/guia/` e são os mesmos que aparecem no GitHub.

### Barra superior

Nas páginas que dependem do mês (Visão geral, Transações, Carteira, Cartões e Vales), a barra superior tem os mesmos controles e no mesmo lugar: ano e mês anterior, o seletor de mês, mês e ano seguinte e **Mês atual**, que volta ao mês corrente. O botão com o ícone de olho oculta os valores da tela.

Datas aparecem e são digitadas no padrão dia, mês e ano (`dd/mm/aaaa`), e o seletor de mês usa `mm/aaaa`, qualquer que seja o idioma do navegador. Basta digitar os números, que as barras entram sozinhas. O botão com o ícone de calendário abre o calendário do navegador.

## Como uma transação é classificada

A Moneta usa a primeira fonte disponível, nesta ordem:

1. a categoria escolhida manualmente na transação;
2. as regras criadas na Moneta;
3. as regras do catálogo, em ordem crescente de prioridade (com a mesma prioridade, as regras importadas vêm antes das padrão);
4. a categoria informada pela Pluggy.

Pagamentos de fatura e aplicações e resgates de investimentos são reconhecidos pela descrição e vão para as categorias internas **Pagamento de fatura** e **Movimentação de investimentos**, para não inflarem receitas e despesas. Rendimentos e impostos sobre investimentos continuam contando como receita e despesa.

## Catálogo de regras

O arquivo [`default-rules.json`](default-rules.json) traz regras prontas para comércios e serviços comuns no Brasil, como delivery, mercados, transporte, assinaturas, farmácias e contas da casa, além de pagamentos de fatura, aplicações, salário e rendimentos. Elas aparecem com a origem **Moneta** na tela de regras, podem ser editadas ou desativadas e vêm todas ativas.

Para compartilhar regras com alguém ou levá-las para outra instalação, clique em **Exportar regras**. A Moneta baixa um arquivo JSON (`moneta-categorization-rules`, versão 1) com as regras da origem escolhida no filtro: todas, só as suas ou só as do catálogo, já com as suas edições. As regras criadas na Moneta saem com prioridade menor que a do catálogo, para continuarem vencendo depois de importadas.

Para importar um arquivo nesse formato, vá em **Regras**, selecione o arquivo e clique em **Importar regras**:

- regras com o mesmo nome são atualizadas, por isso importar de novo traz as alterações do arquivo;
- categorias que ainda não existem são criadas;
- a tela sinaliza regras sem uma categoria de destino ou que usam campos que a Moneta ainda não lê;
- com **Aplicar também aos lançamentos existentes** marcado, todo o histórico é reavaliado. Desmarcado, a classificação atual é preservada e as regras importadas valem apenas para lançamentos novos.

## Dados e privacidade

Tudo fica na pasta de dados: `data/` no Docker e no Node.js (ela está no `.gitignore`), `~/.local/share/moneta` no app instalado no Linux e `%LOCALAPPDATA%\Moneta` no Windows:

- `moneta.cofre`: o banco inteiro (conexões, saldos, investimentos, lançamentos, faturas, vales, categorias, regras, notas e histórico de patrimônio), cifrado com AES-256-GCM. Enquanto a Moneta roda, o banco fica só na memória. `moneta.cofre.anterior` é a gravação anterior, usada se a última for interrompida;
- `banco.cred` (Linux) ou `banco.dpapi` (Windows): a chave do cofre, lacrada pelo sistema. Sem esse recurso, como no Docker, fica em `banco.key` com permissão `0600`, ao lado do cofre;
- `pluggy.cred` (Linux) ou `pluggy.dpapi` (Windows): credenciais da Pluggy lacradas pelo sistema. Sem esse recurso, como no Docker, ficam em `pluggy.json` com permissão `0600`;
- `banco-senha.cred` no lugar de `banco.cred`, com o **modo cofre** ligado: a chave do cofre cifrada com a sua senha e, por cima, lacrada pelo sistema;
- `backups/`: um backup automático por dia, dos últimos 7 dias, cifrado e testado depois de criado. Em **Configuração → Backups** dá para baixar um backup para guardar fora do computador e restaurar de um arquivo;
- `acesso.key`: chave que libera a janela da Moneta (ou o navegador, trocada por um cookie) quando você abre a Moneta pelo atalho.

Com o **modo cofre** (em Configuração), a Moneta pede uma senha para abrir e tranca sozinha depois de um tempo sem uso. Trancada, nem um programa rodando com o seu usuário consegue abrir o banco; em troca, a sincronização automática só acontece com ele aberto.

A API só responde a navegadores autorizados pela chave de acesso. O servidor também recusa cabeçalhos `Host` diferentes de `localhost` e `127.0.0.1` e escritas vindas de outra origem, e envia uma política de segurança de conteúdo restrita. Os únicos dados que saem da máquina são as chamadas à API da Pluggy. O documento [Segurança](docs/seguranca.md) detalha o modelo de ameaças, as proteções e os riscos que ainda ficam.

Outros programas locais podem ler os dados pela API, enviando `Authorization: Bearer` com o conteúdo de `acesso.key`. O contrato está em [Integração](docs/integracao.md).

## Desenvolvimento

Rode os testes com o executor nativo do Node.js:

```sh
node --test
```

Para gerar os instaladores localmente (precisa de `curl`, `xz`, `unzip`, `makensis` e `sha256sum`):

```sh
packaging/build.sh 1.0.0
```

Os arquivos saem em `dist/`. Ao enviar uma tag de versão, como `1.0.0`, o GitHub Actions roda os testes, gera os instaladores e publica a release.

Estrutura do projeto:

| Caminho | Conteúdo |
| --- | --- |
| `server.mjs` | Processo supervisor que inicia e reinicia o backend; com `--desktop`, usa a pasta de dados do usuário e abre o navegador. |
| `backend.mjs` | Servidor HTTP, rotas da API e integração com a Pluggy. |
| `finance.mjs` | Banco SQLite, sincronização e classificação de lançamentos. |
| `category-rules.mjs` | Catálogo de regras, importação e avaliação de condições. |
| `default-rules.json` | Regras padrão do catálogo. |
| `request-body.mjs` | Leitura e validação do corpo JSON das requisições. |
| `peer-data.mjs` | Réplica entre aparelhos: hora de cada alteração, a edição mais recente vence e exclusões se propagam. |
| `peer-sync.mjs` | Vínculos por QR, troca cifrada pela rede local e servidor HTTPS para a Moneta Web. |
| `local-ca.mjs` | Autoridade de certificados da rede local, restrita a IPs privados, e o perfil para iPhone e iPad. |
| `web/` | Moneta Web para iPhone e iPad: build estático, cofre no navegador, Pluggy e vínculo pela câmera. |
| `vault.mjs` | Cofre do banco: SQLite em memória, gravado cifrado com AES-256-GCM em `moneta.cofre`, migração verificada e chave de recuperação. |
| `secret-store.mjs` | Lacre das credenciais da Pluggy pelo sistema (systemd-creds no Linux, DPAPI no Windows). |
| `public/` | Interface: HTML, CSS e módulos JavaScript (relatório, ciclos de cartão, patrimônio, campos de data), ícones e fontes. |
| `packaging/` | Scripts que geram o AppImage, o instalador do Windows e o comando de instalação para Linux. |
| `.github/workflows/` | Publicação automática da release ao enviar uma tag de versão. |
| `docs/guia/` | Guia de conexão (Markdown e imagens), exibido no app e no GitHub. |
| `docs/guia-celular.md` | Guia de uso no iPhone, iPad e Android: instalação, vínculo com o computador, bancos e backup. |
| `desktop/` | Janela nativa (Tauri, Rust): sobe o servidor escondido, abre o painel autorizado e fica na bandeja. |
| `docs/integracao.md` | Contrato para programas locais, como a Ayla: como encontrar a Moneta, autenticar e ler os dados. |
| `docs/seguranca.md` | Modelo de ameaças, proteções, riscos aceitos e próximos passos de segurança. |
| `test/` | Testes automatizados. |

### Fontes

O nome Moneta e os títulos das páginas usam a [Goudy Bookletter 1911](https://github.com/theleagueof/goudy-bookletter-1911), de Barry Schwartz, distribuída em `public/fonts/` sob a SIL Open Font License 1.1 (veja [`public/fonts/OFL.txt`](public/fonts/OFL.txt)). O restante da interface usa a fonte sem serifa do sistema. O projeto só usa fontes gratuitas.

## Licença

O código é distribuído sob a [licença MIT](LICENSE): qualquer pessoa pode usar, copiar, modificar e redistribuir, inclusive em outros projetos, desde que mantenha o aviso de copyright. A fonte Goudy Bookletter 1911 segue a sua própria licença, a SIL Open Font License 1.1.
