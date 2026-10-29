$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if(-not (Test-Path '.env')){throw 'Create .env using .env.example.'}
if(-not (Test-Path '.venv/Scripts/python.exe')){throw 'Create the Python 3.12 venv and install backend/requirements.txt first.'}
New-Item -ItemType Directory -Path '.runtime' -Force | Out-Null
if(-not (Get-NetTCPConnection -LocalPort 55432 -State Listen -ErrorAction SilentlyContinue) -and (Test-Path '.runtime/pgdata/PG_VERSION')){
 $pg=Start-Process -FilePath (Resolve-Path '.runtime/pgsql/bin/pg_ctl.exe') -ArgumentList '-D',('"'+(Join-Path $PWD '.runtime/pgdata')+'"'),'-l',('"'+(Join-Path $PWD '.runtime/postgres.log')+'"'),'-o','"-p 55432 -h 127.0.0.1"','-w','start' -WindowStyle Hidden -Wait -PassThru
 if($pg.ExitCode -ne 0){throw 'PostgreSQL startup failed.'}
}
if(-not (Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue)){
 Start-Process -FilePath (Resolve-Path '.venv/Scripts/python.exe') -ArgumentList '-m','uvicorn','app.main:app','--app-dir','backend','--host','127.0.0.1','--port','8001' -WindowStyle Hidden -RedirectStandardOutput '.runtime/api.log' -RedirectStandardError '.runtime/api-error.log' | Out-Null
}
if(-not (Get-NetTCPConnection -LocalPort 5622 -State Listen -ErrorAction SilentlyContinue)){
 Start-Process -FilePath (Get-Command node).Source -ArgumentList 'node_modules/vite/bin/vite.js' -WorkingDirectory (Join-Path $PWD 'frontend') -WindowStyle Hidden -RedirectStandardOutput '.runtime/frontend.log' -RedirectStandardError '.runtime/frontend-error.log' | Out-Null
}
$ready=$false
$deadline=(Get-Date).AddSeconds(45)
do {
 try { $health=Invoke-RestMethod 'http://127.0.0.1:8001/api/health' -TimeoutSec 3; if($health.status -eq 'ok'){$ready=$true;break} } catch {}
 Start-Sleep -Milliseconds 500
} while((Get-Date) -lt $deadline)
if(-not $ready){throw 'API did not become ready. See .runtime/api-error.log and check database connectivity.'}
Write-Host 'Ready: http://127.0.0.1:5622/ (database verified; campus model requires VPN).'
