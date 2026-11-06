param(
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [Parameter(Mandatory=$true)][string]$ExpectedReleaseId,
  [string[]]$WriteRepository=@(),
  [switch]$AllAccountRepositories
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-security.ps1')
$security=Import-HubSecurityModule
Import-Module (Join-Path $PSHOME 'Modules\ScheduledTasks\ScheduledTasks.psd1') -ErrorAction Stop
$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
function Assert-Local([string]$Path) {
  $cursor=[IO.Path]::GetFullPath($Path)
  while ($cursor) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Upgrade reparse path rejected.' }
    $cursor=[IO.Path]::GetDirectoryName($cursor)
  }
}
Assert-Local $root
$manifestPath=Join-Path $root 'installation.json'
$configPath=Join-Path $root 'data\config.json'
$exe=Join-Path $root 'bin\hashi-github.exe'
$old=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($old.name -ne 'hashi-github-sidecar' -or $old.releaseId -ne $ExpectedReleaseId -or
    [IO.Path]::GetFullPath([string]$config.root) -ne (Join-Path $root 'data') -or
    $config.taskPath -ne '\' -or $config.taskName -notmatch '^HashiHubV2-GitHubRead-[a-zA-Z0-9-]+$') { throw 'Upgrade installation identity changed.' }
$version=& $exe version
if ($LASTEXITCODE -ne 0 -or (($version -join [Environment]::NewLine) | ConvertFrom-Json).releaseId -ne $ExpectedReleaseId) { throw 'Installed integrity check failed.' }
$package=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'github-sidecar\package.json') -Raw | ConvertFrom-Json
if ([version]$package.version -le [version]$old.version) { throw 'Upgrade requires a newer reviewed package.' }
foreach ($repo in $WriteRepository) {
  $accountScope=$AllAccountRepositories -or ($config.PSObject.Properties.Name -contains 'repositoryScope' -and $config.repositoryScope -eq 'account')
  if (($accountScope -and $repo -notmatch ('^(?i)'+[regex]::Escape($config.expectedGitHubLogin)+'/[A-Za-z0-9_.-]+$')) -or (-not $accountScope -and $repo -notin @($config.repositories))) { throw 'Write scope must be inside the repository scope.' }
}
if (@($WriteRepository | Sort-Object -Unique).Count -ne $WriteRepository.Count) { throw 'Duplicate write repository.' }
$task=Get-ScheduledTask -TaskPath '\' -TaskName $config.taskName -ErrorAction Stop
$oldArguments='"'+[string]$config.workerPath+'" --worker --config "'+$configPath+'"'
$taskSid=try { ([Security.Principal.NTAccount]::new([string]$task.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { [string]$task.Principal.UserId }
if ($task.Description -ne ('HASHI permanent GitHub sidecar; installation '+$config.installationId) -or
    @($task.Actions).Count -ne 1 -or $task.Actions[0].Execute -ne (Join-Path $root 'runtime\node.exe') -or
    $task.Actions[0].Arguments -ne $oldArguments -or $taskSid -ne $config.userSid -or
    [string]$task.Principal.LogonType -ne 'Interactive' -or [string]$task.Principal.RunLevel -ne 'Limited') { throw 'Upgrade task ownership mismatch.' }
function Assert-Idle {
  $current=Get-ScheduledTask -TaskPath '\' -TaskName $config.taskName
  if ([string]$current.State -eq 'Running' -or @(Get-ChildItem -LiteralPath (Join-Path $root 'data\queue') -File | Where-Object { $_.Name -match '\.(json|running)$' }).Count) { throw 'Owned sidecar is busy; upgrade does not interrupt it.' }
}
Assert-Idle
$backup=Join-Path $root ('data\upgrades\'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$oldXml=Export-ScheduledTask -TaskPath '\' -TaskName $config.taskName
$oldXml | Set-Content -LiteralPath (Join-Path $backup 'task.xml') -Encoding utf8
$scheduler=New-Object -ComObject Schedule.Service
$scheduler.Connect()
$taskSecurity=$scheduler.GetFolder('\').GetTask($config.taskName).GetSecurityDescriptor(4)
$enabled=[bool]$task.Settings.Enabled
$paths=@('installation.json','data\config.json','bin\hashi-github.exe','bin\launcher.mjs','README.md','LOCATION.md','maintenance')
foreach ($name in $paths) {
  $target=Join-Path $backup $name
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $root $name) -Destination $target -Recurse
}
$stage=$root+'.upgrade-'+[guid]::NewGuid().ToString('N')
$stagedTask=$null
$promoted=$false
$disabled=$false
try {
  & (Join-Path $PSScriptRoot 'install-shared-github-sidecar.ps1') -Mode Install -InstallRoot $stage -SeedConfig $configPath -RuntimeRoot (Join-Path $root 'runtime') -WriteRepository $WriteRepository -AllAccountRepositories:$AllAccountRepositories | Out-Null
  $candidate=Get-Content -LiteralPath (Join-Path $stage 'installation.json') -Raw | ConvertFrom-Json
  $stageConfig=Get-Content -LiteralPath (Join-Path $stage 'data\config.json') -Raw | ConvertFrom-Json
  $stagedTask=[string]$stageConfig.taskName
  if ($candidate.version -ne $package.version -or
      (Get-FileHash -LiteralPath (Join-Path $stage 'runtime\node.exe')).Hash -ne (Get-FileHash -LiteralPath (Join-Path $root 'runtime\node.exe')).Hash) { throw 'Candidate runtime or release mismatch.' }
  Assert-Idle
  Disable-ScheduledTask -TaskPath '\' -TaskName $config.taskName | Out-Null
  $disabled=$true
  Assert-Idle
  $release=Join-Path $root ('releases\'+$candidate.releaseId)
  if (Test-Path -LiteralPath $release) { throw 'Candidate release directory already exists.' }
  Copy-Item -LiteralPath (Join-Path $stage ('releases\'+$candidate.releaseId)) -Destination $release -Recurse
  foreach ($folder in @('uploads','requests','claims','work')) {
    $destination=Join-Path $root ('data\'+$folder)
    if (-not (Test-Path -LiteralPath $destination)) {
      New-Item -ItemType Directory -Path $destination | Out-Null
      $acl=& ($security.ExportedCmdlets['Get-Acl']) -LiteralPath (Join-Path $stage ('data\'+$folder))
      & ($security.ExportedCmdlets['Set-Acl']) -LiteralPath $destination -AclObject $acl
    }
  }
  foreach ($name in @('bin\hashi-github.exe','bin\launcher.mjs','README.md')) {
    Copy-Item -LiteralPath (Join-Path $stage $name) -Destination (Join-Path $root $name) -Force
  }
  $codeTick=[char]96
  @('# Local application location','',('Executable: '+$codeTick+$exe+$codeTick),('Guide: '+$codeTick+(Join-Path $root 'README.md')+$codeTick),('Configuration: '+$codeTick+$configPath+$codeTick)) | Set-Content -LiteralPath (Join-Path $root 'LOCATION.md') -Encoding utf8
  # Keep all original instance data and its installation ID. Only the worker
  # pin and the explicitly selected write scope change.
  $config.workerPath=Join-Path $release 'github-user-sidecar.mjs'
  $config.workerSHA256=$candidate.files.worker.sha256
  foreach ($property in @('repositories','writeRepositories','repositoryScope','writeRepositoryScope')) {
    $config | Add-Member -NotePropertyName $property -NotePropertyValue $stageConfig.$property -Force
  }
  $tempConfig=$configPath+'.upgrade'
  $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $tempConfig -Encoding utf8
  $acl=& ($security.ExportedCmdlets['Get-Acl']) -LiteralPath $configPath
  & ($security.ExportedCmdlets['Set-Acl']) -LiteralPath $tempConfig -AclObject $acl
  [IO.File]::Replace($tempConfig,$configPath,(Join-Path $backup 'config.replaced.json'))
  Copy-Item -Path (Join-Path $stage 'maintenance\*') -Destination (Join-Path $root 'maintenance') -Recurse -Force
  $tempManifest=$manifestPath+'.upgrade'
  Copy-Item -LiteralPath (Join-Path $stage 'installation.json') -Destination $tempManifest
  [IO.File]::Replace($tempManifest,$manifestPath,(Join-Path $backup 'manifest.replaced.json'))
  $arguments='"'+[string]$config.workerPath+'" --worker --config "'+$configPath+'"'
  $action=New-ScheduledTaskAction -Execute (Join-Path $root 'runtime\node.exe') -Argument $arguments -WorkingDirectory $root
  $updatedSettings=$task.Settings
  $updatedSettings.Enabled=$false
  Register-ScheduledTask -TaskPath '\' -TaskName $config.taskName -Action $action -Principal $task.Principal -Settings $updatedSettings -Description $task.Description -Force | Out-Null
  $scheduler.GetFolder('\').GetTask($config.taskName).SetSecurityDescriptor($taskSecurity,0)
  & (Join-Path $PSScriptRoot 'install-shared-github-sidecar.ps1') -Mode Audit -InstallRoot $root | Out-Null
  $promoted=$true
  if ($enabled) { Enable-ScheduledTask -TaskPath '\' -TaskName $config.taskName | Out-Null }
  @{schemaVersion=1;previousRelease=$ExpectedReleaseId;releaseId=$candidate.releaseId;version=$candidate.version;installationId=$config.installationId;dataPreserved=$true;writeRepositories=@($WriteRepository)} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $backup 'result.json') -Encoding utf8
  @{ok=$true;version=$candidate.version;releaseId=$candidate.releaseId;backup=$backup;dataPreserved=$true;repositoryScope=$config.repositoryScope;writeRepositoryScope=$config.writeRepositoryScope;writeRepositories=@($config.writeRepositories)} | ConvertTo-Json -Compress
} catch {
  if ($disabled -and -not $promoted) {
    foreach ($name in $paths) {
      if ($name -eq 'maintenance') { Copy-Item -Path (Join-Path $backup 'maintenance\*') -Destination (Join-Path $root 'maintenance') -Recurse -Force }
      else { Copy-Item -LiteralPath (Join-Path $backup $name) -Destination (Join-Path $root $name) -Force }
    }
    Register-ScheduledTask -TaskPath '\' -TaskName $config.taskName -Xml $oldXml -Force | Out-Null
    $scheduler.GetFolder('\').GetTask($config.taskName).SetSecurityDescriptor($taskSecurity,0)
    if ($enabled) { Enable-ScheduledTask -TaskPath '\' -TaskName $config.taskName | Out-Null }
  }
  throw
} finally {
  if ($stagedTask) {
    $temporary=Get-ScheduledTask -TaskPath '\' -TaskName $stagedTask -ErrorAction SilentlyContinue
    if ($temporary -and $temporary.Description -eq ('HASHI permanent GitHub sidecar; installation '+$stageConfig.installationId) -and [string]$temporary.State -ne 'Running') {
      Unregister-ScheduledTask -TaskPath '\' -TaskName $stagedTask -Confirm:$false
    }
  }
  if ($stagedTask -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
