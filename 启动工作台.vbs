Set fs = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fs.GetParentFolderName(WScript.ScriptFullName)
packaged = fs.BuildPath(root, "release\0.3.0\win-unpacked\Claude Workbench.exe")
localExe = fs.BuildPath(root, "node_modules\electron\dist\electron.exe")
sh.CurrentDirectory = root
sh.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
If fs.FileExists(packaged) Then
  sh.Run Chr(34) & packaged & Chr(34), 1, False
ElseIf fs.FileExists(localExe) And fs.FileExists(fs.BuildPath(root, "dist\index.html")) Then
  sh.Run Chr(34) & localExe & Chr(34) & " " & Chr(34) & root & Chr(34), 1, False
Else
  MsgBox "Please run npm install and npm run build first.", 48, "Claude Workbench"
End If
