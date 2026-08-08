# GATE TV

Player híbrido web/PWA e Android TV para navegadores, BlueStacks e Smart TVs. O aplicativo não fornece conteúdo: cada usuário conecta apenas fontes e listas que tenha autorização para utilizar.

## Recursos da versão 0.5.1

- conexão Xtream Codes e listas M3U/M3U8 por URL ou arquivo local;
- reconexão automática no mesmo aparelho, com os dados salvos apenas localmente;
- favoritos persistentes para canais, filmes e séries;
- interface de 10 pés e navegação por setas, OK/Enter, Voltar/Escape e tecla verde;
- cards com capas, sinopses, programação e fallback visual;
- prévia no primeiro clique e tela cheia no segundo, sem criar reproduções duplicadas;
- navegador com HLS.js para HLS e mpegts.js para MPEG-TS;
- Android com LibVLC como motor principal e Media3/ExoPlayer como fallback;
- tentativa direta no provedor antes do proxy Railway, com troca automática de rota e formato em caso de falha;
- recuperação de travamentos, reconexão, redução de latência ao vivo e limpeza de buffers;
- layout adaptável a HD, Full HD, 4K, mouse, toque e controle remoto;
- validação de Portal/Ministra por URL e MAC;
- PWA instalável e pacote LG webOS Hosted Web App em `platforms/lg-webos`.

## Executar localmente

```bash
npm install
npm start
```

Acesse `http://localhost:3000`.

Para executar os testes:

```bash
npm test
```

## APK Android TV e BlueStacks

O projeto nativo está em `platforms/android-native`. Cada atualização relevante da branch `main` executa os testes web, o lint Android e gera o APK de depuração no GitHub Actions.

Para compilar localmente com Android SDK e Java 17 configurados:

```bash
cd platforms/android-native
gradle :app:lintDebug :app:assembleDebug
```

O APK usa o catálogo web publicado e entrega a reprodução ao player nativo por uma ponte JavaScript explícita. O mesmo stream é reaproveitado ao alternar entre prévia e tela cheia.

## Variáveis opcionais

- `PORT`: porta do serviço (a Railway define automaticamente).
- `PAYMENT_LINK_URL`: URL segura do checkout para a assinatura anual. Sem ela, a página cria o protocolo e informa que o pagamento ainda precisa ser configurado.

## Compatibilidade

O player cobre HLS e MPEG-TS nos formatos e codecs aceitos pelo navegador ou pelo dispositivo Android. Nenhum aplicativo consegue garantir listas expiradas, servidores indisponíveis, DRM ou codecs ausentes no hardware; nesses casos o GATE TV apresenta o erro recebido e tenta automaticamente as rotas e os motores compatíveis antes de desistir.

A publicação em lojas exige contas, certificados e revisão separados para Samsung Tizen, LG webOS e Android TV.

## Pacote LG webOS

O projeto LG está em `platforms/lg-webos`. Para gerar o `.ipk` com a CLI oficial:

```bash
npm install -g @webos-tools/cli
sh scripts/package-webos.sh
```

O pacote é um Hosted Web App e abre a versão publicada na Railway. Consulte `platforms/lg-webos/STORE_SUBMISSION.md` para o material e os dados que ainda precisam ser preenchidos no LG Seller Lounge.
