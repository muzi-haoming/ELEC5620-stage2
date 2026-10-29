param([ValidateSet('CloudSQL','Azure','Local')][string]$DatabaseMode='CloudSQL', [string]$EnvFile='.env.cloud')
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
foreach($tool in @('docker','kind','kubectl')) { if(-not (Get-Command $tool -ErrorAction SilentlyContinue)){throw "Install $tool before deployment."} }
function Invoke-Checked { param([string]$Program,[string[]]$Arguments) & $Program @Arguments; if($LASTEXITCODE -ne 0){throw "$Program failed."} }
if(-not (Test-Path -LiteralPath $EnvFile)){throw 'Create the private .env first.'}
$settings=@{}
Get-Content -LiteralPath $EnvFile | ForEach-Object { if($_ -match '^([A-Z_]+)=(.*)$'){$settings[$matches[1]]=$matches[2]} }
if($settings.MODEL_NAME -ne 'campus-qwen'){throw 'Only campus-qwen is allowed.'}
if($DatabaseMode -eq 'Azure' -and $settings.DATABASE_URL -notmatch 'postgres\.database\.azure\.com.*sslmode=(require|verify-full)'){throw 'Set the Azure PostgreSQL URL with TLS in .env.'}
if($DatabaseMode -eq 'CloudSQL' -and $settings.DATABASE_URL -notmatch '^postgres(?:ql)?://.+[?&]sslmode=(require|verify-full)(&|$)'){throw 'Set the Cloud SQL PostgreSQL URL with TLS in the selected private env file.'}
if($DatabaseMode -eq 'Local'){
 if(-not $settings.POSTGRES_PASSWORD){throw 'Set POSTGRES_PASSWORD in .env.'}
 $encoded=[uri]::EscapeDataString($settings.POSTGRES_PASSWORD)
 $settings.DATABASE_URL="postgresql://secondspace:${encoded}@postgres:5432/secondspace"
}
Invoke-Checked docker @('info','--format','{{.ServerVersion}}')
$clusters=& kind get clusters
if($clusters -notcontains 'second-space'){Invoke-Checked kind @('create','cluster','--name','second-space','--config','deploy/k8s/kind.yaml')}
# Explicit context on every kubectl call avoids modifying another cluster.
$context='kind-second-space'
$ns=& kubectl --context $context get namespace second-space --ignore-not-found -o name
if(-not $ns){Invoke-Checked kubectl @('--context',$context,'create','namespace','second-space')}
# Stream the secret to kubectl; never print or write the secret manifest.
$secret=@{apiVersion='v1';kind='Secret';metadata=@{name='second-space-env';namespace='second-space'};type='Opaque';stringData=$settings} | ConvertTo-Json -Depth 5 -Compress
$secret | & kubectl --context $context apply -f -
if($LASTEXITCODE -ne 0){throw 'Secret apply failed.'}
if($DatabaseMode -eq 'Local'){
 Invoke-Checked kubectl @('--context',$context,'apply','-f','deploy/k8s/postgres-local.yaml')
 Invoke-Checked kubectl @('--context',$context,'-n','second-space','rollout','status','statefulset/postgres','--timeout=180s')
}
Invoke-Checked docker @('build','-f','backend/Dockerfile','-t','second-space-backend:demo','.')
Invoke-Checked docker @('build','-f','frontend/Dockerfile','-t','second-space-frontend:demo','.')
Invoke-Checked kind @('load','docker-image','second-space-backend:demo','second-space-frontend:demo','--name','second-space')
Invoke-Checked kubectl @('--context',$context,'apply','-f','deploy/k8s/app.yaml')
Invoke-Checked kubectl @('--context',$context,'-n','second-space','rollout','restart','deployment/backend','deployment/frontend')
Invoke-Checked kubectl @('--context',$context,'-n','second-space','rollout','status','deployment/backend','--timeout=180s')
Invoke-Checked kubectl @('--context',$context,'-n','second-space','rollout','status','deployment/frontend','--timeout=180s')
Invoke-RestMethod 'http://127.0.0.1:5623/api/health'
Write-Host 'Open http://127.0.0.1:5623/ . No real payment or email service is connected.'
