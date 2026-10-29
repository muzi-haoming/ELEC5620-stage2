param([ValidateSet('Compose','Kind')][string]$Target='Compose', [string]$Source='.runtime/uploads')
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if(-not (Test-Path -LiteralPath $Source -PathType Container)){throw 'Upload source directory does not exist.'}
$sourcePath=(Resolve-Path -LiteralPath $Source).Path
# Copy only; existing local files and persistent volumes are never removed.
if($Target -eq 'Compose'){
 $container=& docker compose ps -q backend
 if($LASTEXITCODE -ne 0 -or -not $container){throw 'Start Compose before copying uploads.'}
 & docker cp "$sourcePath/." "${container}:/data/uploads/"
 if($LASTEXITCODE -ne 0){throw 'Upload copy failed.'}
 & docker exec --user root $container chown -R 1000:1000 /data/uploads
 if($LASTEXITCODE -ne 0){throw 'Upload ownership update failed.'}
}else{
 $pod=& kubectl --context kind-second-space -n second-space get pods -l app=backend -o 'jsonpath={.items[0].metadata.name}'
 if($LASTEXITCODE -ne 0 -or -not $pod){throw 'Start the kind backend before copying uploads.'}
 # Stream a relative archive to avoid kubectl interpreting a Windows drive colon as a remote path.
 $archive=Join-Path $env:TEMP ('second-space-uploads-'+[guid]::NewGuid().ToString()+'.tar')
 try {
  $entries=@(Get-ChildItem -LiteralPath $sourcePath | Select-Object -ExpandProperty Name)
  if($entries.Count -eq 0){Write-Host 'No uploads to copy.';return}
  & tar -cf $archive -C $sourcePath -- @entries
  if($LASTEXITCODE -ne 0){throw 'Upload archive failed.'}
  $previous=Get-Location
  try {
   Set-Location (Split-Path $archive -Parent)
   & kubectl --context kind-second-space -n second-space cp (Split-Path $archive -Leaf) "${pod}:/tmp/uploads.tar"
   if($LASTEXITCODE -ne 0){throw 'Upload transfer failed.'}
  } finally {Set-Location $previous}
  & kubectl --context kind-second-space -n second-space exec $pod -- tar --no-overwrite-dir --no-same-owner --no-same-permissions -xf /tmp/uploads.tar -C /data/uploads
  if($LASTEXITCODE -ne 0){throw 'Upload extraction failed.'}
 } finally {if(Test-Path -LiteralPath $archive){Remove-Item -LiteralPath $archive}}
}
Write-Host 'Uploads copied to the persistent volume; local originals preserved.'
