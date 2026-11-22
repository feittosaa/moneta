# Moneta no celular

Detalhes técnicos das versões móveis. Para o passo a passo de uso, veja o [guia para celular e tablet](guia-celular.md).

## Android

O APK para Android 9 ou posterior em ARM64 inclui a interface, Node.js para Android, SQLite e as regras financeiras. A tela inicial já permite usar a carteira offline. Para consultar saldos bancários atualizados, configure a Pluggy no aparelho e siga o guia de conexão. Credenciais, senha e chave de recuperação pertencem à instalação. A cópia do cofre fica no armazenamento privado do aplicativo. Baixe um backup e guarde a chave de recuperação antes de desinstalar.

### Gerar e instalar o APK de desenvolvimento

Em Linux, use JDK 17, Android SDK Platform 35, Build Tools 35.0.0, Python 3, curl, ar, tar com suporte a xz/zstd e zip. Defina `JAVA_HOME` e `ANDROID_HOME` e rode:

```bash
android/build.sh
adb install -r dist/Moneta-Android-arm64.apk
```

Também é possível copiar o APK para o telefone e abri-lo no gerenciador de arquivos. O build verifica os hashes dos pacotes do runtime e assina o APK com a chave de desenvolvimento em `android/.local/debug.jks`. Guarde essa chave para instalar atualizações locais sobre a mesma instalação.

### APK da release

Cada tag de versão publica o `Moneta-Android-arm64.apk` na release, junto com o AppImage e o instalador do Windows. O workflow passa a versão em `MONETA_VERSION` (1.4.2 vira `versionCode` 10402) e assina com a chave fixa guardada nos segredos do repositório:

| Segredo | Conteúdo |
| --- | --- |
| `MONETA_ANDROID_KEYSTORE_BASE64` | O arquivo `.jks` da chave, em base64 (`base64 -w0 moneta-release.jks`). |
| `MONETA_ANDROID_KEYSTORE_PASSWORD` | A senha do arquivo e da chave, com alias `moneta`. |

A chave precisa ser sempre a mesma: com outra, o Android recusa instalar a versão nova por cima e só aceita depois de desinstalar, o que apaga os dados do aparelho. Guarde uma cópia do `.jks` e da senha fora do computador. Sem os segredos, a release sai sem o APK e o workflow mostra um aviso.

Para gerar localmente um APK assinado como na release:

```bash
MONETA_VERSION=1.4.0 MONETA_ANDROID_KEYSTORE=moneta-release.jks MONETA_ANDROID_KEYSTORE_PASSWORD=... android/build.sh
```

## Vincular aparelhos

Cada Moneta funciona sozinha: computador, Android, iPhone e iPad têm cofre próprio e conectam os bancos pela Pluggy por conta própria. O vínculo é opcional e aceita vários aparelhos ao mesmo tempo.

1. Abra a Moneta nos dois aparelhos, na mesma rede Wi-Fi, e destranque os cofres.
2. Numa instalação nova, a primeira abertura pergunta se você já usa a Moneta em outro aparelho. **Ler QR Code** traz os dados de lá sem criar um cofre do zero; veja [Senha na primeira abertura](#senha-na-primeira-abertura). Numa Moneta que já tem dados, a primeira abertura pergunta se você quer usá-la em outro aparelho. A opção também fica em **Configuração → Sincronização entre aparelhos → Mostrar QR de vínculo**.
3. Escolha o tipo do outro aparelho e siga as instruções da tela. O QR vale por dois minutos.
4. Para Android ou outro computador, use **Ler QR de outro aparelho** no outro lado, pela câmera ou por uma foto do QR. Para iPhone, iPad e Android, o primeiro QR instala a Moneta no celular.

Depois do vínculo, a lista em **Configuração** mostra cada aparelho e a hora da última troca. Para encerrar um vínculo, toque em **Desvincular** ao lado do aparelho.

### Senha na primeira abertura

Quando a primeira abertura de uma instalação nova lê o QR de uma Moneta com modo cofre, o aparelho novo pede a senha dessa Moneta. A senha vai cifrada pelo vínculo e é conferida pela Moneta de origem, com a mesma espera crescente depois de três erros do desbloqueio. A origem só aceita essa conferência nos 10 minutos seguintes ao vínculo. Com a senha certa:

- **Computador e Android:** o modo cofre liga com a mesma senha e o mesmo tempo de inatividade da origem. O cofre ganha uma chave de recuperação própria, mostrada em **Configuração → Cofre do banco**.
- **iPhone e iPad:** o cofre é criado com a mesma senha.

Se a origem não usa senha, o computador e o Android continuam sem senha, com a chave lacrada pelo sistema; o iPhone e o iPad pedem uma senha nova, com a opção **Usar sem senha**. Depois do vínculo, cada aparelho guarda a própria senha: trocar a senha num deles não muda a do outro.

### Como a sincronização funciona

Os aparelhos trocam alterações a cada 15 segundos enquanto a Moneta está aberta e destrancada nos dois. Cada aparelho registra a hora de cada alteração. Se o mesmo item mudar em dois aparelhos antes da troca, vale a edição mais recente. Exclusões também se propagam. Para uma coleta bancária, vale a coleta mais recente. Como o resultado não depende da ordem das trocas, um aparelho vinculado a outros dois repassa as alterações entre eles. Por exemplo, um iPhone e um Android vinculados ao mesmo computador recebem as alterações um do outro através dele.

Os relógios dos aparelhos definem qual edição é a mais recente. Mantenha a hora automática ligada em todos.

As trocas são autenticadas e cifradas com AES-256-GCM, com chave própria para cada vínculo. A API do painel, os backups, a senha, a chave de recuperação e as credenciais da Pluggy não saem do aparelho.

### Rede

A comunicação usa IPv4 privado. Entre Monetas com servidor (computador e Android), o padrão é TCP 4174, com descoberta por UDP 4174 quando o endereço muda. A Moneta Web conecta por HTTPS na porta TCP 4175. Se o firewall do computador perguntar, permita conexões na rede privada. Em redes com isolamento de clientes, como Wi-Fi de visitantes, a troca espera até os aparelhos estarem numa rede que permita comunicação direta.

## Moneta Web no iPhone e iPad

Siga os passos em [Instalação no iPhone e iPad](../README.md#iphone-e-ipad). Você pode começar sem senha. Em **Configuração → Cofre neste aparelho**, pode ativar ou desativar o modo cofre a qualquer momento.

### Conectar bancos no iPhone ou iPad

Ative o modo cofre e cadastre o Client ID e o Client Secret em **Configuração → Credenciais Pluggy**. Depois, use **Conexões → Conectar instituição**. As credenciais ficam no cofre cifrado do aparelho. Se você desativar o modo cofre, a Moneta apaga as credenciais.

O iOS não executa sites em segundo plano. Por isso, a Moneta Web atualiza os bancos ao abrir e a cada 6 horas enquanto estiver aberta. Toque em **Sincronizar**, no topo, para atualizar na hora.

### Sincronizar com o computador ou o Android

O Safari só deixa a Moneta Web falar com outra Moneta por HTTPS. Cada computador ou Android cria a própria autoridade de certificados, e o iPhone ou iPad passa a confiar nela uma única vez:

1. No computador, abra **Configuração → Sincronização entre aparelhos → Mostrar QR de vínculo → iPhone ou iPad**.
2. Se a Moneta ainda não está no iPhone ou iPad, leia o primeiro QR com o app **Câmera** para instalá-la. Depois, no computador, toque em **Já instalei, continuar** e aponte a **Câmera** para o QR do perfil. Abra o link no Safari e toque em **Permitir** para baixar o perfil.
3. Abra **Ajustes → Perfil Baixado → Instalar**.
4. Em **Ajustes → Geral → Sobre → Ajustes de Confiança de Certificados**, ative a Moneta.
5. No computador, toque em **Já instalei o perfil, continuar**.
6. Na Moneta do iPhone ou iPad, toque em **Sim, ler QR Code** na primeira abertura ou em **Configuração → Sincronização → Ler QR Code**. Permita a câmera e aponte para o QR.

Os passos 2 a 4 são feitos uma vez por aparelho. Para vincular outro iPhone ou iPad ao mesmo computador, eles se repetem só no aparelho novo.

O certificado vale apenas para endereços de rede privada (10.x, 172.16 a 172.31 e 192.168.x). Ele não serve para sites da internet, nem nas mãos de quem copiar a chave do computador. Para removê-lo, apague o perfil em **Ajustes → Geral → VPN e Gerenciamento de Dispositivo**. Se o endereço do computador na rede mudar, ele emite um certificado novo sozinho, mas o iPhone precisa ler o QR de vínculo outra vez.

Dois iPhones ou iPads não sincronizam diretamente entre si, porque o navegador não recebe conexões. Vincule os dois ao mesmo computador ou Android.

### Backup

Para guardar seus lançamentos, abra **Configuração → Backup** e toque em **Baixar backup cifrado**. Guarde o arquivo no app **Arquivos**. Para restaurá-lo, use a senha que você tinha quando baixou o backup. Se o modo cofre estiver desligado, a Moneta pede uma senha só para o arquivo exportado. O backup não leva os vínculos nem as credenciais da Pluggy.

### Compilar e disponibilizar

```bash
npm --prefix web ci --ignore-scripts
npm --prefix web run build
npm --prefix web test
```

O build gera `dist/web`. Para testar no computador, sirva essa pasta em `localhost`. Para instalar pelo iPhone ou iPad, use HTTPS. A Moneta só aceita sincronizar com a Moneta Web publicada em `https://feittosaa.github.io`. Para publicar em outro endereço, inicie a Moneta com `MONETA_WEB_ORIGIN` apontando para ele, sem caminho. O workflow manual **Moneta Web** publica os arquivos estáticos quando **GitHub Actions** é selecionado como fonte em **Settings → Pages**. O endereço padrão do repositório pode ser usado sem domínio próprio. [Publicação com GitHub Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
