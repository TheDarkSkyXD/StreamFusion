Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TaskbarCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string name, string title);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
}
'@
$taskbarHandle = [TaskbarCapture]::FindWindow('Shell_TrayWnd', $null)
$taskbarRect = New-Object TaskbarCapture+RECT
if ($taskbarHandle -eq [IntPtr]::Zero -or -not [TaskbarCapture]::GetWindowRect($taskbarHandle, [ref]$taskbarRect)) { throw 'Windows taskbar unavailable' }
$taskbarWidth = $taskbarRect.Right - $taskbarRect.Left
$taskbarHeight = $taskbarRect.Bottom - $taskbarRect.Top
$taskbarBitmap = New-Object System.Drawing.Bitmap($taskbarWidth, $taskbarHeight)
$taskbarGraphics = [System.Drawing.Graphics]::FromImage($taskbarBitmap)
try {
  $taskbarGraphics.CopyFromScreen($taskbarRect.Left, $taskbarRect.Top, 0, 0, $taskbarBitmap.Size)
  $taskbarOutput = Join-Path $PWD '.scratch/feature-migration/taskbar-current.png'
  $taskbarBitmap.Save($taskbarOutput, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output $taskbarOutput
} finally { $taskbarGraphics.Dispose(); $taskbarBitmap.Dispose() }
