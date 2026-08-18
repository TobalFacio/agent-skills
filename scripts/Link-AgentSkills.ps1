<#
.SYNOPSIS
  Enlaza un repo de proyecto con las skills compartidas, sin copiar nada.

.DESCRIPTION
  Crea tres junctions desde el repo del proyecto hacia este repo de skills:

      <proyecto>\.claude\skills   ->  <skills>\skills     (lo que lee Claude Code)
      <proyecto>\.agents\skills   ->  <skills>\skills     (la ruta neutral de agentes)
      <proyecto>\scripts\shared   ->  <skills>\scripts    (el verificador y utilidades)

  Y siembra <proyecto>\.agents\project.yml desde la plantilla, si no existe.

  SEGURIDAD: si alguna de esas rutas ya existe como carpeta REAL (no junction), el
  script se detiene y no toca nada. Es la garantía de que correrlo por error sobre un
  proyecto que tiene sus propias skills no las borra.

.PARAMETER Project
  Raíz del repo del proyecto. Ej: C:\Dev\SIG

.PARAMETER Skills
  Raíz de este repo de skills. Ej: C:\Dev\agent-skills

.PARAMETER Force
  Rehace los junctions que ya apunten a otro lado. Nunca toca carpetas reales.

.EXAMPLE
  .\Link-AgentSkills.ps1 -Project C:\Dev\SIG -Skills C:\Dev\agent-skills

.EXAMPLE
  .\Link-AgentSkills.ps1 -Project C:\Dev\SIG -Skills C:\Dev\agent-skills -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$Project,
    [Parameter(Mandatory = $true)][string]$Skills,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Resolve-Root([string]$path, [string]$label) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        throw "$label no existe: $path"
    }
    (Resolve-Path -LiteralPath $path).Path.TrimEnd('\')
}

$Project = Resolve-Root $Project 'El repo del proyecto'
$Skills = Resolve-Root $Skills 'El repo de skills'

foreach ($needed in @('skills', 'scripts', 'templates')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Skills $needed) -PathType Container)) {
        throw "$Skills no parece el repo de skills: le falta la carpeta '$needed'."
    }
}

$links = @(
    @{ From = Join-Path $Project '.claude\skills'; To = Join-Path $Skills 'skills' }
    @{ From = Join-Path $Project '.agents\skills'; To = Join-Path $Skills 'skills' }
    @{ From = Join-Path $Project 'scripts\shared'; To = Join-Path $Skills 'scripts' }
)

function Get-LinkTarget([string]$path) {
    $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    if (-not $item) { return $null }
    if ($item.LinkType) { return ($item.Target | Select-Object -First 1) }
    return $false   # existe y NO es enlace
}

# --------------------------------------------------------------- comprobar antes de tocar
$plan = @()
foreach ($l in $links) {
    $target = Get-LinkTarget $l.From
    if ($target -eq $false) {
        throw @"
$($l.From) ya existe como carpeta real.

No la voy a tocar. Si ese proyecto tiene hoy sus propias skills ahí, esto es
exactamente lo que debe pasar: mueve o respalda esa carpeta a mano y vuelve a correr
este script cuando estés seguro.
"@
    }
    if ($null -eq $target) { $plan += @{ Action = 'crear'; Link = $l } }
    elseif ($target.TrimEnd('\') -eq $l.To.TrimEnd('\')) { $plan += @{ Action = 'ya-ok'; Link = $l } }
    elseif ($Force) { $plan += @{ Action = 'rehacer'; Link = $l } }
    else {
        throw "$($l.From) ya es un enlace, pero apunta a $target. Usa -Force si quieres reapuntarlo a $($l.To)."
    }
}

# ------------------------------------------------------------------------------- aplicar
foreach ($step in $plan) {
    $from = $step.Link.From
    $to = $step.Link.To
    switch ($step.Action) {
        'ya-ok' { Write-Host "  ya estaba  $from -> $to" -ForegroundColor DarkGray }
        default {
            if ($PSCmdlet.ShouldProcess($from, "junction -> $to")) {
                $parent = Split-Path -Parent $from
                if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
                if ($step.Action -eq 'rehacer') { (Get-Item -LiteralPath $from -Force).Delete() }
                New-Item -ItemType Junction -Path $from -Target $to | Out-Null
                Write-Host "  $($step.Action)     $from -> $to" -ForegroundColor Green
            }
        }
    }
}

# --------------------------------------------------------------------------- project.yml
$cfg = Join-Path $Project '.agents\project.yml'
if (Test-Path -LiteralPath $cfg) {
    Write-Host "  ya estaba  $cfg" -ForegroundColor DarkGray
}
elseif ($PSCmdlet.ShouldProcess($cfg, 'sembrar desde templates/project.yml')) {
    Copy-Item -LiteralPath (Join-Path $Skills 'templates\project.yml') -Destination $cfg
    Write-Host "  creado     $cfg  <- plantilla. AJÚSTALO ANTES DE USAR LAS SKILLS." -ForegroundColor Yellow
}

# ----------------------------------------------------------------------------- .gitignore
# Los junctions no se versionan: git los seguiría y trataría de rastrear el contenido del
# otro repo. Lo que sí se versiona es .agents/project.yml.
$gitignore = Join-Path $Project '.gitignore'
$entries = @('/.claude/skills', '/.agents/skills', '/scripts/shared')
if (Test-Path -LiteralPath $gitignore) {
    $current = Get-Content -LiteralPath $gitignore -Raw
    $missing = $entries | Where-Object { $current -notmatch [regex]::Escape($_) }
    if ($missing -and $PSCmdlet.ShouldProcess($gitignore, "agregar $($missing -join ', ')")) {
        Add-Content -LiteralPath $gitignore -Value "`r`n# junctions al repo de skills compartidas`r`n$($missing -join "`r`n")"
        Write-Host "  .gitignore actualizado: $($missing -join ', ')" -ForegroundColor Green
    }
}
else {
    Write-Host "  aviso      $Project no tiene .gitignore - agrega a mano: $($entries -join ', ')" -ForegroundColor Yellow
}

Write-Host "`nListo. Siguiente paso: revisar .agents\project.yml y correr el verificador." -ForegroundColor Cyan
Write-Host "    node scripts\shared\verify-backlog.mjs" -ForegroundColor Cyan
