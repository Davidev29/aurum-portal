#Requires -Version 5.1
<#
.SYNOPSIS
  Monitor local do CI (GitHub Actions) - notifica a cada run e devolve exit code.

.DESCRIPTION
  Dois modos:
    (padrao)  Observa o ultimo run do branch (ou -RunId) ate concluir;
              notifica (balao do Windows + beep) e sai com 0 (verde) ou 1 (vermelho/timeout/erro fatal).
              Se o ultimo run JA estiver concluido, notifica mesmo assim e sai.
    -Follow   Monitoramento continuo: a cada run que passar a 'completed', notifica.
              Nao termina sozinho - encerre com Ctrl+C.

  Pre-requisito: GitHub CLI ('gh') autenticado (gh auth login).

.EXAMPLE
  .\scripts\ci-watch.ps1
  .\scripts\ci-watch.ps1 -Branch main -PollSeconds 10
  .\scripts\ci-watch.ps1 -RunId 43612027047
  .\scripts\ci-watch.ps1 -Follow
  .\scripts\ci-watch.ps1 -NoBalloon         # so console + beep (sem janela)
#>
[CmdletBinding()]
param(
  [string]$Branch = '',
  [string]$RunId = '',
  [int]$PollSeconds = 15,
  [int]$TimeoutMinutes = 30,
  [switch]$Follow,
  [switch]$NoBalloon
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Fail([string]$msg, [int]$code = 2) {
  Write-Host "[ci-watch] ERRO: $msg" -ForegroundColor Red
  exit $code
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Fail "GitHub CLI 'gh' nao encontrado no PATH. Instale com: winget install GitHub.cli"
}
if (-not (Test-Path .git)) {
  Fail "Execute na raiz do repositorio (pasta com .git)."
}
try {
  $null = & gh auth status 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "'gh' nao autenticado. Rode: gh auth login" }
} catch {
  Fail "'gh auth status' falhou: $($_.Exception.Message). Rode: gh auth login"
}

if (-not $Branch) {
  try { $Branch = (& git branch --show-current 2>$null) } catch { $Branch = '' }
  if (-not $Branch) { $Branch = 'main' }
}

$cOk = 'Green'; $cFail = 'Red'; $cInfo = 'Cyan'; $cWarn = 'Yellow'

function Write-Step([string]$msg) { Write-Host "[ci-watch] $msg" -ForegroundColor $cInfo }

function Send-Notification([string]$title, [string]$message, [string]$kind) {
  # Beep sempre funciona (nao depende de UI)
  try {
    if ($kind -eq 'fail') {
      [Console]::Beep(880, 250); [Console]::Beep(660, 250); [Console]::Beep(440, 550)
    } else {
      [Console]::Beep(660, 180); [Console]::Beep(880, 280)
    }
  } catch { }
  if ($NoBalloon) { return }
  try {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    Add-Type -AssemblyName System.Drawing | Out-Null
    $icon = New-Object System.Windows.Forms.NotifyIcon
    $icon.Icon = if ($kind -eq 'fail') { [System.Drawing.SystemIcons]::Error } else { [System.Drawing.SystemIcons]::Information }
    $icon.Visible = $true
    $icon.BalloonTipTitle = $title
    $icon.BalloonTipText = $message
    $icon.ShowBalloonTip(8000)
    Start-Sleep -Milliseconds 400
    $icon.Visible = $false
    $icon.Dispose()
  } catch {
    Write-Host "[ci-watch] (balao indisponivel: $($_.Exception.Message))" -ForegroundColor $cWarn
  }
}

function Get-RunDetails([string]$id) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $json = & gh run view $id --json databaseId,name,status,conclusion,url,jobs 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($code -ne 0) {
    $msg = ($json | Out-String).Trim()
    $err = New-Object System.Exception "gh run view $id falhou: $msg"
    # 404 = run inexistente/sem acesso -> permanente; nao adianta re-tentar por 30 min.
    $err.Data['Permanent'] = ($msg -match '(?i)404|not found')
    throw $err
  }
  return ($json | ConvertFrom-Json)
}

function Get-RunList([string]$branch, [int]$limit) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $json = & gh run list --branch $branch --limit $limit --json databaseId,name,status,conclusion,url 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($code -ne 0) { Fail "gh run list --branch $branch falhou: $($json | Out-String)" }
  return ($json | ConvertFrom-Json)
}

function Complete-Run($run) {
  $ok = ($run.conclusion -eq 'success')
  Write-Host ''
  Write-Host ("[ci-watch] run {0} - {1} - {2}" -f $run.databaseId, $run.conclusion, $run.name) -ForegroundColor $(if ($ok) { $cOk } else { $cFail })
  Write-Host "  url: $($run.url)"
  if ($run.jobs) {
    foreach ($job in $run.jobs) {
      Write-Host ("  job: {0} -> {1}" -f $job.name, $job.conclusion) -ForegroundColor $(if ($job.conclusion -eq 'success') { $cOk } else { $cFail })
    }
  }
  $title = if ($ok) { 'CI verde (main)' } else { 'CI VERMELHO' }
  $msg = "$($run.name)`n$($run.conclusion)`n$($run.url)"
  Send-Notification $title $msg ($(if ($ok) { 'ok' } else { 'fail' }))
  if ($ok) { return 0 } else { return 1 }
}

if ($Follow) {
  Write-Step "modo continuo no branch '$Branch' - Ctrl+C para sair"
  $seen = @{}
  foreach ($r in (Get-RunList $Branch 10)) {
    if ($r.status -eq 'completed') { $seen[$r.databaseId] = $true }
  }
  while ($true) {
    Start-Sleep -Seconds $PollSeconds
    try {
      foreach ($r in (Get-RunList $Branch 10)) {
        if (-not $seen.ContainsKey($r.databaseId) -and $r.status -eq 'completed') {
          $seen[$r.databaseId] = $true
          try {
            [void](Complete-Run (Get-RunDetails $r.databaseId))
          } catch {
            Write-Host "[ci-watch] nao consegui detalhes do run $($r.databaseId): $($_.Exception.Message)" -ForegroundColor $cWarn
          }
        }
      }
    } catch {
      Write-Host "[ci-watch] poll falhou (vou tentar de novo): $($_.Exception.Message)" -ForegroundColor $cWarn
    }
  }
}

if (-not $RunId) {
  $latest = @(Get-RunList $Branch 1)
  if ($latest.Count -eq 0) { Fail "nenhum run encontrado para o branch '$Branch'" }
  $target = $latest[0]
  if ($target.status -eq 'completed') {
    Write-Step "o ultimo run do branch '$Branch' ja esta concluido ($($target.conclusion)); notificando..."
    exit (Complete-Run (Get-RunDetails $target.databaseId))
  }
  $RunId = $target.databaseId
}

Write-Step "monitorando run $RunId no branch '$Branch' (poll ${PollSeconds}s, timeout ${TimeoutMinutes}min)..."
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$consecutiveFailures = 0
while ((Get-Date) -lt $deadline) {
  try {
    $run = Get-RunDetails $RunId
    $consecutiveFailures = 0
  } catch {
    if ($_.Exception.Data['Permanent']) { Fail "run $RunId nao encontrado/sem acesso" }
    $consecutiveFailures += 1
    if ($consecutiveFailures -ge 10) { Fail "10 falhas consecutivas de poll - desistindo (rede/autenticacao do gh?)" }
    Write-Host "[ci-watch] poll falhou ($consecutiveFailures/10, vou tentar de novo): $($_.Exception.Message)" -ForegroundColor $cWarn
    Start-Sleep -Seconds $PollSeconds
    continue
  }
  if ($run.status -eq 'completed') { exit (Complete-Run $run) }
  Write-Step ('[{0}] status={1} url={2}' -f (Get-Date -Format 'HH:mm:ss'), $run.status, $run.url)
  Start-Sleep -Seconds $PollSeconds
}

Send-Notification 'CI timeout' "run $RunId nao concluiu em $TimeoutMinutes min" 'fail'
Write-Host "[ci-watch] TIMEOUT apos $TimeoutMinutes min" -ForegroundColor $cFail
exit 1
