# Один раз на компьютере с AvPass. Права администратора не требуются:
# если политика HKCU:\Software\Policies\Microsoft\Edge закрыта, скрипт не падает и настраивает зоны IE и ActiveX.
# Запуск из каталога репозитория:
#   powershell -ExecutionPolicy Bypass -File app\tools\edge-ie-mode.ps1 -Origin http://178.159.47.172
param(
  [Parameter(Mandatory = $true)]
  [string]$Origin
)

try {
  $parsed = [Uri]$Origin
} catch {
  throw "Укажите адрес ПМ, например http://178.159.47.172"
}
if (-not $parsed.Host) {
  throw "В адресе нет хоста"
}

$authority = $parsed.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
$hostWithPort = $parsed.Authority
$list = "$authority/api/v1/ie-mode/sites.xml?host=$([Uri]::EscapeDataString($hostWithPort))"
$hostName = $parsed.Host

# 1. Политика Edge IE Mode (может требовать запуск PowerShell от имени администратора, если ветка Policies закрыта)
try {
  $policy = 'HKCU:\Software\Policies\Microsoft\Edge'
  New-Item -Path $policy -Force -ErrorAction Stop | Out-Null
  New-ItemProperty -Path $policy -Name InternetExplorerIntegrationLevel -PropertyType DWord -Value 1 -Force -ErrorAction Stop | Out-Null
  New-ItemProperty -Path $policy -Name InternetExplorerIntegrationSiteList -PropertyType String -Value $list -Force -ErrorAction Stop | Out-Null
  New-ItemProperty -Path $policy -Name InternetExplorerIntegrationZoneAllowed -PropertyType DWord -Value 1 -Force -ErrorAction Stop | Out-Null
  New-ItemProperty -Path $policy -Name RedirectSitesFromInternetExplorerPreventBHOInstall -PropertyType DWord -Value 1 -Force -ErrorAction Stop | Out-Null
  Write-Host "Политика Edge IE Mode обновлена: $list"
} catch {
  Write-Warning "Ветка Policies\Microsoft\Edge закрыта для обычного пользователя (это нормально, если она уже задана администратором)."
}

# 2. Добавление хоста/IP в «Надёжные сайты» (зона 2)
$zoneMap = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings\ZoneMap'
if ($hostName -match '^\d{1,3}(\.\d{1,3}){3}$') {
  $ranges = Join-Path $zoneMap 'Ranges'
  New-Item -Path $ranges -Force | Out-Null
  $range = Join-Path $ranges 'EripSign'
  New-Item -Path $range -Force | Out-Null
  New-ItemProperty -Path $range -Name ':Range' -PropertyType String -Value $hostName -Force | Out-Null
  New-ItemProperty -Path $range -Name https -PropertyType DWord -Value 2 -Force | Out-Null
  New-ItemProperty -Path $range -Name http -PropertyType DWord -Value 2 -Force | Out-Null
} else {
  $labels = $hostName.Split('.')
  if ($labels.Length -ge 2) {
    $domain = ($labels[($labels.Length - 2)..($labels.Length - 1)] -join '.')
    $sub = $null
    if ($labels.Length -gt 2) {
      $sub = ($labels[0..($labels.Length - 3)] -join '.')
    }
    $key = Join-Path (Join-Path $zoneMap 'Domains') $domain
    if ($sub) { $key = Join-Path $key $sub }
  } else {
    $key = Join-Path (Join-Path $zoneMap 'Domains') $hostName
  }
  New-Item -Path $key -Force | Out-Null
  New-ItemProperty -Path $key -Name https -PropertyType DWord -Value 2 -Force | Out-Null
  New-ItemProperty -Path $key -Name http -PropertyType DWord -Value 2 -Force | Out-Null
}

# 3. Разрешение инициализации и скриптинга ActiveX (1201=0 — ключевой параметр для CreateBlob в AvCMXWebP!)
# и отключение Защищённого режима (2500=3) + 64-битных вкладок (2702=3) для зон 1, 2 и 3.
foreach ($z in @('1', '2', '3')) {
  $zonePath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings\Zones\$z"
  if (Test-Path $zonePath) {
    New-ItemProperty -Path $zonePath -Name '1200' -PropertyType DWord -Value 0 -Force | Out-Null
    New-ItemProperty -Path $zonePath -Name '1201' -PropertyType DWord -Value 0 -Force | Out-Null
    New-ItemProperty -Path $zonePath -Name '1208' -PropertyType DWord -Value 0 -Force | Out-Null
    New-ItemProperty -Path $zonePath -Name '1405' -PropertyType DWord -Value 0 -Force | Out-Null
    New-ItemProperty -Path $zonePath -Name '2000' -PropertyType DWord -Value 0 -Force | Out-Null
    New-ItemProperty -Path $zonePath -Name '2500' -PropertyType DWord -Value 3 -Force | Out-Null
    New-ItemProperty -Path $zonePath -Name '2702' -PropertyType DWord -Value 3 -Force | Out-Null
  }
}

# 4. 32-битный процесс вкладки IE11 и разрешение Per-Site ActiveX для CLSID AvCMXWebP
$ieMain = 'HKCU:\Software\Microsoft\Internet Explorer\Main'
if (Test-Path $ieMain) {
  New-ItemProperty -Path $ieMain -Name 'Isolation' -PropertyType String -Value 'PMIL' -Force | Out-Null
  New-ItemProperty -Path $ieMain -Name 'Isolation64Bit' -PropertyType DWord -Value 0 -Force | Out-Null
  New-ItemProperty -Path $ieMain -Name 'TabProcGrowth' -PropertyType DWord -Value 1 -Force | Out-Null
}

$extPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Ext\Stats\{35B35038-9C01-5D75-943F-5A19E32AC230}\iexplore'
New-Item -Path $extPath -Force | Out-Null
New-ItemProperty -Path $extPath -Name 'Flags' -PropertyType DWord -Value 4 -Force | Out-Null
New-Item -Path (Join-Path $extPath 'AllowedDomains\*') -Force | Out-Null
New-Item -Path (Join-Path $extPath "AllowedDomains\$hostName") -Force | Out-Null

Write-Host "Настройки ActiveX (1201=0), Надёжных узлов и 32-битного режима IE успешно записаны для $hostName."
