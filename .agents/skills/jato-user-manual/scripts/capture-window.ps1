param([string]$OutputPath)
if (-not $OutputPath) { throw '必须提供 OutputPath；请使用真实 Jato UI 截图。' }
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('{PRTSC}')
throw '请由操作者确认目标窗口后保存截图；本脚本不会生成或重绘 UI 图像。'
