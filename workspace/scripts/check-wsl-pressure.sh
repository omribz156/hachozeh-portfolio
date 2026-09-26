#!/usr/bin/env bash
set -euo pipefail

print_section() {
  printf '\n%s\n' "== $1 =="
}

run_quietly() {
  "$@" 2>/dev/null || true
}

printf '%s\n' '--- Navi WSL Pressure Check ---'
printf 'time=%s\n' "$(date -Is)"
printf 'cwd=%s\n' "$PWD"

print_section "WSL Version"
run_quietly wsl.exe --version | tr -d '\000'

print_section "WSL Distros"
run_quietly wsl.exe -l -v | tr -d '\000'

print_section "Linux Memory"
free -h
printf '\n'
grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree' /proc/meminfo

print_section "Linux Top CPU"
ps -eo pid,ppid,%cpu,%mem,etime,cmd --sort=-%cpu | head -n 12

print_section "Linux Top RSS"
ps -eo pid,ppid,rss,%mem,etime,cmd --sort=-rss | head -n 12

print_section "Focused Runtime Processes"
ps -eo pid,ppid,%cpu,%mem,etime,cmd | rg 'node|npm|tsx|pnpm|playwright|chrom|docker|postgres|vitest' || true

print_section "Windows WSL/Docker Processes"
run_quietly powershell.exe -NoProfile -Command '
  Get-Process -Name "vmmemWSL","Docker Desktop","com.docker.backend" -ErrorAction SilentlyContinue |
    Select-Object Name,Id,CPU,@{Name="WS_MB";Expression={[math]::Round($_.WS / 1MB, 1)}},StartTime |
    Format-Table -Auto
'

print_section "GPU Summary"
if command -v nvidia-smi >/dev/null 2>&1; then
  run_quietly nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,power.draw --format=csv,noheader
else
  printf '%s\n' 'nvidia-smi missing'
fi

print_section "Interpretation Hints"
printf '%s\n' '- high vmmemWSL CPU + low GPU = probably CPU/RAM/IO-bound work, not something GPU would fix'
printf '%s\n' '- usual suspects: TypeScript builds, npm install, Docker startup, browser QA, too many watch processes'
printf '%s\n' '- if Docker is sleeping, wake it first instead of assuming config drift'
printf '%s\n' '- if this keeps recurring, apply the repo-recommended .wslconfig cap and restart WSL'
