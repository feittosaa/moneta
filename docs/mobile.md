# Moneta no celular

## Android

O APK para Android 9 ou posterior em ARM64 inclui a interface, Node.js para Android, SQLite e as regras financeiras. A tela inicial já permite usar a carteira offline. Para consultar saldos bancários atualizados, configure a Pluggy no aparelho e siga o guia de conexão. Credenciais, senha e chave de recuperação pertencem à instalação. A cópia do cofre fica no armazenamento privado do aplicativo. Baixe um backup e guarde a chave de recuperação antes de desinstalar.

### Gerar e instalar o APK de desenvolvimento

Em Linux, use JDK 17, Android SDK Platform 35, Build Tools 35.0.0, Python 3, curl, ar, tar com suporte a xz/zstd e zip. Defina `JAVA_HOME` e `ANDROID_HOME` e rode:

```bash
android/build.sh
adb install -r dist/Moneta-Android-arm64.apk
```

Também é possível copiar o APK para o telefone e abri-lo no gerenciador de arquivos. O build verifica os hashes dos pacotes do runtime e assina o APK com a chave de desenvolvimento em `android/.local/debug.jks`. Guarde essa chave para instalar atualizações locais sobre a mesma instalação. A distribuição pela loja exigirá assinatura de distribuição.

## Vincular celular e computador

1. Abra a versão com suporte a vínculo nos dois aparelhos e destranque os cofres. Use uma rede Wi-Fi que permita comunicação entre os dispositivos.
2. Na primeira abertura, escolha **Vincular por QR Code** ou siga usando só esse aparelho. A opção também fica em **Configuração → Sincronização entre aparelhos**.
3. Escolha **Mostrar QR de vínculo** em qualquer um dos dois. O código vale por dois minutos. No outro, use **Ler QR com a câmera** ou selecione uma foto e confirme.
4. Confira a hora da última troca. Feche um dos painéis, registre lançamentos no outro e abra ambos novamente. O vínculo é lembrado e as alterações entram automaticamente.

O painel verifica o par ao abrir ou voltar ao primeiro plano. O intervalo de nova tentativa é de 15 segundos. Cada lado pode registrar alterações offline. A comunicação usa IPv4 privado e a porta TCP indicada no QR no aparelho que o mostrou. A Moneta tenta a porta 4174 e escolhe uma livre se ela já estiver ocupada. A descoberta após mudança de endereço usa UDP 4174. Em redes com isolamento de clientes, a troca aguarda uma rede que permita comunicação direta. Em Docker, prefira mostrar o QR no celular e lê-lo no painel do contêiner para que a conexão TCP saia do contêiner.

As trocas são autenticadas e cifradas com AES-256-GCM. O convite inicial permite estabelecer uma chave própria do par. A API do painel, os backups e os segredos de acesso continuam locais. Para trocar o aparelho vinculado, use **Desvincular aparelho** em ambas as instalações.

A conciliação usa os registros da última troca confirmada. Lançamentos distintos feitos offline são reunidos, e exclusões são propagadas. Se o mesmo registro mudar nos dois lados entre duas trocas, prevalece a edição do aparelho que mostrou o QR. Para uma coleta bancária do mesmo item, prevalece a coleta mais recente. Cada instalação mantém suas credenciais da Pluggy para atualizar bancos por conta própria.

## Caminho para iOS

Para um iPhone que funcione sozinho, a proposta é empacotar a interface local com WKWebView, manter SQLite no aparelho e adaptar as operações que hoje dependem de Node, como arquivos, cofre e rede. As regras JavaScript compartilhadas podem rodar em JavaScriptCore. A primeira prova de conceito deve abrir um cofre offline e trocar dados com esta versão do desktop usando o mesmo protocolo. [JavaScriptCore na documentação da Apple](https://developer.apple.com/documentation/javascriptcore)

O app deve explicar o uso da rede local no primeiro vínculo e pedir acesso à câmera ao ler o QR. A descoberta por broadcast precisa ser avaliada com as restrições de multicast da Apple. O teste inicial pode usar o endereço indicado no QR. [Privacidade de rede local no iOS](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)

A validação final requer um build assinado em Xcode e teste em iPhone. Para distribuir uma beta, o caminho é enviar o build ao App Store Connect e convidar os testadores no TestFlight. [Distribuição pelo TestFlight](https://developer.apple.com/testflight/)

## Moneta Web no iPhone e iPad

A versão web usa o mesmo painel e as mesmas regras de carteira, categorias, vales e relatórios. O navegador executa SQLite localmente. O banco fica cifrado no armazenamento do app web e a senha é necessária para abrir ou restaurar o cofre. A versão inicial oferece lançamentos manuais e backup local. A conexão com a Pluggy e o vínculo por QR ficam para uma etapa posterior.

### Instalar no aparelho

1. Abra o endereço HTTPS da Moneta Web no Safari. Escolha **Adicionar à Tela de Início** e habilite **Abrir como App da Web**. [Instruções da Apple](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)
2. Abra pelo ícone enquanto ainda estiver online e crie um cofre. Aguarde **Disponível offline** no rodapé do menu. Use o ícone como entrada para o uso diário.
3. Para conferir, ative o modo avião, abra a carteira e registre um gasto. Feche e abra de novo para verificar o lançamento.
4. Em **Configuração → Backup**, baixe uma cópia cifrada e guarde fora do navegador. O arquivo `.monetaweb` usa a senha que valia na exportação e pode ser restaurado ao criar um cofre em outro aparelho. Limpar os dados do app web pode remover a cópia local. [Armazenamento do WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/)

### Compilar e disponibilizar

```bash
npm --prefix web ci --ignore-scripts
npm --prefix web run build
npm --prefix web test
```

O build gera `dist/web`. Para testar no computador, sirva essa pasta em `localhost`. Para instalar pelo iPhone ou iPad, use HTTPS. O workflow manual **Moneta Web** publica os arquivos estáticos quando **GitHub Actions** é selecionado como fonte em **Settings → Pages**. O endereço padrão do repositório pode ser usado sem domínio próprio. [Publicação com GitHub Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
