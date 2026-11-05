param([Parameter(Mandatory=$true)][ValidateSet('service.query','service.control','registry.read','registry.write','task.query','task.control','task.restart')][string]$Operation)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$effectStarted=$false
$stages=@()
try {
  $inputData=[Console]::In.ReadToEnd() | ConvertFrom-Json
  $result=$null
  if ($Operation.StartsWith('service.')) {
    $service=Get-Service -Name $inputData.name -ErrorAction Stop
    if ($Operation -eq 'service.control') {
      if ([string]$service.Status -ne $inputData.expectedStatus) { throw 'ADMIN_STALE_STATE' }
      $effectStarted=$true
      switch ($inputData.action) {
        'start' { Start-Service -InputObject $service -ErrorAction Stop }
        'stop' { Stop-Service -InputObject $service -ErrorAction Stop }
        'restart' { Restart-Service -InputObject $service -ErrorAction Stop }
      }
      $service.Refresh()
      $target=if ($inputData.action -eq 'stop') {'Stopped'} else {'Running'}
      $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::$target,[TimeSpan]::FromSeconds(30))
      $service.Refresh()
    }
    $result=@{name=$service.ServiceName;status=[string]$service.Status;canStop=$service.CanStop}
  } elseif ($Operation.StartsWith('registry.')) {
    $hive=if ($inputData.hive -eq 'HKCU') {[Microsoft.Win32.Registry]::CurrentUser} else {[Microsoft.Win32.Registry]::LocalMachine}
    $key=$null
    try {
      if ($Operation -eq 'registry.write') {
        $effectStarted=$true
        $key=$hive.CreateSubKey([string]$inputData.key,$true)
        $value=switch ($inputData.kind) {
          'DWord' { [int]$inputData.value }
          'QWord' { [long]$inputData.value }
          'MultiString' { ,[string[]]$inputData.value }
          'Binary' { ,[Convert]::FromBase64String([string]$inputData.value) }
          default { [string]$inputData.value }
        }
        $kind=[Microsoft.Win32.RegistryValueKind]::$($inputData.kind)
        $key.SetValue([string]$inputData.name,$value,$kind)
        $key.Flush()
      } else { $key=$hive.OpenSubKey([string]$inputData.key,$false) }
      if ($null -eq $key) { throw 'ADMIN_NOT_FOUND' }
      $kind=[string]$key.GetValueKind([string]$inputData.name)
      $value=$key.GetValue([string]$inputData.name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($kind -eq 'Binary') { $value=[Convert]::ToBase64String([byte[]]$value) }
      $result=@{hive=$inputData.hive;key=$inputData.key;name=$inputData.name;kind=$kind;value=$value;written=($Operation -eq 'registry.write')}
      if ($inputData.name -match '(?i)password|secret|token|cookie|private.?key') { $result.value='[REDACTED]' }
    } finally { if ($null -ne $key) { $key.Dispose() } }
  } else {
    Import-Module (Join-Path $PSHOME 'Modules\ScheduledTasks\ScheduledTasks.psd1') -ErrorAction Stop
    $task=Get-ScheduledTask -TaskName $inputData.name -TaskPath $inputData.folder -ErrorAction Stop
    if (@($task).Count -ne 1) { throw 'ADMIN_TARGET_REJECTED' }
    if ($Operation -eq 'task.restart') {
      if ([string]$task.State -ne $inputData.expectedState) { throw 'ADMIN_STALE_STATE' }
      $effectStarted=$true
      if ([string]$task.State -eq 'Running') { Stop-ScheduledTask -InputObject $task -ErrorAction Stop; $stages+=@('scheduler_stopped') }
      if ($inputData.PSObject.Properties.Name -contains 'processGuards') {
        $native=Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'bin\maintenance-native.exe'
        foreach ($guard in @($inputData.processGuards)) {
          $guardResult=$guard | ConvertTo-Json -Compress | & $native 'process.stop' | ConvertFrom-Json
          if (-not $guardResult.ok) { throw 'ADMIN_OUTCOME_UNCERTAIN' }
          $stages+=@('process_exit_verified:'+ [string]$guard.pid)
        }
      }
      Start-ScheduledTask -InputObject $task -ErrorAction Stop
      $stages+=@('scheduler_dispatched')
      $task=Get-ScheduledTask -TaskName $inputData.name -TaskPath $inputData.folder -ErrorAction Stop
    }
    if ($Operation -eq 'task.control') {
      if ([string]$task.State -ne $inputData.expectedState) { throw 'ADMIN_STALE_STATE' }
      $effectStarted=$true
      switch ($inputData.action) {
        'run' { Start-ScheduledTask -InputObject $task -ErrorAction Stop }
        'stop' { Stop-ScheduledTask -InputObject $task -ErrorAction Stop }
        'enable' { Enable-ScheduledTask -InputObject $task -ErrorAction Stop | Out-Null }
        'disable' { Disable-ScheduledTask -InputObject $task -ErrorAction Stop | Out-Null }
      }
      $task=Get-ScheduledTask -TaskName $inputData.name -TaskPath $inputData.folder -ErrorAction Stop
    }
    $info=Get-ScheduledTaskInfo -InputObject $task
    $result=@{name=$task.TaskName;folder=$task.TaskPath;state=[string]$task.State;lastResult=$info.LastTaskResult;logon=[string]$task.Principal.LogonType;runLevel=[string]$task.Principal.RunLevel}
    if ($Operation -eq 'task.restart') { $result.schedulerDispatched=$true; $result.applicationReady=$false; $result.stages=$stages }
  }
  @{ok=$true;data=$result} | ConvertTo-Json -Depth 20 -Compress
} catch {
  $code=if ($effectStarted) {'ADMIN_OUTCOME_UNCERTAIN'} elseif ($_.Exception.Message -match '^ADMIN_[A-Z_]+$') {$_.Exception.Message} else {'ADMIN_OPERATION_REJECTED'}
  @{ok=$false;error=@{code=$code};data=@{effectStarted=$effectStarted;stages=$stages}} | ConvertTo-Json -Depth 6 -Compress
  exit 1
}
