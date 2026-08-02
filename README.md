# GATE IPTV PLAYER

Player web/PWA responsivo para navegadores, BlueStacks e navegação por controle remoto em Smart TVs. O aplicativo não fornece conteúdo: cada usuário conecta apenas fontes e listas que tenha autorização para utilizar.

## Recursos do MVP

- interface de 10 pés para Samsung, LG e Android TV;
- navegação por setas, OK/Enter e Voltar/Escape;
- anúncio interno de 10 segundos no plano gratuito;
- plano anual sem anúncios de R$ 30;
- conexão Xtream Codes;
- listas M3U/M3U8 por URL ou arquivo local;
- cards de canais, filmes e séries com capas, sinopses e fallback visual;
- tela de detalhes em dois cliques para filmes e séries;
- reprodução HLS adaptativa preservando a melhor qualidade disponível;
- layout adaptável a HD, Full HD, 4K, mouse, toque e controle remoto;
- validação de Portal/Ministra por URL e MAC;
- solicitação de renovação por MAC;
- PWA instalável.
- pacote LG webOS Hosted Web App em `platforms/lg-webos`.

## Executar localmente

```bash
npm install
npm start
```

Acesse `http://localhost:3000`.

## Variáveis opcionais

- `PORT`: porta do serviço (a Railway define automaticamente).
- `PAYMENT_LINK_URL`: URL segura do checkout para a assinatura anual. Sem ela, a página cria o protocolo e informa que o pagamento ainda precisa ser configurado.

## Próximas etapas de produto

O núcleo web está pronto para validação. A publicação nas lojas exige projetos de empacotamento e certificados separados para Samsung Tizen, LG webOS e Android TV.

## Pacote LG webOS

O projeto LG está em `platforms/lg-webos`. Para gerar o `.ipk` com a CLI oficial:

```bash
npm install -g @webos-tools/cli
sh scripts/package-webos.sh
```

O pacote é um Hosted Web App e abre a versão publicada na Railway. Consulte `platforms/lg-webos/STORE_SUBMISSION.md` para o material e os dados que ainda precisam ser preenchidos no LG Seller Lounge.
