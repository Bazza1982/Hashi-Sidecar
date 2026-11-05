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
            info.WorkingDirectory = root;
            using (Process process = Process.Start(info))
            {
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch
        {
            Console.Error.WriteLine("{\"ok\":false,\"error\":{\"code\":\"SHARED_SIDECAR_LAUNCH_FAILED\"}}");
            return 2;
        }
    }
}
