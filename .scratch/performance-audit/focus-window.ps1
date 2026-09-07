Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AuditForeground {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
"@
$foregroundPid = [uint32]0
[void][AuditForeground]::GetWindowThreadProcessId([AuditForeground]::GetForegroundWindow(), [ref]$foregroundPid)
Get-Process -Id $foregroundPid | Select-Object Id,ProcessName,MainWindowTitle
$auditProcess = Get-Process -Id 17908
$auditProcess | Select-Object Id,ProcessName,MainWindowTitle,MainWindowHandle
[AuditForeground]::SetForegroundWindow($auditProcess.MainWindowHandle)
