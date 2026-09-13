<#
  RGossips Admin - desktop stats widget (Windows, WPF)
  ----------------------------------------------------
  Frameless always-on-top card showing, for today (IST) and all time:
    * Collected amount   (Razorpay captured payments, net of refunds)
    * Subscriptions      (new paid subscriptions today / creators on a paid plan)
    * Sign-ups           (new creators + brands today / all profiles)
  auto-refreshed from the admin app's /api/widget/stats endpoint.

  Run:      powershell -NoProfile -ExecutionPolicy Bypass -File RGossipsWidget.ps1
  Silent:   double-click Start-Widget.vbs  (no console window)
  Settings: config.json next to this file (apiUrl + token); window position,
            size, opacity and interval are remembered in
            %LOCALAPPDATA%\RGossipsAdminWidget\state.json

  Adapted from myshop-client/widget. This file is deliberately pure ASCII - the
  rupee sign and other symbols are built from code points so it survives any
  editor/encoding round-trip.
#>
[CmdletBinding()]
param(
  [string]$ApiUrl,
  [int]$RefreshSeconds = 0
)

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Windows.Forms   # global cursor position / modifier keys while resizing

# The live site is https; older PowerShell defaults to TLS 1.0 and would fail.
try {
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11
} catch { }

# Only one widget at a time - a second launch just exits quietly.
$createdNew = $false
$singleton  = New-Object System.Threading.Mutex($true, 'Local\RGossipsAdminWidget', [ref]$createdNew)
if (-not $createdNew) { return }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RS  = [char]0x20B9   # rupee sign
$SEP = [char]0x00B7   # middle dot
$ELL = [char]0x2026   # ellipsis
$DASH = [char]0x2014  # em dash

# ---------------------------------------------------------------- config / state
$cfg = @{
  apiUrl         = 'https://rgossipsadmin.netlify.app'
  dashboardUrl   = 'https://rgossipsadmin.netlify.app/dashboard'
  token          = ''
  refreshSeconds = 60
  opacity        = 0.97
  scale          = 1.0
}
$cfgPath = Join-Path $ScriptDir 'config.json'
if (Test-Path $cfgPath) {
  try {
    $fromFile = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($p in $fromFile.PSObject.Properties) { $cfg[$p.Name] = $p.Value }
  } catch { }
}
if ($ApiUrl)               { $cfg.apiUrl         = $ApiUrl }
if ($RefreshSeconds -gt 0) { $cfg.refreshSeconds = $RefreshSeconds }

$stateDir  = Join-Path $env:LOCALAPPDATA 'RGossipsAdminWidget'
$statePath = Join-Path $stateDir 'state.json'
$state = @{
  left = $null; top = $null
  opacity        = [double]$cfg.opacity
  refreshSeconds = [int]$cfg.refreshSeconds
  topmost        = $true
  scale          = [double]$cfg.scale
}
if (Test-Path $statePath) {
  try {
    $s = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($p in $s.PSObject.Properties) { $state[$p.Name] = $p.Value }
  } catch { }
}
function Save-State {
  try {
    if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
    ([pscustomobject]$state | ConvertTo-Json) | Out-File -FilePath $statePath -Encoding utf8 -Force
  } catch { }
}

# ---------------------------------------------------------------- helpers
$Culture = [System.Globalization.CultureInfo]::InvariantCulture
try { $Culture = [System.Globalization.CultureInfo]::GetCultureInfo('en-IN') } catch { }

function N ($v) {
  if ($null -eq $v) { return [double]0 }
  try { return [double]$v } catch { return [double]0 }
}
function Money ([double]$v) { return $RS + $v.ToString('N2', $Culture) }
function Count ([double]$v) { return $v.ToString('N0', $Culture) }
function Brush ([string]$hex) {
  return New-Object Windows.Media.SolidColorBrush ([Windows.Media.ColorConverter]::ConvertFromString($hex))
}
function Plural ([double]$n, [string]$one, [string]$many) { if ($n -eq 1) { return $one } else { return $many } }

# ---------------------------------------------------------------- UI
$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="RGossips Stats" WindowStyle="None" AllowsTransparency="True"
        Background="Transparent" Topmost="True" ShowInTaskbar="False"
        SizeToContent="WidthAndHeight" ResizeMode="NoResize"
        WindowStartupLocation="Manual" FontFamily="Segoe UI"
        TextOptions.TextFormattingMode="Display">
  <Window.Resources>
    <Style x:Key="IconBtn" TargetType="Button">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Foreground" Value="#FF868FA3"/>
      <Setter Property="Width" Value="18"/>
      <Setter Property="Height" Value="18"/>
      <Setter Property="FontSize" Value="10"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="FontFamily" Value="Segoe UI Symbol"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bg" CornerRadius="5" Background="{TemplateBinding Background}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bg" Property="Background" Value="#26FFFFFF"/>
                <Setter Property="Foreground" Value="#FFEDF0F6"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>

  <Border x:Name="Card" Width="216" CornerRadius="12" Background="#FF151922"
          BorderBrush="#FF2B3342" BorderThickness="1" Padding="11,8,11,9" Margin="11">
    <Border.Effect>
      <DropShadowEffect BlurRadius="16" ShadowDepth="3" Opacity="0.5" Color="#FF000000"/>
    </Border.Effect>

   <Grid>
    <StackPanel>
      <!-- header -->
      <Grid>
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>
        <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
          <Ellipse x:Name="Dot" Width="6.5" Height="6.5" Fill="#FF22C55E" VerticalAlignment="Center"/>
          <TextBlock Text="RGOSSIPS" Margin="6,0,0,0" FontSize="9" FontWeight="Bold"
                     Foreground="#FFF472B6" VerticalAlignment="Center"/>
          <TextBlock Text="ADMIN" Margin="4,0,0,0" FontSize="7.5" FontWeight="Bold"
                     Foreground="#FF667085" VerticalAlignment="Center"/>
        </StackPanel>
        <StackPanel Grid.Column="1" Orientation="Horizontal">
          <Button x:Name="BtnRefresh" Style="{StaticResource IconBtn}" Content="&#x27F3;" ToolTip="Refresh now"/>
          <Button x:Name="BtnClose"   Style="{StaticResource IconBtn}" Content="&#x2715;" ToolTip="Close widget"/>
        </StackPanel>
      </Grid>

      <!-- collected today -->
      <TextBlock Text="COLLECTED TODAY" Margin="0,6,0,0" FontSize="8" FontWeight="Bold" Foreground="#FF868FA3"/>
      <TextBlock x:Name="CollectedTxt" FontSize="23" FontWeight="Bold"
                 Foreground="#FFF3F6FB" TextOptions.TextFormattingMode="Ideal"/>
      <StackPanel Orientation="Horizontal">
        <TextBlock x:Name="CollectedSubTxt" FontSize="9.5" Foreground="#FF868FA3" VerticalAlignment="Center"/>
        <TextBlock x:Name="DeltaTxt" FontSize="9.5" FontWeight="Bold" Margin="6,0,0,0"
                   Foreground="#FF22C55E" Visibility="Collapsed" VerticalAlignment="Center"/>
      </StackPanel>

      <!-- today / total tiles -->
      <UniformGrid Columns="2" Margin="-2.5,8,-2.5,0">
        <Border Background="#FF1C2230" CornerRadius="8" Padding="8,5,8,6" Margin="2.5">
          <StackPanel>
            <StackPanel Orientation="Horizontal">
              <Ellipse Width="5.5" Height="5.5" Fill="#FFA78BFA" VerticalAlignment="Center"/>
              <TextBlock Text="SUBSCRIPTIONS" Margin="5,0,0,0" FontSize="7.5" FontWeight="Bold" Foreground="#FF868FA3"/>
            </StackPanel>
            <TextBlock x:Name="SubsTodayTxt" Margin="0,1,0,0" FontSize="15" FontWeight="Bold" Foreground="#FFE6EAF2"/>
            <TextBlock x:Name="SubsTotalTxt" FontSize="9" Foreground="#FF868FA3"/>
          </StackPanel>
        </Border>
        <Border x:Name="SignupTile" Background="#FF1C2230" CornerRadius="8" Padding="8,5,8,6" Margin="2.5">
          <StackPanel>
            <StackPanel Orientation="Horizontal">
              <Ellipse Width="5.5" Height="5.5" Fill="#FF22D3EE" VerticalAlignment="Center"/>
              <TextBlock Text="SIGN-UPS" Margin="5,0,0,0" FontSize="7.5" FontWeight="Bold" Foreground="#FF868FA3"/>
            </StackPanel>
            <TextBlock x:Name="SignupsTodayTxt" Margin="0,1,0,0" FontSize="15" FontWeight="Bold" Foreground="#FFE6EAF2"/>
            <TextBlock x:Name="SignupsTotalTxt" FontSize="9" Foreground="#FF868FA3"/>
          </StackPanel>
        </Border>
      </UniformGrid>

      <TextBlock x:Name="FootTxt" Margin="0,7,0,0" FontSize="8.5" Foreground="#FF667085" TextWrapping="Wrap"/>
    </StackPanel>

    <!-- drag-to-resize grip, bottom-right corner -->
    <Border x:Name="Grip" Width="13" Height="13" Background="Transparent" Opacity="0.5"
            HorizontalAlignment="Right" VerticalAlignment="Bottom" Margin="0,0,-4,-4"
            Cursor="SizeNWSE" ToolTip="Drag to resize (double-click to reset)">
      <Path Data="M1,11 L11,1 M5,11 L11,5 M9,11 L11,9" Stroke="#FF7C879C" StrokeThickness="1.2"/>
    </Border>
   </Grid>
  </Border>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
$win    = [Windows.Markup.XamlReader]::Load($reader)

$card          = $win.FindName('Card')
$dot           = $win.FindName('Dot')
$btnRef        = $win.FindName('BtnRefresh')
$btnClose      = $win.FindName('BtnClose')
$collectedTxt  = $win.FindName('CollectedTxt')
$collectedSub  = $win.FindName('CollectedSubTxt')
$deltaTxt      = $win.FindName('DeltaTxt')
$subsTodayTxt  = $win.FindName('SubsTodayTxt')
$subsTotalTxt  = $win.FindName('SubsTotalTxt')
$signTodayTxt  = $win.FindName('SignupsTodayTxt')
$signTotalTxt  = $win.FindName('SignupsTotalTxt')
$signupTile    = $win.FindName('SignupTile')
$footTxt       = $win.FindName('FootTxt')
$grip          = $win.FindName('Grip')

# a mutable brush so the border can be animated when something new lands
$borderBrush = Brush '#FF2B3342'
$card.BorderBrush = $borderBrush

$COL_OK   = Brush '#FF22C55E'
$COL_BUSY = Brush '#FF3B82F6'
$COL_ERR  = Brush '#FFEF4444'

$collectedTxt.Text = $RS + '--'
$collectedSub.Text = 'connecting' + $ELL
$subsTodayTxt.Text = '--'
$subsTotalTxt.Text = ''
$signTodayTxt.Text = '--'
$signTotalTxt.Text = ''
$footTxt.Text      = ''

$win.Opacity = [double]$state.opacity
$win.Topmost = [bool]$state.topmost

# ---------------------------------------------------------------- resizing
# Everything lives inside one Border, so a LayoutTransform on it scales the whole
# card - text included, vector-crisp - and SizeToContent shrinks the window to fit.
$CARD_W    = 216.0   # design width, used as the drag-sensitivity baseline
$ZOOM_MIN  = 0.65
$ZOOM_MAX  = 2.50

$scaleT = New-Object Windows.Media.ScaleTransform (1, 1)
$card.LayoutTransform = $scaleT

$script:zoom = 1.0
$script:dpi  = 1.0

function Set-Zoom ([double]$z) {
  if ($z -lt $ZOOM_MIN) { $z = $ZOOM_MIN }
  if ($z -gt $ZOOM_MAX) { $z = $ZOOM_MAX }
  $z = [math]::Round($z, 3)
  $script:zoom  = $z
  $scaleT.ScaleX = $z
  $scaleT.ScaleY = $z
  $state.scale   = $z
}
$z0 = N $state.scale
if ($z0 -le 0) { $z0 = 1.0 }
Set-Zoom $z0

# keep the card fully on screen after it grows or moves
function Clamp-Position {
  try {
    $win.UpdateLayout()
    $area = [Windows.SystemParameters]::WorkArea
    $w = $win.ActualWidth
    $h = $win.ActualHeight
    if ($win.Left + $w -gt $area.Right)  { $win.Left = $area.Right  - $w }
    if ($win.Top  + $h -gt $area.Bottom) { $win.Top  = $area.Bottom - $h }
    if ($win.Left -lt $area.Left) { $win.Left = $area.Left }
    if ($win.Top  -lt $area.Top)  { $win.Top  = $area.Top }
  } catch { }
}

# first run: park it bottom-right of the work area (above the taskbar)
$wa = [Windows.SystemParameters]::WorkArea
if ($null -ne $state.left -and $null -ne $state.top) {
  $win.Left = [double]$state.left
  $win.Top  = [double]$state.top
} else {
  $win.Left = $wa.Right  - 260
  $win.Top  = $wa.Bottom - 220
}

# ---------------------------------------------------------------- data plumbing
$http = New-Object System.Net.Http.HttpClient
$http.Timeout = [TimeSpan]::FromSeconds(20)   # the Razorpay scan can take a few seconds cold
if ($cfg.token) {
  $http.DefaultRequestHeaders.Authorization =
    New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', [string]$cfg.token)
}

$script:task          = $null
$script:lastCollected = $null
$script:lastSubs      = $null
$script:lastSignups   = $null
$script:lastOk        = $null

function Flash-Card ([string]$hex) {
  try {
    $anim = New-Object Windows.Media.Animation.ColorAnimation
    $anim.From     = [Windows.Media.ColorConverter]::ConvertFromString($hex)
    $anim.To       = [Windows.Media.ColorConverter]::ConvertFromString('#FF2B3342')
    $anim.Duration = New-Object Windows.Duration ([TimeSpan]::FromMilliseconds(1500))
    $borderBrush.BeginAnimation([Windows.Media.SolidColorBrush]::ColorProperty, $anim)
  } catch { }
}

function Show-Error ([string]$msg) {
  $dot.Fill = $COL_ERR
  $collectedTxt.Opacity = 0.45
  $stamp = ''
  if ($null -ne $script:lastOk) { $stamp = '  ' + $SEP + '  last ok ' + $script:lastOk.ToString('HH:mm:ss') }
  $footTxt.Text = $msg + $stamp
}

function Show-Data ($json) {
  if ($null -eq $json -or $json.status -ne 'success') { Show-Error ('Bad response, retrying' + $ELL); return }

  $script:lastOk        = Get-Date
  $collectedTxt.Opacity = 1
  $dot.Fill             = $COL_OK
  $chips = @()

  # -- collected (Razorpay)
  $col = $json.collected
  $collectedNote = ''
  if ($null -ne $col.today) {
    $today = N $col.today
    $total = N $col.total
    $pays  = [int](N $col.paymentsToday)
    $collectedTxt.Text = Money $today
    $totalLabel = (Money $total) + ' total'
    if ($col.totalIsPartial) { $totalLabel += '+' }
    $collectedSub.Text = $totalLabel + '  ' + $SEP + '  ' + $pays + ' ' + (Plural $pays 'payment' 'payments')
    if ($null -ne $script:lastCollected -and $today -gt $script:lastCollected) {
      $chips += '+' + (Money ($today - $script:lastCollected))
    }
    $script:lastCollected = $today
  } else {
    $collectedTxt.Text    = $RS + ' ' + $DASH
    $collectedTxt.Opacity = 0.45
    $collectedSub.Text    = 'Razorpay unavailable'
    if ($col.error -eq 'not_configured') { $collectedNote = 'Add Razorpay keys to the admin app. ' }
    else { $collectedNote = 'Razorpay error. ' }
    $script:lastCollected = $null
  }

  # -- subscriptions
  $subsTotal = N $json.subscriptions.total
  if ($null -ne $json.subscriptions.today) {
    $st = N $json.subscriptions.today
    $subsTodayTxt.Text = '+' + (Count $st) + ' today'
    if ($null -ne $script:lastSubs -and $st -gt $script:lastSubs) {
      $d = $st - $script:lastSubs
      $chips += '+' + (Count $d) + ' ' + (Plural $d 'sub' 'subs')
    }
    $script:lastSubs = $st
  } else {
    # migration 067 not applied yet - there is no record of WHEN people subscribed
    $subsTodayTxt.Text = $DASH + ' today'
    $subsTodayTxt.ToolTip = 'New-subscription tracking starts once migration 067 is applied'
  }
  $subsTotalTxt.Text = (Count $subsTotal) + ' total'

  # -- sign-ups
  $su = $json.signups
  $sgt = N $su.today
  $signTodayTxt.Text = '+' + (Count $sgt) + ' today'
  $signTotalTxt.Text = (Count (N $su.total)) + ' total'
  $signupTile.ToolTip = 'Today: ' + (Count (N $su.influencersToday)) + ' creators, ' + (Count (N $su.brandsToday)) + " brands`n" +
                        'Total: ' + (Count (N $su.influencersTotal)) + ' creators, ' + (Count (N $su.brandsTotal)) + ' brands'
  if ($null -ne $script:lastSignups -and $sgt -gt $script:lastSignups) {
    $d = $sgt - $script:lastSignups
    $chips += '+' + (Count $d) + ' ' + (Plural $d 'sign-up' 'sign-ups')
  }
  $script:lastSignups = $sgt

  # something new landed since the last poll -> green pulse + chip
  if ($chips.Count -gt 0) {
    $deltaTxt.Text       = ($chips -join ' ')
    $deltaTxt.Tag        = 0
    $deltaTxt.Visibility = 'Visible'
    Flash-Card '#FF22C55E'
  }

  $footTxt.Text = $collectedNote + 'Updated ' + $script:lastOk.ToString('HH:mm:ss') + '  ' + $SEP +
                  '  every ' + [int]$state.refreshSeconds + 's'
}

function Start-Fetch {
  if ($null -ne $script:task -and -not $script:task.IsCompleted) { return }
  if (-not $cfg.token) {
    Show-Error ('No token - put "token" in ' + $cfgPath)
    return
  }
  $dot.Fill = $COL_BUSY
  $url = ([string]$cfg.apiUrl).TrimEnd('/') + '/api/widget/stats?_=' +
         [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  try { $script:task = $http.GetAsync($url) }
  catch { $script:task = $null; Show-Error ('Offline, retrying' + $ELL) }
}

# poll the in-flight request instead of blocking the UI thread on it
$poll = New-Object Windows.Threading.DispatcherTimer
$poll.Interval = [TimeSpan]::FromMilliseconds(200)
$poll.Add_Tick({
  if ($null -eq $script:task -or -not $script:task.IsCompleted) { return }
  $t = $script:task
  $script:task = $null
  if ($t.IsFaulted -or $t.IsCanceled) {
    $m = 'Offline, retrying' + $ELL
    if ($t.IsCanceled) { $m = 'Timed out, retrying' + $ELL }
    Show-Error $m
    return
  }
  try {
    $resp = $t.Result
    # GetAsync buffers the body by default, so this read is already complete.
    $body = $resp.Content.ReadAsStringAsync().Result
    $code = [int]$resp.StatusCode
    if ($code -eq 401) { Show-Error 'Token rejected - check "token" in config.json'; return }
    if ($code -eq 503) { Show-Error 'Widget API disabled - set WIDGET_API_TOKEN on the admin app'; return }
    if (-not $resp.IsSuccessStatusCode) { Show-Error ('Server error ' + $code + ', retrying' + $ELL); return }
    Show-Data ($body | ConvertFrom-Json)
  }
  catch { Show-Error ('Bad response, retrying' + $ELL) }
})

$refresh = New-Object Windows.Threading.DispatcherTimer
$refresh.Interval = [TimeSpan]::FromSeconds([int]$state.refreshSeconds)
$refresh.Add_Tick({ Start-Fetch })

# retire the "+..." chip ~15s after something lands
$deltaHide = New-Object Windows.Threading.DispatcherTimer
$deltaHide.Interval = [TimeSpan]::FromSeconds(1)
$deltaHide.Add_Tick({
  if ($deltaTxt.Visibility -ne 'Visible') { return }
  $n = 0
  if ($null -ne $deltaTxt.Tag) { $n = [int]$deltaTxt.Tag }
  $n++
  $deltaTxt.Tag = $n
  if ($n -ge 15) { $deltaTxt.Visibility = 'Collapsed'; $deltaTxt.Tag = 0 }
})

# ---------------------------------------------------------------- interactions
$btnRef.Add_Click({ Start-Fetch })
$btnClose.Add_Click({ $win.Close() })

# --- grip: drag to resize, double-click to reset to 100%
$script:resizing  = $false
$script:startPt   = $null
$script:startZoom = 1.0

$grip.Add_MouseEnter({ $grip.Opacity = 1.0 })
$grip.Add_MouseLeave({ if (-not $script:resizing) { $grip.Opacity = 0.5 } })

$grip.Add_MouseLeftButtonDown({
  param($s, $e)
  $e.Handled = $true          # don't let the card start a window drag
  if ($e.ClickCount -ge 2) {
    Set-Zoom 1.0
    Clamp-Position
    Save-State
    return
  }
  $script:resizing  = $true
  $script:startPt   = [System.Windows.Forms.Cursor]::Position
  $script:startZoom = $script:zoom
  [void]$grip.CaptureMouse()
})

$grip.Add_MouseMove({
  param($s, $e)
  if (-not $script:resizing) { return }
  $now = [System.Windows.Forms.Cursor]::Position
  $dx  = $now.X - $script:startPt.X
  $dy  = $now.Y - $script:startPt.Y
  $d   = [math]::Max($dx, $dy)                 # follow whichever axis is pulled harder
  Set-Zoom ($script:startZoom + ($d / ($CARD_W * $script:dpi)))
})

$grip.Add_MouseLeftButtonUp({
  param($s, $e)
  if (-not $script:resizing) { return }
  $script:resizing = $false
  $grip.ReleaseMouseCapture()
  $grip.Opacity = 0.5
  Clamp-Position
  $state.left = $win.Left
  $state.top  = $win.Top
  Save-State
})

# Ctrl + wheel also scales (the widget needs focus, so click it once first)
$card.Add_MouseWheel({
  param($s, $e)
  if ([System.Windows.Forms.Control]::ModifierKeys -band [System.Windows.Forms.Keys]::Control) {
    Set-Zoom ($script:zoom + ([math]::Sign($e.Delta) * 0.05))
    Clamp-Position
    Save-State
    $e.Handled = $true
  }
})

# drag to move; double-click opens the admin dashboard
$card.Add_MouseLeftButtonDown({
  param($s, $e)
  if ($e.ClickCount -ge 2) {
    try { Start-Process ([string]$cfg.dashboardUrl) } catch { }
    return
  }
  try { $win.DragMove() } catch { }
  $state.left = $win.Left
  $state.top  = $win.Top
})

# --- right-click menu
$menu = New-Object Windows.Controls.ContextMenu

$miRefresh = New-Object Windows.Controls.MenuItem
$miRefresh.Header = 'Refresh now'
$miRefresh.Add_Click({ Start-Fetch })
$menu.Items.Add($miRefresh) | Out-Null

# 30s floor: every refresh asks Razorpay for today's payments.
$miInterval = New-Object Windows.Controls.MenuItem
$miInterval.Header = 'Refresh every'
foreach ($opt in @(@{n='30 seconds'; v=30}, @{n='1 minute'; v=60}, @{n='2 minutes'; v=120}, @{n='5 minutes'; v=300})) {
  $it = New-Object Windows.Controls.MenuItem
  $it.Header      = $opt.n
  $it.Tag         = $opt.v
  $it.IsCheckable = $true
  $it.IsChecked   = ([int]$state.refreshSeconds -eq [int]$opt.v)
  $it.Add_Click({
    param($src, $e)
    $secs = [int]$src.Tag
    $state.refreshSeconds = $secs
    $refresh.Interval = [TimeSpan]::FromSeconds($secs)
    foreach ($sib in $miInterval.Items) { $sib.IsChecked = ([int]$sib.Tag -eq $secs) }
    Save-State
    Start-Fetch
  })
  $miInterval.Items.Add($it) | Out-Null
}
$menu.Items.Add($miInterval) | Out-Null

$miOpacity = New-Object Windows.Controls.MenuItem
$miOpacity.Header = 'Opacity'
foreach ($opt in @(@{n='100%'; v=1.0}, @{n='90%'; v=0.9}, @{n='75%'; v=0.75}, @{n='60%'; v=0.6})) {
  $it = New-Object Windows.Controls.MenuItem
  $it.Header      = $opt.n
  $it.Tag         = $opt.v
  $it.IsCheckable = $true
  $it.IsChecked   = ([math]::Abs([double]$state.opacity - [double]$opt.v) -lt 0.02)
  $it.Add_Click({
    param($src, $e)
    $o = [double]$src.Tag
    $state.opacity = $o
    $win.Opacity   = $o
    foreach ($sib in $miOpacity.Items) { $sib.IsChecked = ([math]::Abs([double]$sib.Tag - $o) -lt 0.02) }
    Save-State
  })
  $miOpacity.Items.Add($it) | Out-Null
}
$menu.Items.Add($miOpacity) | Out-Null

$miSize = New-Object Windows.Controls.MenuItem
$miSize.Header = 'Size'
foreach ($opt in @(@{n='Tiny (75%)'; v=0.75}, @{n='Small (90%)'; v=0.9},
                   @{n='Normal (100%)'; v=1.0}, @{n='Large (130%)'; v=1.3},
                   @{n='Huge (170%)'; v=1.7})) {
  $it = New-Object Windows.Controls.MenuItem
  $it.Header      = $opt.n
  $it.Tag         = $opt.v
  $it.IsCheckable = $true
  $it.IsChecked   = ([math]::Abs($script:zoom - [double]$opt.v) -lt 0.02)
  $it.Add_Click({
    param($src, $e)
    Set-Zoom ([double]$src.Tag)
    Clamp-Position
    foreach ($sib in $miSize.Items) { $sib.IsChecked = ([math]::Abs($script:zoom - [double]$sib.Tag) -lt 0.02) }
    Save-State
  })
  $miSize.Items.Add($it) | Out-Null
}
$menu.Items.Add($miSize) | Out-Null

$miTop = New-Object Windows.Controls.MenuItem
$miTop.Header      = 'Always on top'
$miTop.IsCheckable = $true
$miTop.IsChecked   = [bool]$state.topmost
$miTop.Add_Click({
  param($src, $e)
  $state.topmost = [bool]$src.IsChecked
  $win.Topmost   = [bool]$src.IsChecked
  Save-State
})
$menu.Items.Add($miTop) | Out-Null

$startupLnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'RGossips Admin Widget.lnk'
$miAuto = New-Object Windows.Controls.MenuItem
$miAuto.Header      = 'Start with Windows'
$miAuto.IsCheckable = $true
$miAuto.IsChecked   = (Test-Path $startupLnk)
$miAuto.Add_Click({
  param($src, $e)
  try {
    if ($src.IsChecked) {
      $sh  = New-Object -ComObject WScript.Shell
      $lnk = $sh.CreateShortcut($startupLnk)
      $lnk.TargetPath       = Join-Path $ScriptDir 'Start-Widget.vbs'
      $lnk.WorkingDirectory = $ScriptDir
      $lnk.Description      = 'RGossips admin stats widget'
      $lnk.Save()
    } elseif (Test-Path $startupLnk) {
      Remove-Item $startupLnk -Force
    }
  } catch {
    [Windows.MessageBox]::Show('Could not change the startup setting: ' + $_.Exception.Message) | Out-Null
    $src.IsChecked = (Test-Path $startupLnk)
  }
})
$menu.Items.Add($miAuto) | Out-Null

$menu.Items.Add((New-Object Windows.Controls.Separator)) | Out-Null

$miOpen = New-Object Windows.Controls.MenuItem
$miOpen.Header = 'Open admin dashboard'
$miOpen.Add_Click({ try { Start-Process ([string]$cfg.dashboardUrl) } catch { } })
$menu.Items.Add($miOpen) | Out-Null

$miQuit = New-Object Windows.Controls.MenuItem
$miQuit.Header = 'Close widget'
$miQuit.Add_Click({ $win.Close() })
$menu.Items.Add($miQuit) | Out-Null

$card.ContextMenu = $menu

# the grip can change the zoom behind the menu's back - resync the ticks on open
$menu.Add_Opened({
  foreach ($sib in $miSize.Items) {
    $sib.IsChecked = ([math]::Abs($script:zoom - [double]$sib.Tag) -lt 0.02)
  }
})

# drag sensitivity is in physical pixels, so it needs the monitor's DPI factor
$win.Add_SourceInitialized({
  try {
    $src = [Windows.PresentationSource]::FromVisual($win)
    if ($src -and $src.CompositionTarget) { $script:dpi = $src.CompositionTarget.TransformToDevice.M11 }
    if ($script:dpi -le 0) { $script:dpi = 1.0 }
  } catch { $script:dpi = 1.0 }
})

$win.Add_Closing({
  $state.left = $win.Left
  $state.top  = $win.Top
  Save-State
  $poll.Stop(); $refresh.Stop(); $deltaHide.Stop()
  try { $http.Dispose() } catch { }
})

$win.Add_Loaded({
  Clamp-Position
  $poll.Start(); $refresh.Start(); $deltaHide.Start()
  Start-Fetch
})

$win.ShowDialog() | Out-Null
