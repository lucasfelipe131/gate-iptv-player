# Checklist de publicação — Google Play / Android TV

## Conta e identidade

- [ ] Conta de desenvolvedor do Google Play criada e identidade verificada.
- [ ] Tipo correto escolhido: pessoa física ou organização.
- [ ] Perfil de pagamentos e dados fiscais conferidos.
- [ ] Se a conta pessoal foi criada após 13/11/2023, concluir o teste fechado exigido pelo Play Console antes de solicitar acesso à produção.

## Aplicativo

- [x] Pacote definido: `com.gateone.app.gateiptvplayer`.
- [x] `LEANBACK_LAUNCHER` configurado.
- [x] Tela sensível ao toque não obrigatória.
- [x] ARM32 e ARM64 incluídos.
- [x] Bibliotecas ARM64 verificadas para alinhamento de página de 16 KB.
- [x] `targetSdk 35` e `compileSdk 36`.
- [x] Workflow preparado para gerar AAB assinado.
- [ ] Segredos da chave de upload adicionados ao GitHub.
- [ ] Workflow “Build signed GATE TV Google Play AAB” executado com sucesso.
- [ ] AAB enviado primeiro ao teste interno.
- [ ] Instalação do bundle testada em Android TV real.

## Ficha da loja

- [x] Nome, descrição curta e descrição completa preparados.
- [x] Política de privacidade pública preparada.
- [x] Página pública de suporte preparada.
- [x] Instruções determinísticas para revisão preparadas.
- [x] Ícone 512 × 512 e gráfico promocional preparados no pacote de assets.
- [x] Banner Android TV 320 × 180 preparado no app.
- [ ] Capturar pelo menos uma imagem real, sem montagem, da versão atual rodando na TV.
- [ ] Enviar screenshots de alta resolução do painel inicial, conexão e player.
- [ ] Incluir “Android TV” na descrição da loja.
- [ ] Optar pela distribuição em Android TV no Play Console.

## Conteúdo e políticas

- [ ] Marcar “Contém anúncios” quando a tag VAST de produção estiver ativa.
- [ ] Preencher Segurança de Dados após confirmar o contrato da rede de anúncios.
- [ ] Preencher classificação indicativa com base nas funções do player, sem atribuir conteúdo externo ao GATE TV.
- [ ] Declarar que o app não é direcionado especificamente a crianças.
- [ ] Informar que o usuário fornece a própria fonte autorizada.
- [ ] Não incluir imagens de canais, serviços ou marcas sem autorização.
- [ ] Não oferecer listas ou credenciais na descrição, screenshots ou revisão.
- [ ] Publicar somente a tag VAST aprovada; nunca usar tag de demonstração em produção.
- [ ] Atualizar `app-ads.txt` com as linhas exatas da rede aprovada.

## Lançamento recomendado

- [ ] Teste interno com contas próprias.
- [ ] Teste fechado com TVs e marcas diferentes.
- [ ] Corrigir falhas relatadas pelos testadores.
- [ ] Produção inicial apenas no Brasil.
- [ ] Acompanhar ANRs, falhas, `no fill`, taxa de conclusão de anúncio e avaliações.
