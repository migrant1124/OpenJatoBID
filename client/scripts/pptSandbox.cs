// Windows 无网络 AppContainer + 单进程 Job。只由宿主执行固定工具，参数来自受管策略文件。
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Web.Script.Serialization;

class PptSandbox {
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO {
    public int cb; public IntPtr reserved, desktop, title; public int x,y,xsize,ysize,xchars,ychars,fill,flags; public short show,reserved2; public IntPtr reservedPtr,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO info; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public int pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr sid,capabilities; public uint count,reserved; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int length; public IntPtr descriptor; public int inherit; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active; public IntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr caps,uint count,out IntPtr sid);
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttr,IntPtr threadAttr,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFOEX startup,out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXTENDED_LIMIT data,int size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern uint SetErrorMode(uint mode);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string file,uint access,uint share,ref SECURITY_ATTRIBUTES security,uint creation,uint flags,IntPtr template);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetFileSecurity(string file,uint information,byte[] security);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumePathName(string file,StringBuilder volume,uint length);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumeNameForVolumeMountPoint(string mount,StringBuilder volume,uint length);
  static string Volume(string file) { var mount=new StringBuilder(1024); var volume=new StringBuilder(1024); Check(GetVolumePathName(Path.GetFullPath(file),mount,1024),"目标卷查询失败"); Check(GetVolumeNameForVolumeMountPoint(mount.ToString(),volume,1024),"卷标识查询失败"); return volume.ToString(); }
  static void Check(bool ok,string operation) { if(!ok) throw new Exception(operation+"："+Marshal.GetLastWin32Error()); }
  static string Quote(string value) { var result=new StringBuilder("\""); int slashes=0; foreach(char letter in value) { if(letter=='\\') { slashes++; continue; } if(letter=='\"') result.Append('\\',slashes*2+1); else result.Append('\\',slashes); result.Append(letter); slashes=0; } result.Append('\\',slashes*2); result.Append('"'); return result.ToString(); }
  static byte[] EditAccess(string root,SecurityIdentifier sid,FileSystemRights rights,AceFlags flags,bool remove) {
    // 非规范 ACL 也保留原 ACE 顺序；只增删本次 SID 的精确规则，不重置用户权限。
    var descriptor=new RawSecurityDescriptor(Directory.GetAccessControl(root).GetSecurityDescriptorBinaryForm(),0);
    var acl=descriptor.DiscretionaryAcl;
    for(int index=acl.Count-1;index>=0;index--) {
      var ace=acl[index] as CommonAce;
      if(ace!=null && ace.SecurityIdentifier.Equals(sid) && ace.AceQualifier==AceQualifier.AccessAllowed && ace.AccessMask==(int)rights && ace.AceFlags==flags) {
        if(remove) acl.RemoveAce(index); else return Binary(descriptor);
      }
    }
    if(!remove) {
      int position=0; while(position<acl.Count && (acl[position].AceFlags&AceFlags.Inherited)==0) position++;
      acl.InsertAce(position,new CommonAce(flags,AceQualifier.AccessAllowed,(int)rights,sid,false,null));
    }
    return Binary(descriptor);
  }
  static byte[] Binary(RawSecurityDescriptor descriptor) { byte[] result=new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(result,0); return result; }
  static void Access(string root, SecurityIdentifier sid, bool write, bool remove) {
    var security=new DirectorySecurity();
    security.SetSecurityDescriptorBinaryForm(EditAccess(root,sid,write?FileSystemRights.FullControl:FileSystemRights.ReadAndExecute|FileSystemRights.Synchronize,AceFlags.ContainerInherit|AceFlags.ObjectInherit,remove),AccessControlSections.Access);
    Directory.SetAccessControl(root,security);
  }
  static void Integrity(string root,string level) {
    var info=new System.Diagnostics.ProcessStartInfo(Path.Combine(Environment.GetEnvironmentVariable("SystemRoot"),"System32","icacls.exe"));
    info.Arguments=Quote(root)+" /setintegritylevel "+Quote("(OI)(CI)"+level); info.UseShellExecute=false; info.CreateNoWindow=true; info.RedirectStandardOutput=true; info.RedirectStandardError=true;
    using(var process=System.Diagnostics.Process.Start(info)) { string output=process.StandardOutput.ReadToEnd(); string error=process.StandardError.ReadToEnd(); process.WaitForExit(); if(process.ExitCode!=0) throw new Exception("候选目录完整性等级设置失败："+error+output); }
  }
  static void Traverse(string root,SecurityIdentifier sid,List<string> granted,bool remove=false) {
    var rights=FileSystemRights.Traverse|FileSystemRights.ReadAttributes;
    foreach(string directory in granted) if(remove) Check(SetFileSecurity(directory,4,EditAccess(directory,sid,rights,AceFlags.None,true)),"目录穿越权限恢复失败："+directory);
    if(remove) return;
    var current=Directory.GetParent(root);
    while(current!=null && current.Parent!=null) {
      if(!granted.Contains(current.FullName)) { Check(SetFileSecurity(current.FullName,4,EditAccess(current.FullName,sid,rights,AceFlags.None,false)),"目录穿越权限设置失败："+current.FullName); granted.Add(current.FullName); }
      current=current.Parent;
    }
  }
  static int Main(string[] args) {
    Console.OutputEncoding=new UTF8Encoding(false); Console.InputEncoding=new UTF8Encoding(false);
    SetErrorMode(0x8007);
    if(args.Length==3 && args[0]=="--volume") { try { Console.WriteLine(new JavaScriptSerializer().Serialize(new { target=Volume(args[1]), system=Volume(args[2]) })); return 0; } catch(Exception error) { Console.Error.WriteLine(error.Message); return 126; } }
    string profile="JatoPpt-"+Guid.NewGuid().ToString("N"),writeRoot=null; IntPtr sid=IntPtr.Zero,job=IntPtr.Zero,attributes=IntPtr.Zero,capsPtr=IntPtr.Zero,nullInput=IntPtr.Zero; PROCESS_INFORMATION child=new PROCESS_INFORMATION();
    var access=new List<Tuple<string,bool>>(); var traversal=new List<string>(); SecurityIdentifier identity=null; bool lowered=false,attributeInitialized=false,locked=false; byte[] originalAccess=null;
    var mutex=new System.Threading.Mutex(false,"Local\\JatoPptSandbox-"+WindowsIdentity.GetCurrent().User.Value);
    try {
      try { locked=mutex.WaitOne(60000); } catch(System.Threading.AbandonedMutexException) { locked=true; }
      if(!locked) throw new Exception("固定工具隔离器等待超时");
      if(args.Length!=1) throw new Exception("缺少固定工具策略");
      var request=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(args[0],Encoding.UTF8));
      string executable=Path.GetFullPath((string)request["executable"]),launcher=Path.GetFullPath((string)request["launcher"]),policy=Path.GetFullPath((string)request["policy"]);
      writeRoot=Path.GetFullPath((string)request["writeRoot"]);
      int result=CreateAppContainerProfile(profile,profile,"Jato PPT 固定工具隔离",IntPtr.Zero,0,out sid); if(result!=0) throw new Exception("AppContainer 创建失败："+result);
      identity=new SecurityIdentifier(sid);
      foreach(object entry in (System.Collections.ArrayList)request["readRoots"]) {
        string root=Path.GetFullPath((string)entry); if(root==writeRoot || !Directory.Exists(root)) continue;
        if(!File.Exists(Path.Combine(root,"runtime-lock.json")) || !File.Exists(Path.Combine(root,"files-manifest.json"))) throw new Exception("只读运行包缺少归属清单");
        Traverse(root,identity,traversal);
        // 公开运行组件只读；不把每次工具调用变成上万文件的 ACL 改写，项目仍用独立 SID。
        var publicIdentity=new SecurityIdentifier("S-1-15-2-1"); bool readable=false;
        var readRights=FileSystemRights.ReadAndExecute|FileSystemRights.Synchronize;
        foreach(FileSystemAccessRule rule in Directory.GetAccessControl(root).GetAccessRules(true,true,typeof(SecurityIdentifier))) if(rule.IdentityReference.Equals(publicIdentity) && rule.AccessControlType==AccessControlType.Allow && (rule.FileSystemRights&readRights)==readRights) readable=true;
        if(!readable) Access(root,publicIdentity,false,false);
      }
      Traverse(writeRoot,identity,traversal);
      // 仅在已归属的候选根授予当前用户完整控制，以设置低完整性标签；退出时恢复原 ACL。
      var candidateAccess=Directory.GetAccessControl(writeRoot); originalAccess=candidateAccess.GetSecurityDescriptorBinaryForm();
      Access(writeRoot,WindowsIdentity.GetCurrent().User,true,false);
      Access(writeRoot,identity,true,false); access.Add(Tuple.Create(writeRoot,true)); Integrity(writeRoot,"L"); lowered=true;
      job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero,"Job 创建失败");
      var limits=new EXTENDED_LIMIT(); limits.basic.flags=0x2008; limits.basic.active=1;
      Check(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(EXTENDED_LIMIT))),"Job 限制失败");
      IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size); attributes=Marshal.AllocHGlobal(size);
      Check(InitializeProcThreadAttributeList(attributes,1,0,ref size),"AppContainer 属性初始化失败"); attributeInitialized=true;
      var caps=new SECURITY_CAPABILITIES(); caps.sid=sid; capsPtr=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES))); Marshal.StructureToPtr(caps,capsPtr,false);
      Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20009),capsPtr,new IntPtr(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES))),IntPtr.Zero,IntPtr.Zero),"AppContainer 能力限制失败");
      var startup=new STARTUPINFOEX(); startup.info.cb=Marshal.SizeOf(typeof(STARTUPINFOEX)); startup.info.flags=0x101; startup.info.show=0;
      var inputSecurity=new SECURITY_ATTRIBUTES(); inputSecurity.length=Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)); inputSecurity.inherit=1;
      nullInput=CreateFile("NUL",0x80000000,3,ref inputSecurity,3,0,IntPtr.Zero); Check(nullInput!=new IntPtr(-1),"工具空输入创建失败");
      // 工具不读交互 stdin；宿主的取消管道不能同时作为 Python 标准输入。
      startup.info.input=nullInput; startup.info.output=GetStdHandle(-11); startup.info.error=GetStdHandle(-12); startup.attributes=attributes;
      var command=new StringBuilder(Quote(executable));
      if(request.ContainsKey("kind") && (string)request["kind"]=="media") { foreach(object argument in (System.Collections.ArrayList)request["arguments"]) command.Append(" "+Quote((string)argument)); }
      else command.Append(" -I -B -S "+Quote(launcher)+" "+Quote(policy));
      Check(CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,true,0x08080004,IntPtr.Zero,writeRoot,ref startup,out child),"隔离工具启动失败");
      Check(AssignProcessToJobObject(job,child.process),"进程树归属失败"); Check(ResumeThread(child.thread)!=0xffffffff,"隔离工具恢复失败");
      var cancel=new System.Threading.Thread(()=> { try { if(Console.ReadLine()=="cancel") TerminateJobObject(job,125); } catch{} }); cancel.IsBackground=true; cancel.Start();
      Check(WaitForSingleObject(child.process,0xffffffff)==0,"隔离进程等待失败"); uint exit; Check(GetExitCodeProcess(child.process,out exit),"隔离进程退出状态读取失败"); Console.Error.WriteLine("隔离工具进程退出码："+exit); return (int)exit;
    } catch(Exception error) { Console.Error.WriteLine(error.ToString()); if(child.process!=IntPtr.Zero) TerminateProcess(child.process,126); return 126; }
    finally {
      if(job!=IntPtr.Zero) CloseHandle(job); if(child.thread!=IntPtr.Zero) CloseHandle(child.thread); if(child.process!=IntPtr.Zero) CloseHandle(child.process);
      if(nullInput!=IntPtr.Zero && nullInput!=new IntPtr(-1)) CloseHandle(nullInput);
      if(attributeInitialized) DeleteProcThreadAttributeList(attributes); if(attributes!=IntPtr.Zero) Marshal.FreeHGlobal(attributes); if(capsPtr!=IntPtr.Zero) Marshal.FreeHGlobal(capsPtr);
      if(lowered) try { Integrity(writeRoot,"M"); } catch(Exception error) { Console.Error.WriteLine(error.Message); }
      if(identity!=null) foreach(var entry in access) try { Access(entry.Item1,identity,entry.Item2,true); } catch(Exception error) { Console.Error.WriteLine(error.Message); }
      if(identity!=null) try { Traverse(writeRoot,identity,traversal,true); } catch(Exception error) { Console.Error.WriteLine(error.Message); }
      if(originalAccess!=null) try { var restored=new DirectorySecurity(); restored.SetSecurityDescriptorBinaryForm(originalAccess,AccessControlSections.Access); Directory.SetAccessControl(writeRoot,restored); } catch(Exception error) { Console.Error.WriteLine(error.Message); }
      if(sid!=IntPtr.Zero) { FreeSid(sid); DeleteAppContainerProfile(profile); }
      if(locked) mutex.ReleaseMutex(); mutex.Dispose();
    }
  }
}
