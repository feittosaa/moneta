# Moneta no celular e no tablet

A Moneta funciona sozinha no iPhone, no iPad e no Android. Ela guarda os lançamentos no próprio aparelho, abre sem internet e pode conectar seus bancos pela Pluggy sem computador. Se você também usa a Moneta no computador, pode vincular os aparelhos para que as alterações apareçam em todos.

- [iPhone e iPad](#iphone-e-ipad)
- [Android](#android)
- [Vincular ao computador](#vincular-ao-computador)
- [Conectar bancos no celular](#conectar-bancos-no-celular)
- [Destravar com Face ID ou digital](#destravar-com-face-id-ou-digital)
- [Atualizar a Moneta](#atualizar-a-moneta)
- [Backup e troca de aparelho](#backup-e-troca-de-aparelho)
- [Problemas comuns](#problemas-comuns)

## iPhone e iPad

A Moneta para iPhone e iPad é um app da web: você instala pelo Safari, sem App Store.

### 1. Instale na Tela de Início

1. No **Safari**, abra [feittosaa.github.io/moneta](https://feittosaa.github.io/moneta/). Se você já usa a Moneta no computador, também pode abrir **Configuração → Sincronização entre aparelhos → Mostrar QR de vínculo → iPhone ou iPad** e ler o QR com o app **Câmera**.
2. Toque em **Compartilhar** (o quadrado com a seta para cima).
3. Toque em **Adicionar à Tela de Início**. Se aparecer **Abrir como App da Web**, deixe ativado.
4. Toque em **Adicionar**.

> **Instale antes de criar a senha.** No iPhone e no iPad, o Safari e o app da Tela de Início guardam dados separados. Uma senha, lançamentos ou um vínculo criados numa aba do Safari não aparecem no app. Se isso já aconteceu, veja [Passei a usar o app e meus dados ficaram no Safari](#passei-a-usar-o-app-e-meus-dados-ficaram-no-safari).

### 2. Abra e crie o cofre

1. Abra a **Moneta** pelo ícone na Tela de Início. Ela pergunta se você já usa a Moneta em outro aparelho.
   - **Ler QR Code:** traz os dados da Moneta do computador ou do Android, sem criar um cofre do zero. Antes, instale e confie no certificado (passo 3) e siga [Vincular ao computador](#vincular-ao-computador). Se a outra Moneta tiver senha, digite essa senha: este aparelho passa a usar a mesma. Se ela não tiver senha, a Moneta pede para você criar uma, como no passo seguinte.
   - **Começar do zero:** siga o passo seguinte.
2. Escolha uma das opções:
   - **Criar cofre:** digite uma senha de pelo menos 8 caracteres e repita. A senha protege os lançamentos neste aparelho. Ela não pode ser recuperada, então guarde num gerenciador de senhas.
   - **Usar sem senha:** a Moneta abre direto. Você pode ativar a senha depois em **Configuração → Cofre neste aparelho**.
3. Espere aparecer **Disponível offline** no rodapé. A partir daí, a Moneta abre mesmo sem internet.

### 3. Para vincular ao computador: instale e confie no certificado

Se você vai vincular o iPhone ou o iPad à Moneta do computador, ele precisa confiar no certificado da Moneta antes de ler o QR de vínculo. São três etapas, feitas uma única vez em cada aparelho:

1. **Baixar o perfil:** leia o QR do perfil com o app **Câmera** e toque em **Permitir**.
2. **Instalar o perfil:** em **Ajustes → Perfil Baixado**, toque em **Instalar**.
3. **Ativar a confiança:** em **Ajustes → Geral → Sobre → Ajustes de Confiança de Certificados**, ative a **Moneta**.

> **Não pule a terceira etapa.** Com o perfil instalado mas a confiança desligada, o iPhone e o iPad recusam a conexão com o computador, e a Moneta não consegue concluir o vínculo depois de ler o QR. O passo a passo completo está em [iPhone ou iPad com o computador](#iphone-ou-ipad-com-o-computador).

### 4. Use a Moneta

Começando do zero, a Moneta funciona sozinha neste aparelho. Registre gastos em **Carteira** e, se quiser, [conecte seus bancos](#conectar-bancos-no-celular). Para vincular depois, use **Configuração → Sincronização → Ler QR Code**.

A senha copiada da outra Moneta vale só a partir do vínculo. Se você trocar a senha num aparelho depois, o outro continua com a antiga.

## Android

A Moneta para Android 9 ou posterior (ARM64, o caso de quase todo celular atual) é um aplicativo instalado fora da Play Store.

1. No celular, baixe o [Moneta-Android-arm64.apk](https://github.com/feittosaa/moneta/releases/latest/download/Moneta-Android-arm64.apk). Se você já usa a Moneta no computador, abra **Configuração → Sincronização entre aparelhos → Mostrar QR de vínculo → Android** e leia o primeiro QR com a câmera.
2. Abra o arquivo baixado. O Android pede para permitir a instalação de apps dessa fonte. Se o Play Protect avisar que não conhece o app, toque em **Instalar mesmo assim**.
3. Abra a Moneta. Ela pergunta se você já usa a Moneta em outro aparelho. Para trazer os dados do computador, toque em **Ler QR Code** e siga [Android com o computador](#android-com-o-computador). Se a Moneta do computador tiver senha, digite essa senha: o Android passa a usar a mesma e oferece o desbloqueio pela digital. Para começar sem dados, toque em **Começar do zero**.

Para atualizar, veja [Atualizar a Moneta](#atualizar-a-moneta). Depois de instalado, o Android tem os mesmos recursos do computador: cofre próprio, conexão com os bancos e vínculo com outros aparelhos. As instruções para compilar o APK estão em [Moneta no celular: detalhes técnicos](mobile.md#android).

## Vincular ao computador

Os aparelhos vinculados trocam as alterações pelo Wi-Fi de casa, enquanto a Moneta está aberta nos dois. Fora de casa, cada um continua funcionando normalmente. Quando voltam para a mesma rede, eles se atualizam. Se o mesmo item mudar em dois aparelhos, vale a edição mais recente.

### iPhone ou iPad com o computador

O iPhone e o iPad só conversam com o computador por conexão segura. Por isso, na primeira vez, você instala um perfil com o certificado da Moneta do seu computador e ativa a confiança nele. O certificado vale só para endereços da rede local e não serve para nenhum site da internet.

**Antes de começar**

1. Deixe o computador e o iPhone no mesmo Wi-Fi.
2. No computador, abra **Configuração → Sincronização entre aparelhos → Mostrar QR de vínculo** e escolha **iPhone ou iPad**. O primeiro QR instala a Moneta; se ela já está na Tela de Início, clique em **Já instalei, continuar**.

**Etapa 1: baixar o perfil**

3. No iPhone, abra o app **Câmera**, não a Moneta, e aponte para o QR do perfil. Toque no link que aparece. O Safari pergunta se quer baixar um perfil: toque em **Permitir**.

**Etapa 2: instalar o perfil**

4. Abra **Ajustes**. Logo no topo aparece **Perfil Baixado**. Toque nele e depois em **Instalar**. O iPhone pede o código do aparelho. Se **Perfil Baixado** não aparecer, procure em **Ajustes → Geral → VPN e Gerenciamento de Dispositivos**.

**Etapa 3: confiar no certificado**

5. Abra **Ajustes → Geral → Sobre** e role até o fim. Toque em **Ajustes de Confiança de Certificados** e ative a chave da **Moneta**. Confirme em **Continuar**.

> **Esta etapa é obrigatória.** Instalar o perfil não basta: sem ativar a confiança, o iPhone e o iPad recusam a conexão, e a Moneta mostra que não encontrou a outra Moneta depois de ler o QR.

**Etapa 4: ler o QR de vínculo**

6. No computador, clique em **Já instalei o perfil, continuar**.
7. Na Moneta do iPhone, toque em **Ler QR Code** na primeira abertura, ou abra **Configuração → Sincronização → Ler QR Code**. Permita o uso da câmera e aponte para o QR. Na primeira abertura, se a Moneta do computador tiver senha, digite essa senha para criar o cofre do iPhone com ela.

Pronto: o computador e o iPhone aparecem um na lista do outro. As etapas 1 a 3 são feitas uma única vez em cada iPhone ou iPad.

Se o firewall do computador perguntar, permita conexões na rede privada. A Moneta usa as portas 4174 e 4175.

### Android com o computador

1. Deixe os dois no mesmo Wi-Fi.
2. No computador, abra **Configuração → Sincronização entre aparelhos → Mostrar QR de vínculo** e escolha **Android**. Se a Moneta ainda não está no celular, leia o primeiro QR com a câmera para baixar o aplicativo. Depois, clique em **Já instalei, continuar**.
3. No Android, toque em **Ler QR Code** na primeira abertura, ou abra **Configuração → Sincronização entre aparelhos → Ler QR de outro aparelho**, e aponte a câmera para o QR. Na primeira abertura, se a Moneta do computador tiver senha, digite essa senha para o Android usar a mesma.

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

## Atualizar a Moneta

**iPhone e iPad:** a Moneta se atualiza sozinha, porque é um app da web. Ao abrir, ela confere se há uma versão nova. Se o cofre ainda estiver trancado, a versão nova entra na hora; se você já estiver usando, ela entra na próxima vez que você voltar ao app. Não precisa baixar nada.

**Android:** quando sai uma versão nova, o rodapé do menu lateral mostra **Instalar a versão…**. Toque nele: a Moneta baixa a versão, confere se o arquivo é o publicado e abre a confirmação do Android. Na primeira vez, o Android pede para permitir que a Moneta instale apps; permita, volte e toque de novo. Se preferir, baixe o [APK mais recente](https://github.com/feittosaa/moneta/releases/latest/download/Moneta-Android-arm64.apk) e abra o arquivo. Nos dois casos, a versão nova instala por cima e mantém os dados.

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

### A Moneta do iPhone ou do iPad lê o QR, mas não conecta

Quase sempre falta ativar a confiança no certificado. Abra **Ajustes → Geral → Sobre → Ajustes de Confiança de Certificados** e confira se a chave da **Moneta** está ativada. Se a Moneta não aparecer nessa lista, o perfil não foi instalado: refaça as etapas 1 e 2 de [iPhone ou iPad com o computador](#iphone-ou-ipad-com-o-computador). Depois, leia o QR de vínculo de novo.

### O iPhone não encontra o computador

- Confira se o certificado da Moneta está ativado em **Ajustes → Geral → Sobre → Ajustes de Confiança de Certificados**.
- Confira se os dois estão no mesmo Wi-Fi. Redes de visitantes costumam bloquear a comunicação entre aparelhos.
- Deixe a Moneta aberta nos dois enquanto sincroniza.
- Se o endereço do computador na rede mudou, mostre o QR de vínculo de novo e leia pelo iPhone. O perfil não precisa ser reinstalado.

### O QR de vínculo não faz nada no app Câmera

O QR do passo 3 é lido pela própria Moneta, não pelo app Câmera. Abra a Moneta pelo ícone na Tela de Início e toque em **Ler QR Code**, na primeira abertura, ou em **Configuração → Sincronização → Ler QR Code**. Se você ler pela Câmera, o Safari abre uma página com essas mesmas instruções.

### O link do primeiro QR não abre o perfil

O QR do perfil vale por 10 minutos. Se o Safari mostrar que o QR expirou, toque em **Voltar** e depois em **Continuar** no computador para gerar outro, e leia com o app **Câmera**, não pela Moneta.
