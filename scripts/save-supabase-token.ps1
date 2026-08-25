$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$target = Join-Path $workspace ".env.supabase.local"
$secureToken = Read-Host "Cole o Personal Access Token do Supabase" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)

try {
  $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)

  if ([string]::IsNullOrWhiteSpace($plainToken) -or -not $plainToken.StartsWith("sbp_")) {
    throw "O valor informado não parece ser um Personal Access Token do Supabase."
  }

  [System.IO.File]::WriteAllText(
    $target,
    "SUPABASE_ACCESS_TOKEN=$plainToken",
    [System.Text.UTF8Encoding]::new($false)
  )

  Write-Host "Token salvo localmente em arquivo ignorado pelo Git."
}
finally {
  if ($tokenPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
  }

  Remove-Variable plainToken -ErrorAction SilentlyContinue
  Remove-Variable secureToken -ErrorAction SilentlyContinue
}
