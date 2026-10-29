$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if(-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path 'D:/tools/Docker/resources/bin/docker.exe')){
 $env:PATH='D:\tools\Docker\resources\bin;'+$env:PATH
}
if(-not (Get-Command docker -ErrorAction SilentlyContinue)){throw 'Docker CLI is missing. Start Docker Desktop after installation.'}
& docker info --format '{{.ServerVersion}}'
if($LASTEXITCODE -ne 0){throw 'Start Docker Desktop and wait for its engine, then run this script again.'}
if(& docker ps --filter 'name=^/second-space-control-plane$' --format '{{.Names}}'){
 $health=Invoke-RestMethod 'http://127.0.0.1:5623/api/health' -TimeoutSec 20
 if($health.status -ne 'ok'){throw 'The existing kind deployment is not ready. Run scripts/deploy-kind.ps1.'}
 Write-Host 'Existing kind deployment ready: http://127.0.0.1:5623/ . Keep campus VPN connected.'
 return
}
if(-not (Test-Path '.env')){throw 'Create the private .env using .env.example before starting.'}
& docker compose up --build -d
if($LASTEXITCODE -ne 0){throw 'Compose failed. Check whether kind already occupies port 5623.'}
if(Test-Path '.runtime/uploads') { & "$PSScriptRoot/copy-uploads.ps1" -Target Compose }
$health=Invoke-RestMethod 'http://127.0.0.1:5623/api/health' -TimeoutSec 20
if($health.status -ne 'ok'){throw 'Container database readiness failed.'}
Write-Host 'Ready: http://127.0.0.1:5623/ . Keep campus VPN connected for real model calls.'
