# Ativação da monetização programática

## Estado atual

O GATE TV já possui integração nativa com Google IMA/VAST no Android TV e integração VAST no shell web. Sem uma tag aprovada, o aplicativo mantém a experiência local e não registra receita.

## Para ativar

1. Contratar ou ser aprovado por uma fonte de demanda de vídeo/CTV que forneça uma tag VAST HTTPS.
2. Receber as linhas oficiais de `app-ads.txt` e publicá-las em `public/app-ads.txt`.
3. Definir a variável `VAST_AD_TAG_URL` no serviço de produção da Railway.
4. Testar no-fill, timeout, conclusão, botão de pular, controle remoto e retorno ao catálogo.
5. Confirmar no relatório do parceiro as solicitações, impressões válidas, taxa de preenchimento e receita.

## Segurança

- Nunca usar tag de demonstração em produção.
- Nunca inventar linha de `app-ads.txt`.
- Nunca declarar anúncio de abertura como conteúdo in-stream quando ele for app-open/outstream.
- Nunca fornecer ou promover conteúdo sem autorização.
