param(
 [ValidateSet('Install','Audit','Disable')][string]$Mode='Audit',
 [Parameter(Mandatory=$true)][string]$InstallRoot,
 [string]$AccountsFile,
 [string]$RuntimeRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-security.ps1')
$security=Import-HubSecurityModule
function Hash([string]$Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function LocalPath([string]$Path){
 $full=[IO.Path]::GetFullPath($Path)
 for($p=$full;$p;$p=[IO.Path]::GetDirectoryName($p)){
  if((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Reparse installation/dependency path rejected.'}
 }
 return $full
}
function OwnedPath([string]$Root,[string]$Relative){
 if([IO.Path]::IsPathRooted($Relative)){throw 'Absolute path in installation registry rejected.'}
 $full=LocalPath (Join-Path $Root $Relative)
 if(-not $full.StartsWith($Root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Installation path escapes its owner.'}
 return $full
}
function ProtectRoot([string]$Path){
 $acl=[Security.AccessControl.DirectorySecurity]::new()
 $acl.SetAccessRuleProtection($true,$false)
 $system=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
 $acl.SetOwner($system)
 foreach($sid in @('S-1-5-18','S-1-5-32-544')){
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
 }
 $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-11'),'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'))
 & ($security.ExportedCmdlets['Set-Acl']) -LiteralPath $Path -AclObject $acl
}
function WriteJson([string]$Path,$Value){
 $temporary=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
 $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $temporary -Encoding UTF8
 Move-Item -LiteralPath $temporary -Destination $Path -Force
}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if(-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'An actual elevated administrator or SYSTEM installer is required.'}
$root=(LocalPath $InstallRoot).TrimEnd('\')
if($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\') -or $root.StartsWith($PSScriptRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Use a dedicated installation directory outside the source scripts.'}
$manifestPath=Join-Path $root 'sidecar.json'
$pendingPath=Join-Path $root 'setup-state.json'
$sourceFiles=@(Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -File | Sort-Object FullName)
$sourceText=($sourceFiles | ForEach-Object {$_.FullName.Substring($PSScriptRoot.Length).Replace('\','/')+'='+(Hash $_.FullName)}) -join "`n"
$hashAlgorithm=[Security.Cryptography.SHA256]::Create()
try{$sourceDigest=([BitConverter]::ToString($hashAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($sourceText)))).Replace('-','').ToLowerInvariant()}finally{$hashAlgorithm.Dispose()}
$manifest=$null
if(Test-Path -LiteralPath $manifestPath){
 $manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
 if($manifest.name -ne 'hashi-sidecar' -or $manifest.version -ne '3.0.0' -or $manifest.sourceDigest -ne $sourceDigest){throw 'A matching owned release is required; install a changed release beside it.'}
 foreach($pin in $manifest.files.PSObject.Properties){if((Hash (OwnedPath $root $pin.Name)) -ne $pin.Value){throw 'Installed payload or target configuration changed; no task repair was attempted.'}}
 if($AccountsFile){
  $requested=Get-Content -LiteralPath (LocalPath $AccountsFile) -Raw | ConvertFrom-Json
  if((@($requested.targets.sid | Sort-Object) -join ',') -ne (@($manifest.targets.sid | Sort-Object) -join ',')){throw 'Account enrollment differs; prepare a separate owned installation.'}
  foreach($target in @($requested.targets)){
   $registered=Get-Content -LiteralPath (OwnedPath $root ('accounts/'+$target.sid+'/data/config.json')) -Raw | ConvertFrom-Json
   foreach($field in @(@('githubLogin','expectedGitHubLogin'),@('ghPath','ghPath'))){
    $value=if($target.PSObject.Properties.Name -contains $field[0]){[string]$target.($field[0])}else{''}
    if($value -ne [string]$registered.($field[1])){throw 'Account adapter configuration differs; no repair was attempted.'}
   }
   foreach($field in @('publisherSids','issuerSids')){
    $principals=if($requested.PSObject.Properties.Name -contains $field){@($requested.$field)}elseif($field -eq 'issuerSids' -and $requested.PSObject.Properties.Name -contains 'publisherSids'){@($requested.publisherSids)}else{@('S-1-5-18')}
    if((@($principals | Sort-Object) -join ',') -ne (@($registered.$field | Sort-Object) -join ',')){throw 'Publisher/issuer configuration differs; no repair was attempted.'}
   }
  }
 }
 if($RuntimeRoot){foreach($file in @('node.exe','LICENSE')){if((Hash (LocalPath (Join-Path $RuntimeRoot $file))) -ne (Hash (OwnedPath $root ('runtime/'+$file)))){throw 'Runtime differs; prepare a separate release.'}}}
}
if(-not $manifest){
 if($Mode -ne 'Install'){throw 'Standalone Sidecar is not fully installed.'}
 if(-not $RuntimeRoot){throw 'A portable runtime is required for a new installation or resume.'}
 $runtime=LocalPath $RuntimeRoot
 foreach($file in @('node.exe','LICENSE')){if(-not(Test-Path -LiteralPath (LocalPath (Join-Path $runtime $file)) -PathType Leaf)){throw 'Portable Node runtime or license unavailable.'}}
 if(Test-Path -LiteralPath $pendingPath){
  $pending=Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
  if($pending.schemaVersion -ne 1 -or $pending.sourceDigest -ne $sourceDigest -or $pending.installRoot -ne $root){throw 'A foreign or changed pending installation is rejected.'}
  foreach($pin in $pending.preparedFiles.PSObject.Properties){if((Hash (OwnedPath $root $pin.Name)) -ne $pin.Value){throw 'Pending payload integrity failed; do not overwrite it.'}}
  $spec=$pending.spec
 }else{
  if((Test-Path -LiteralPath $root) -and @(Get-ChildItem -LiteralPath $root -Force).Count){throw 'Unknown nonempty installation root.'}
  if(-not $AccountsFile){throw 'Explicit account configuration is required.'}
  $spec=Get-Content -LiteralPath (LocalPath $AccountsFile) -Raw | ConvertFrom-Json
  if(@($spec.PSObject.Properties.Name | Where-Object {$_ -notin @('targets','publisherSids','issuerSids')}).Count){throw 'Unknown account configuration field.'}
  $targets=@($spec.targets)
  if($targets.Count -lt 1 -or @($targets.sid | Select-Object -Unique).Count -ne $targets.Count){throw 'Select distinct explicit target SIDs.'}
  foreach($target in $targets){
   if(@($target.PSObject.Properties.Name | Where-Object {$_ -notin @('sid','githubLogin','ghPath')}).Count -or [string]$target.sid -notmatch '^S-1-5-21-(\d+-){2,}\d+$'){throw 'Invalid account selection.'}
   $verified=[Security.Principal.SecurityIdentifier]::new([string]$target.sid)
   $null=$verified.Translate([Security.Principal.NTAccount])
   $null=Get-LocalUser -SID $verified -ErrorAction Stop
   $target.sid=$verified.Value
  }
  if(-not ($spec.PSObject.Properties.Name -contains 'publisherSids')){$spec | Add-Member -NotePropertyName publisherSids -NotePropertyValue @('S-1-5-18')}
  if(-not ($spec.PSObject.Properties.Name -contains 'issuerSids')){$spec | Add-Member -NotePropertyName issuerSids -NotePropertyValue @($spec.publisherSids)}
  if(-not @($spec.publisherSids).Count -or -not @($spec.issuerSids).Count){throw 'Publisher and issuer SIDs cannot be empty.'}
  $spec.publisherSids=@($spec.publisherSids | ForEach-Object {[Security.Principal.SecurityIdentifier]::new([string]$_).Value})
  $spec.issuerSids=@($spec.issuerSids | ForEach-Object {[Security.Principal.SecurityIdentifier]::new([string]$_).Value})
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  ProtectRoot $root
  foreach($folder in @('bin','runtime','maintenance','accounts')){New-Item -ItemType Directory -Path (Join-Path $root $folder) | Out-Null}
  Copy-Item -LiteralPath (Join-Path $runtime 'node.exe'),(Join-Path $runtime 'LICENSE') -Destination (Join-Path $root 'runtime')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'standalone\launcher.mjs'),(Join-Path $PSScriptRoot 'standalone\accounts.mjs') -Destination (Join-Path $root 'bin')
  foreach($sourceFile in $sourceFiles){
   $relative=$sourceFile.FullName.Substring($PSScriptRoot.Length+1)
   $destination=Join-Path $root ('maintenance\'+$relative)
   New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
   Copy-Item -LiteralPath $sourceFile.FullName -Destination $destination
  }
  $compiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  & $compiler /nologo /target:exe (('/out:'+(Join-Path $root 'bin\hashi-sidecar.exe'))) (Join-Path $PSScriptRoot 'admin-sidecar\Launcher.cs')
  if($LASTEXITCODE -ne 0){throw 'Standalone launcher compilation failed.'}
  $pins=@{}
  foreach($folder in @('bin','runtime','maintenance')){
   foreach($file in Get-ChildItem -LiteralPath (Join-Path $root $folder) -Recurse -File){$pins[$file.FullName.Substring($root.Length+1).Replace('\','/')]=Hash $file.FullName}
  }
  $pending=@{schemaVersion=1;sourceDigest=$sourceDigest;installRoot=$root;spec=$spec;preparedFiles=$pins;state='prepared';completed=@()}
  WriteJson $pendingPath $pending
 }
 $registered=@()
 try{
  foreach($target in @($spec.targets)){
   $accountRoot=Join-Path $root ('accounts\'+$target.sid)
   $arguments=@{Mode='Install';InstallRoot=$accountRoot;RuntimeRoot=(Join-Path $root 'runtime');TargetSid=[string]$target.sid;PublisherSid=@($spec.publisherSids);IssuerSid=@($spec.issuerSids)}
   if($target.PSObject.Properties.Name -contains 'githubLogin'){$arguments.GitHubLogin=[string]$target.githubLogin}
   if($target.PSObject.Properties.Name -contains 'ghPath'){$arguments.GhPath=[string]$target.ghPath}
   & (Join-Path $PSScriptRoot 'install-admin-sidecar.ps1') @arguments
   $config=Get-Content -LiteralPath (Join-Path $accountRoot 'data\config.json') -Raw | ConvertFrom-Json
   if($config.userSid -ne $target.sid){throw 'Target identity mismatch.'}
   $registered+=@{sid=[string]$target.sid;root=('accounts/'+$target.sid);installationId=$config.installationId}
   $pending.completed=@($registered.sid);$pending.state='installing'
   WriteJson $pendingPath $pending
  }
  $pins=@{}
  foreach($pin in $pending.preparedFiles.PSObject.Properties){$pins[$pin.Name]=$pin.Value}
  if($pending.preparedFiles -is [hashtable]){$pins=$pending.preparedFiles.Clone()}
  foreach($target in $registered){
   foreach($part in @('installation.json','data/config.json')){$relative=$target.root+'/'+$part;$pins[$relative]=Hash (Join-Path $root $relative)}
  }
  $manifest=@{schemaVersion=1;name='hashi-sidecar';version='3.0.0';state='ready';sourceDigest=$sourceDigest;targets=@($registered);files=$pins}
  WriteJson $manifestPath $manifest
  $pending.state='ready';WriteJson $pendingPath $pending
 }catch{
  $pending.state='incomplete';WriteJson $pendingPath $pending
  throw
 }
}else{
 foreach($target in @($manifest.targets)){
  $accountRoot=OwnedPath $root $target.root
  & (Join-Path $accountRoot 'maintenance\install-admin-sidecar.ps1') -Mode $Mode -InstallRoot $accountRoot
 }
}
& (Join-Path $root 'bin\hashi-sidecar.exe') version
if($LASTEXITCODE -ne 0){throw 'Standalone payload/configuration verification failed.'}
@{ok=$true;mode=$Mode;name='hashi-sidecar';version='3.0.0';targets=@($manifest.targets.sid);networkListener=$false;legacyInstallationRequired=$false} | ConvertTo-Json -Compress
