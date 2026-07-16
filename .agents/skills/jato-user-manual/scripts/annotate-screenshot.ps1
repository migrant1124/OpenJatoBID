param([string]$Annotation)
if (-not $Annotation) { throw '必须提供截图注释。' }
Write-Output "待记录注释：$Annotation"
