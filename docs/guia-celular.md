# Moneta no celular e no tablet

A Moneta funciona sozinha no iPhone, no iPad e no Android. Ela guarda os lançamentos no próprio aparelho, abre sem internet e pode conectar seus bancos pela Pluggy sem computador. Se você também usa a Moneta no computador, pode vincular os aparelhos para que as alterações apareçam em todos.

- [iPhone e iPad](#iphone-e-ipad)
- [Android](#android)
- [Vincular ao computador](#vincular-ao-computador)
- [Conectar bancos no celular](#conectar-bancos-no-celular)
- [Destravar com Face ID ou digital](#destravar-com-face-id-ou-digital)
- [Backup e troca de aparelho](#backup-e-troca-de-aparelho)
- [Problemas comuns](#problemas-comuns)

## iPhone e iPad

A Moneta para iPhone e iPad é um app da web: você instala pelo Safari, sem App Store.

### 1. Instale na Tela de Início

1. No **Safari**, abra [feittosaa.github.io/moneta](https://feittosaa.github.io/moneta/).
2. Toque em **Compartilhar** (o quadrado com a seta para cima).
3. Toque em **Adicionar à Tela de Início**. Se aparecer **Abrir como App da Web**, deixe ativado.
4. Toque em **Adicionar**.

> **Instale antes de criar a senha.** No iPhone e no iPad, o Safari e o app da Tela de Início guardam dados separados. Uma senha, lançamentos ou um vínculo criados numa aba do Safari não aparecem no app. Se isso já aconteceu, veja [Passei a usar o app e meus dados ficaram no Safari](#passei-a-usar-o-app-e-meus-dados-ficaram-no-safari).

### 2. Abra e crie o cofre

1. Abra a **Moneta** pelo ícone na Tela de Início.
2. Escolha uma das opções:
   - **Criar cofre:** digite uma senha de pelo menos 8 caracteres e repita. A senha protege os lançamentos neste aparelho. Ela não pode ser recuperada, então guarde num gerenciador de senhas.
   - **Usar sem senha:** a Moneta abre direto. Você pode ativar a senha depois em **Configuração → Cofre neste aparelho**.
3. Espere aparecer **Disponível offline** no rodapé. A partir daí, a Moneta abre mesmo sem internet.

### 3. Escolha como usar

Na primeira abertura, a Moneta pergunta se você quer sincronizar com outra Moneta.

- **Usar só neste aparelho:** a Moneta funciona sozinha. Registre gastos em **Carteira** e, se quiser, [conecte seus bancos](#conectar-bancos-no-celular).
- **Sim, ler QR Code:** siga [Vincular ao computador](#vincular-ao-computador).

Você pode mudar de ideia depois em **Configuração → Sincronização**.

## Android

O app para Android 9 ou posterior ainda está em teste e é gerado a partir do código. As instruções de compilação estão em [Moneta no celular: detalhes técnicos](mobile.md#android). Depois de instalado, o Android tem os mesmos recursos do computador: cofre próprio, conexão com os bancos e vínculo com outros aparelhos.

## Vincular ao computador

Os aparelhos vinculados trocam as alterações pelo Wi-Fi de casa, enquanto a Moneta está aberta nos dois. Fora de casa, cada um continua funcionando normalmente. Quando voltam para a mesma rede, eles se atualizam. Se o mesmo item mudar em dois aparelhos, vale a edição mais recente.

### iPhone ou iPad com o computador

O iPhone e o iPad só conversam com o computador por conexão segura. Por isso, na primeira vez, você instala um perfil com o certificado da Moneta do seu computador. O certificado vale só para endereços da rede local e não serve para nenhum site da internet.

1. Deixe o computador e o iPhone no mesmo Wi-Fi.
2. No computador, abra **Configuração → Sincronização entre aparelhos → Mostrar QR de vínculo** e escolha **iPhone ou iPad**.
3. No iPhone, abra o app **Câmera** e aponte para o QR. Toque no link que aparece. O Safari pergunta se quer baixar um perfil: toque em **Permitir**.
4. Abra **Ajustes**. Logo no topo aparece **Perfil Baixado**. Toque nele e depois em **Instalar**. O iPhone pede o código do aparelho.
5. Em **Ajustes → Geral → Sobre → Ajustes de Confiança de Certificados**, ative o certificado da **Moneta**.
6. No computador, clique em **Já instalei, mostrar QR de vínculo**.
7. Na Moneta do iPhone, toque em **Sim, ler QR Code**, ou abra **Configuração → Sincronização → Ler QR Code**. Permita o uso da câmera e aponte para o QR.

Pronto: o computador e o iPhone aparecem um na lista do outro. Os passos 3 a 5 são feitos uma única vez em cada iPhone ou iPad.

Se o firewall do computador perguntar, permita conexões na rede privada. A Moneta usa as portas 4174 e 4175.

### Android com o computador

1. Deixe os dois no mesmo Wi-Fi.
2. No computador, abra **Configuração → Sincronização entre aparelhos → Mostrar QR de vínculo** e escolha **Android ou outro computador**.
3. No Android, abra **Configuração → Sincronização entre aparelhos → Ler QR de outro aparelho** e aponte a câmera para o QR.

### Mais de dois aparelhos

Você pode vincular quantos aparelhos quiser ao mesmo computador. Eles recebem as alterações uns dos outros através dele. Dois iPhones ou iPads não se vinculam diretamente entre si: vincule os dois ao computador ou a um Android.

Para desfazer um vínculo, toque em **Desvincular** ao lado do aparelho, na lista em **Configuração**.

## Conectar bancos no celular

Cada aparelho pode conectar os bancos sozinho, sem depender do computador.

1. Crie as contas gratuitas na Pluggy seguindo o [Guia de conexão](guia/conectar-bancos.md).
2. No iPhone ou iPad, a Moneta precisa estar com a senha ativada: só assim ela guarda as credenciais da Pluggy com segurança. Se você escolheu **Usar sem senha**, ative em **Configuração → Cofre neste aparelho**.
3. Em **Configuração → Credenciais Pluggy**, informe o Client ID e o Client Secret.
4. Em **Conexões**, toque em **Conectar instituição** e siga o assistente da Pluggy.

O iPhone não deixa apps da web rodarem em segundo plano. Por isso, a Moneta atualiza os bancos quando você abre o app e a cada 6 horas enquanto ele está aberto. Para atualizar na hora, toque em **Sincronizar**, no topo.

## Destravar com Face ID ou digital

Com o cofre protegido por senha, a Moneta pode abrir com o Face ID, o Touch ID, a digital ou o bloqueio de tela do aparelho. A senha continua funcionando e é a única forma de restaurar backups.

**iPhone e iPad** (iOS 18 ou mais novo, com as Senhas do iCloud ativadas):

1. Abra **Configuração → Cofre neste aparelho → Destravar com Face ID ou Touch ID**.
2. Digite a senha do cofre e toque em **Ativar**. O iPhone pede para salvar uma passkey da Moneta e confirma com o Face ID.
3. Nas próximas aberturas, toque em **Usar Face ID ou Touch ID** na tela da senha.

A passkey fica no app **Senhas** do iPhone. Ela só funciona no endereço `feittosaa.github.io`.

**Android:**

1. Abra **Configuração → Modo cofre → Digital ou bloqueio de tela**.
2. Digite a senha atual e toque em **Ativar desbloqueio pelo aparelho**. Confirme com a digital, o rosto ou o bloqueio de tela.
3. Nas próximas aberturas, o Android pede a confirmação logo que a Moneta abre.

Se você cadastrar uma digital nova no Android, desligar o modo cofre ou trocar a senha, o desbloqueio pelo aparelho é desativado por segurança. Ative de novo em **Configuração**.

## Backup e troca de aparelho

Em **Configuração → Backup**, toque em **Baixar backup cifrado** e guarde o arquivo no app **Arquivos** ou no iCloud Drive. Para restaurar num aparelho novo, abra a Moneta pela primeira vez, escolha **Ou escolha um backup** e digite a senha que você usava quando baixou o arquivo.

O backup leva os lançamentos, as regras e as categorias. Ele não leva os vínculos nem as credenciais da Pluggy, que precisam ser refeitos no aparelho novo.

## Problemas comuns

### Passei a usar o app e meus dados ficaram no Safari

O Safari e o app da Tela de Início não compartilham dados. Para levar o que você fez no Safari para o app:

1. Na aba do Safari, abra a Moneta, vá em **Configuração → Backup** e toque em **Baixar backup cifrado**. Salve no app **Arquivos**.
2. Abra a Moneta pelo ícone na Tela de Início. Na tela inicial, toque em **Ou escolha um backup**, selecione o arquivo e digite a senha.
3. Refaça o vínculo com o computador pelo QR, se você tinha um.

Se ainda não havia nada importante no Safari, basta criar o cofre de novo no app.

### O iPhone não encontra o computador

- Confira se os dois estão no mesmo Wi-Fi. Redes de visitantes costumam bloquear a comunicação entre aparelhos.
- Deixe a Moneta aberta nos dois enquanto sincroniza.
- Se o endereço do computador na rede mudou, mostre o QR de vínculo de novo e leia pelo iPhone. O perfil não precisa ser reinstalado.

### O link do primeiro QR não abre o perfil

O QR do perfil vale por 10 minutos. Mostre o QR de novo no computador e leia com o app **Câmera**, não pela Moneta.
