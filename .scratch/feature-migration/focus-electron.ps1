param([int]$MainPid)
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class StreamFusionAuditWindow { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle); }'
$streamFusionProcess = Get-Process -Id $MainPid
if ($streamFusionProcess.ProcessName -ne 'electron' -or $streamFusionProcess.MainWindowTitle -ne 'StreamFusion') { throw 'Expected isolated StreamFusion Electron window' }
$streamFusionHandle = $streamFusionProcess.MainWindowHandle
[StreamFusionAuditWindow]::ShowWindow($streamFusionHandle, 9)
[StreamFusionAuditWindow]::SetForegroundWindow($streamFusionHandle)
