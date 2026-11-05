param(
 [Parameter(Mandatory=$true)][string]$ProgramRoot,
 [Parameter(Mandatory=$true)][string]$EvidenceRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$program=Join-Path $ProgramRoot 'bin\hashi-sidecar.exe'
New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
$script:observations=@()
$script:grants=@()
function Check([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function CallProgram([string[]]$Arguments){
 $start=[Diagnostics.ProcessStartInfo]::new()
 $start.FileName=$program
 $start.Arguments=(@($Arguments | ForEach-Object {'"'+$_.Replace('"','\"')+'"'}) -join ' ')
 $start.UseShellExecute=$false;$start.CreateNoWindow=$true
 $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 $process=[Diagnostics.Process]::Start($start)
 try{
  $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $raw=$stdout.Result;$errors=$stderr.Result
  $errors | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'last-stderr.log') -Encoding UTF8
  if(-not $raw.Trim()){$raw=$errors}
  try{$reply=$raw | ConvertFrom-Json}catch{throw 'Program did not return structured JSON.'}
  return [pscustomobject]@{exitCode=$process.ExitCode;reply=$reply}
 }finally{$process.Dispose()}
}
function Record([string]$Name,$Details){
 $script:observations+=[pscustomobject]@{name=$Name;passed=$true;details=$Details;at=(Get-Date -Format o)}
 $script:observations | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'observations.json') -Encoding UTF8
 Write-Output ('PASS '+$Name)
}
function TargetCall([string]$Sid,[string[]]$Arguments){CallProgram (@('--target-sid',$Sid)+$Arguments)}
function Scope([string]$Sid,[string[]]$Profiles,[string[]]$Capabilities=@('identity','process','script')){
 $scope=@{task='Disposable standalone qualification';profiles=$Profiles;capabilities=$Capabilities;callerSids=@('S-1-5-18');durationSeconds=1800;allowAnyCode=$true}
 $path=Join-Path $EvidenceRoot ('scope-'+[guid]::NewGuid().ToString('N')+'.json')
 $scope | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding UTF8
 $r=TargetCall $Sid @('grant-create','--input-file',$path)
 Check ($r.exitCode -eq 0 -and $r.reply.ok) 'Grant creation failed.'
 $script:grants+=@{sid=$Sid;id=$r.reply.grant.id}
 return $r.reply.grant.id
}
function InvokeJob([string]$Sid,[string]$Grant,[string]$Profile,[string]$Operation,$InputObject,[string]$Id=([guid]::NewGuid().ToString())){
 $path=Join-Path $EvidenceRoot ('input-'+$Id+'.json')
 $InputObject | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $path -Encoding UTF8
 return TargetCall $Sid @('call','--grant',$Grant,'--profile',$Profile,'--operation',$Operation,'--input-file',$path,'--request-id',$Id)
}
try{
 $suite=Get-Content -LiteralPath (Join-Path $ProgramRoot 'sidecar.json') -Raw | ConvertFrom-Json
 $configs=@($suite.targets | ForEach-Object {Get-Content -LiteralPath (Join-Path $ProgramRoot ($_.root+'/data/config.json')) -Raw | ConvertFrom-Json})
 $admin=@($configs | Where-Object {$_.profiles.'user-admin'.available} | Select-Object -First 1)
 $standard=@($configs | Where-Object {-not $_.profiles.'user-admin'.available -and $_.profiles.'user-admin'.reason -eq 'TARGET_NOT_ADMINISTRATOR'} | Select-Object -First 1)
 Check ($admin.Count -eq 1 -and $standard.Count -eq 1) 'Qualification requires an enrolled administrator and standard-user target.'
 $admin=$admin[0];$standard=$standard[0]
 $caller=& $admin.helperPath identity | ConvertFrom-Json
 Check ($caller.sid -eq 'S-1-5-18' -and $caller.elevated -and $caller.sessionId -eq 0) 'Use the actual SYSTEM service execution context.'
 Record 'actual-service-caller' $caller
 $version=CallProgram @('version');Check ($version.exitCode -eq 0 -and $version.reply.version -eq '3.0.0') 'Version check failed.'
 $targets=CallProgram @('targets');Check ($targets.exitCode -eq 0 -and @($targets.reply.targets).Count -eq 2) 'Target discovery failed.'
 Record 'independent-windows-only-install' @{version=$version.reply.version;targets=@($targets.reply.targets.sid);legacyRequired=$false;githubEnabled=$admin.githubEnabled}
 $capabilities=TargetCall $admin.userSid @('capabilities')
 Check ($capabilities.reply.profiles.user.available -and $capabilities.reply.profiles.'user-admin'.available) 'The administrator must be logged on for actual user-token qualification.'
 $grant=Scope $admin.userSid @('system','user','user-admin')
 foreach($profile in @('system','user','user-admin')){
  $identity=InvokeJob $admin.userSid $grant $profile 'identity' @{}
  $expectedSid=if($profile -eq 'system'){'S-1-5-18'}else{$admin.userSid}
  Check ($identity.exitCode -eq 0 -and $identity.reply.data.sid -eq $expectedSid -and $identity.reply.data.elevated -eq ($profile -ne 'user')) ('Wrong actual '+$profile+' identity.')
  Record ('identity-'+$profile) $identity.reply.data
  $probe=InvokeJob $admin.userSid $grant $profile 'process.run' @{executable=$admin.nodePath;args=@('-e','process.stdout.write(JSON.stringify({profile:process.env.USERPROFILE,temp:process.env.TEMP}))');cwd=$admin.programRoot;timeoutMs=10000}
  Check ($probe.exitCode -eq 0 -and $probe.reply.data.exitCode -eq 0 -and $probe.reply.data.identity.sid -eq $expectedSid) ('Process execution failed for '+$profile)
  $environment=$probe.reply.data.stdout | ConvertFrom-Json
  Check ($environment.temp.StartsWith($admin.root,[StringComparison]::OrdinalIgnoreCase)) 'Process temp escaped the independent installation.'
  if($profile -ne 'system'){Check ($environment.profile -eq $admin.userProfile) 'Wrong target-user environment.'}
  Record ('process-'+$profile) @{identity=$probe.reply.data.identity;exitCode=$probe.reply.data.exitCode;temporary=$environment.temp}
 }
 $scriptText='[IO.File]::AppendAllText($args[0], ''once'')'
 $scriptId=[guid]::NewGuid().ToString()
 $marker=Join-Path $admin.root ('lanes\user\work\marker-'+$scriptId+'.txt')
 $sha=[Security.Cryptography.SHA256]::Create()
 try{$scriptHash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($scriptText)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 $scriptInput=@{interpreter='powershell';script=$scriptText;sha256=$scriptHash;args=@($marker);cwd=$admin.programRoot;timeoutMs=10000}
 $first=InvokeJob $admin.userSid $grant 'user' 'script.run' $scriptInput $scriptId
 Check ($first.exitCode -eq 0 -and (Get-Content -LiteralPath $marker -Raw) -eq 'once') 'Pinned user script failed.'
 $second=InvokeJob $admin.userSid $grant 'user' 'script.run' $scriptInput $scriptId
 $reopened=TargetCall $admin.userSid @('result','--request-id',$scriptId)
 Check ($second.exitCode -eq 0 -and $reopened.reply.ok -and (Get-Content -LiteralPath $marker -Raw) -eq 'once') 'Durable result/replay protection failed.'
 Record 'pinned-script-durable-result-no-replay' @{id=$scriptId;identity=$first.reply.data.identity;executions=1}
 $changed=@{};foreach($key in $scriptInput.Keys){$changed[$key]=$scriptInput[$key]};$changed.timeoutMs=11000
 $conflict=InvokeJob $admin.userSid $grant 'user' 'script.run' $changed $scriptId
 Check ($conflict.exitCode -ne 0 -and $conflict.reply.error.code -eq 'ADMIN_REQUEST_ID_REUSED') 'Changed request ID was accepted.'
 Record 'changed-input-rejected' $conflict.reply.error
 $standardGrant=Scope $standard.userSid @('system','user')
 $standardSystem=InvokeJob $standard.userSid $standardGrant 'system' 'identity' @{}
 Check ($standardSystem.exitCode -eq 0 -and $standardSystem.reply.data.system) 'Offline target SYSTEM maintenance failed.'
 $offlineId=[guid]::NewGuid().ToString()
 $offline=InvokeJob $standard.userSid $standardGrant 'user' 'identity' @{} $offlineId
 Check ($offline.exitCode -ne 0 -and $offline.reply.error.code -eq 'ADMIN_USER_SESSION_UNAVAILABLE') 'Offline user must report its unavailable session.'
 Check (-not(Test-Path -LiteralPath (Join-Path $standard.root ('requests\'+$offlineId+'.json')))) 'Offline request was admitted.'
 Record 'offline-standard-account-boundary' @{system=$standardSystem.reply.data;userError=$offline.reply.error}
 $badScope=Join-Path $EvidenceRoot 'standard-elevation.json'
 @{task='Negative boundary';profiles=@('user-admin');capabilities=@('identity');callerSids=@('S-1-5-18');durationSeconds=600} | ConvertTo-Json | Set-Content -LiteralPath $badScope -Encoding UTF8
 $bad=TargetCall $standard.userSid @('grant-create','--input-file',$badScope)
 Check ($bad.exitCode -ne 0 -and $bad.reply.error.code -eq 'ADMIN_PROFILE_UNAVAILABLE') 'Standard-user elevation was falsely promised.'
 Record 'standard-user-is-not-an-administrator' $bad.reply.error
 $cross=InvokeJob $standard.userSid $grant 'system' 'identity' @{}
 Check ($cross.exitCode -ne 0) 'A grant crossed into another target installation.'
 Record 'cross-account-grant-rejected' $cross.reply.error
 $github=InvokeJob $admin.userSid $grant 'user' 'github.request' @{method='GET';path='/user'}
 Check ($github.exitCode -ne 0 -and $github.reply.error.code -eq 'ADMIN_GITHUB_UNAVAILABLE') 'Disabled GitHub adapter did not report unavailable.'
 Record 'github-is-optional' $github.reply.error
 $revoke=TargetCall $admin.userSid @('grant-revoke','--grant',$grant)
 Check ($revoke.exitCode -eq 0) 'Revocation failed.'
 $revoked=InvokeJob $admin.userSid $grant 'system' 'identity' @{}
 Check ($revoked.exitCode -ne 0 -and $revoked.reply.error.code -eq 'ADMIN_GRANT_REVOKED') 'Revoked grant remained usable.'
 $afterRevoke=TargetCall $admin.userSid @('result','--request-id',$scriptId)
 Check ($afterRevoke.exitCode -eq 0 -and $afterRevoke.reply.ok) 'Revocation lost a completed durable result.'
 Record 'revocation-keeps-results-and-stops-new-work' @{error=$revoked.reply.error;resultRetained=$true}
}finally{
 foreach($grantEntry in $script:grants){
  $null=TargetCall $grantEntry.sid @('grant-revoke','--grant',$grantEntry.id)
 }
 $script:observations | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'observations.json') -Encoding UTF8
}
[pscustomobject]@{ok=$true;passed=$script:observations.Count;actualServiceCaller=$true;existingAccountsChanged=$false} | ConvertTo-Json -Compress
