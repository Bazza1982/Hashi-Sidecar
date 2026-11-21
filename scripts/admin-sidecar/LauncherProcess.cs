using System;
using System.IO;
using System.Diagnostics;
using System.ComponentModel;
using System.Text;
using System.Runtime.InteropServices;

// Shared native launcher plumbing only. The launcher owns one non-inherited
// job handle until OS process exit; never close it before returning Node's code.
internal static class LauncherProcess {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimits limits,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr GetStdHandle(int kind);

 [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr source,IntPtr handle,IntPtr target,out IntPtr duplicate,uint access,bool inherit,uint options);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string name,uint access,uint share,ref SecurityAttributes security,uint disposition,uint flags,IntPtr template);
 [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {public int length;public IntPtr descriptor;public bool inherit;}
 [StructLayout(LayoutKind.Sequential)] struct BasicLimits {public long processTime,jobTime;public uint flags;public UIntPtr minimum,maximum;public uint active;public UIntPtr affinity;public uint priority,scheduling;}
 [StructLayout(LayoutKind.Sequential)] struct IoCounters {public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes;}
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {public BasicLimits basic;public IoCounters io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
 static IntPtr lifetimeJob;
 static void Phase(Action<string> report,string phase){if(report!=null)report(phase);}
 static void OwnLifetime(Action<string> report){
  Phase(report,"job-create");IntPtr job=CreateJobObject(IntPtr.Zero,null);
  if(job==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
  bool assigned=false;
  try{
   Phase(report,"job-configure");var limits=new ExtendedLimits();limits.basic.flags=0x2000;
   if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))))throw new Win32Exception(Marshal.GetLastWin32Error());
   Phase(report,"job-assign");
   if(!AssignProcessToJobObject(job,GetCurrentProcess()))throw new Win32Exception(Marshal.GetLastWin32Error());
   assigned=true;lifetimeJob=job;
  }finally{if(!assigned)CloseHandle(job);}
 }
 sealed class StandardHandles:IDisposable {
  readonly int[] kinds={-10,-11,-12};readonly IntPtr[] original=new IntPtr[3];public readonly IntPtr[] forwarded=new IntPtr[3];
  public StandardHandles(){
   for(int i=0;i<3;i++)original[i]=GetStdHandle(kinds[i]);
   try{for(int i=0;i<3;i++){
    if(original[i]!=IntPtr.Zero&&original[i]!=new IntPtr(-1)){
     if(!DuplicateHandle(GetCurrentProcess(),original[i],GetCurrentProcess(),out forwarded[i],0,true,2))throw new Win32Exception(Marshal.GetLastWin32Error());
    }else{
     var security=new SecurityAttributes {length=Marshal.SizeOf(typeof(SecurityAttributes)),inherit=true};
     forwarded[i]=CreateFile("NUL",i==0?0x80000000u:0x40000000u,3,ref security,3,0,IntPtr.Zero);
     if(forwarded[i]==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());
    }

   }}catch{Dispose();throw;}
  }
  public void Dispose(){for(int i=0;i<3;i++){if(forwarded[i]!=IntPtr.Zero&&forwarded[i]!=new IntPtr(-1)){CloseHandle(forwarded[i]);forwarded[i]=IntPtr.Zero;}}}
 }
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr key,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref StartupInfoEx startup,out ProcessInformation child);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct StartupInfo {public int cb;public string reserved,desktop,title;public int x,y,xSize,ySize,xCount,yCount,fill,flags;public short show,reservedBytes;public IntPtr reservedPointer,input,output,error;}
 [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx {public StartupInfo startup;public IntPtr attributes;}
 [StructLayout(LayoutKind.Sequential)] struct ProcessInformation {public IntPtr process,thread;public uint pid,tid;}
 static string Quote(string value){return "\\\""+value+"\\\"";} // Executable is a verified Windows file path.
 public static int Run(ProcessStartInfo info,Action<string> report=null){
  // Assign self before any Node instruction, retaining child-start race protection.
  OwnLifetime(report);
  Phase(report,"stdio");
  // Forward kernel handles directly, not new proxy pipes. Restrict inheritance
  // to these three duplicates: inheriting a caller's stdin writer would prevent EOF.
  using(var handles=new StandardHandles()){
   IntPtr list=IntPtr.Zero,array=IntPtr.Zero,size=IntPtr.Zero;bool initialized=false;
   ProcessInformation child=new ProcessInformation();
   try{
    InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
    list=Marshal.AllocHGlobal(size);
    if(!InitializeProcThreadAttributeList(list,1,0,ref size))throw new Win32Exception(Marshal.GetLastWin32Error());
    initialized=true;array=Marshal.AllocHGlobal(IntPtr.Size*3);Marshal.Copy(handles.forwarded,0,array,3);
    if(!UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),array,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error());
    var startup=new StartupInfoEx();startup.startup.cb=Marshal.SizeOf(typeof(StartupInfoEx));startup.startup.flags=0x100;
    startup.startup.input=handles.forwarded[0];startup.startup.output=handles.forwarded[1];startup.startup.error=handles.forwarded[2];startup.attributes=list;
    Phase(report,"node-start");
    var command=new StringBuilder(Quote(info.FileName)+" "+info.Arguments);
    if(!CreateProcess(info.FileName,command,IntPtr.Zero,IntPtr.Zero,true,0x08080000,IntPtr.Zero,info.WorkingDirectory,ref startup,out child))throw new Win32Exception(Marshal.GetLastWin32Error());
    Phase(report,"node-running");
    if(WaitForSingleObject(child.process,0xffffffff)!=0)throw new Win32Exception(Marshal.GetLastWin32Error());
    uint code;if(!GetExitCodeProcess(child.process,out code))throw new Win32Exception(Marshal.GetLastWin32Error());
    GC.KeepAlive(lifetimeJob);return unchecked((int)code);
   }finally{
    if(child.thread!=IntPtr.Zero)CloseHandle(child.thread);
    if(child.process!=IntPtr.Zero)CloseHandle(child.process);
    if(initialized)DeleteProcThreadAttributeList(list);
    if(list!=IntPtr.Zero)Marshal.FreeHGlobal(list);
    if(array!=IntPtr.Zero)Marshal.FreeHGlobal(array);
   }
  }
 }
}
