param(
  [ValidateSet('Install','Audit')][string]$Mode='Audit',
  [string]$Account,
  [Parameter(Mandatory=$true)][string[]]$Repository,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9-]{1,39}$')][string]$ExpectedGitHubLogin
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-security.ps1')
$security=Import-HubSecurityModule
Import-Module (Join-Path $PSHOME 'Modules\ScheduledTasks\ScheduledTasks.psd1') -ErrorAction Stop
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$root=Join-Path $repoRoot 'state\github-user-sidecar'
$configPath=Join-Path $root 'config.json'
$workerPath=Join-Path $PSScriptRoot 'github-user-sidecar.mjs'
function Assert-LocalPath([string]$Path) {
  $cursor=[IO.Path]::GetFullPath($Path)
  while ($cursor) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'Sidecar reparse path rejected.'
    }
    $cursor=[IO.Path]::GetDirectoryName($cursor)
  }
}
Assert-LocalPath $root
Assert-LocalPath $workerPath
foreach ($item in $Repository) {
  if ($item -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid repository allowlist entry.' }
}
if ($Repository.Count -gt 16 -or @($Repository | Sort-Object -Unique).Count -ne $Repository.Count) { throw 'Invalid repository allowlist.' }
if (-not $Account) { $Account=(Get-CimInstance Win32_ComputerSystem).UserName }
if (-not $Account) { throw 'A verified logged-on Windows account is required.' }
$userSid=([Security.Principal.NTAccount]::new($Account)).Translate([Security.Principal.SecurityIdentifier])
if ($userSid.Value -notmatch '^S-1-5-21-') { throw 'Interactive user account required.' }
$interactiveProfile=@(Get-CimInstance Win32_UserProfile | Where-Object { $_.SID -eq $userSid.Value -and $_.Loaded })
if ($interactiveProfile.Count -ne 1) { throw 'The selected user profile is not currently loaded.' }
& git -C $repoRoot check-ignore --quiet -- $configPath
if ($LASTEXITCODE -ne 0) { throw 'Instance configuration must remain Git-ignored.' }
$old=$null
if (Test-Path -LiteralPath $configPath) {
  $old=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if ($old.schemaVersion -ne 1 -or $old.root -ne $root -or $old.userSid -ne $userSid.Value) { throw 'Existing sidecar identity mismatch.' }
} elseif ((Test-Path -LiteralPath $root) -and @(Get-ChildItem -LiteralPath $root -Force).Count) {
  throw 'Unrecognized nonempty sidecar state root.'
}
$installationId=if ($old) { [string]$old.installationId } else { [guid]::NewGuid().ToString() }
if ($installationId -notmatch '^[0-9a-f-]{36}$') { throw 'Invalid installation identity.' }
$hash=[Security.Cryptography.SHA256]::Create()
try { $suffix=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($root+'|'+$userSid.Value)))).Replace('-','').Substring(0,12).ToLowerInvariant() }
finally { $hash.Dispose() }
$taskName='HashiHubV2-GitHubRead-'+$suffix
$description='HASHI Hub v2 scoped read-only GitHub sidecar; installation '+$installationId
$nodePath=(Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
$ghPath=(Get-Command gh.exe -CommandType Application -ErrorAction Stop).Source
$gitPath=(Get-Command git.exe -CommandType Application -ErrorAction Stop).Source
$arguments='"'+$workerPath+'" --worker --config "'+$configPath+'"'
$existing=Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  $existingSid=try { ([Security.Principal.NTAccount]::new([string]$existing.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { [string]$existing.Principal.UserId }
  if (-not $old -or $existing.Description -ne $description -or $existingSid -ne $userSid.Value -or
      @($existing.Actions).Count -ne 1 -or $existing.Actions[0].Execute -ne $nodePath -or $existing.Actions[0].Arguments -ne $arguments) {
    throw 'Existing scheduled task is not this installation.'
  }
  if ([string]$existing.State -eq 'Running') { throw 'Sidecar is busy; installation will not replace a running task.' }
}
function Set-PrivateAcl([string]$Path,[string]$UserRights,[bool]$Directory) {
  $acl=if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
  $acl.SetAccessRuleProtection($true,$false)
  $inherit=if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
  $systemSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $adminSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $acl.SetOwner($systemSid)
  foreach ($sid in @($systemSid,$adminSid)) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',$inherit,'None','Allow'))
  }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($userSid,$UserRights,$inherit,'None','Allow'))
  & ($security.ExportedCmdlets['Set-Acl']) -LiteralPath $Path -AclObject $acl
}
$config=@{
  schemaVersion=1;installationId=$installationId;root=$root;userSid=$userSid.Value
  taskName=$taskName;taskPath='\';userProfile=[string]$interactiveProfile[0].LocalPath
  expectedGitHubLogin=$ExpectedGitHubLogin;ghPath=$ghPath;gitPath=$gitPath
  workerPath=$workerPath;workerSHA256=(Get-FileHash -LiteralPath $workerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  repositories=@($Repository)
}
if ($Mode -eq 'Install') {
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  Set-PrivateAcl $root 'ReadAndExecute' $true
  foreach ($folder in @('queue','responses','sources','hooks')) {
    $path=Join-Path $root $folder
    Assert-LocalPath $path
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    Set-PrivateAcl $path $(if ($folder -eq 'hooks') {'ReadAndExecute'} else {'Modify'}) $true
  }
  $config | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $configPath -Encoding utf8
  Set-PrivateAcl $configPath 'Read' $false
  $principal=New-ScheduledTaskPrincipal -UserId $Account -LogonType Interactive -RunLevel Limited
  $action=New-ScheduledTaskAction -Execute $nodePath -Argument $arguments -WorkingDirectory $repoRoot
  $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 8) -MultipleInstances IgnoreNew
  $registration=@{TaskName=$taskName;TaskPath='\';Action=$action;Settings=$settings;Principal=$principal;Description=$description}
  if ($existing) { $registration.Force=$true }
  Register-ScheduledTask @registration | Out-Null
  $scheduler=New-Object -ComObject Schedule.Service
  $scheduler.Connect()
  $task=$scheduler.GetFolder('\').GetTask($taskName)
  $task.SetSecurityDescriptor('D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGX;;;'+$userSid.Value+')',0)
}
if (-not (Test-Path -LiteralPath $configPath)) { throw 'Sidecar has not been installed.' }
$actualConfig=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($actualConfig.workerSHA256 -ne $config.workerSHA256 -or $actualConfig.expectedGitHubLogin -ne $ExpectedGitHubLogin -or
    (@($actualConfig.repositories | Sort-Object) -join '|') -ne (@($Repository | Sort-Object) -join '|')) {
  throw 'Installed worker or scope differs; explicit Install is required.'
}
foreach ($path in @($root,$configPath,(Join-Path $root 'queue'),(Join-Path $root 'responses'),(Join-Path $root 'sources'),(Join-Path $root 'hooks'))) {
  Assert-LocalPath $path
  $acl=& ($security.ExportedCmdlets['Get-Acl']) -LiteralPath $path
  $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
  if (-not $acl.AreAccessRulesProtected -or @($rules | Where-Object { $_.AccessControlType -ne 'Allow' -or $_.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544',$userSid.Value) }).Count) {
    throw 'Sidecar private ACL audit failed.'
  }
}
$installed=Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction Stop
if ([string]$installed.Principal.LogonType -ne 'Interactive' -or [string]$installed.Principal.RunLevel -ne 'Limited' -or @($installed.Triggers | Where-Object { $null -ne $_ }).Count) {
  throw 'Sidecar must remain a limited, demand-only interactive-user task.'
}
$scheduler=New-Object -ComObject Schedule.Service
$scheduler.Connect()
$taskSecurity=[Security.AccessControl.RawSecurityDescriptor]::new($scheduler.GetFolder('\').GetTask($taskName).GetSecurityDescriptor(4))
for ($aceIndex=0;$aceIndex -lt $taskSecurity.DiscretionaryAcl.Count;$aceIndex++) {
  $ace=$taskSecurity.DiscretionaryAcl[$aceIndex]
  if ($ace.AceQualifier -ne 'AccessAllowed' -or $ace.SecurityIdentifier.Value -notin @('S-1-5-18','S-1-5-32-544',$userSid.Value)) {
    throw 'Sidecar task ACL audit failed.'
  }
}
@{mode=$Mode;taskName=$taskName;userSid=$userSid.Value;interactiveToken=$true;privateAcl=$true;taskAcl=$true;config=$configPath;automaticTriggers=$false} | ConvertTo-Json -Compress
