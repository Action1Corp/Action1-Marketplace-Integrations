$ErrorActionPreference = 'Stop'

function ConvertTo-A1CMDisplayTimestamp {
    param(
        [AllowNull()]
        [object]$Value
    )

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return $null
    }

    try {
        $timestamp = [DateTimeOffset]::Parse(
            [string]$Value,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
        )
        return $timestamp.ToString('MMM dd, yyyy h:mm tt ''UTC''', [Globalization.CultureInfo]::InvariantCulture)
    }
    catch {
        return [string]$Value
    }
}

$baseDirectory = 'C:\Windows\Action1\ConfigurationManager'
$result = New-Object System.Collections.ArrayList

if (-not (Test-Path -LiteralPath $baseDirectory -PathType Container)) {
    $result
    return
}

$stateFiles = Get-ChildItem -LiteralPath $baseDirectory -Filter '*.json' -File -Recurse -ErrorAction SilentlyContinue
foreach ($stateFile in $stateFiles) {
    try {
        $rawJson = Get-Content -LiteralPath $stateFile.FullName -Raw -Encoding UTF8 -ErrorAction Stop
        if ([string]::IsNullOrWhiteSpace($rawJson)) { continue }
        $state = $rawJson | ConvertFrom-Json -ErrorAction Stop
        if ([string]::IsNullOrWhiteSpace([string]$state.policyId) -or [string]::IsNullOrWhiteSpace([string]$state.controlId)) { continue }
        $row = '' | Select-Object 'Policy ID','Policy Name','Control ID','Control Version','Control Name','Configuration Status','Last Checked At','Remediation Attempted','Last Remediated At','Message','State File','A1_Key'
        $row.'Policy ID' = [string]$state.policyId
        $row.'Policy Name' = [string]$state.policyName
        $row.'Control ID' = [string]$state.controlId
        $row.'Control Version' = [string]$state.controlVersion
        $row.'Control Name' = [string]$state.controlName
        $row.'Configuration Status' = [string]$state.status
        $row.'Last Checked At' = [string]$state.lastCheckedAt
        $row.'Last Checked At' = ConvertTo-A1CMDisplayTimestamp -Value $row.'Last Checked At'
        $row.'Remediation Attempted' = [bool]$state.remediationAttempted
        $row.'Last Remediated At' = if ($null -eq $state.lastRemediatedAt) { '' } else { [string]$state.lastRemediatedAt }
        $row.'Last Remediated At' = ConvertTo-A1CMDisplayTimestamp -Value $row.'Last Remediated At'
        $row.'Message' = [string]$state.message
        $row.'State File' = [string]$stateFile.FullName
        $row.'A1_Key' = '{0}::{1}' -f ([string]$state.policyId), ([string]$state.controlId)
        [void]$result.Add($row)
    } catch { continue }
}

$result
