param(
 [Parameter(Mandatory=$true)][string]$SourceRoot,
 [Parameter(Mandatory=$true)][string]$EvidenceRoot,
 [Parameter(Mandatory=$true)][string]$RuntimeRoot,
 [Parameter(Mandatory=$true)][string]$TargetSid
)
$ErrorActionPreference='Stop'
$who=[Security.Principal.WindowsIdentity]::GetCurrent()
if($who.User.Value -ne 'S-1-5-18' -or [Diagnostics.Process]::GetCurrentProcess().SessionId -ne 0){throw 'Run through the actual SYSTEM service context'}
if(Test-Path $EvidenceRoot){throw 'Use a fresh disposable evidence root'}
$null=New-Item -ItemType Directory $EvidenceRoot
# Only this disposable fixture is writable by its selected interactive test account.
$acl=Get-Acl $EvidenceRoot
$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($TargetSid),'Modify','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule);Set-Acl $EvidenceRoot $acl
$profile=@(Get-CimInstance Win32_UserProfile|Where-Object SID -eq $TargetSid)
if($profile.Count -ne 1){throw 'Explicit registered user profile required'}
$node=Join-Path $RuntimeRoot 'node.exe'
$probe=Join-Path $SourceRoot 'test\fixtures\worker-stop-probe.mjs'
$fake=@'
using System;using System.IO;using System.Diagnostics;
class FakeGitHub {
 static string Q(string v){return "\""+v.Replace("\\","\\\\").Replace("\"","\\\"")+"\"";}
 static int Main(){
  var root=AppDomain.CurrentDomain.BaseDirectory;
  var spec=File.ReadAllLines(Path.Combine(root,"fixture-paths.txt"));
  var p=Process.Start(new ProcessStartInfo(spec[0],Q(spec[1])+" "+Q(spec[2])+" compat "+Q(spec[3])){UseShellExecute=false,CreateNoWindow=true});
  p.WaitForExit();return p.ExitCode;
 }
}
'@
# Paths in this fixture have no trailing separator; preserve native Windows quoting.
$fake=$fake.Replace('v.Replace("\\","\\\\").Replace("\"","\\\"")','v.Replace("\"","\\\"")')
$fakePath=Join-Path $EvidenceRoot 'fake-gh.cs'
[IO.File]::WriteAllText($fakePath,$fake)
$csc=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:exe (('/out:'+(Join-Path $EvidenceRoot 'fake-gh.exe'))) $fakePath
if($LASTEXITCODE){throw 'Fixture compilation failed'}
& $csc /nologo /target:exe (('/out:'+(Join-Path $EvidenceRoot 'window-witness.exe'))) (Join-Path $SourceRoot 'test\fixtures\WindowWitness.cs')
if($LASTEXITCODE){throw 'Window witness compilation failed'}
$install=Join-Path $EvidenceRoot 'install'
@($node,$probe,$EvidenceRoot,(Join-Path $install 'bin\admin-native.exe'))|Set-Content (Join-Path $EvidenceRoot 'fixture-paths.txt') -Encoding UTF8
$seed=@{schemaVersion=1;installationId=[guid]::NewGuid().ToString();root=$EvidenceRoot;userSid=$TargetSid;userProfile=$profile[0].LocalPath;expectedGitHubLogin='fixture';repositories=@('example/fixture');taskName='HashiHubV2-GitHubRead-fixture';taskPath='\';ghPath=(Join-Path $EvidenceRoot 'fake-gh.exe');gitPath=$node;workerPath=$probe;workerSHA256=('a'*64)}
$seedPath=Join-Path $EvidenceRoot 'seed.json';$seed|ConvertTo-Json|Set-Content $seedPath -Encoding UTF8
& (Join-Path $SourceRoot 'scripts\install-admin-sidecar.ps1') -Mode Install -InstallRoot $install -SeedConfig $seedPath -RuntimeRoot $RuntimeRoot
& $node (Join-Path $SourceRoot 'test\qualify-worker-stop.mjs') $install $EvidenceRoot $TargetSid
$code=$LASTEXITCODE
exit $code
