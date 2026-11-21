using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Reflection;
[assembly:AssemblyTitle("HASHI Sidecar Windowless Worker")]
[assembly:AssemblyVersion("3.0.0.0")]
internal static class WorkerLauncher {
 static string Quote(string value){StringBuilder s=new StringBuilder("\"");int n=0;foreach(char c in value){if(c=='\\'){n++;continue;}if(c=='"')s.Append('\\',2*n+1).Append(c);else s.Append('\\',n).Append(c);n=0;}return s.Append('\\',2*n).Append('"').ToString();}
 static int Run(ProcessStartInfo info){
  info.RedirectStandardInput=true;info.RedirectStandardOutput=true;info.RedirectStandardError=true;
  // Process uses Console.InputEncoding for its stdin writer; suppress its UTF-8 preamble.
  try{Console.InputEncoding=new System.Text.UTF8Encoding(false);}catch(IOException){}
  using(Process p=Process.Start(info)){
   var input=new System.Threading.Thread(()=>{try{Console.OpenStandardInput().CopyTo(p.StandardInput.BaseStream);}catch(IOException){}catch(ObjectDisposedException){}finally{try{p.StandardInput.BaseStream.Close();}catch(IOException){}catch(ObjectDisposedException){}}});
   var output=new System.Threading.Thread(()=>{try{p.StandardOutput.BaseStream.CopyTo(Console.OpenStandardOutput());}catch(IOException){}catch(ObjectDisposedException){}});
   var error=new System.Threading.Thread(()=>{try{p.StandardError.BaseStream.CopyTo(Console.OpenStandardError());}catch(IOException){}catch(ObjectDisposedException){}});
   input.IsBackground=true;output.IsBackground=true;error.IsBackground=true;
   input.Start();output.Start();error.Start();p.WaitForExit();output.Join();error.Join();return p.ExitCode;
  }
 }
 static int Main(string[] args){try{
  string root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
  string node=Path.Combine(root,"runtime","node.exe"),entry;
  var manifest=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"installation.json")));
  string release=manifest.ContainsKey("releaseId")?manifest["releaseId"] as string:null;
  if(!Regex.IsMatch(release??"",@"^[23]\.\d+\.\d+-[a-f0-9]{12}$"))throw new InvalidOperationException();
  string[] childArgs;
  if(args.Length==2&&args[0]=="--profile"&&(args[1]=="system"||args[1]=="user"||args[1]=="user-admin")){
   entry=Path.Combine(root,"releases",release,"cli.mjs");
   childArgs=new string[]{"--worker","--profile",args[1]};
  }else if(args.Length==1&&args[0]=="--compat"&&manifest.ContainsKey("compatibility")&&Object.Equals(manifest["compatibility"],true)){
   entry=Path.Combine(root,"compat","github-user-sidecar.mjs");
   childArgs=new string[]{"--worker","--config",Path.Combine(root,"data","legacy","config.json")};
  }else throw new InvalidOperationException();
  if(!File.Exists(node)||!File.Exists(entry))throw new InvalidOperationException();
  StringBuilder command=new StringBuilder(Quote(entry));foreach(string arg in childArgs)command.Append(" ").Append(Quote(arg));
  var info=new ProcessStartInfo(node,command.ToString()){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=root};
  return Run(info);
 }catch{Console.Error.WriteLine("{\"ok\":false,\"error\":{\"code\":\"ADMIN_WORKER_LAUNCH_FAILED\"}}");return 2;}}
}
