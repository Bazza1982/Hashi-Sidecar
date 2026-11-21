using System;using System.IO;using System.Text;using System.Runtime.InteropServices;
class WindowWitness {
 [DllImport("kernel32.dll")]static extern bool FreeConsole();
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool AttachConsole(uint pid);
 [DllImport("kernel32.dll")]static extern IntPtr GetConsoleWindow();
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr window);
 static int Main(string[] args){
  uint pid=uint.Parse(args[0]);FreeConsole();bool attached=AttachConsole(pid);
  IntPtr window=GetConsoleWindow();bool visible=window!=IntPtr.Zero&&IsWindowVisible(window);
  File.WriteAllText(args[1],"{\"pid\":"+pid+",\"attached\":"+attached.ToString().ToLowerInvariant()+",\"consoleWindow\":"+window.ToInt64()+",\"visible\":"+visible.ToString().ToLowerInvariant()+"}",new UTF8Encoding(false));
  return window==IntPtr.Zero&&!visible?0:1;
 }
}
