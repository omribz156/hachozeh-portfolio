Write-Host "`n--- Automated Development Environment Setup (Windows / PowerShell) ---`n" -ForegroundColor Cyan

function Resolve-ToolPath {
    param(
        [string]$CommandName,
        [string[]]$FallbackPaths = @()
    )

    $command = Get-Command $CommandName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
        return $command.Source
    }

    foreach ($path in $FallbackPaths) {
        if ($path -and (Test-Path $path)) {
            return $path
        }
    }

    return $null
}

function Get-NpmConfigValue {
    param(
        [string]$NpmPath,
        [string]$ConfigKey
    )

    if (-not $NpmPath) {
        return $null
    }

    $value = & $NpmPath config get $ConfigKey 2>$null | Select-Object -First 1
    if ($LASTEXITCODE -ne 0 -or $null -eq $value) {
        return $null
    }

    return "$value".Trim()
}

function Enable-TemporaryNpmStrictSslBypass {
    param([string]$NpmPath)

    $script:StrictSslOriginal = Get-NpmConfigValue -NpmPath $NpmPath -ConfigKey "strict-ssl"
    $script:StrictSslHadExplicitValue = $script:StrictSslOriginal -and $script:StrictSslOriginal -notin @("undefined", "null")

    Write-Host "Temporarily configuring npm strict-ssl=false..."
    & $NpmPath config set strict-ssl false
}

function Restore-NpmStrictSsl {
    param([string]$NpmPath)

    if (-not $NpmPath) {
        return
    }

    if ($script:StrictSslHadExplicitValue) {
        Write-Host "Restoring npm strict-ssl=$script:StrictSslOriginal..."
        & $NpmPath config set strict-ssl $script:StrictSslOriginal
        return
    }

    Write-Host "Restoring npm strict-ssl to npm default..."
    & $NpmPath config delete strict-ssl
}

function Add-ToSessionPath {
    param([string]$ToolPath)

    if (-not $ToolPath) {
        return
    }

    $toolDir = Split-Path -Path $ToolPath -Parent
    if (-not $toolDir) {
        return
    }

    $pathEntries = $env:PATH -split ';'
    if ($pathEntries -notcontains $toolDir) {
        $env:PATH = "$toolDir;$env:PATH"
    }
}

$nodePath = Resolve-ToolPath "node" @(
    "$env:ProgramFiles\nodejs\node.exe"
)

$npmPath = Resolve-ToolPath "npm.cmd" @(
    "$env:ProgramFiles\nodejs\npm.cmd"
)

$gitPath = Resolve-ToolPath "git" @(
    "$env:ProgramFiles\Git\cmd\git.exe",
    "D:\vibe stuff\Git\cmd\git.exe"
)

$wingetPath = Resolve-ToolPath "winget" @(
    "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe"
)

Add-ToSessionPath $nodePath
Add-ToSessionPath $npmPath
Add-ToSessionPath $gitPath
Add-ToSessionPath $wingetPath

$tools = @(
    @{ Display = "Node.js"; ToolPath = { Resolve-ToolPath "node" @("$env:ProgramFiles\nodejs\node.exe") }; Id = "OpenJS.NodeJS.LTS" },
    @{ Display = "Git"; ToolPath = { Resolve-ToolPath "git" @("$env:ProgramFiles\Git\cmd\git.exe", "D:\vibe stuff\Git\cmd\git.exe") }; Id = "Git.Git" }
)

foreach ($tool in $tools) {
    Write-Host "Checking for $($tool.Display)... " -NoNewline
    $toolPath = & $tool.ToolPath

    if ($toolPath) {
        Add-ToSessionPath $toolPath
        Write-Host "OK. [$toolPath]" -ForegroundColor Green
        continue
    }

    if (-not $wingetPath) {
        Write-Host "NOT FOUND. winget missing too." -ForegroundColor Red
        continue
    }

    Write-Host "NOT FOUND. Installing..." -ForegroundColor Yellow
    & $wingetPath install --id $tool.Id --silent --accept-package-agreements --accept-source-agreements
}

if (-not $npmPath) {
    $npmPath = Resolve-ToolPath "npm.cmd" @(
        "$env:ProgramFiles\nodejs\npm.cmd"
    )
    Add-ToSessionPath $npmPath
}

if ($npmPath) {
    Enable-TemporaryNpmStrictSslBypass $npmPath

    try {
        Write-Host "Checking for pnpm... " -NoNewline
        $pnpmPath = Resolve-ToolPath "pnpm.cmd" @(
            "$env:APPDATA\npm\pnpm.cmd"
        )

        if (-not $pnpmPath) {
            Write-Host "NOT FOUND. Installing via npm..." -ForegroundColor Yellow
            & $npmPath install -g pnpm
        } else {
            Add-ToSessionPath $pnpmPath
            Write-Host "OK. [$pnpmPath]" -ForegroundColor Green
        }

        Write-Host "`nInstalling/refreshing global npm tools..." -ForegroundColor Cyan
        & $npmPath install -g typescript eslint prettier nodemon
    } finally {
        Restore-NpmStrictSsl $npmPath
    }
} else {
    Write-Host "Skipping npm global tool install; npm.cmd not available." -ForegroundColor Red
}

Write-Host "`nEnvironment setup complete!" -ForegroundColor Cyan
