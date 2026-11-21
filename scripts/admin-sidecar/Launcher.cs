using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Reflection;
[assembly:AssemblyTitle("HASHI Admin Sidecar")]
[assembly:AssemblyVersion("3.0.0.0")]
internal static class Launcher {
 static string Quote(string value){StringBuilder s=new StringBuilder("\"");int n=0;foreach(char c in value){if(c=='\\'){n++;continue;}if(c=='"')s.Append('\\',2*n+1).Append(c);else s.Append('\\',n).Append(c);n=0;}return s.Append('\\',2*n).Append('"').ToString();}
 static int Run(ProcessStartInfo info){
  info.RedirectStandardInput=true;info.RedirectStandardOutput=true;info.RedirectStandardError=true;
  using(Process p=Process.Start(info)){
   var input=new System.Threading.Thread(()=>{try{Console.OpenStandardInput().CopyTo(p.StandardInput.BaseStream);}catch(IOException){}catch(ObjectDisposedException){}finally{try{p.StandardInput.Close();}catch(IOException){}catch(ObjectDisposedException){}}});
   var output=new System.Threading.Thread(()=>{try{p.StandardOutput.BaseStream.CopyTo(Console.OpenStandardOutput());}catch(IOException){}catch(ObjectDisposedException){}});
   var error=new System.Threading.Thread(()=>{try{p.StandardError.BaseStream.CopyTo(Console.OpenStandardError());}catch(IOException){}catch(ObjectDisposedException){}});
   input.IsBackground=true;output.IsBackground=true;error.IsBackground=true;
   input.Start();output.Start();error.Start();p.WaitForExit();output.Join();error.Join();return p.ExitCode;
  }
 }
 static int Main(string[] args){try{
 string root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"..")),node=Path.Combine(root,"runtime","node.exe"),entry=Path.Combine(root,"bin","launcher.mjs");
 if(!File.Exists(node)||!File.Exists(entry))throw new InvalidOperationException();
 StringBuilder a=new StringBuilder(Quote(entry));foreach(string s in args)a.Append(" ").Append(Quote(s));
 ProcessStartInfo info=new ProcessStartInfo(node,a.ToString()){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=root};
 return Run(info);
 }catch{Console.Error.WriteLine("{\"ok\":false,\"error\":{\"code\":\"ADMIN_LAUNCH_FAILED\"}}");return 2;}}
}
