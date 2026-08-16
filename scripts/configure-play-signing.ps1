[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path $_ -PathType Leaf })]
    [string]$KeystorePath,

    [string]$Repository = "lucasfelipe131/gate-iptv-player"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI não encontrado. Instale o gh e execute 'gh auth login' antes deste script."
}

$authStatus = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "O GitHub CLI não está autenticado. Execute 'gh auth login'.`n$authStatus"
}

$resolvedPath = (Resolve-Path $KeystorePath).Path
$storePassword = Read-Host "Senha do keystore"
$keyAlias = Read-Host "Alias da chave (ex.: gate-upload)"
$keyPassword = Read-Host "Senha da chave"

if ([string]::IsNullOrWhiteSpace($storePassword) -or
    [string]::IsNullOrWhiteSpace($keyAlias) -or
    [string]::IsNullOrWhiteSpace($keyPassword)) {
    throw "Nenhum valor pode ficar vazio."
}

$keystoreBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($resolvedPath))

function Set-RepositorySecret {
    param([string]$Name, [string]$Value)
    $Value | gh secret set $Name --repo $Repository
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível configurar o secret $Name." }
    Write-Host "Configurado: $Name" -ForegroundColor Green
}

Set-RepositorySecret -Name "ANDROID_KEYSTORE_BASE64" -Value $keystoreBase64
Set-RepositorySecret -Name "ANDROID_KEYSTORE_PASSWORD" -Value $storePassword
Set-RepositorySecret -Name "ANDROID_KEY_ALIAS" -Value $keyAlias
Set-RepositorySecret -Name "ANDROID_KEY_PASSWORD" -Value $keyPassword

Write-Host "`nSegredos configurados. Para gerar o AAB:" -ForegroundColor Cyan
Write-Host "gh workflow run build-play-release.yml --repo $Repository"
Write-Host "gh run watch --repo $Repository"
