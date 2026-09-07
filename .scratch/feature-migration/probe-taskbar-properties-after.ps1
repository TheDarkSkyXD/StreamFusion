Add-Type @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct IconPropertyKey { public Guid fmtid; public uint pid; public IconPropertyKey(uint id){fmtid=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");pid=id;} }
[StructLayout(LayoutKind.Explicit, Size=24)] public struct IconPropVariant { [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr pointer; }
[ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IconPropertyStore {
 [PreserveSig]int GetCount(out uint count); [PreserveSig]int GetAt(uint index,out IconPropertyKey key); [PreserveSig]int GetValue(ref IconPropertyKey key,out IconPropVariant value); [PreserveSig]int SetValue(ref IconPropertyKey key,ref IconPropVariant value); [PreserveSig]int Commit();
}
public static class TaskbarPropertyProbe {
 [DllImport("shell32.dll",PreserveSig=true)] public static extern int SHGetPropertyStoreForWindow(IntPtr hwnd,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out IconPropertyStore store);
 [DllImport("ole32.dll")] public static extern int PropVariantClear(ref IconPropVariant value);
 public static string Read(long hwnd,uint id){ var iid=new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");IconPropertyStore store;int hr=SHGetPropertyStoreForWindow(new IntPtr(hwnd),ref iid,out store);if(hr!=0)return "HRESULT:"+hr;try{var key=new IconPropertyKey(id);IconPropVariant v;hr=store.GetValue(ref key,out v);if(hr!=0)return "HRESULT:"+hr;try{return v.type==31?Marshal.PtrToStringUni(v.pointer):"VT:"+v.type;}finally{PropVariantClear(ref v);}}finally{Marshal.ReleaseComObject(store);}}
}
"@
$record=[ordered]@{handle=923866; appUserModelId=[TaskbarPropertyProbe]::Read(923866,5);relaunchIconResource=[TaskbarPropertyProbe]::Read(923866,3);relaunchCommand=[TaskbarPropertyProbe]::Read(923866,2);relaunchDisplayName=[TaskbarPropertyProbe]::Read(923866,4)}
$record|ConvertTo-Json|Set-Content .scratch/feature-migration/taskbar-properties-after.json
$record|ConvertTo-Json

