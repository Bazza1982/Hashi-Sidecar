param(
  [ValidateSet('Install','Audit','Upgrade')][string]$Mode='Audit',
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [string]$SeedConfig,
  [string]$RuntimeRoot,
  [string]$ExpectedReleaseId,
  [string[]]$WriteRepository=@(),
  [switch]$AllAccountRepositories
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-security.ps1')
$security=Import-HubSecurityModule
Import-Module (Join-Path $PSHOME 'Modules\ScheduledTasks\ScheduledTasks.psd1') -ErrorAction Stop
$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ($Mode -eq 'Upgrade') {
  if (-not $ExpectedReleaseId) { throw 'Upgrade requires the reviewed installed release ID.' }
  & (Join-Path $PSScriptRoot 'upgrade-shared-github-sidecar.ps1') -InstallRoot $root -ExpectedReleaseId $ExpectedReleaseId -WriteRepository $WriteRepository -AllAccountRepositories:$AllAccountRepositories
  return
}
if ($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\')) { throw 'Explicit application directory required.' }
function Assert-LocalPath([string]$Path) {
  $cursor=[IO.Path]::GetFullPath($Path)
  while ($cursor) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'Shared application reparse path rejected.'
    }
    $cursor=[IO.Path]::GetDirectoryName($cursor)
  }
}
function Hash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Text-Hash([string]$Value) {
  $algorithm=[Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}
Assert-LocalPath $root
$data=Join-Path $root 'data'
$configPath=Join-Path $data 'config.json'
$manifestPath=Join-Path $root 'installation.json'
$assets=@{
  worker=(Join-Path $PSScriptRoot 'github-user-sidecar.mjs')
  launcher=(Join-Path $PSScriptRoot 'github-sidecar\launcher.mjs')
  nativeLauncher=(Join-Path $PSScriptRoot 'github-sidecar\Launcher.cs')
  package=(Join-Path $PSScriptRoot 'github-sidecar\package.json')
  guide=(Join-Path $PSScriptRoot 'github-sidecar\README.md')
  upgrade=(Join-Path $PSScriptRoot 'upgrade-shared-github-sidecar.ps1')
  installer=$PSCommandPath
  security=(Join-Path $PSScriptRoot 'windows-security.ps1')
}
$sourceHashes=@{}
foreach ($entry in $assets.GetEnumerator()) {
  Assert-LocalPath $entry.Value
  if (-not (Test-Path -LiteralPath $entry.Value -PathType Leaf)) { throw 'Application package source is incomplete.' }
  $sourceHashes[$entry.Key]=Hash $entry.Value
}
$package=Get-Content -LiteralPath $assets.package -Raw | ConvertFrom-Json
if ($package.name -ne 'hashi-github-sidecar' -or $package.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid program package.' }
$releaseHash=Text-Hash ((@($sourceHashes.GetEnumerator() | Sort-Object Name | ForEach-Object { $_.Name+'='+$_.Value })) -join [Environment]::NewLine)
$releaseId=$package.version+'-'+$releaseHash.Substring(0,12)
$worker=Join-Path $root ('releases\'+$releaseId+'\github-user-sidecar.mjs')
$node=Join-Path $root 'runtime\node.exe'
$exe=Join-Path $root 'bin\hashi-github.exe'
$existingManifest=$null
if (Test-Path -LiteralPath $manifestPath) {
  $existingManifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($existingManifest.name -ne $package.name -or $existingManifest.releaseId -ne $releaseId) {
    throw 'Installed package differs. Use a reviewed new deployment instead of an implicit overwrite.'
  }
  $SeedConfig=$configPath
} elseif (Test-Path -LiteralPath $root) {
  throw 'Unrecognized existing application directory will not be overwritten.'
}
if (-not $SeedConfig) { throw 'First installation requires a private seed configuration.' }
Assert-LocalPath $SeedConfig
$seed=Get-Content -LiteralPath $SeedConfig -Raw | ConvertFrom-Json
if ($seed.schemaVersion -ne 1 -or $seed.userSid -notmatch '^S-1-5-21-(\d+-){2,}\d+$' -or
    $seed.expectedGitHubLogin -notmatch '^[A-Za-z0-9-]{1,39}$') { throw 'Invalid seed identity.' }
$accountScope=$AllAccountRepositories -or ($seed.PSObject.Properties.Name -contains 'repositoryScope' -and $seed.repositoryScope -eq 'account')
$accountWrite=$AllAccountRepositories -or ($seed.PSObject.Properties.Name -contains 'writeRepositoryScope' -and $seed.writeRepositoryScope -eq 'account')
if ($accountWrite -and -not $accountScope) { throw 'Account writes require account reads.' }
$repositories=@(if (-not $accountScope) { $seed.repositories })
if ((-not $accountScope -and -not $repositories.Count) -or $repositories.Count -gt 16 -or @($repositories | Sort-Object -Unique).Count -ne $repositories.Count) { throw 'Invalid repository scope.' }
foreach ($repo in $repositories) { if ($repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid repository scope.' } }
foreach ($repo in $WriteRepository) {
  if (($accountScope -and $repo -notmatch ('^(?i)'+[regex]::Escape($seed.expectedGitHubLogin)+'/[A-Za-z0-9_.-]+$')) -or (-not $accountScope -and $repo -notin $repositories)) { throw 'Write scope must be inside the repository scope.' }
}
if (@($WriteRepository | Sort-Object -Unique).Count -ne $WriteRepository.Count) { throw 'Duplicate write scope.' }
$userSid=[Security.Principal.SecurityIdentifier]::new([string]$seed.userSid)
$userAccount=$userSid.Translate([Security.Principal.NTAccount]).Value
$interactiveProfile=@(Get-CimInstance Win32_UserProfile | Where-Object { $_.SID -eq $userSid.Value })
if ($interactiveProfile.Count -ne 1 -or [IO.Path]::GetFullPath([string]$interactiveProfile[0].LocalPath) -ne [IO.Path]::GetFullPath([string]$seed.userProfile)) {
  throw 'Seed identity does not match the OS profile.'
}
foreach ($dependency in @($seed.ghPath,$seed.gitPath)) {
  if (-not [IO.Path]::IsPathRooted($dependency) -or -not (Test-Path -LiteralPath $dependency -PathType Leaf)) { throw 'Configured GitHub/Git dependency is unavailable.' }
}
$installationId=if ($existingManifest) { [string]$seed.installationId } else { [guid]::NewGuid().ToString() }
if ($installationId -notmatch '^[0-9a-f-]{36}$') { throw 'Invalid installation ID.' }
$taskName='HashiHubV2-GitHubRead-'+(Text-Hash ($data+'|'+$userSid.Value)).Substring(0,12)
$description='HASHI permanent GitHub sidecar; installation '+$installationId
$arguments='"'+$worker+'" --worker --config "'+$configPath+'"'
$existingTask=Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
  $taskSid=try { ([Security.Principal.NTAccount]::new([string]$existingTask.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { [string]$existingTask.Principal.UserId }
  if (-not $existingManifest -or $existingTask.Description -ne $description -or $taskSid -ne $userSid.Value -or
      @($existingTask.Actions).Count -ne 1 -or $existingTask.Actions[0].Execute -ne $node -or $existingTask.Actions[0].Arguments -ne $arguments) {
    throw 'Existing task is not owned by this installation.'
  }
  if ([string]$existingTask.State -eq 'Running' -and $Mode -eq 'Install') { throw 'Owned task is busy; repair will not replace it.' }
}
function Set-ApplicationAcl([string]$Path,[bool]$Private,[string]$UserRights,[bool]$Directory) {
  $acl=if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
  $acl.SetAccessRuleProtection($true,$false)
  $inherit=if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
  $systemSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $adminSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $acl.SetOwner($systemSid)
  foreach ($sid in @($systemSid,$adminSid)) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',$inherit,'None','Allow'))
  }
  if ($Private) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($userSid,$UserRights,$inherit,'None','Allow')) }
  else { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-11'),'ReadAndExecute',$inherit,'None','Allow')) }
  & ($security.ExportedCmdlets['Set-Acl']) -LiteralPath $Path -AclObject $acl
}
if ($Mode -eq 'Install' -and -not $existingManifest) {
  if (-not $interactiveProfile[0].Loaded) { throw 'First installation requires the selected logged-on user.' }
  if (-not $RuntimeRoot) { throw 'First installation requires an explicitly selected portable Node runtime.' }
  Assert-LocalPath $RuntimeRoot
  $runtimeNode=Join-Path $RuntimeRoot 'node.exe'
  $runtimeLicense=Join-Path $RuntimeRoot 'LICENSE'
  if (-not (Test-Path $runtimeNode -PathType Leaf) -or -not (Test-Path $runtimeLicense -PathType Leaf)) { throw 'Portable Node and its license are required.' }
  $nodeVersion=(& $runtimeNode --version) -join ''
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(22|24)\.') { throw 'Supported Node LTS runtime required.' }
  $stage=$root+'.staging-'+[guid]::NewGuid().ToString('N')
  Assert-LocalPath $stage
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  Set-ApplicationAcl $stage $false '' $true
  try {
    foreach ($folder in @('bin','runtime',('releases\'+$releaseId),'maintenance\github-sidecar','data')) {
      New-Item -ItemType Directory -Path (Join-Path $stage $folder) -Force | Out-Null
    }
    Set-ApplicationAcl (Join-Path $stage 'data') $true 'ReadAndExecute' $true
    foreach ($folder in @('queue','responses','sources','hooks','uploads','requests','claims','work')) {
      $path=Join-Path $stage ('data\'+$folder)
      New-Item -ItemType Directory -Path $path | Out-Null
      Set-ApplicationAcl $path $true $(if ($folder -eq 'hooks') {'ReadAndExecute'} else {'Modify'}) $true
    }
    Copy-Item -LiteralPath $runtimeNode -Destination (Join-Path $stage 'runtime\node.exe')
    Copy-Item -LiteralPath $runtimeLicense -Destination (Join-Path $stage 'runtime\LICENSE')
    Copy-Item -LiteralPath $assets.worker -Destination (Join-Path $stage ('releases\'+$releaseId+'\github-user-sidecar.mjs'))
    Copy-Item -LiteralPath $assets.launcher -Destination (Join-Path $stage 'bin\launcher.mjs')
    Copy-Item -LiteralPath $assets.guide -Destination (Join-Path $stage 'README.md')
    $maintenance=@{
      worker='github-user-sidecar.mjs';launcher='github-sidecar\launcher.mjs';nativeLauncher='github-sidecar\Launcher.cs'
      package='github-sidecar\package.json';guide='github-sidecar\README.md';installer='install-shared-github-sidecar.ps1';security='windows-security.ps1';upgrade='upgrade-shared-github-sidecar.ps1'
    }
    foreach ($entry in $maintenance.GetEnumerator()) { Copy-Item -LiteralPath $assets[$entry.Key] -Destination (Join-Path $stage ('maintenance\'+$entry.Value)) }
    $compiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $compiler /nologo /target:exe /platform:anycpu ('/out:'+(Join-Path $stage 'bin\hashi-github.exe')) $assets.nativeLauncher
    if ($LASTEXITCODE -ne 0) { throw 'Native launcher compilation failed.' }
    $configuration=@{
      schemaVersion=1;installationId=$installationId;root=$data;userSid=$userSid.Value
      taskName=$taskName;taskPath='\';userProfile=[string]$interactiveProfile[0].LocalPath
      expectedGitHubLogin=[string]$seed.expectedGitHubLogin;ghPath=[string]$seed.ghPath;gitPath=[string]$seed.gitPath
      workerPath=$worker;workerSHA256=$sourceHashes.worker;repositories=@($repositories);writeRepositories=@($WriteRepository | Where-Object { -not $accountWrite })
      repositoryScope=$(if ($accountScope) {'account'} else {'list'});writeRepositoryScope=$(if ($accountWrite) {'account'} else {'list'})
    }
    $stageConfig=Join-Path $stage 'data\config.json'
    $configuration | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $stageConfig -Encoding utf8
    Set-ApplicationAcl $stageConfig $true 'Read' $false
    $manifest=@{schemaVersion=1;name=$package.name;version=$package.version;releaseId=$releaseId;config='data/config.json';nodeVersion=$nodeVersion;sourceHashes=$sourceHashes;files=@{}}
    $filePaths=@{worker=('releases/'+$releaseId+'/github-user-sidecar.mjs');launcher='bin/launcher.mjs';executable='bin/hashi-github.exe';runtime='runtime/node.exe';license='runtime/LICENSE'}
    foreach ($entry in $filePaths.GetEnumerator()) { $manifest.files[$entry.Key]=@{path=$entry.Value;sha256=(Hash (Join-Path $stage $entry.Value))} }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $stage 'installation.json') -Encoding utf8
    $codeTick=[char]96
    @('# Local application location','',('Executable: '+$codeTick+$exe+$codeTick),('Guide: '+$codeTick+(Join-Path $root 'README.md')+$codeTick),('Configuration: '+$codeTick+$configPath+$codeTick)) | Set-Content -LiteralPath (Join-Path $stage 'LOCATION.md') -Encoding utf8
    $selfCheck=& (Join-Path $stage 'bin\hashi-github.exe') version
    if ($LASTEXITCODE -ne 0 -or (($selfCheck -join [Environment]::NewLine) | ConvertFrom-Json).version -ne $package.version) { throw 'Staged executable self-check failed.' }
    Move-Item -LiteralPath $stage -Destination $root
  } finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  }
}
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Permanent application has not been installed.' }
if ($Mode -eq 'Install') {
  $principal=New-ScheduledTaskPrincipal -UserId $userAccount -LogonType Interactive -RunLevel Limited
  $action=New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $root
  $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 8) -MultipleInstances IgnoreNew
  $registration=@{TaskName=$taskName;TaskPath='\';Action=$action;Settings=$settings;Principal=$principal;Description=$description}
  if ($existingTask) { $registration.Force=$true }
  Register-ScheduledTask @registration | Out-Null
  $scheduler=New-Object -ComObject Schedule.Service
  $scheduler.Connect()
  $scheduler.GetFolder('\').GetTask($taskName).SetSecurityDescriptor('D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGX;;;'+$userSid.Value+')',0)
}
# The installed binary validates all public payload hashes before any worker call.
$versionOutput=& $exe version
if ($LASTEXITCODE -ne 0) { throw 'Installed payload integrity check failed.' }
$installedVersion=($versionOutput -join [Environment]::NewLine) | ConvertFrom-Json
if ($installedVersion.releaseId -ne $releaseId) { throw 'Installed release identity mismatch.' }
foreach ($path in @($root,$data,$configPath,(Join-Path $data 'queue'),(Join-Path $data 'responses'),(Join-Path $data 'sources'),(Join-Path $data 'hooks'))) {
  Assert-LocalPath $path
  $acl=& ($security.ExportedCmdlets['Get-Acl']) -LiteralPath $path
  $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
  $allowed=if ($path -eq $root) { @('S-1-5-18','S-1-5-32-544','S-1-5-11') } else { @('S-1-5-18','S-1-5-32-544',$userSid.Value) }
  if (-not $acl.AreAccessRulesProtected -or @($rules | Where-Object { $_.AccessControlType -ne 'Allow' -or $_.IdentityReference.Value -notin $allowed }).Count) { throw 'Application ACL audit failed.' }
  if ($path -eq $root -and @($rules | Where-Object { $_.IdentityReference.Value -eq 'S-1-5-11' -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) }).Count) { throw 'Public program files must not be writable by callers.' }
}
$installedTask=Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction Stop
if ([string]$installedTask.Principal.LogonType -ne 'Interactive' -or [string]$installedTask.Principal.RunLevel -ne 'Limited' -or @($installedTask.Triggers | Where-Object { $null -ne $_ }).Count) { throw 'Invalid permanent task policy.' }
$scheduler=New-Object -ComObject Schedule.Service
$scheduler.Connect()
$taskSecurity=[Security.AccessControl.RawSecurityDescriptor]::new($scheduler.GetFolder('\').GetTask($taskName).GetSecurityDescriptor(4))
for ($index=0;$index -lt $taskSecurity.DiscretionaryAcl.Count;$index++) {
  $ace=$taskSecurity.DiscretionaryAcl[$index]
  if ($ace.AceQualifier -ne 'AccessAllowed' -or $ace.SecurityIdentifier.Value -notin @('S-1-5-18','S-1-5-32-544',$userSid.Value)) { throw 'Permanent task ACL audit failed.' }
}
@{mode=$Mode;program=$exe;root=$root;version=$package.version;releaseId=$releaseId;taskName=$taskName;privateAcl=$true;taskAcl=$true;bundledNode=$installedVersion.node;checkoutIndependent=$true} | ConvertTo-Json -Compress
