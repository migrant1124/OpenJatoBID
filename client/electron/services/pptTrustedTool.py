"""受信固定工具的路径、网络和子进程约束；不用于执行用户/Agent 代码。"""
import json
import os
import runpy
import sys
from pathlib import Path

request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
script = Path(request["script"]).resolve()
read_roots = [Path(root).resolve() for root in request["readRoots"]]
read_roots.append(Path(__file__).resolve().parent)
write_root = Path(request["writeRoot"]).resolve()

def inside(target, roots):
    return any(target == root or root in target.parents for root in roots)

# Python 3.13 的 0700 会覆盖 Windows 继承 ACL，移除当前 AppContainer SID。
# 候选内临时目录继承候选 ACL，保留操作系统边界；不改变候选外权限。
original_mkdir = os.mkdir
def candidate_mkdir(target, mode=0o777, *, dir_fd=None):
    if os.name == "nt" and mode == 0o700 and inside(Path(target).resolve(), [write_root]):
        mode = 0o777
    return original_mkdir(target, mode, dir_fd=dir_fd)
os.mkdir = candidate_mkdir

def audit(event, args):
    if event.startswith("socket.") or event in ("subprocess.Popen", "os.system", "os.exec", "os.spawn", "os.startfile"):
        raise PermissionError("PPT 固定工具禁止网络和子进程；媒体和服务经宿主工具调用")
    if event == "open" and not isinstance(args[0], int):
        target = Path(os.fsdecode(args[0])).resolve()
        mode, flags = args[1], args[2]
        writing = (isinstance(mode, str) and any(letter in mode for letter in "wax+")) or (isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC))
        if not inside(target, [write_root] if writing else read_roots):
            raise PermissionError("PPT 工具访问越界")
    if event in ("os.remove", "os.rmdir", "os.mkdir", "os.rename", "os.replace", "os.chmod", "os.link", "os.symlink"):
        for value in args[:2] if event in ("os.rename", "os.replace", "os.link", "os.symlink") else args[:1]:
            if isinstance(value, (str, bytes)) and not inside(Path(os.fsdecode(value)).resolve(), [write_root]):
                raise PermissionError("PPT 工具写入越界")

sys.addaudithook(audit)
sys.path.insert(0, str(script.parent))
sys.argv = [str(script)] + request["args"]
runpy.run_path(str(script), run_name="__main__")
