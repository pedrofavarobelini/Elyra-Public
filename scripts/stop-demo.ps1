# Desliga o que `npm run demo` subiu (Era 6).
#
# Uso:
#   npm run demo:stop              # para a aplicacao e o Supabase local
#   npm run demo:stop -- -KeepDb   # para so a aplicacao, mantem o banco no ar

[CmdletBinding()]
param(
  [switch]$KeepDb,
  [int]$Port = 3000
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pidFile = Join-Path $root ".demo/app.pid"

Write-Host "==> Aplicacao" -ForegroundColor Cyan
# Primeiro o PID que o start gravou; a varredura por porta fica como rede de seguranca.
if (Test-Path $pidFile) {
  $registrado = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($registrado) {
    $proc = Get-Process -Id ([int]$registrado) -ErrorAction SilentlyContinue
    if ($proc) {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      Write-Host "    encerrado processo registrado (pid $($proc.Id))" -ForegroundColor Green
    }
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

$conexoes = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conexoes) {
  Write-Host "    nada escutando na porta $Port" -ForegroundColor DarkGray
} else {
  foreach ($processId in ($conexoes | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq "node") {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
      Write-Host "    encerrado node (pid $processId)" -ForegroundColor Green
    } else {
      Write-Host "    porta $Port ocupada por $($proc.ProcessName) (pid $processId) — nao mexi" -ForegroundColor Yellow
    }
  }
}

if ($KeepDb) {
  Write-Host "==> Supabase local mantido no ar (-KeepDb)" -ForegroundColor DarkGray
  exit 0
}

Write-Host "==> Supabase local" -ForegroundColor Cyan
# `supabase stop` preserva os dados: ele para os containers, nao apaga volume.
npm run supabase:stop
if ($LASTEXITCODE -eq 0) {
  Write-Host "    Supabase parado (os dados locais continuam no volume)" -ForegroundColor Green
} else {
  Write-Host "    nao consegui parar o Supabase; rode: npx supabase stop" -ForegroundColor Yellow
}
