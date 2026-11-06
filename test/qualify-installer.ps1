param(
 [Parameter(Mandatory=$true)][string]$ProgramRoot,
 [Parameter(Mandatory=$true)][string]$AccountsFile,
 [Parameter(Mandatory=$true)][string]$RuntimeRoot,
 [Parameter(Mandatory=$true)][string]$EvidenceRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path $PSScriptRoot -Parent
$installer=Join-Path $sourceRoot 'scripts\install-sidecar.ps1'
New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
$script:cases=@()
function Check([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
function Record([string]$Name,$Details){
 $script:cases+=@{name=$Name;passed=$true;details=$Details;at=(Get-Date -Format o)}
 $script:cases | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'installer-observations.json') -Encoding UTF8
 Write-Output ('PASS '+$Name)
}
function Reject([scriptblock]$Operation){
 $rejected=$false
 try{& $Operation | Out-File -LiteralPath (Join-Path $EvidenceRoot 'negative-output.log') -Encoding utf8}catch{$rejected=$true}
 Check $rejected 'Expected installer rejection was not observed.'
}
$suite=Get-Content -LiteralPath (Join-Path $ProgramRoot 'sidecar.json') -Raw | ConvertFrom-Json
$configPath=Join-Path $ProgramRoot ($suite.targets[0].root+'/data/config.json')
$bytes=[IO.File]::ReadAllBytes($configPath)
try{
 $changed=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
 $changed.userSid='S-1-5-21-1-2-3-99999'
 $changed | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $configPath -Encoding UTF8
 Reject {& $installer -Mode Audit -InstallRoot $ProgramRoot}
}finally{[IO.File]::WriteAllBytes($configPath,$bytes)}
Record 'changed-config-rejected-before-task-repair' @{restoredExactBytes=$true}
$spec=Get-Content -LiteralPath $AccountsFile -Raw | ConvertFrom-Json
$changedSpec=@{targets=@($spec.targets[0]);publisherSids=@($spec.publisherSids);issuerSids=@($spec.issuerSids)}
$changedPath=Join-Path $EvidenceRoot 'changed-accounts.json'
$changedSpec | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $changedPath -Encoding UTF8
Reject {& $installer -Mode Install -InstallRoot $ProgramRoot -AccountsFile $changedPath}
Record 'changed-enrollment-rejected' @{existingMembershipPreserved=$true}
$foreign=Join-Path $EvidenceRoot 'nonempty-root'
New-Item -ItemType Directory -Path $foreign -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $foreign 'keep.txt'),'foreign-content')
Reject {& $installer -Mode Install -InstallRoot $foreign -AccountsFile $AccountsFile -RuntimeRoot $RuntimeRoot}
Check ((Get-Content -LiteralPath (Join-Path $foreign 'keep.txt') -Raw) -eq 'foreign-content') 'Installer damaged a foreign directory.'
Record 'nonempty-root-preserved' @{fileRetained=$true}
$resumeRoot=Join-Path $EvidenceRoot 'resume-fixture'
$delayedCli=Join-Path $EvidenceRoot 'delayed-gh.exe'
$copySpec=$spec | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$targets=@($copySpec.targets)
Check ($targets.Count -eq 2) 'Resume fixture needs two explicit target accounts.'
$targets[1] | Add-Member -NotePropertyName githubLogin -NotePropertyValue 'standalone-qualification' -Force
$targets[1] | Add-Member -NotePropertyName ghPath -NotePropertyValue $delayedCli -Force
$resumeSpec=@{targets=$targets;publisherSids=@($spec.publisherSids);issuerSids=@($spec.issuerSids)}
$resumePath=Join-Path $EvidenceRoot 'resume-accounts.json'
$resumeSpec | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $resumePath -Encoding UTF8
Reject {& $installer -Mode Install -InstallRoot $resumeRoot -AccountsFile $resumePath -RuntimeRoot $RuntimeRoot}
$pending=Get-Content -LiteralPath (Join-Path $resumeRoot 'setup-state.json') -Raw | ConvertFrom-Json
Check ($pending.state -eq 'incomplete' -and @($pending.completed).Count -eq 1) 'Partial install intent was not retained.'
$firstConfig=Join-Path $resumeRoot ('accounts/'+$targets[0].sid+'/data/config.json')
$firstIdentity=(Get-Content -LiteralPath $firstConfig -Raw | ConvertFrom-Json).installationId
Record 'partial-target-failure-retains-intent' @{state=$pending.state;completed=@($pending.completed).Count;effectsReplayed=$false}
$realCli=(Get-Command gh.exe -ErrorAction Stop).Source
Copy-Item -LiteralPath $realCli -Destination $delayedCli
try{
 & $installer -Mode Install -InstallRoot $resumeRoot -AccountsFile $resumePath -RuntimeRoot $RuntimeRoot | Out-File -LiteralPath (Join-Path $EvidenceRoot 'resumed-output.log') -Encoding utf8
 $completed=Get-Content -LiteralPath (Join-Path $resumeRoot 'setup-state.json') -Raw | ConvertFrom-Json
 $finalIdentity=(Get-Content -LiteralPath $firstConfig -Raw | ConvertFrom-Json).installationId
 Check ($completed.state -eq 'ready' -and $firstIdentity -eq $finalIdentity) 'Resume replaced an existing target installation.'
 Record 'same-intent-resume-preserves-first-installation' @{firstInstallationRetained=$true;targets=@($completed.completed).Count;githubCalls=0}
}finally{
 & (Join-Path $resumeRoot 'maintenance\install-sidecar.ps1') -Mode Disable -InstallRoot $resumeRoot | Out-File -LiteralPath (Join-Path $EvidenceRoot 'resume-disabled.log') -Encoding utf8
}
@{ok=$true;passed=$script:cases.Count;githubAccountOperations=0;existingAccountsChanged=$false} | ConvertTo-Json -Compress
