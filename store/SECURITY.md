# Segurança de publicação

- A chave de upload da Google Play nunca deve ser versionada.
- Senhas e o arquivo JKS entram apenas como segredos do GitHub.
- A assinatura webOS deve permanecer fora do pacote-fonte público.
- URLs com credenciais não devem aparecer em screenshots, logs ou tickets.
- `app-ads.txt` deve conter exclusivamente vendedores autorizados.
- Tags VAST de teste não devem ser usadas em produção.
- Cada artefato de release deve ter checksum SHA-256 e corresponder ao commit aprovado.
