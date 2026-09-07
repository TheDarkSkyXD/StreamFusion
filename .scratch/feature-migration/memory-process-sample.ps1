param([int]$LauncherId = 29388)
$appProcesses = Get-CimInstance Win32_Process
$verifyIds = [System.Collections.Generic.HashSet[int]]::new()
[void]$verifyIds.Add($LauncherId)
do {
  $added = $false
  foreach ($appProc in $appProcesses) {
    if ($verifyIds.Contains([int]$appProc.ParentProcessId) -and $verifyIds.Add([int]$appProc.ProcessId)) { $added = $true }
  }
} while ($added)
$rows = foreach ($appProc in $appProcesses) {
  if (-not $verifyIds.Contains([int]$appProc.ProcessId)) { continue }
  $liveProc = Get-Process -Id $appProc.ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $liveProc) { continue }
  [pscustomobject]@{
    pid=$liveProc.Id
    name=$liveProc.ProcessName
    role=([regex]::Match($appProc.CommandLine,'--type=([^ ]+)')).Groups[1].Value
    workingSetMB=[Math]::Round($liveProc.WorkingSet64/1MB,1)
    privateMB=[Math]::Round($liveProc.PrivateMemorySize64/1MB,1)
  }
}
[pscustomobject]@{at=[DateTime]::UtcNow.ToString('o');processes=@($rows)} | ConvertTo-Json -Depth 4
