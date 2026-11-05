using System;
using System.IO;
using System.Text;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal static class Maintenance {
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=4*1024*1024,RecursionLimit=64};
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out FileInfoData info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle h,StringBuilder name,uint length,uint flags);
 [DllImport("advapi32.dll")] static extern uint GetSecurityInfo(SafeFileHandle h,int kind,uint flags,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr descriptor,uint revision,uint flags,out IntPtr text,out uint length);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,uint revision,out IntPtr descriptor,out uint length);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetSecurityDescriptorDacl(IntPtr descriptor,out bool present,out IntPtr dacl,out bool defaulted);
 [DllImport("advapi32.dll")] static extern uint SetSecurityInfo(SafeFileHandle h,int kind,uint flags,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr handle,uint code);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [StructLayout(LayoutKind.Sequential)] struct Time {public uint low,high;}
 [StructLayout(LayoutKind.Sequential)] struct FileInfoData {public uint attributes;public Time created,accessed,written;public uint volume,sizeHigh,sizeLow,links,indexHigh,indexLow;}
 sealed class Snapshot {
  public string path,fileId,sddl,hash;
  public bool directory;
  public long length;
  public uint links;
 }
 static string Text(Dictionary<string,object>d,string k){object v;return d.TryGetValue(k,out v)?Convert.ToString(v):"";}
 static long Number(Dictionary<string,object>d,string k,long fallback){object v;return d.TryGetValue(k,out v)?Convert.ToInt64(v):fallback;}
 static void Reject(string code){throw new InvalidOperationException(code);}
 static string Hash(string s){using(SHA256 h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(Encoding.UTF8.GetBytes(s))).Replace("-","").ToLowerInvariant();}
 static string DescriptorHash(string s){
  RawSecurityDescriptor sd=new RawSecurityDescriptor(s);
  if(sd.DiscretionaryAcl==null||sd.Owner==null||sd.Group==null)Reject("ADMIN_ACL_DESCRIPTOR_REJECTED");
  byte[] acl=new byte[sd.DiscretionaryAcl.BinaryLength];sd.DiscretionaryAcl.GetBinaryForm(acl,0);
  return Hash(sd.Owner.Value+"|"+sd.Group.Value+"|"+((sd.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0?"P":"I")+"|"+Convert.ToBase64String(acl));
 }
 static string GuardPath(string path){
  if(!Path.IsPathRooted(path)||path.StartsWith(@"\\")||path.IndexOf('\0')>=0)Reject("ADMIN_PATH_REJECTED");
  string full=Path.GetFullPath(path),part=full;
  while(!String.IsNullOrEmpty(part)){
   if((File.GetAttributes(part)&FileAttributes.ReparsePoint)!=0)Reject("ADMIN_PATH_REJECTED");
   part=Path.GetDirectoryName(part);
  }
  return full;
 }
 static SafeFileHandle Open(string path,bool write){
  string full=GuardPath(path);
  SafeFileHandle h=CreateFile(full,0x00020000U|(write?0x00040000U:0U),write?1U:7U,IntPtr.Zero,3,0x02200000U,IntPtr.Zero);
  if(h.IsInvalid){h.Dispose();throw new Win32Exception();}
  try {
   StringBuilder final=new StringBuilder(32768);
   uint n=GetFinalPathNameByHandle(h,final,(uint)final.Capacity,0);
   if(n==0||n>=final.Capacity)throw new Win32Exception();
   string resolved=final.ToString();if(resolved.StartsWith(@"\\?\"))resolved=resolved.Substring(4);
   if(!String.Equals(full.TrimEnd('\\'),resolved.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))Reject("ADMIN_PATH_REJECTED");
   FileInfoData info;if(!GetFileInformationByHandle(h,out info))throw new Win32Exception();
   if((info.attributes&0x400U)!=0)Reject("ADMIN_PATH_REJECTED");
   if(write&&(info.attributes&0x10U)==0&&info.links!=1)Reject("ADMIN_HARDLINK_REJECTED");
   return h;
  }catch{h.Dispose();throw;}
 }
 static Snapshot Read(SafeFileHandle h,string path){
  FileInfoData info;if(!GetFileInformationByHandle(h,out info))throw new Win32Exception();
  IntPtr owner,group,dacl,sacl,sd,text=IntPtr.Zero;
  uint code=GetSecurityInfo(h,1,7,out owner,out group,out dacl,out sacl,out sd);
  if(code!=0)throw new Win32Exception((int)code);
  try{
   uint length;if(!ConvertSecurityDescriptorToStringSecurityDescriptor(sd,1,7,out text,out length))throw new Win32Exception();
   string s=Marshal.PtrToStringUni(text);
   return new Snapshot {path=Path.GetFullPath(path),fileId=info.volume.ToString("x8")+":"+info.indexHigh.ToString("x8")+info.indexLow.ToString("x8"),
    sddl=s,hash=DescriptorHash(s),directory=(info.attributes&0x10U)!=0,length=((long)info.sizeHigh<<32)|info.sizeLow,links=info.links};
  }finally{if(text!=IntPtr.Zero)LocalFree(text);LocalFree(sd);}
 }
 static object Inspect(Dictionary<string,object>d){
  string path=Text(d,"path");
  using(SafeFileHandle h=Open(path,false)){
   Snapshot s=Read(h,path);RawSecurityDescriptor sd=new RawSecurityDescriptor(s.sddl);
   return new {path=s.path,fileId=s.fileId,descriptorHash=s.hash,sddl=s.sddl,directory=s.directory,links=s.links,bytes=s.length,ownerSid=sd.Owner.Value,
    protectedDacl=(sd.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0,contentsRead=false};
  }
 }
 static Dictionary<string,object> Plan(Dictionary<string,object>d){
  string path=Text(d,"path");using(SafeFileHandle h=Open(path,false)){
   Snapshot before=Read(h,path);if(!before.directory&&before.links!=1)Reject("ADMIN_HARDLINK_REJECTED");
   FileSystemSecurity sec=before.directory?(FileSystemSecurity)new DirectorySecurity():new FileSecurity();
   sec.SetSecurityDescriptorSddlForm(before.sddl,AccessControlSections.Owner|AccessControlSections.Group|AccessControlSections.Access);
   IEnumerable changes=d["changes"] as IEnumerable;if(changes==null)Reject("ADMIN_INPUT_REJECTED");
   foreach(object raw in changes){
    Dictionary<string,object> v=raw as Dictionary<string,object>;if(v==null)Reject("ADMIN_INPUT_REJECTED");
    SecurityIdentifier sid=new SecurityIdentifier(Text(v,"sid"));
    FileSystemRights rights=(FileSystemRights)Enum.Parse(typeof(FileSystemRights),Text(v,"rights"));
    string access=Text(v,"access");AccessControlType type=access=="Deny"?AccessControlType.Deny:AccessControlType.Allow;
    FileSystemAccessRule rule=new FileSystemAccessRule(sid,rights,InheritanceFlags.None,PropagationFlags.None,type);
    if(Text(v,"action")=="grant")sec.AddAccessRule(rule);
    else if(Text(v,"action")=="remove")sec.RemoveAccessRuleSpecific(rule);
    else Reject("ADMIN_INPUT_REJECTED");
   }
   string after=sec.GetSecurityDescriptorSddlForm(AccessControlSections.Owner|AccessControlSections.Group|AccessControlSections.Access);
   return new Dictionary<string,object>{{"path",before.path},{"fileId",before.fileId},{"beforeSddl",before.sddl},{"afterSddl",after},
    {"beforeHash",before.hash},{"afterHash",DescriptorHash(after)},{"changes",d["changes"]},{"contentsRead",false},{"contentsWritten",false}};
  }
 }
 static void SetDacl(SafeFileHandle h,string sddl){
  IntPtr sd=IntPtr.Zero,dacl;uint size;
  if(!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl,1,out sd,out size))throw new Win32Exception();
  try{
   bool present,defaulted;
   if(!GetSecurityDescriptorDacl(sd,out present,out dacl,out defaulted)||!present||dacl==IntPtr.Zero)Reject("ADMIN_ACL_DESCRIPTOR_REJECTED");
   uint code=SetSecurityInfo(h,1,4,IntPtr.Zero,IntPtr.Zero,dacl,IntPtr.Zero);if(code!=0)throw new Win32Exception((int)code);
  }finally{if(sd!=IntPtr.Zero)LocalFree(sd);}
 }
 static object Apply(Dictionary<string,object>d,bool restore){
  string path=Text(d,"path"),from=Text(d,restore?"afterHash":"beforeHash"),to=Text(d,restore?"beforeHash":"afterHash");
  string target=Text(d,restore?"beforeSddl":"afterSddl");bool effected=false;
  if(DescriptorHash(target)!=to)Reject("ADMIN_ACL_PLAN_REJECTED");
  using(SafeFileHandle h=Open(path,true)){
   Snapshot before=Read(h,path);
   if(before.fileId!=Text(d,"fileId"))Reject("ADMIN_STALE_FILE_IDENTITY");
   if(before.hash==to)return new {path=before.path,fileId=before.fileId,descriptorHash=before.hash,changed=false,reused=true,restored=restore,contentsWritten=false};
   if(before.hash!=from)Reject("ADMIN_STALE_SECURITY_DESCRIPTOR");
   try{
    SetDacl(h,target);effected=true;
    Snapshot after=Read(h,path);
    if(after.fileId!=before.fileId||after.hash!=to||after.length!=before.length)Reject("ADMIN_OUTCOME_UNCERTAIN");
    return new {path=after.path,fileId=after.fileId,descriptorHash=after.hash,changed=true,reused=false,restored=restore,contentsWritten=false};
   }catch{if(effected)Reject("ADMIN_OUTCOME_UNCERTAIN");throw;}
  }
 }
 static object Probe(Dictionary<string,object>d){
  string path=Text(d,"path");long maximum=Number(d,"maxBytes",16*1024*1024);
  try{
   GuardPath(path);
   using(FileStream stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){
    byte[] buffer=new byte[8192];long read=0;int n;
    while(read<maximum&&(n=stream.Read(buffer,0,(int)Math.Min(buffer.Length,maximum-read)))>0)read+=n;
    Array.Clear(buffer,0,buffer.Length);
    return new {path=Path.GetFullPath(path),readable=true,bytesRead=read,complete=read==stream.Length,contentsReturned=false};
   }
  }catch(UnauthorizedAccessException){return new {path=path,readable=false,reason="ACCESS_DENIED",contentsReturned=false};}
   catch(FileNotFoundException){return new {path=path,readable=false,reason="NOT_FOUND",contentsReturned=false};}
 }
 static object ProcessInfo(Dictionary<string,object>d){
  int pid=(int)Number(d,"pid",0);using(Process p=Process.GetProcessById(pid)){
   IntPtr token;string sid=null;
   if(OpenProcessToken(p.Handle,8,out token)){try{using(WindowsIdentity w=new WindowsIdentity(token))sid=w.User.Value;}finally{CloseHandle(token);}}
   return new {pid=p.Id,creationTicks=p.StartTime.ToUniversalTime().Ticks.ToString(),executable=p.MainModule.FileName,
    exited=p.HasExited,sessionId=p.SessionId,ownerSid=sid};
  }
 }
 static object Stop(Dictionary<string,object>d){
  int pid=(int)Number(d,"pid",0);if(pid<=4||pid==Process.GetCurrentProcess().Id)Reject("ADMIN_PROCESS_REJECTED");
  Process p;try{p=Process.GetProcessById(pid);}catch(ArgumentException){return new {pid=pid,stopped=true,alreadyAbsent=true};}
  using(p){
   IntPtr handle=p.Handle;
   if(p.StartTime.ToUniversalTime().Ticks.ToString()!=Text(d,"expectedCreationTicks")||
    !String.Equals(Path.GetFullPath(p.MainModule.FileName),Path.GetFullPath(Text(d,"expectedExecutable")),StringComparison.OrdinalIgnoreCase))Reject("ADMIN_STALE_PROCESS");
   if(!TerminateProcess(handle,1460))throw new Win32Exception();
   if(!p.WaitForExit((int)Number(d,"timeoutMs",10000)))Reject("ADMIN_OUTCOME_UNCERTAIN");
   return new {pid=pid,stopped=true,alreadyAbsent=false,creationTicks=Text(d,"expectedCreationTicks"),targetExitCode=p.ExitCode};
  }
 }
 static int Main(string[] args){
  Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
  try{
   if(args.Length!=1)Reject("ADMIN_NATIVE_INPUT_REJECTED");
   string input=Console.In.ReadToEnd();if(Encoding.UTF8.GetByteCount(input)>2*1024*1024)Reject("ADMIN_SIZE_REJECTED");
   Dictionary<string,object>d=Json.Deserialize<Dictionary<string,object>>(input);object result;
   switch(args[0]){
    case "acl.inspect":result=Inspect(d);break;
    case "acl.plan":result=Plan(d);break;
    case "acl.apply":result=Apply(d,false);break;
    case "acl.restore":result=Apply(d,true);break;
    case "file.probe":result=Probe(d);break;
    case "process.inspect":result=ProcessInfo(d);break;
    case "process.stop":result=Stop(d);break;
    default:throw new InvalidOperationException("ADMIN_OPERATION_REJECTED");
   }
   Console.WriteLine(Json.Serialize(new {ok=true,data=result}));return 0;
  }catch(Exception e){
   string code=e is InvalidOperationException&&e.Message.StartsWith("ADMIN_")?e.Message:"ADMIN_NATIVE_REJECTED";
   Console.WriteLine(Json.Serialize(new {ok=false,error=new {code=code,nativeCode=e is Win32Exception?((Win32Exception)e).NativeErrorCode:e.HResult}}));return 1;
  }
 }
}
