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
 static string stage="arguments",root;
 static string Quote(string value){StringBuilder s=new StringBuilder("\"");int n=0;foreach(char c in value){if(c=='\\'){n++;continue;}if(c=='"')s.Append('\\',2*n+1).Append(c);else s.Append('\\',n).Append(c);n=0;}return s.Append('\\',2*n).Append('"').ToString();}
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
  return LauncherProcess.Run(info,value=>stage=value);
 }catch(Exception error){Failure(error,compat);return 2;}}
}
