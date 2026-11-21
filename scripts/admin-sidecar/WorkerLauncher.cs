using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Reflection;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
[assembly:AssemblyTitle("HASHI Sidecar Windowless Worker")]
[assembly:AssemblyVersion("3.0.0.0")]
internal static class WorkerLauncher {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimits limits,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [StructLayout(LayoutKind.Sequential)] struct BasicLimits {public long processTime,jobTime;public uint flags;public UIntPtr minimum,maximum;public uint active;public UIntPtr affinity;public uint priority,scheduling;}
 [StructLayout(LayoutKind.Sequential)] struct IoCounters {public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes;}
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {public BasicLimits basic;public IoCounters io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
 static string stage="arguments",root;
 // Intentionally owned until OS process exit, never inherited by children. Closing
 // this last handle kills the entire job, including this launcher. Assigning self
 // BEFORE Process.Start eliminates the child-start/assignment escape race.
 static IntPtr lifetimeJob;
 static void OwnLifetime(){
  stage="job-create";IntPtr job=CreateJobObject(IntPtr.Zero,null);
  if(job==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
  bool assigned=false;
  try{
   stage="job-configure";var limits=new ExtendedLimits();limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE; no breakaway.
   if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))))throw new Win32Exception(Marshal.GetLastWin32Error());
   stage="job-assign";
   using(var self=Process.GetCurrentProcess())if(!AssignProcessToJobObject(job,self.Handle))throw new Win32Exception(Marshal.GetLastWin32Error());
   assigned=true;lifetimeJob=job;
  }finally{if(!assigned)CloseHandle(job);}
 }
 static string Quote(string value){StringBuilder s=new StringBuilder("\"");int n=0;foreach(char c in value){if(c=='\\'){n++;continue;}if(c=='"')s.Append('\\',2*n+1).Append(c);else s.Append('\\',n).Append(c);n=0;}return s.Append('\\',2*n).Append('"').ToString();}
 static int Run(ProcessStartInfo info){
  info.RedirectStandardInput=true;info.RedirectStandardOutput=true;info.RedirectStandardError=true;
  // Process uses Console.InputEncoding for its stdin writer; suppress its UTF-8 preamble.
  try{Console.InputEncoding=new System.Text.UTF8Encoding(false);}catch(IOException){}
  stage="node-start";
  using(Process p=Process.Start(info)){
   var input=new System.Threading.Thread(()=>{try{Console.OpenStandardInput().CopyTo(p.StandardInput.BaseStream);}catch(IOException){}catch(ObjectDisposedException){}finally{try{p.StandardInput.BaseStream.Close();}catch(IOException){}catch(ObjectDisposedException){}}});
   var output=new System.Threading.Thread(()=>{try{p.StandardOutput.BaseStream.CopyTo(Console.OpenStandardOutput());}catch(IOException){}catch(ObjectDisposedException){}});
   var error=new System.Threading.Thread(()=>{try{p.StandardError.BaseStream.CopyTo(Console.OpenStandardError());}catch(IOException){}catch(ObjectDisposedException){}});
   input.IsBackground=true;output.IsBackground=true;error.IsBackground=true;
   input.Start();output.Start();error.Start();stage="node-running";p.WaitForExit();output.Join();error.Join();GC.KeepAlive(lifetimeJob);return p.ExitCode;
  }
 }
 static void Failure(Exception failure,bool compat){
  int native=failure is Win32Exception?((Win32Exception)failure).NativeErrorCode:0;
  string report=new JavaScriptSerializer().Serialize(new {ok=false,error=new {code="ADMIN_WORKER_LAUNCH_FAILED",stage=stage,win32=native},at=DateTimeOffset.UtcNow.ToString("o"),pid=Process.GetCurrentProcess().Id});
  Console.Error.WriteLine(report);
  // Pick a writable lane from the ACTUAL token, never from untrusted arguments.
  // A SYSTEM/elevated failure must not write into a Limited user's writable lane.
  try{
   using(var who=WindowsIdentity.GetCurrent()){
    bool system=who.User.Value=="S-1-5-18",admin=new WindowsPrincipal(who).IsInRole(WindowsBuiltInRole.Administrator);
    string directory=system?Path.Combine(root,"data","lanes","system","work"):admin?Path.Combine(root,"data","lanes","user-admin","work"):compat?Path.Combine(root,"data","legacy","work"):Path.Combine(root,"data","lanes","user","work");
    if(Directory.Exists(directory))File.WriteAllText(Path.Combine(directory,"worker-startup.json"),report,new UTF8Encoding(false));
   }
  }catch{} // Stderr and the nonzero task result remain available if storage fails.
 }
 static int Main(string[] args){bool compat=false;try{
  root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
  string profile=null;
  if(args.Length==2&&args[0]=="--profile"&&(args[1]=="system"||args[1]=="user"||args[1]=="user-admin"))profile=args[1];
  else if(args.Length==1&&args[0]=="--compat")compat=true;
  else throw new InvalidOperationException();
  stage="manifest";
  var manifest=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"installation.json")));
  string release=manifest.ContainsKey("releaseId")?manifest["releaseId"] as string:null;
  if(!Regex.IsMatch(release??"",@"^[23]\.\d+\.\d+-[a-f0-9]{12}$"))throw new InvalidOperationException();
  if(compat&&(!manifest.ContainsKey("compatibility")||!Object.Equals(manifest["compatibility"],true)))throw new InvalidOperationException();
  string node=Path.Combine(root,"runtime","node.exe");
  string entry=compat?Path.Combine(root,"compat","github-user-sidecar.mjs"):Path.Combine(root,"releases",release,"cli.mjs");
  stage="payload";
  if(!File.Exists(node)||!File.Exists(entry))throw new FileNotFoundException();
  string[] childArgs=compat?new string[]{"--worker","--config",Path.Combine(root,"data","legacy","config.json")}:new string[]{"--worker","--profile",profile};
  StringBuilder command=new StringBuilder(Quote(entry));foreach(string arg in childArgs)command.Append(" ").Append(Quote(arg));
  var info=new ProcessStartInfo(node,command.ToString()){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=root};
  OwnLifetime();
  return Run(info);
 }catch(Exception error){Failure(error,compat);return 2;}}
}
