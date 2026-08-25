$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "FUNIL METRICS - CONFIGURAR TOKEN DA RAILWAY" -ForegroundColor Cyan
Write-Host "Cole o token de conta da Railway abaixo. Ele nao sera exibido na tela." -ForegroundColor White
Write-Host ""

$secureRailwayToken = Read-Host "RAILWAY_API_TOKEN" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureRailwayToken)

try {
    $plainRailwayToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)

    if ([string]::IsNullOrWhiteSpace($plainRailwayToken)) {
        throw "Nenhum token foi informado."
    }

    [Environment]::SetEnvironmentVariable("RAILWAY_API_TOKEN", $plainRailwayToken, "User")
    [Environment]::SetEnvironmentVariable("RAILWAY_TOKEN", $null, "User")

    $savedRailwayToken = [Environment]::GetEnvironmentVariable("RAILWAY_API_TOKEN", "User")
    if ([string]::IsNullOrWhiteSpace($savedRailwayToken)) {
        throw "O Windows nao confirmou a gravacao do token."
    }

    Write-Host ""
    Write-Host "Token salvo e confirmado com seguranca para o usuario do Windows." -ForegroundColor Green
    Write-Host "Pode fechar esta janela e responder 'pronto' no Codex." -ForegroundColor Green
} finally {
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }

    Remove-Variable plainRailwayToken -ErrorAction SilentlyContinue
    Remove-Variable savedRailwayToken -ErrorAction SilentlyContinue
    Remove-Variable secureRailwayToken -ErrorAction SilentlyContinue
}
