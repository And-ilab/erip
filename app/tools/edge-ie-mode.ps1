﻿# Один раз на компьютере с AvPass. Политика текущего пользователя, права администратора не нужны.
# Запуск из каталога репозитория:
#   powershell -ExecutionPolicy Bypass -File app\tools\edge-ie-mode.ps1 -Origin https://адрес-пм
param(
  [Parameter(Mandatory = $true)]
  [string]$Origin
)

$ErrorActionPreference = 'Stop'
try {
  $parsed = [Uri]$Origin
} catch {
  throw "Укажите адрес ПМ, например https://pm.example.by"
}
if (-not $parsed.Host) {
  throw "В адресе нет хоста"
}

$authority = $parsed.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
$list = "$authority/api/v1/ie-mode/sites.xml"
$hostName = $parsed.Host

$policy = 'HKCU:\Software\Policies\Microsoft\Edge'
New-Item -Path $policy -Force | Out-Null
New-ItemProperty -Path $policy -Name InternetExplorerIntegrationLevel -PropertyType DWord -Value 1 -Force | Out-Null
New-ItemProperty -Path $policy -Name InternetExplorerIntegrationSiteList -PropertyType String -Value $list -Force | Out-Null

# Надёжные узлы — зона 2. Для имени с точками IE ждёт ключ домена и поддомена.
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

# 2500 = 3 снимает защищённый режим зоны «Надёжные узлы»: иначе AvPass не открывает %APPDATA%\Avest.
$trusted = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings\Zones\2'
if (Test-Path $trusted) {
  New-ItemProperty -Path $trusted -Name '2500' -PropertyType DWord -Value 3 -Force | Out-Null
}

Write-Host "Политика Edge записана для $hostName"
Write-Host "Список сайтов: $list"
Write-Host "В режиме Internet Explorer откроется только /ie-sign/. Закройте все окна Edge и откройте ПМ снова."
