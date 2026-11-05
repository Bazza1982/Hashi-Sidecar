using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal static class Native {
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=16*1024*1024,RecursionLimit=64};
 static readonly byte[] Entropy=Encoding.UTF8.GetBytes("HASHI Admin Sidecar v2");
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int information,IntPtr value,int length,out int returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,IntPtr value,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SecurityAttributes attributes,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref StartupInfo startup,out ProcessInformation process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {public int length;public IntPtr descriptor;public int inherit;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct StartupInfo {
 public int cb;public string reserved;public string desktop;public string title;public int x,y,xSize,ySize,xCount,yCount,fill,flags;public short show,reservedBytes;public IntPtr reservedPointer,input,output,error;}
 [StructLayout(LayoutKind.Sequential)] struct ProcessInformation {public IntPtr process,thread;public uint pid,tid;}
 [StructLayout(LayoutKind.Sequential)] struct BasicLimits {public long processTime,jobTime;public uint flags;public UIntPtr minimum,maximum;public uint active;public UIntPtr affinity;public uint priority,scheduling;}
 [StructLayout(LayoutKind.Sequential)] struct IoCounters {public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes;}
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {public BasicLimits basic;public IoCounters io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
 static object Identity(){
 using(WindowsIdentity who=WindowsIdentity.GetCurrent()){
 bool elevated=false;IntPtr p=Marshal.AllocHGlobal(4);
 try{int n;if(GetTokenInformation(who.Token,20,p,4,out n))elevated=Marshal.ReadInt32(p)!=0;}
 finally{Marshal.FreeHGlobal(p);}
 return new {sid=who.User.Value,system=who.User.Value=="S-1-5-18",elevated=elevated,admin=new WindowsPrincipal(who).IsInRole(WindowsBuiltInRole.Administrator),machine=Environment.MachineName,sessionId=Process.GetCurrentProcess().SessionId};
 }}
 [StructLayout(LayoutKind.Sequential)] struct WtsSession {public int id;public IntPtr station;public int state;}
 [DllImport("wtsapi32.dll",SetLastError=true)] static extern bool WTSEnumerateSessions(IntPtr server,int reserved,int version,out IntPtr sessions,out int count);
 [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool WTSQuerySessionInformation(IntPtr server,int id,int kind,out IntPtr value,out int bytes);
 [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr memory);
 static string SessionText(int id,int kind){
  IntPtr value;int bytes;if(!WTSQuerySessionInformation(IntPtr.Zero,id,kind,out value,out bytes))throw new Win32Exception();
  try{return Marshal.PtrToStringUni(value)??"";}finally{WTSFreeMemory(value);}
 }
 static object Sessions(){
  IntPtr buffer;int count;if(!WTSEnumerateSessions(IntPtr.Zero,0,1,out buffer,out count))throw new Win32Exception();
  List<object> rows=new List<object>();
  try{int size=Marshal.SizeOf(typeof(WtsSession));for(int i=0;i<count;i++){
   WtsSession entry=(WtsSession)Marshal.PtrToStructure(IntPtr.Add(buffer,i*size),typeof(WtsSession));
   string user=SessionText(entry.id,5);if(String.IsNullOrEmpty(user))continue;
   string domain=SessionText(entry.id,7);
   SecurityIdentifier sid=(SecurityIdentifier)new NTAccount(domain,user).Translate(typeof(SecurityIdentifier));
   rows.Add(new {sid=sid.Value,sessionId=entry.id,state=entry.state});
  }}finally{WTSFreeMemory(buffer);}
  return new {sessions=rows,complete=true};
 }
 static string Quote(string value){
 StringBuilder s=new StringBuilder("\"");int slash=0;
 foreach(char ch in value){if(ch=='\\'){slash++;continue;}if(ch=='"'){s.Append('\\',slash*2+1).Append('"');}else{s.Append('\\',slash).Append(ch);}slash=0;}
 return s.Append('\\',slash*2).Append('"').ToString();
 }
 static string Text(Dictionary<string,object> d,string key,string fallback){object v;return d.TryGetValue(key,out v)?Convert.ToString(v):fallback;}
 static long Number(Dictionary<string,object> d,string key,long fallback){object v;return d.TryGetValue(key,out v)?Convert.ToInt64(v):fallback;}
 sealed class Capture {public string value;public bool truncated;}
 static Capture ReadTail(IntPtr handle,int maxBytes){
 using(SafeFileHandle safe=new SafeFileHandle(handle,true))
 using(FileStream stream=new FileStream(safe,FileAccess.Read,4096,false))
 using(StreamReader reader=new StreamReader(stream,new UTF8Encoding(false,false))){
 StringBuilder b=new StringBuilder();char[] chars=new char[4096];int n;bool truncated=false;
 while((n=reader.Read(chars,0,chars.Length))>0){b.Append(chars,0,n);if(b.Length>maxBytes){b.Remove(0,b.Length-maxBytes);truncated=true;}}
 string s=b.ToString();while(Encoding.UTF8.GetByteCount(s)>maxBytes){s=s.Substring(Math.Min(1024,s.Length));truncated=true;}
 if(s.Length>0&&char.IsLowSurrogate(s[0]))s=s.Substring(1);
 return new Capture {value=s,truncated=truncated};
 }}
 static object Run(Dictionary<string,object> d){
 string executable=Text(d,"executable",""),directory=Text(d,"cwd","");
 if(!Path.IsPathRooted(executable)||!File.Exists(executable)||!Path.IsPathRooted(directory)||!Directory.Exists(directory))throw new InvalidOperationException("ADMIN_NATIVE_INPUT_REJECTED");
 long timeout=Number(d,"timeoutMs",40000),deadline=Number(d,"deadlineMs",long.MaxValue);
 if(timeout<100||timeout>86400000)throw new InvalidOperationException("ADMIN_NATIVE_INPUT_REJECTED");
 int maxBytes=(int)Number(d,"maxOutputBytes",131072);if(maxBytes<1024||maxBytes>1024*1024)throw new InvalidOperationException("ADMIN_NATIVE_INPUT_REJECTED");
 object raw;System.Collections.IEnumerable args=d.TryGetValue("args",out raw)?raw as System.Collections.IEnumerable:null;
 if(args==null||raw is string)throw new InvalidOperationException("ADMIN_NATIVE_INPUT_REJECTED");
 StringBuilder command=new StringBuilder(Quote(executable));
 foreach(object a in args){if(!(a is string)||((string)a).IndexOf('\0')>=0)throw new InvalidOperationException("ADMIN_NATIVE_INPUT_REJECTED");command.Append(' ').Append(Quote((string)a));}
 if(command.Length>32760)throw new InvalidOperationException("ADMIN_NATIVE_INPUT_REJECTED");
 IntPtr job=IntPtr.Zero,inRead=IntPtr.Zero,inWrite=IntPtr.Zero,outRead=IntPtr.Zero,outWrite=IntPtr.Zero,errRead=IntPtr.Zero,errWrite=IntPtr.Zero;
 ProcessInformation child=new ProcessInformation();bool resumed=false;Task<Capture> stdout=null,stderr=null;
 try{
 job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new Win32Exception();
 ExtendedLimits limits=new ExtendedLimits();limits.basic.flags=0x2000;int size=Marshal.SizeOf(limits);IntPtr p=Marshal.AllocHGlobal(size);
 try{Marshal.StructureToPtr(limits,p,false);if(!SetInformationJobObject(job,9,p,(uint)size))throw new Win32Exception();}finally{Marshal.FreeHGlobal(p);}
 SecurityAttributes sa=new SecurityAttributes {length=Marshal.SizeOf(typeof(SecurityAttributes)),inherit=1};
 if(!CreatePipe(out inRead,out inWrite,ref sa,0)||!CreatePipe(out outRead,out outWrite,ref sa,0)||!CreatePipe(out errRead,out errWrite,ref sa,0))throw new Win32Exception();
 if(!SetHandleInformation(inWrite,1,0)||!SetHandleInformation(outRead,1,0)||!SetHandleInformation(errRead,1,0))throw new Win32Exception();
 bool normalWindow=Text(d,"window","hidden")=="normal";
 StartupInfo startup=new StartupInfo {cb=Marshal.SizeOf(typeof(StartupInfo)),flags=0x100|1,show=(short)(normalWindow?1:0),input=inRead,output=outWrite,error=errWrite};
 if(!CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,true,(normalWindow?0U:0x08000000U)|4U|0x400U,IntPtr.Zero,directory,ref startup,out child))throw new Win32Exception();
 CloseHandle(inRead);inRead=IntPtr.Zero;CloseHandle(outWrite);outWrite=IntPtr.Zero;CloseHandle(errWrite);errWrite=IntPtr.Zero;
 if(!AssignProcessToJobObject(job,child.process))throw new Win32Exception();
 IntPtr o=outRead,e=errRead;outRead=IntPtr.Zero;errRead=IntPtr.Zero;
 stdout=Task.Factory.StartNew(()=>ReadTail(o,maxBytes));stderr=Task.Factory.StartNew(()=>ReadTail(e,maxBytes));
 string creationTicks=Process.GetProcessById((int)child.pid).StartTime.ToUniversalTime().Ticks.ToString();
 if(ResumeThread(child.thread)==uint.MaxValue)throw new Win32Exception();resumed=true;
 string input=Text(d,"stdin","");IntPtr writer=inWrite;inWrite=IntPtr.Zero;
 Task inputTask=Task.Factory.StartNew(()=>{using(SafeFileHandle safe=new SafeFileHandle(writer,true))using(FileStream stream=new FileStream(safe,FileAccess.Write,4096,false)){
 try{byte[] bytes=Encoding.UTF8.GetBytes(input);stream.Write(bytes,0,bytes.Length);}catch(IOException){}}});
 string statusFile=Text(d,"statusFile","");
 if(!String.IsNullOrEmpty(statusFile))File.WriteAllText(statusFile,Json.Serialize(new {state="running",pid=child.pid,creationTicks=creationTicks,identity=Identity(),startedAt=DateTimeOffset.UtcNow.ToString("o")}),new UTF8Encoding(false));
 Stopwatch watch=Stopwatch.StartNew();string stopped=null;
 while(WaitForSingleObject(child.process,50)==258){
 if(File.Exists(Text(d,"cancelFile",""))){stopped="cancelled";break;}
 if(File.Exists(Text(d,"revokedFile",""))){stopped="grant_revoked";break;}
 if(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()>=deadline){stopped="grant_expired";break;}
 if(watch.ElapsedMilliseconds>=timeout){stopped="timed_out";break;}
 }
 if(stopped!=null){TerminateJobObject(job,1460);WaitForSingleObject(child.process,5000);}
 uint code;if(!GetExitCodeProcess(child.process,out code))throw new Win32Exception();
 CloseHandle(job);job=IntPtr.Zero;
 if(!Task.WaitAll(new Task[]{stdout,stderr,inputTask},10000))throw new InvalidOperationException("ADMIN_NATIVE_PIPE_TIMEOUT");
 if(!String.IsNullOrEmpty(statusFile))File.WriteAllText(statusFile,Json.Serialize(new {state="finished",pid=child.pid,exitCode=code,termination=stopped,identity=Identity(),finishedAt=DateTimeOffset.UtcNow.ToString("o")}),new UTF8Encoding(false));
 return new {identity=Identity(),pid=child.pid,exitCode=code,durationMs=watch.ElapsedMilliseconds,termination=stopped,jobObject=true,
 stdout=stdout.Result.value,stderr=stderr.Result.value,stdoutTruncated=stdout.Result.truncated,stderrTruncated=stderr.Result.truncated};
 }finally{
 if(child.process!=IntPtr.Zero&&!resumed)TerminateProcess(child.process,1460);
 foreach(IntPtr h in new IntPtr[]{job,child.process,child.thread,inRead,inWrite,outRead,outWrite,errRead,errWrite})if(h!=IntPtr.Zero)CloseHandle(h);
 }
 }
 static int Main(string[] args){
 Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
 try{
 if(args.Length!=1)throw new InvalidOperationException("ADMIN_NATIVE_INPUT_REJECTED");
 if(args[0]=="identity"){Console.WriteLine(Json.Serialize(Identity()));return 0;}
 if(args[0]=="sessions"){Console.WriteLine(Json.Serialize(Sessions()));return 0;}
 string input=Console.In.ReadToEnd();if(Encoding.UTF8.GetByteCount(input)>8*1024*1024)throw new InvalidOperationException("ADMIN_NATIVE_INPUT_REJECTED");
 if(args[0]=="protect"){Console.WriteLine(Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(input),Entropy,DataProtectionScope.LocalMachine)));return 0;}
 if(args[0]=="unprotect"){Console.WriteLine(Convert.ToBase64String(ProtectedData.Unprotect(Convert.FromBase64String(input.Trim()),Entropy,DataProtectionScope.LocalMachine)));return 0;}
 if(args[0]=="run"){Console.WriteLine(Json.Serialize(Run(Json.Deserialize<Dictionary<string,object>>(input))));return 0;}
 throw new InvalidOperationException("ADMIN_NATIVE_INPUT_REJECTED");
 }catch(Exception e){string code=e is InvalidOperationException&&e.Message.StartsWith("ADMIN_")?e.Message:"ADMIN_NATIVE_FAILED";
 Console.Error.WriteLine(Json.Serialize(new {ok=false,error=new {code=code,nativeCode=e is Win32Exception?((Win32Exception)e).NativeErrorCode:0}}));return 2;}
 }
}
