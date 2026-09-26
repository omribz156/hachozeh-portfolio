Write-Host "`n--- Navi WSL Pressure Check (Windows Host) ---`n" -ForegroundColor Cyan

function Write-Section {
    param([string]$Title)

    Write-Host "`n== $Title ==" -ForegroundColor Yellow
}

function Write-Safe {
    param([scriptblock]$Block)

    try {
        & $Block
    } catch {
        Write-Host "unavailable: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
}

Write-Host "time=$([DateTimeOffset]::Now.ToString('o'))"

Write-Section "Host Memory"
Write-Safe {
    $computer = Get-CimInstance Win32_ComputerSystem
    $os = Get-CimInstance Win32_OperatingSystem

    [pscustomobject]@{
        TotalPhysicalMemoryGB = [math]::Round($computer.TotalPhysicalMemory / 1GB, 1)
        FreePhysicalMemoryGB  = [math]::Round(($os.FreePhysicalMemory * 1KB) / 1GB, 1)
        LogicalProcessors     = $computer.NumberOfLogicalProcessors
    } | Format-List
}

Write-Section "WSL Version"
Write-Safe {
    wsl.exe --version
}

Write-Section "WSL Distros"
Write-Safe {
    wsl.exe -l -v
}

Write-Section ".wslconfig"
Write-Safe {
    $wslConfig = Join-Path $env:USERPROFILE ".wslconfig"

    if (Test-Path $wslConfig) {
        Get-Content $wslConfig
    } else {
        Write-Host "missing"
    }
}

Write-Section "Windows WSL / Docker Processes"
Write-Safe {
    Get-Process -Name "vmmemWSL", "Docker Desktop", "com.docker.backend" -ErrorAction SilentlyContinue |
        Select-Object Name, Id, CPU, @{Name="WS_MB"; Expression = { [math]::Round($_.WS / 1MB, 1) } }, StartTime |
        Sort-Object WS_MB -Descending |
        Format-Table -Auto
}

Write-Section "Top Host CPU"
Write-Safe {
    Get-Process |
        Sort-Object CPU -Descending |
        Select-Object -First 12 Name, Id, CPU, @{Name="WS_MB"; Expression = { [math]::Round($_.WS / 1MB, 1) } } |
        Format-Table -Auto
}

Write-Section "Top Host Memory"
Write-Safe {
    Get-Process |
        Sort-Object WS -Descending |
        Select-Object -First 12 Name, Id, @{Name="WS_MB"; Expression = { [math]::Round($_.WS / 1MB, 1) } }, CPU |
        Format-Table -Auto
}

Write-Section "GPU"
Write-Safe {
    Get-CimInstance Win32_VideoController |
        Select-Object Name, DriverVersion, @{Name="AdapterRAM_GB"; Expression = { [math]::Round($_.AdapterRAM / 1GB, 1) } } |
        Format-List
}

Write-Section "nvidia-smi"
Write-Safe {
    & "$env:SystemRoot\System32\nvidia-smi.exe"
}

Write-Section "Interpretation Hints"
Write-Host "- if vmmemWSL is high and GPU is mostly idle, suspect CPU/RAM/IO pressure first"
Write-Host "- usual suspects: npm install, TypeScript compile, Docker startup, browser QA, too many watch processes"
Write-Host "- if Docker is needed but stopped, start Docker Desktop before blaming WSL config"
Write-Host "- if the machine is truly choking, collect this output first, then consider 'wsl --shutdown'"
