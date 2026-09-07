Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TaskbarIconProbe {
 public delegate bool EnumCallback(IntPtr handle, IntPtr param);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback cb, IntPtr param);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle, System.Text.StringBuilder text,int size);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
 [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam,uint flags,uint timeout,out IntPtr result);
 [DllImport("user32.dll",EntryPoint="GetClassLongPtrW")] public static extern IntPtr GetClassLongPtr(IntPtr hwnd,int index);
}
"@
$rows=[Collections.Generic.List[object]]::new()
$rootDir=(Get-Location).Path
[TaskbarIconProbe]::EnumWindows({param($handle,$unused)
 $windowPid=0
 [void][TaskbarIconProbe]::GetWindowThreadProcessId($handle,[ref]$windowPid)
 if($windowPid -eq 84836){
  $title=[Text.StringBuilder]::new(512)
  [void][TaskbarIconProbe]::GetWindowText($handle,$title,512)
  $record=[ordered]@{handle=$handle.ToInt64();title=$title.ToString();visible=[TaskbarIconProbe]::IsWindowVisible($handle);icons=@()}
  foreach($kind in @(0,1,2)){
   $iconHandle=[IntPtr]::Zero
   [void][TaskbarIconProbe]::SendMessageTimeout($handle,127,[IntPtr]$kind,[IntPtr]::Zero,2,1000,[ref]$iconHandle)
   $record.icons+=@{kind=$kind;handle=$iconHandle.ToInt64()}
   if($iconHandle -ne [IntPtr]::Zero){$icon=[Drawing.Icon]::FromHandle($iconHandle);$bitmap=$icon.ToBitmap();$bitmap.Save((Join-Path $rootDir ".scratch/feature-migration/window-$($handle.ToInt64())-icon-$kind.png"));$bitmap.Dispose()}
  }
  $record.classSmall=[TaskbarIconProbe]::GetClassLongPtr($handle,-34).ToInt64()
  $record.classBig=[TaskbarIconProbe]::GetClassLongPtr($handle,-14).ToInt64()
  $rows.Add($record)
 }
 return $true
},[IntPtr]::Zero)|Out-Null
$rows|ConvertTo-Json -Depth 6|Set-Content .scratch/feature-migration/taskbar-native-after.json
$rows|ConvertTo-Json -Depth 6

