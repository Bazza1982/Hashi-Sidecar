using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle("HASHI GitHub Sidecar")]
[assembly: AssemblyProduct("HASHI GitHub Sidecar")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class Launcher
{
    // Quote an argv item for the Windows C runtime. No command shell is used.
    private static string Quote(string value)
    {
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"')
            {
                result.Append('\\', slashes * 2 + 1);
                result.Append('"');
            }
            else
            {
                result.Append('\\', slashes);
                result.Append(character);
            }
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        result.Append('"');
        return result.ToString();
    }

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
    private static int Main(string[] args)
    {
        try
        {
            string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
            string node = Path.Combine(root, "runtime", "node.exe");
            string entry = Path.Combine(root, "bin", "launcher.mjs");
            if (!File.Exists(node) || !File.Exists(entry))
                throw new InvalidOperationException();
            StringBuilder arguments = new StringBuilder(Quote(entry));
            foreach (string argument in args) arguments.Append(" ").Append(Quote(argument));
            ProcessStartInfo info = new ProcessStartInfo(node, arguments.ToString());
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WorkingDirectory = root;
            return Run(info);
        }
        catch
        {
            Console.Error.WriteLine("{\"ok\":false,\"error\":{\"code\":\"SHARED_SIDECAR_LAUNCH_FAILED\"}}");
            return 2;
        }
    }
}
