# Sobe a Elyra localmente para demonstracao (Era 6/7).
#
# Uso:
#   npm run demo                # build de producao + Supabase local + app
#   npm run demo -- -Dev        # modo desenvolvimento (recarrega ao editar)
#   npm run demo -- -Port 3001  # outra porta
#   npm run demo:stop           # desliga o que este script subiu
#
# Ordem: pre-requisitos, Supabase local, migrations pendentes (sem apagar dado),
# porta, build, aplicacao, espera de readiness e o contrato de saida:
#
#   ELYRA READY
#   URL = http://localhost:3000
#
# Nenhum segredo e impresso: o script diz se a variavel existe, nunca o valor.
# Nenhum reset de banco acontece aqui — reconstruir e decisao explicita
# (`npm run qa:db:reset`), nunca efeito colateral de subir para apresentar.

[CmdletBinding()]
param(
  [switch]$Dev,
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logDir = Join-Path $root ".demo"
$appLog = Join-Path $logDir "app.log"
$pidFile = Join-Path $logDir "app.pid"

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "    ok: $text" -ForegroundColor Green }
function Info($text) { Write-Host "    $text" -ForegroundColor DarkGray }
function Falha($text, $comoResolver) {
  Write-Host "    ERRO: $text" -ForegroundColor Red
  Write-Host "    Como resolver: $comoResolver" -ForegroundColor Yellow
  exit 1
}

Step "Pre-requisitos"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Falha "Node nao encontrado." "Instale o Node 24 ou superior: https://nodejs.org"
}
$nodeMajor = [int]((node --version) -replace "^v(\d+)\..*", '$1')
if ($nodeMajor -lt 20) { Falha "Node $nodeMajor e antigo demais." "Use Node 20 ou superior (o projeto roda em 24)." }
Ok "node $(node --version)"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Falha "Docker nao encontrado." "Instale e abra o Docker Desktop; o Supabase local roda em containers."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Falha "Docker esta instalado mas nao esta rodando." "Abra o Docker Desktop e espere ficar verde." }
Ok "docker respondendo"

if (-not (Test-Path ".env.local")) {
  Falha "Falta o arquivo .env.local." "Rode: npm run qa:env:local (ele gera o arquivo a partir do Supabase local)."
}
Ok ".env.local presente (valores nao sao exibidos)"

# Dependencias x package-lock.json (QA do owner 27/09): antes so instalava
# quando faltava o `next`, e um `git pull` com dependencia nova (maplibre-gl)
# passava direto. Agora confere o hash do lockfile e cada dependencia direta;
# fora de sincronia -> `npm ci` (instala exatamente o lockfile, nunca o altera).
$depCheck = if (Test-Path "node_modules") { node scripts/check-dependencies.mjs } else { "DEPENDENCIES=OUT_OF_SYNC reason=primeira instalacao (sem node_modules)" }
if ($LASTEXITCODE -ne 0 -or -not (Test-Path "node_modules")) {
  $motivo = ($depCheck | Select-Object -Last 1) -replace "^DEPENDENCIES=OUT_OF_SYNC reason=", ""
  Step "Dependencias fora de sincronia ($motivo) — sincronizando (npm ci)"
  npm ci
  if ($LASTEXITCODE -ne 0) {
    Falha "npm ci falhou." "Se a Elyra estiver aberta, rode npm run demo:stop (arquivos em uso travam no Windows); depois confira a conexao e rode npm run demo de novo."
  }
  node scripts/check-dependencies.mjs --record | Out-Null
  if ($LASTEXITCODE -ne 0) { Falha "npm ci terminou, mas faltam pacotes do package-lock." "Rode npm ci manualmente e leia o primeiro erro." }
  Ok "dependencias sincronizadas com o package-lock (npm ci)"
} else {
  Ok "dependencias conferidas: package-lock inalterado e pacotes presentes"
}

New-Item -ItemType Directory -Force -Path $logDir *> $null

Step "Supabase local"
npm run supabase:start
if ($LASTEXITCODE -ne 0) { Falha "Supabase local nao subiu." "Veja a saida acima; normalmente e Docker sem memoria. Feche outros containers e tente de novo." }
Ok "Supabase local no ar"

Step "Migrations"
<#
  Fonte de verdade: os arquivos em `supabase/migrations` contra a tabela
  `supabase_migrations.schema_migrations` do banco local.

  Por que nao usar `supabase migration list --output json`: chamado de um
  PowerShell nao interativo, o CLI nao entrega o JSON na saida capturavel (a
  stderr vira ErrorRecord e o JSON se perde). Medido nesta maquina. Comparar
  arquivo x tabela funciona em qualquer shell e diz a mesma coisa.

  Nada aqui apaga dado: pendencia e aplicada com `migration up`. Reconstruir o
  banco continua sendo decisao explicita (`npm run qa:db:reset`).
#>
$anterior = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$aplicadasRaw = (docker exec -i supabase_db_elyra-public-snapshot-local psql -U postgres -At -c "select version from supabase_migrations.schema_migrations" 2>&1 | Out-String)
$ErrorActionPreference = $anterior

$aplicadas = @($aplicadasRaw -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d{10,}$' })
$arquivos = @(Get-ChildItem -Path (Join-Path $root "supabase/migrations") -Filter *.sql -ErrorAction SilentlyContinue |
  ForEach-Object { ($_.Name -split "_")[0] } | Where-Object { $_ -match '^\d{10,}$' })

if ($arquivos.Count -eq 0) {
  Info "nenhum arquivo de migration encontrado - seguindo"
} elseif ($aplicadas.Count -eq 0) {
  Info "nao consegui ler o historico aplicado no banco"
  Info "se algo falhar depois, reconstrua explicitamente: npm run qa:db:reset"
} else {
  $pendentes = @($arquivos | Where-Object { $aplicadas -notcontains $_ })
  if ($pendentes.Count -eq 0) {
    Ok "banco alinhado ($($arquivos.Count) migrations aplicadas)"
  } else {
    Info "$($pendentes.Count) migration(s) pendente(s) - aplicando sem apagar dados"
    $ErrorActionPreference = "Continue"
    npx supabase migration up --local
    $codigo = $LASTEXITCODE
    $ErrorActionPreference = $anterior
    if ($codigo -ne 0) {
      Falha "nao foi possivel aplicar as migrations pendentes." "Se o banco local estiver inconsistente, reconstrua explicitamente: npm run qa:db:reset"
    }
    Ok "migrations aplicadas"
  }
}

# Rede de Apoio na demo (QA do owner 27/09: "ainda nao tem dados"). Com o
# CNES real desligado (licenca), a demonstracao usa a fixture [DEMO], sempre
# marcada como ficticia. So banco LOCAL; dado real ativo tem precedencia.
Step "Rede de Apoio (demonstracao)"
$demo = node scripts/import-support-network.mjs --ensure-demo 2>&1
if ($LASTEXITCODE -ne 0) {
  Info "nao foi possivel preparar a fixture [DEMO] da Rede de Apoio (o resto da demo segue)"
  Info (($demo | Select-Object -Last 1) -as [string])
} else {
  $estadoDemo = (($demo | Select-String "SUPPORT_DEMO=") | Select-Object -Last 1) -as [string]
  Ok $estadoDemo.Trim()
}

Step "Porta $Port"
$ocupada = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($ocupada) {
  $pids = ($ocupada | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($processId in $pids) {
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq "node") {
      Info "porta ocupada por node (pid $processId) — encerrando"
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    } else {
      Falha "Porta $Port ocupada por $($proc.ProcessName) (pid $processId)." "Feche esse programa ou rode: npm run demo -- -Port 3001"
    }
  }
  Start-Sleep -Seconds 2
}
Ok "porta $Port livre"

if ($Dev) {
  # `npm run dev`, e nao `npx next dev`: so assim o `predev` roda (confere o
  # banco, publica o worker do MapLibre em public/vendor e gera os conteudos).
  # Antes o -Dev pulava o predev e o mapa ficava sem worker (QA do owner 27/09).
  # Rede de Apoio editorial: os artigos ainda em REVIEW aparecem com a faixa
  # "Pre-visualizacao editorial" so aqui (dev + Supabase local; a trava do
  # servidor recusa em producao). Nada e publicado nem revisado por isso.
  $env:ELYRA_SUPPORT_CONTENT_PREVIEW = "review"
  Step "Subindo em modo desenvolvimento (predev + next dev; Ctrl+C encerra)"
  Write-Host ""
  Write-Host "ELYRA READY (dev)" -ForegroundColor Green
  Write-Host "URL = http://localhost:$Port" -ForegroundColor Green
  Write-Host ""
  npm run dev -- --port $Port
  exit $LASTEXITCODE
}

Step "Build de producao"
npm run build
if ($LASTEXITCODE -ne 0) { Falha "O build falhou." "Rode npm run build e leia o primeiro erro." }
Ok "build pronto"

Step "Subindo a Elyra"
# Processo separado, com log em .demo/: o script termina e a aplicacao continua
# no ar, para a apresentacao nao depender desta janela ficar aberta.
# `node` com o binario do Next, e nao `npx`: `Start-Process` recusa o shim `.cmd`
# do npm ("%1 nao e um aplicativo Win32 valido") — descoberto executando.
$nextBin = Join-Path $root "node_modules/next/dist/bin/next"
$app = Start-Process -FilePath "node" -ArgumentList @($nextBin, "start", "--port", "$Port") `
  -RedirectStandardOutput $appLog -RedirectStandardError (Join-Path $logDir "app.err.log") `
  -NoNewWindow -PassThru
Set-Content -Path $pidFile -Value $app.Id -Encoding ascii

# Readiness pela origem canonica, e nao por 127.0.0.1.
#
# A Elyra canonicaliza 127.0.0.1:<porta> para localhost:<porta> no proxy, de
# proposito: WebAuthn exige RP ID de dominio e a sessao/PKCE precisa nascer no
# mesmo host que a Passkey vai enxergar (ver src/lib/security/local-qa-origin.ts).
# O probe antigo batia justamente no host que o produto redireciona, e o
# Invoke-WebRequest do PowerShell 5.1 terminava em "numero excessivo de
# redirecionamentos" - com o Next perfeitamente no ar, ja com "Ready in" no log
# e a porta em LISTEN. Resultado: `npm run demo` dizia ERRO sobre uma aplicacao
# saudavel, na vespera da apresentacao.
#
# O readiness passa a usar a mesma URL que o script anuncia no final. Nenhum
# redirecionamento e esperado aqui; se um aparecer, e sintoma e nao ruido, entao
# ele e reportado em vez de ser seguido em silencio.
$readinessUrl = "http://localhost:$Port/entrar"
$pronta = $false
$ultimaFalha = "nenhuma tentativa concluida"
foreach ($tentativa in 1..60) {
  Start-Sleep -Seconds 1
  if ($app.HasExited) { $ultimaFalha = "o processo do Next saiu com codigo $($app.ExitCode)"; break }
  try {
    $resposta = Invoke-WebRequest -Uri $readinessUrl -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0 -ErrorAction Stop
    if ($resposta.StatusCode -eq 200) { $pronta = $true; break }
    $ultimaFalha = "resposta HTTP $($resposta.StatusCode)"
  } catch {
    $ultimaFalha = $_.Exception.Message
  }
}

if (-not $pronta) {
  $errLog = Join-Path $logDir "app.err.log"
  Write-Host "    ERRO: $readinessUrl nao respondeu 200." -ForegroundColor Red
  Write-Host "    Ultima falha: $ultimaFalha" -ForegroundColor Yellow
  Write-Host "    Log de saida: $appLog" -ForegroundColor Yellow
  Write-Host "    Log de erro:  $errLog" -ForegroundColor Yellow
  Write-Host "    Encerre com: npm run demo:stop" -ForegroundColor Yellow
  exit 1
}

Ok "aplicacao respondendo"
Write-Host ""
Write-Host "ELYRA READY" -ForegroundColor Green
Write-Host "URL = http://localhost:$Port" -ForegroundColor Green
Write-Host ""
Info "conta de demonstracao: npm run demo:account"
Info "Supabase Studio (so local): http://127.0.0.1:54383"
Info "para encerrar: npm run demo:stop"
