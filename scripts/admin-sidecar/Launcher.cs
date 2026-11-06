using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Reflection;
[assembly:AssemblyTitle("HASHI Admin Sidecar")]
[assembly:AssemblyVersion("3.0.0.0")]
internal static class Launcher {
 static string Quote(string value){StringBuilder s=new StringBuilder("\"");int n=0;foreach(char c in value){if(c=='\\'){n++;continue;}if(c=='"')s.Append('\\',2*n+1).Append(c);else s.Append('\\',n).Append(c);n=0;}return s.Append('\\',2*n).Append('"').ToString();}
 static int Main(string[] args){try{
 string root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"..")),node=Path.Combine(root,"runtime","node.exe"),entry=Path.Combine(root,"bin","launcher.mjs");
 if(!File.Exists(node)||!File.Exists(entry))throw new InvalidOperationException();
 StringBuilder a=new StringBuilder(Quote(entry));foreach(string s in args)a.Append(" ").Append(Quote(s));
 ProcessStartInfo info=new ProcessStartInfo(node,a.ToString()){UseShellExecute=false,WorkingDirectory=root};
 using(Process p=Process.Start(info)){p.WaitForExit();return p.ExitCode;}
 }catch{Console.Error.WriteLine("{\"ok\":false,\"error\":{\"code\":\"ADMIN_LAUNCH_FAILED\"}}");return 2;}}
}
