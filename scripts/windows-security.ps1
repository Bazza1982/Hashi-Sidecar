function Import-HubSecurityModule {
  # A parent pwsh may supply another generation's PSModulePath. Resolve the
  # native manifest and its nested binary using only this runtime's modules.
  $manifest = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
  $priorModulePath = $env:PSModulePath
  try {
    $env:PSModulePath = Join-Path $PSHOME 'Modules'
    Remove-Module -Name Microsoft.PowerShell.Security -Force -ErrorAction SilentlyContinue
    $module = Import-Module -Name $manifest -Force -Global -PassThru -ErrorAction Stop
    if (-not $module.ExportedCmdlets.ContainsKey('Set-Acl') -or -not $module.ExportedCmdlets.ContainsKey('Get-Acl')) {
      throw 'Native filesystem security cmdlets are unavailable.'
    }
    return $module
  } finally {
    $env:PSModulePath = $priorModulePath
  }
}
