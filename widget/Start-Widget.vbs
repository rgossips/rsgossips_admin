' Launches the RGossips stats widget with no console window flashing up.
Option Explicit
Dim sh, fso, here, cmd
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\RGossipsWidget.ps1"""
sh.Run cmd, 0, False
