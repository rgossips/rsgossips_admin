<#
  Builds widget\dist\RGossipsWidget.exe - a single file teammates can run.

    powershell -NoProfile -ExecutionPolicy Bypass -File widget\build\Build-WidgetExe.ps1

  Needs nothing beyond Windows: uses the C# compiler that ships with
  .NET Framework 4.x and the Windows PowerShell 5.1 engine already installed.
  The exe embeds RGossipsWidget.ps1 (no token - each user enters theirs on
  first run) and an icon generated here.
#>
$ErrorActionPreference = 'Stop'

$here   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$widget = Split-Path -Parent $here
$dist   = Join-Path $widget 'dist'
$script = Join-Path $widget 'RGossipsWidget.ps1'
$source = Join-Path $here 'Launcher.cs'
$icon   = Join-Path $here 'rgossips.ico'
$out    = Join-Path $dist 'RGossipsWidget.exe'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'csc.exe (.NET Framework 4.x) not found.' }

$sma = [System.Management.Automation.PSObject].Assembly.Location
if (-not $sma -or -not (Test-Path $sma)) { throw 'System.Management.Automation.dll not found - run this from Windows PowerShell 5.1.' }

# --- icon: rounded pink/purple tile with "RG", PNG-in-ICO at 16..256 px
if (-not (Test-Path $icon)) {
  Add-Type -AssemblyName System.Drawing
  $sizes = 16, 24, 32, 48, 64, 128, 256
  $pngs = foreach ($sz in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $sz, $sz
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
    $r = [Math]::Max(3, [int]($sz * 0.22)); $d = $r * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90); $path.AddArc($sz - $d - 1, 0, $d, $d, 270, 90)
    $path.AddArc($sz - $d - 1, $sz - $d - 1, $d, $d, 0, 90); $path.AddArc(0, $sz - $d - 1, $d, $d, 90, 90)
    $path.CloseFigure()
    $rect = New-Object System.Drawing.Rectangle 0, 0, $sz, $sz
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(236, 72, 153)), ([System.Drawing.Color]::FromArgb(124, 58, 237)), 45
    $g.FillPath($brush, $path)
    $font = New-Object System.Drawing.Font 'Segoe UI', ([float]($sz * 0.40)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
    $g.DrawString('RG', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, ([float]($sz * 0.02)), $sz, $sz), $fmt)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    ,$ms.ToArray()
  }
  $fs = [System.IO.File]::Create($icon); $bw = New-Object System.IO.BinaryWriter $fs
  $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = $sizes[$i]; if ($dim -ge 256) { $dim = 0 }   # 0 means 256 in ICO headers
    $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$pngs[$i].Length); $bw.Write([uint32]$offset)
    $offset += $pngs[$i].Length
  }
  foreach ($p in $pngs) { $bw.Write($p) }
  $bw.Close()
  Write-Host "icon     $icon"
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
$wpf = Join-Path (Split-Path -Parent $csc) 'WPF'

& $csc /nologo /target:winexe /optimize+ /platform:anycpu `
  "/out:$out" "/win32icon:$icon" `
  "/reference:$sma" `
  /reference:System.Windows.Forms.dll `
  "/resource:$script,RGossipsWidget.ps1" `
  $source
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }

$sha = (Get-FileHash $out -Algorithm SHA256).Hash
Write-Host "built    $out"
Write-Host ("size     {0:N0} KB" -f ((Get-Item $out).Length / 1KB))
Write-Host "sha256   $sha"
