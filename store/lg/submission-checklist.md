# Checklist de publicação — LG Content Store

## Conta e cadastro

- [ ] Conta criada no LG Seller Lounge como vendedor individual ou corporativo.
- [ ] Identidade, endereço, contato e dados fiscais verificados.
- [ ] Nome público do vendedor revisado antes da submissão.
- [ ] Países de distribuição selecionados; lançamento inicial recomendado no Brasil.

## Pacote webOS

- [x] App ID válido e definitivo: `com.gateone.app.gateiptvplayer`.
- [x] `appinfo.json` com título, versão, arquivo principal, ícones e descrição.
- [x] Ícone interno 80 × 80 e large icon 130 × 130 presentes.
- [x] IPK gerado e validado no CI.
- [x] Navegação por controle remoto testada no projeto.
- [ ] Instalar o IPK final pelo Developer Mode em pelo menos uma TV LG real.
- [ ] Repetir abertura, conexão M3U, reprodução, retorno e encerramento.
- [ ] Confirmar compatibilidade mínima declarada no Seller Lounge.

## Materiais da loja

- [x] Descrição curta e completa preparadas.
- [x] Política de privacidade pública preparada.
- [x] Página de suporte pública preparada.
- [x] Ícone de loja 400 × 400 preparado no pacote de assets.
- [x] Cenário de UX detalhado preparado.
- [ ] Capturar imagens reais, sem montagem, da versão webOS atual.
- [ ] Preencher o modelo oficial de UX Scenario do Seller Lounge usando o conteúdo deste repositório.
- [ ] Baixar e preencher a versão mais recente do Self Checklist oficial da LG.
- [ ] Assinar/declarar todos os documentos exigidos no portal.

## Conteúdo, privacidade e monetização

- [ ] Declarar publicidade quando a tag VAST de produção estiver ativa.
- [ ] Informar todos os fornecedores de dados/publicidade no formulário da LG.
- [ ] Publicar somente vendedores aprovados em `app-ads.txt`.
- [ ] Não incluir listas, canais ou marcas sem licença no pacote, screenshots ou descrição.
- [ ] Explicar claramente que o usuário adiciona uma fonte autorizada.
- [ ] Validar que o anúncio não bloqueia a abertura em erro ou `no fill`.
- [ ] Verificar que credenciais não aparecem em logs, screenshots ou mensagens de erro.

## QA antes do envio

- [ ] Início a frio e retorno do segundo plano.
- [ ] Direcional, OK, Voltar e foco visual.
- [ ] Fonte válida e fonte inválida.
- [ ] Perda e retorno da internet.
- [ ] Reprodução por pelo menos 30 minutos.
- [ ] Troca repetida de itens sem crescimento anormal de memória.
- [ ] Fechamento correto pelo botão Voltar.
- [ ] Páginas de privacidade, termos e suporte acessíveis.
- [ ] Lista de demonstração do revisor disponível.

## Submissão

- [ ] Fazer upload do IPK final.
- [ ] Fazer upload do ícone 400 × 400 e imagens de loja.
- [ ] Anexar UX Scenario e Self Checklist oficiais.
- [ ] Informar o e-mail lucasfelipe.oliveira@hotmail.com para contato de QA.
- [ ] Acompanhar pretest, function test e content test no Seller Lounge.
- [ ] Corrigir qualquer rejeição em nova versão; não substituir silenciosamente o pacote aprovado.
