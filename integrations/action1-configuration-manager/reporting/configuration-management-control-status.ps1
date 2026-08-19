$ErrorActionPreference = 'Stop'

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
        $row = '' | Select-Object 'Policy ID','Control ID','Control Version','Control Name','Configuration Status','Last Checked At','Remediation Attempted','Last Remediated At','Message','State File','A1_Key'
        $row.'Policy ID' = [string]$state.policyId
        $row.'Control ID' = [string]$state.controlId
        $row.'Control Version' = [string]$state.controlVersion
        $row.'Control Name' = [string]$state.controlName
        $row.'Configuration Status' = [string]$state.status
        $row.'Last Checked At' = [string]$state.lastCheckedAt
        $row.'Remediation Attempted' = [bool]$state.remediationAttempted
        $row.'Last Remediated At' = if ($null -eq $state.lastRemediatedAt) { '' } else { [string]$state.lastRemediatedAt }
        $row.'Message' = [string]$state.message
        $row.'State File' = [string]$stateFile.FullName
        $row.'A1_Key' = '{0}::{1}' -f ([string]$state.policyId), ([string]$state.controlId)
        [void]$result.Add($row)
    } catch { continue }
}

$result
