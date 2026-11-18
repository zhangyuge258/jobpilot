[CmdletBinding()]
param([switch]$WhenIdle)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Python = (Get-Item -LiteralPath (Join-Path $RepoRoot '.venv\Scripts\python.exe')).FullName

# Do not interrupt an active collection, scoring, or delivery task.
do {
    $Request = [Net.HttpWebRequest]::Create('http://127.0.0.1:8686/api/workbench')
    $Request.Proxy = $null
    $Request.Timeout = 5000
    $State = $null
    try {
        $Response = $Request.GetResponse()
        try {
            $Reader = New-Object IO.StreamReader($Response.GetResponseStream())
            try { $State = $Reader.ReadToEnd() | ConvertFrom-Json } finally { $Reader.Dispose() }
        } finally { $Response.Dispose() }
    } catch [Net.WebException] {
        if (Get-NetTCPConnection -LocalPort 8686 -State Listen -ErrorAction SilentlyContinue) {
            if (-not $WhenIdle) { throw }
            Start-Sleep -Seconds 15
            continue
        }
    }
    if ($null -eq $State.task -and -not $State.active_tasks) { break }
    if (-not $WhenIdle) { throw 'A BossHunter task is active. Wait for it to finish before restarting.' }
    Start-Sleep -Seconds 15
} while ($true)

# Limit cleanup to this installation's Python launchers and their web children.
$Processes = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'python.exe' -and $_.CommandLine -match '-m bosshunter\.main web --no-open'
})
$Parents = @($Processes | Where-Object { $_.ExecutablePath -eq $Python })
$ParentIds = @($Parents | ForEach-Object { $_.ProcessId })
if (-not $ParentIds.Count -and (Get-NetTCPConnection -LocalPort 8686 -State Listen -ErrorAction SilentlyContinue)) {
    throw 'Port 8686 is occupied by an unrecognized process; nothing was stopped.'
}
$Children = @($Processes | Where-Object { $_.ParentProcessId -in $ParentIds })
foreach ($Process in @($Children) + @($Parents)) {
    try {
        Stop-Process -Id $Process.ProcessId -ErrorAction Stop
        Write-Host "Stopped old workbench: $($Process.ProcessId)"
    } catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
        # The launcher can exit automatically as soon as its child exits.
        if (Get-Process -Id $Process.ProcessId -ErrorAction SilentlyContinue) { throw }
    }
}

$env:BOSSHUNTER_AI_PROXY = 'http://127.0.0.1:7890'
$env:PYTHONUTF8 = '1'
$Server = Start-Process -FilePath $Python -ArgumentList @('-m', 'bosshunter.main', 'web', '--no-open') -WorkingDirectory $RepoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $RepoRoot 'data\web.stdout.log') -RedirectStandardError (Join-Path $RepoRoot 'data\web.stderr.log') -PassThru
Write-Host "Started updated workbench: $($Server.Id)"
for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
    try {
        $HealthRequest = [Net.HttpWebRequest]::Create('http://127.0.0.1:8686/api/workbench')
        $HealthRequest.Proxy = $null
        $HealthRequest.Timeout = 1000
        $HealthResponse = $HealthRequest.GetResponse()
        $HealthResponse.Dispose()
        Write-Host 'Workbench is ready. Refresh http://127.0.0.1:8686/'
        return
    } catch [Net.WebException] {
        Start-Sleep -Milliseconds 500
    }
}
throw 'Workbench did not become ready. Check data\web.stderr.log.'
