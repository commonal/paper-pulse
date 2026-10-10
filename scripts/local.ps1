param([ValidateSet('setup','start','stop','restart')][string]$Action='start')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$local=Join-Path $root '.local'
$envFile=Join-Path $root '.env'
$stateFile=Join-Path $local 'processes.json'
New-Item -ItemType Directory -Path $local -Force | Out-Null
if($Action -eq 'setup') {
  node (Join-Path $PSScriptRoot 'configure-local.ts')
  if($LASTEXITCODE -ne 0){throw 'Local configuration failed'}
  $exists=docker ps -a --filter 'name=^paper-pulse-db$' --format '{{.Names}}'
  if($LASTEXITCODE -ne 0){throw 'Docker is unavailable'}
  if(!$exists){
    docker run -d --name paper-pulse-db --env-file (Join-Path $local 'db.env') -p 127.0.0.1:5545:5432 -v paper-pulse-pgdata:/var/lib/postgresql/data pgvector/pgvector:pg16 | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Database container did not start'}
  }else{docker start paper-pulse-db | Out-Null}
  for($n=0;$n -lt 30;$n++) { docker exec paper-pulse-db pg_isready -U paperpulse -d paper_pulse 2>$null | Out-Null; if($LASTEXITCODE -eq 0){break}; Start-Sleep -Seconds 1 }
  Push-Location $root
  try { node --env-file=.env scripts/migrate.ts; if($LASTEXITCODE -ne 0){throw 'Migration failed'} } finally { Pop-Location }
  exit
}
if($Action -eq 'stop' -or $Action -eq 'restart') {
  if(Test-Path -LiteralPath $stateFile){
    $state=Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    foreach($role in $state.roles){
      $proc=Get-CimInstance Win32_Process -Filter "ProcessId = $($role.processId)" -ErrorAction SilentlyContinue
      if($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine.Contains($envFile)){Stop-Process -Id $role.processId; Write-Output ($role.role+' stopped')}
    }
  }
  if($Action -eq 'stop'){exit}
}
if(Test-Path -LiteralPath $stateFile){
  $state=Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  foreach($role in $state.roles){
    $proc=Get-CimInstance Win32_Process -Filter "ProcessId = $($role.processId)" -ErrorAction SilentlyContinue
    if($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine.Contains($envFile)){throw 'Services already running; use restart'}
  }
}
$roles=@()
$ports=@{API_PORT=3001;WEB_PORT=3000}
foreach($line in (Get-Content -LiteralPath $envFile)){
  if($line -match '^\s*(API_PORT|WEB_PORT)\s*=\s*(\d+)\s*$'){$ports[$Matches[1]]=[int]$Matches[2]}
}
foreach($entry in @(@{role='api';port=$ports.API_PORT},@{role='web';port=$ports.WEB_PORT})){
  $client=[System.Net.Sockets.TcpClient]::new()
  try{$probe=$client.BeginConnect('127.0.0.1',$entry.port,$null,$null);$inUse=$probe.AsyncWaitHandle.WaitOne(300) -and $client.Connected}
  catch{$inUse=$false}
  finally{$client.Dispose()}
  if($inUse){throw "Cannot start $($entry.role): 127.0.0.1:$($entry.port) already accepts connections. Check the existing service before starting another copy."}
}
foreach($role in @(@{name='api';file='apps/api/src/main.ts'},@{name='worker';file='apps/worker/src/main.ts'},@{name='web';file='apps/web/server.ts'})) {
  $entry=Join-Path $root $role.file
  $proc=Start-Process -FilePath 'node.exe' -ArgumentList @("--env-file=`"$envFile`"", "`"$entry`"") -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $local ($role.name+'.stdout.log')) -RedirectStandardError (Join-Path $local ($role.name+'.stderr.log'))
  $roles+=@{role=$role.name;processId=$proc.Id}
}
Start-Sleep -Milliseconds 800
$failed=@()
foreach($role in $roles){if(!(Get-Process -Id $role.processId -ErrorAction SilentlyContinue)){$failed+=$role}}
if($failed.Count){
  foreach($role in $roles){if(Get-Process -Id $role.processId -ErrorAction SilentlyContinue){Stop-Process -Id $role.processId -ErrorAction SilentlyContinue}}
  throw "Local startup process exited: $(($failed | ForEach-Object {$_.role}) -join ', '). Check .local/*.stderr.log"
}
[IO.File]::WriteAllText($stateFile, (@{roles=$roles;root=$root;web="http://127.0.0.1:$($ports.WEB_PORT)"} | ConvertTo-Json -Depth 4))
$roles | ForEach-Object { Write-Output ($_.role+' started PID '+$_.processId) }
