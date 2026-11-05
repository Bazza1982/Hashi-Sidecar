param(
 [ValidateSet('Install','Audit','Disable')][string]$Mode='Audit',
 [Parameter(Mandatory=$true)][string]$InstallRoot,
 [string]$SeedConfig,
 [string]$RuntimeRoot,
 [string]$TargetSid,
 [string[]]$PublisherSid=@('S-1-5-18'),
 [string[]]$IssuerSid,
 [string]$GitHubLogin,
 [string]$GhPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-security.ps1')
$security=Import-HubSecurityModule
Import-Module (Join-Path $PSHOME 'Modules\ScheduledTasks\ScheduledTasks.psd1') -ErrorAction Stop
function Assert-Local([string]$Path) {
 $p=[IO.Path]::GetFullPath($Path)
 while ($p) {
  if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Administration reparse path rejected.' }
  $p=[IO.Path]::GetDirectoryName($p)
 }
}
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function HashText([string]$Text) { $h=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()} }
function PrivateAcl([string]$Path,[string]$UserRights,[bool]$Public=$false) {
 $directory=(Get-Item -LiteralPath $Path -Force).PSIsContainer
 $acl=if ($directory) {[Security.AccessControl.DirectorySecurity]::new()} else {[Security.AccessControl.FileSecurity]::new()}
 $acl.SetAccessRuleProtection($true,$false)
 $inherit=if ($directory) {[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'} else {[Security.AccessControl.InheritanceFlags]::None}
 $system=[Security.Principal.SecurityIdentifier]::new('S-1-5-18');$admins=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
 $acl.SetOwner($system)
 foreach($sid in @($system,$admins)){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',$inherit,'None','Allow'))}
 if ($UserRights) {$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($script:userSid,$UserRights,$inherit,'None','Allow'))}
 if ($Public) {$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-11'),'ReadAndExecute',$inherit,'None','Allow'))}
 & ($security.ExportedCmdlets['Set-Acl']) -LiteralPath $Path -AclObject $acl
}
$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');Assert-Local $root
if($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\')){throw 'Use a dedicated installation directory.'}
$manifestPath=Join-Path $root 'installation.json';$configPath=Join-Path $root 'data\config.json'
$source=Join-Path $PSScriptRoot 'admin-sidecar'
$package=Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
$sourceNames=@('core.mjs','execute.mjs','cli.mjs','bootstrap.mjs','Native.cs','Launcher.cs','actions.ps1','maintenance.mjs','Maintenance.cs','package.json','README.md')
$sourcePins=@{};foreach($name in $sourceNames){$sourcePins[$name]=Hash (Join-Path $source $name)}
$sourcePins['legacy-worker']=Hash (Join-Path $PSScriptRoot 'github-user-sidecar.mjs')
$sourcePins['legacy-launcher']=Hash (Join-Path $PSScriptRoot 'github-sidecar\launcher.mjs')
 $sourcePins['installer']=Hash $PSCommandPath
 $sourcePins['windows-security']=Hash (Join-Path $PSScriptRoot 'windows-security.ps1')
$releaseId=$package.version+'-'+(HashText (($sourcePins.GetEnumerator() | Sort-Object Name | ForEach-Object {$_.Key+'='+$_.Value}) -join [Environment]::NewLine)).Substring(0,12)
$first=-not (Test-Path -LiteralPath $manifestPath)
if ($first) {
 if ($Mode -ne 'Install') { throw 'Administration program is not installed.' }
 if ((Test-Path -LiteralPath $root) -and @(Get-ChildItem -LiteralPath $root -Force).Count) { throw 'Unknown nonempty install root.' }
 if (-not $RuntimeRoot) { throw 'A portable runtime is required.' }
 Assert-Local $RuntimeRoot
 $runtimeVersion=& (Join-Path $RuntimeRoot 'node.exe') --version
 if($LASTEXITCODE -ne 0 -or $runtimeVersion -notmatch '^v(22|24)\.') {throw 'Supported portable Node 22 or 24 is required.'}
 $compatibilityEnabled=[bool]$SeedConfig
 if ($SeedConfig) {
  if ($TargetSid) { throw 'Use TargetSid or the optional legacy seed, not both.' }
  Assert-Local $SeedConfig
  $seed=Get-Content -LiteralPath $SeedConfig -Raw | ConvertFrom-Json
 } else {
  if (-not $TargetSid) { throw 'An explicit target Windows account SID is required.' }
  $verifiedSid=[Security.Principal.SecurityIdentifier]::new($TargetSid)
  $null=$verifiedSid.Translate([Security.Principal.NTAccount])
  $observedProfiles=@(Get-CimInstance Win32_UserProfile | Where-Object {$_.SID -eq $verifiedSid.Value})
  if ($observedProfiles.Count -gt 1) { throw 'Ambiguous Windows profile registration.' }
  $profilePath=if($observedProfiles.Count -eq 1){[string]$observedProfiles[0].LocalPath}else{''}
  $seed=[pscustomobject]@{userSid=$verifiedSid.Value;userProfile=$profilePath;expectedGitHubLogin=$GitHubLogin;ghPath=$GhPath;gitPath=''}
 }
 $githubEnabled=([bool]$seed.ghPath -and [bool]$seed.expectedGitHubLogin)
 if (([bool]$seed.ghPath) -ne ([bool]$seed.expectedGitHubLogin)) { throw 'GitHub requires both an explicit CLI path and expected login.' }
 if (-not $IssuerSid) {$IssuerSid=$PublisherSid}
 $PublisherSid=@($PublisherSid | ForEach-Object {[Security.Principal.SecurityIdentifier]::new($_).Value})
 $IssuerSid=@($IssuerSid | ForEach-Object {[Security.Principal.SecurityIdentifier]::new($_).Value})
 if (-not $PublisherSid.Count -or -not $IssuerSid.Count) { throw 'Explicit publisher and issuer principals are required.' }
 $script:userSid=[Security.Principal.SecurityIdentifier]::new([string]$seed.userSid)
 if ($script:userSid.Value -notmatch '^S-1-5-21-') { throw 'Verified interactive SID required.' }
 $account=$script:userSid.Translate([Security.Principal.NTAccount]).Value
 $null=Get-LocalUser -SID $script:userSid -ErrorAction Stop
 $profile=@(Get-CimInstance Win32_UserProfile | Where-Object {$_.SID -eq $script:userSid.Value})
 $profileAvailable=($profile.Count -eq 1 -and [bool]$seed.userProfile)
 if ($profileAvailable -and [IO.Path]::GetFullPath([string]$profile[0].LocalPath) -ne [IO.Path]::GetFullPath([string]$seed.userProfile)) { throw 'Selected Windows profile registration changed.' }
 $administrator=@(Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop | Where-Object {$_.SID.Value -eq $script:userSid.Value}).Count -eq 1
 if ($githubEnabled -and -not $profileAvailable) { throw 'GitHub requires an existing target-user profile.' }
 $dependencies=@((Join-Path $RuntimeRoot 'node.exe'),(Join-Path $RuntimeRoot 'LICENSE'))
 if($githubEnabled){$dependencies+=@($seed.ghPath)}
 if($compatibilityEnabled){$dependencies+=@($seed.gitPath)}
 foreach($path in $dependencies){Assert-Local $path;if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw 'Verified dependency unavailable.'}}
 $id=[guid]::NewGuid().ToString();$suffix=$id.Substring(0,12)
 $stage=$root+'.stage-'+[guid]::NewGuid().ToString('N')
 New-Item -ItemType Directory -Path $stage | Out-Null
 try {
  PrivateAcl $stage 'ReadAndExecute' $true
  foreach($p in @('bin','runtime',('releases\'+$releaseId),'compat','maintenance','maintenance\admin-sidecar','maintenance\github-sidecar','data')){New-Item -ItemType Directory -Path (Join-Path $stage $p) -Force | Out-Null}
  $release=Join-Path $stage ('releases\'+$releaseId)
  foreach($name in @('core.mjs','execute.mjs','cli.mjs','actions.ps1','maintenance.mjs')){Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $release $name)}
  Copy-Item -LiteralPath (Join-Path $source 'bootstrap.mjs') -Destination (Join-Path $stage 'bin\launcher.mjs')
  if($compatibilityEnabled){
   Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'github-user-sidecar.mjs') -Destination (Join-Path $stage 'compat\github-user-sidecar.mjs')
   Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'github-sidecar\launcher.mjs') -Destination (Join-Path $stage 'compat\launcher.mjs')
  }
  Copy-Item -LiteralPath (Join-Path $RuntimeRoot 'node.exe') -Destination (Join-Path $stage 'runtime\node.exe')
  Copy-Item -LiteralPath (Join-Path $RuntimeRoot 'LICENSE') -Destination (Join-Path $stage 'runtime\LICENSE')
  $csc=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  if (-not(Test-Path -LiteralPath $csc)) {throw 'The supported native compiler is unavailable.'}
  & $csc /nologo /target:exe /r:System.Web.Extensions.dll /r:System.Security.dll (('/out:'+(Join-Path $stage 'bin\admin-native.exe'))) (Join-Path $source 'Native.cs')
  if($LASTEXITCODE -ne 0){throw 'Native execution helper compilation failed.'}
  & $csc /nologo /target:exe /r:System.Web.Extensions.dll /r:System.Security.dll (('/out:'+(Join-Path $stage 'bin\maintenance-native.exe'))) (Join-Path $source 'Maintenance.cs')
  if($LASTEXITCODE -ne 0){throw 'Native maintenance helper compilation failed.'}
  & $csc /nologo /target:exe (('/out:'+(Join-Path $stage 'bin\hashi-admin.exe'))) (Join-Path $source 'Launcher.cs')
  if($LASTEXITCODE -ne 0){throw 'Native client compilation failed.'}
  foreach($name in $sourceNames){Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $stage ('maintenance\admin-sidecar\'+$name))}
  foreach($name in @('install-admin-sidecar.ps1','windows-security.ps1','github-user-sidecar.mjs')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $stage ('maintenance\'+$name))}
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'github-sidecar\launcher.mjs') -Destination (Join-Path $stage 'maintenance\github-sidecar\launcher.mjs')
  $data=Join-Path $stage 'data';PrivateAcl $data 'ReadAndExecute'
  foreach($p in @('grants','revoked','requests','events','maintenance','lanes','legacy')){$folder=Join-Path $data $p;New-Item -ItemType Directory -Path $folder -Force | Out-Null;PrivateAcl $folder 'ReadAndExecute'}
  $profiles=@{}
  foreach($p in @('system','user','user-admin')){
   $folder=Join-Path $data ('lanes\'+$p);New-Item -ItemType Directory -Path $folder -Force | Out-Null;PrivateAcl $folder 'ReadAndExecute'
   foreach($part in @('queue','claims','responses','cancel','work')){$leaf=Join-Path $folder $part;New-Item -ItemType Directory -Path $leaf | Out-Null;PrivateAcl $leaf $(if($p -eq 'user'){'Modify'}else{'ReadAndExecute'})}
   $available=($p -eq 'system' -or ($profileAvailable -and ($p -eq 'user' -or $administrator)))
   $reason=if($available){''}elseif($p -eq 'user-admin' -and -not $administrator){'TARGET_NOT_ADMINISTRATOR'}else{'USER_PROFILE_NOT_CREATED'}
   $profiles[$p]=@{sid=$(if($p -eq 'system'){'S-1-5-18'}else{$script:userSid.Value});elevated=($p -ne 'user');taskName=('HashiSidecar-'+$suffix+'-'+$p);available=$available;reason=$reason}
  }
  foreach($part in @('queue','responses','sources','hooks','uploads','requests','claims','work')){$folder=Join-Path $data ('legacy\'+$part);New-Item -ItemType Directory -Path $folder -Force | Out-Null;PrivateAcl $folder $(if($part -eq 'hooks'){'ReadAndExecute'}else{'Modify'})}
  $config=@{schemaVersion=2;installationId=$id;machine=[Environment]::MachineName;root=(Join-Path $root 'data');programRoot=$root;userSid=$script:userSid.Value;userProfile=$seed.userProfile;
    publisherSids=@($PublisherSid);issuerSids=@($IssuerSid);githubEnabled=$githubEnabled;compatibilityEnabled=$compatibilityEnabled;expectedGitHubLogin=$seed.expectedGitHubLogin;ghPath=$seed.ghPath;gitPath=$seed.gitPath;
    nodePath=(Join-Path $root 'runtime\node.exe');helperPath=(Join-Path $root 'bin\admin-native.exe');workerPath=(Join-Path $root ('releases\'+$releaseId+'\cli.mjs'));actionsPath=(Join-Path $root ('releases\'+$releaseId+'\actions.ps1'));
    powershellPath=(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe');profiles=$profiles;legacyTaskName=('HashiHubV2-GitHubRead-admin-'+$suffix)}
  $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $stage 'data\config.json') -Encoding utf8
  PrivateAcl (Join-Path $stage 'data\config.json') 'Read'
  if($compatibilityEnabled){
  $legacy=$seed | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  $legacy.installationId=[guid]::NewGuid().ToString();$legacy.root=Join-Path $root 'data\legacy';$legacy.workerPath=Join-Path $root 'compat\github-user-sidecar.mjs'
  $legacy.workerSHA256=Hash (Join-Path $stage 'compat\github-user-sidecar.mjs');$legacy.taskName=$config.legacyTaskName;$legacy.taskPath='\'
  $legacy | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $stage 'data\legacy\config.json') -Encoding utf8
  PrivateAcl (Join-Path $stage 'data\legacy\config.json') 'Read'
  }
  Copy-Item -LiteralPath (Join-Path $source 'README.md') -Destination (Join-Path $stage 'README.md')
  $pins=@{'README.md'=(Hash (Join-Path $stage 'README.md'))}
  foreach($folder in @('bin','runtime','releases','compat','maintenance')){foreach($file in Get-ChildItem -LiteralPath (Join-Path $stage $folder) -Recurse -File){$relative=$file.FullName.Substring($stage.Length+1).Replace('\','/');$pins[$relative]=Hash $file.FullName}}
  @{schemaVersion=2;name=$package.name;version=$package.version;compatibility=$compatibilityEnabled;releaseId=$releaseId;config='data/config.json';files=$pins;sourcePins=$sourcePins;legacySource=$sourcePins['legacy-worker']} | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $stage 'installation.json') -Encoding utf8
  @('HASHI Admin Sidecar 2.1','',('Executable: '+(Join-Path $root 'bin\hashi-admin.exe')),('Maintenance: '+(Join-Path $root 'maintenance\install-admin-sidecar.ps1')), 'Use managed execution. Run --help and capabilities. The original GitHubSidecar installation is preserved.') | Set-Content -LiteralPath (Join-Path $stage 'LOCATION.md') -Encoding utf8
  Move-Item -LiteralPath $stage -Destination $root
 } finally {if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}}
}
$manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$script:userSid=[Security.Principal.SecurityIdentifier]::new([string]$config.userSid)
$account=$script:userSid.Translate([Security.Principal.NTAccount]).Value
if($manifest.name -ne 'hashi-admin-sidecar' -or $manifest.releaseId -ne $releaseId -or $config.root -ne (Join-Path $root 'data')){throw 'An owned matching release is required; no in-place overwrite occurs.'}
foreach($property in $manifest.files.PSObject.Properties){$p=Join-Path $root $property.Name;Assert-Local $p;if((Hash $p) -ne $property.Value){throw 'Installed administration payload integrity failed.'}}
$definitions=@()
foreach($p in @('system','user','user-admin')){
 $definition=$config.profiles.$p
 if($definition.PSObject.Properties.Name -contains 'available' -and -not $definition.available){continue}
 $definitions+=@{name=$definition.taskName;sid=$definition.sid;profile=$p;logon=$(if($p -eq 'system'){'ServiceAccount'}else{'Interactive'});level=$(if($p -eq 'user'){'Limited'}else{'Highest'});exe=$config.nodePath;arguments=('"'+$config.workerPath+'" --worker --profile '+$p);description=('HASHI Admin Sidecar '+$config.installationId+' '+$p)}
}
if($config.compatibilityEnabled){$definitions+=@{name=$config.legacyTaskName;sid=$config.userSid;profile='compat';logon='Interactive';level='Limited';exe=$config.nodePath;arguments=('"'+(Join-Path $root 'compat\github-user-sidecar.mjs')+'" --worker --config "'+(Join-Path $root 'data\legacy\config.json')+'"');description=('HASHI Admin Sidecar '+$config.installationId+' compat')}}
foreach($d in $definitions){
 $existing=Get-ScheduledTask -TaskPath '\' -TaskName $d.name -ErrorAction SilentlyContinue
 if($existing){
  $observedSid=try{([Security.Principal.NTAccount]::new([string]$existing.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value}catch{[string]$existing.Principal.UserId}
  if($existing.Description -ne $d.description -or $observedSid -ne $d.sid -or @($existing.Actions).Count -ne 1 -or $existing.Actions[0].Execute -ne $d.exe -or $existing.Actions[0].Arguments -ne $d.arguments){throw 'A foreign or changed scheduled task is rejected.'}
  if($Mode -ne 'Audit' -and [string]$existing.State -eq 'Running'){throw 'Owned executor is busy.'}
 }
 if($Mode -eq 'Install'){
  $principal=New-ScheduledTaskPrincipal -UserId $(if($d.profile -eq 'system'){'SYSTEM'}else{$account}) -LogonType $d.logon -RunLevel $d.level
  $action=New-ScheduledTaskAction -Execute $d.exe -Argument $d.arguments -WorkingDirectory $root
  $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 25) -MultipleInstances IgnoreNew
  $registration=@{TaskName=$d.name;TaskPath='\';Principal=$principal;Action=$action;Settings=$settings;Description=$d.description};if($existing){$registration.Force=$true}
  Register-ScheduledTask @registration | Out-Null
  $scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect()
  $scheduler.GetFolder('\').GetTask($d.name).SetSecurityDescriptor('D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGX;;;'+$script:userSid.Value+')',0)
 }
 $actual=Get-ScheduledTask -TaskPath '\' -TaskName $d.name -ErrorAction Stop
 if([string]$actual.Principal.LogonType -ne $d.logon -or [string]$actual.Principal.RunLevel -ne $d.level -or @($actual.Triggers | Where-Object {$null -ne $_}).Count){throw 'Executor identity policy audit failed.'}
 if($Mode -eq 'Disable'){Disable-ScheduledTask -InputObject $actual | Out-Null}
}
foreach($path in @($root,(Join-Path $root 'data'),$configPath,(Join-Path $root 'data\requests'),(Join-Path $root 'data\grants'),(Join-Path $root 'data\revoked'),(Join-Path $root 'data\lanes\system'),(Join-Path $root 'data\lanes\user-admin'))){
 Assert-Local $path;$acl=& ($security.ExportedCmdlets['Get-Acl']) -LiteralPath $path
 $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
 $allowed=@('S-1-5-18','S-1-5-32-544',$script:userSid.Value);if($path -eq $root){$allowed+=@('S-1-5-11')}
 if(-not $acl.AreAccessRulesProtected -or @($rules | Where-Object {$_.AccessControlType -ne 'Allow' -or $_.IdentityReference.Value -notin $allowed}).Count){throw 'Administration ACL audit failed.'}
 if(@($rules | Where-Object {$_.IdentityReference.Value -in @($script:userSid.Value,'S-1-5-11') -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write)}).Count){throw 'Unprivileged control-state writer rejected.'}
}
& (Join-Path $root 'bin\hashi-admin.exe') version
if($LASTEXITCODE -ne 0){throw 'Installed client validation failed.'}
@{ok=$true;mode=$Mode;root=$root;version=$manifest.version;releaseId=$releaseId;tasks=@($definitions | ForEach-Object {$_.name});legacyPreserved=$true;compatibilityEnabled=$config.compatibilityEnabled;targetSid=$config.userSid;githubEnabled=$config.githubEnabled;authority='Windows-principal task grants; per-Agent labels are not attested'} | ConvertTo-Json -Depth 10 -Compress
