Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$administratorSids=@((Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop).SID.Value)
$profiles=@(Get-CimInstance Win32_UserProfile)
$accounts=@(Get-LocalUser | ForEach-Object {
 $sid=$_.SID.Value
 $profile=@($profiles | Where-Object {$_.SID -eq $sid})
 [pscustomobject]@{
  sid=$sid
  name=$_.Name
  enabled=$_.Enabled
  administrator=($sid -in $administratorSids)
  profileExists=($profile.Count -eq 1)
  profileLoaded=($profile.Count -eq 1 -and $profile[0].Loaded)
 }
})
@{source='Windows local account/profile/group authorities';accounts=$accounts} | ConvertTo-Json -Depth 5
