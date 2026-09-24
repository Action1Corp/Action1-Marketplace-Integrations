# Action1 Configuration Manager Control Pack
# Pack: Windows Endpoint Configuration (windows-endpoint-configuration) v0.9.0
# Automation Group: Web Certificate & TLS Security (platform.web-certificate-and-tls) v0.1.0
# Contains: 5 fixed Control implementation(s)
# The embedded Policy configuration selects which included Controls execute.
# Generated file. Do not edit manually.

$policyConfigurationBase64 = '__A1CM_POLICY_CONFIGURATION_BASE64__'

$policyConfigurationJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($policyConfigurationBase64))

$policyConfiguration = $policyConfigurationJson | ConvertFrom-Json

function Get-A1CMUtcTimestamp {
    [DateTime]::UtcNow.ToString('o')
}

function Get-A1CMStateRoot {
    if ($env:A1CM_TEST_MODE -eq '1' -and $env:A1CM_TEST_STATE_ROOT) {
        return $env:A1CM_TEST_STATE_ROOT
    }

    return 'C:\Windows\Action1\ConfigurationManager'
}

function Add-A1CMMockOperation {
    param(
        [Parameter(Mandatory)]
        [string]$Value
    )

    if ($null -ne $global:MockOps) {
        [void]$global:MockOps.Add($Value)
    }
}

function Get-A1CMMockRegistryIdentityKey {
    param(
        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$Name
    )

    $separatorIndex = $RegistryPath.IndexOf(':\')
    if ($separatorIndex -lt 0) {
        return "$RegistryPath|$Name"
    }

    $hive = $RegistryPath.Substring(0, $separatorIndex).ToUpperInvariant()
    $relativePath = $RegistryPath.Substring($separatorIndex + 2).ToUpperInvariant()
    $valueName = $Name.ToUpperInvariant()

    return "$hive|$relativePath|$valueName"
}

function Initialize-A1CMMockRegistryEntries {
    if ($null -eq $global:MockRegistry) {
        $global:MockRegistry = [PSCustomObject]@{}
    }

    if (-not $global:MockRegistry.PSObject.Properties['__entries']) {
        $global:MockRegistry | Add-Member -NotePropertyName '__entries' -NotePropertyValue ([PSCustomObject]@{})
    }

    return $global:MockRegistry.PSObject.Properties['__entries'].Value
}

function Sync-A1CMMockRegistryLegacyProperty {
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    $entries = Initialize-A1CMMockRegistryEntries
    $matchingEntries = @(
        $entries.PSObject.Properties |
            Where-Object { $_.Name -like "*|$($Name.ToUpperInvariant())" }
    )

    if ($matchingEntries.Count -eq 1) {
        $value = $matchingEntries[0].Value
        if ($global:MockRegistry.PSObject.Properties[$Name]) {
            $global:MockRegistry.PSObject.Properties[$Name].Value = $value
        }
        else {
            $global:MockRegistry | Add-Member -NotePropertyName $Name -NotePropertyValue $value
        }

        return
    }

    if ($matchingEntries.Count -eq 0) {
        [void]$global:MockRegistry.PSObject.Properties.Remove($Name)
    }
}

function Get-A1CMMockRegistryValue {
    param(
        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$Name
    )

    if ($null -eq $global:MockRegistry) {
        return $null
    }

    $entries = Initialize-A1CMMockRegistryEntries
    $identityKey = Get-A1CMMockRegistryIdentityKey -RegistryPath $RegistryPath -Name $Name
    $entryProperty = $entries.PSObject.Properties[$identityKey]
    if ($entryProperty) {
        return $entryProperty.Value
    }

    $matchingEntries = @(
        $entries.PSObject.Properties |
            Where-Object { $_.Name -like "*|$($Name.ToUpperInvariant())" }
    )
    if ($matchingEntries.Count -gt 0) {
        return $null
    }

    $property = $global:MockRegistry.PSObject.Properties[$Name]
    if ($property) {
        return $property.Value
    }

    return $null
}

function Set-A1CMMockRegistryValue {
    param(
        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        $Value
    )

    $entries = Initialize-A1CMMockRegistryEntries
    $identityKey = Get-A1CMMockRegistryIdentityKey -RegistryPath $RegistryPath -Name $Name

    if ($entries.PSObject.Properties[$identityKey]) {
        $entries.PSObject.Properties[$identityKey].Value = $Value
    }
    else {
        $entries | Add-Member -NotePropertyName $identityKey -NotePropertyValue $Value
    }

    Sync-A1CMMockRegistryLegacyProperty -Name $Name
}

function Remove-A1CMMockRegistryValue {
    param(
        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$Name
    )

    if ($null -eq $global:MockRegistry) {
        return
    }

    $entries = Initialize-A1CMMockRegistryEntries
    $identityKey = Get-A1CMMockRegistryIdentityKey -RegistryPath $RegistryPath -Name $Name
    [void]$entries.PSObject.Properties.Remove($identityKey)
    Sync-A1CMMockRegistryLegacyProperty -Name $Name
}

function Get-A1CMMockAuditPolicyValue {
    param(
        [Parameter(Mandatory)]
        [string]$SubcategoryGuid
    )

    if ($null -eq $global:MockAuditPolicy) {
        return $null
    }

    $property = $global:MockAuditPolicy.PSObject.Properties[$SubcategoryGuid]
    if ($property) {
        return $property.Value
    }

    return $null
}

function Set-A1CMMockAuditPolicyValue {
    param(
        [Parameter(Mandatory)]
        [string]$SubcategoryGuid,

        [Parameter(Mandatory)]
        [string]$Value
    )

    if ($null -eq $global:MockAuditPolicy) {
        $global:MockAuditPolicy = [PSCustomObject]@{}
    }

    if ($global:MockAuditPolicy.PSObject.Properties[$SubcategoryGuid]) {
        $global:MockAuditPolicy.PSObject.Properties[$SubcategoryGuid].Value = $Value
    }
    else {
        $global:MockAuditPolicy | Add-Member -NotePropertyName $SubcategoryGuid -NotePropertyValue $Value
    }
}

function Assert-A1CMAuditPolicyValue {
    param(
        [Parameter(Mandatory)]
        [string]$Value
    )

    if ($Value -notin @('none', 'success', 'failure', 'success-and-failure')) {
        throw "Unsupported audit policy value '$Value'."
    }
}

function ConvertFrom-A1CMAuditPolicyInclusionSetting {
    param(
        [Parameter(Mandatory)]
        [string]$Value
    )

    $normalized = ($Value.ToLowerInvariant() -replace '[^a-z]+', '')
    switch ($normalized) {
        'none' { return 'none' }
        'noauditing' { return 'none' }
        'success' { return 'success' }
        'failure' { return 'failure' }
        'successandfailure' { return 'success-and-failure' }
        default {
            throw "Unsupported auditpol inclusion setting '$Value'."
        }
    }
}

function Get-A1CMAuditPolicyValue {
    param(
        [Parameter(Mandatory)]
        [string]$SubcategoryGuid
    )

    Add-A1CMMockOperation -Value "AuditPolicy:Get:$SubcategoryGuid"

    if ($env:A1CM_TEST_AUDITPOL -eq '1') {
        if ($env:A1CM_TEST_AUDITPOL_FAILURE -eq 'get') {
            throw "Mock auditpol get failed for $SubcategoryGuid."
        }

        $value = Get-A1CMMockAuditPolicyValue -SubcategoryGuid $SubcategoryGuid
        if ($null -eq $value) {
            return 'none'
        }

        Assert-A1CMAuditPolicyValue -Value $value
        return $value
    }

    $csv = & auditpol /get "/subcategory:$SubcategoryGuid" /r 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw "auditpol /get failed for $SubcategoryGuid. Run with administrative privileges. Output: $csv"
    }

    $records = $csv | ConvertFrom-Csv
    if ($null -eq $records -or @($records).Count -eq 0) {
        throw "auditpol /get returned no data for $SubcategoryGuid."
    }

    $record = @($records)[0]
    $setting = $record.'Inclusion Setting'
    if ([string]::IsNullOrWhiteSpace($setting)) {
        throw "auditpol /get did not return an Inclusion Setting for $SubcategoryGuid."
    }

    return ConvertFrom-A1CMAuditPolicyInclusionSetting -Value $setting
}

function Set-A1CMAuditPolicyValue {
    param(
        [Parameter(Mandatory)]
        [string]$SubcategoryGuid,

        [Parameter(Mandatory)]
        [string]$Value
    )

    Assert-A1CMAuditPolicyValue -Value $Value
    Add-A1CMMockOperation -Value "AuditPolicy:Set:$SubcategoryGuid"

    if ($env:A1CM_TEST_AUDITPOL -eq '1') {
        if ($env:A1CM_TEST_AUDITPOL_FAILURE -eq 'set') {
            throw "Mock auditpol set failed for $SubcategoryGuid."
        }

        if ($env:A1CM_TEST_AUDITPOL_VERIFICATION_DRIFT -ne '1') {
            Set-A1CMMockAuditPolicyValue -SubcategoryGuid $SubcategoryGuid -Value $Value
        }

        return
    }

    $successSetting = if ($Value -in @('success', 'success-and-failure')) { 'enable' } else { 'disable' }
    $failureSetting = if ($Value -in @('failure', 'success-and-failure')) { 'enable' } else { 'disable' }

    $output = & auditpol /set "/subcategory:$SubcategoryGuid" "/success:$successSetting" "/failure:$failureSetting" 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw "auditpol /set failed for $SubcategoryGuid. Run with administrative privileges. Output: $output"
    }
}

function Invoke-A1CMAuditPolicyControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$SubcategoryGuid,

        [Parameter(Mandatory)]
        [string]$SubcategoryName,

        [Parameter(Mandatory)]
        [string]$DesiredValue
    )

    Assert-A1CMAuditPolicyValue -Value $DesiredValue
    $friendlyName = $Context.ControlName.ToLowerInvariant()

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $value = Get-A1CMAuditPolicyValue -SubcategoryGuid $SubcategoryGuid
            [PSCustomObject]@{
                IsCompliant                         = ($value -eq $DesiredValue)
                CompliantMessage                   = "Configured audit policy already enforces $friendlyName for $SubcategoryName."
                NonCompliantMessage                = "Configured audit policy does not yet enforce $friendlyName for $SubcategoryName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured audit policy now enforces $friendlyName for $SubcategoryName."
                PostRemediationNonCompliantMessage = "Configured audit policy still does not enforce $friendlyName for $SubcategoryName after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMAuditPolicyValue -SubcategoryGuid $SubcategoryGuid -Value $DesiredValue
        }
}

function Get-A1CMMockFirewallProfileValue {
    param(
        [Parameter(Mandatory)]
        [string]$ProfileName,

        [Parameter(Mandatory)]
        [string]$PropertyName
    )

    if ($null -eq $global:MockFirewallProfiles) {
        return $null
    }

    $profile = $global:MockFirewallProfiles.PSObject.Properties[$ProfileName]
    if (-not $profile) {
        return $null
    }

    $property = $profile.Value.PSObject.Properties[$PropertyName]
    if ($property) {
        return $property.Value
    }

    return $null
}

function Set-A1CMMockFirewallProfileValue {
    param(
        [Parameter(Mandatory)]
        [string]$ProfileName,

        [Parameter(Mandatory)]
        [string]$PropertyName,

        [Parameter(Mandatory)]
        $Value
    )

    if ($null -eq $global:MockFirewallProfiles) {
        $global:MockFirewallProfiles = [PSCustomObject]@{}
    }

    $profileProperty = $global:MockFirewallProfiles.PSObject.Properties[$ProfileName]
    if (-not $profileProperty) {
        $global:MockFirewallProfiles | Add-Member -NotePropertyName $ProfileName -NotePropertyValue ([PSCustomObject]@{})
        $profileProperty = $global:MockFirewallProfiles.PSObject.Properties[$ProfileName]
    }

    if ($profileProperty.Value.PSObject.Properties[$PropertyName]) {
        $profileProperty.Value.PSObject.Properties[$PropertyName].Value = $Value
    }
    else {
        $profileProperty.Value | Add-Member -NotePropertyName $PropertyName -NotePropertyValue $Value
    }
}

function Resolve-A1CMFirewallProfileNames {
    param(
        [Parameter(Mandatory)]
        [string]$ProfileSelection
    )

    switch ($ProfileSelection) {
        'Domain' { return @('Domain') }
        'Private' { return @('Private') }
        'Public' { return @('Public') }
        'DomainAndPrivate' { return @('Domain', 'Private') }
        'DomainAndPublic' { return @('Domain', 'Public') }
        'PrivateAndPublic' { return @('Private', 'Public') }
        'AllProfiles' { return @('Domain', 'Private', 'Public') }
        default { throw "Unsupported firewall profile selection $ProfileSelection." }
    }
}

function Get-A1CMFirewallProfileValue {
    param(
        [Parameter(Mandatory)]
        [string]$ProfileName,

        [Parameter(Mandatory)]
        [string]$PropertyName
    )

    Add-A1CMMockOperation -Value "Firewall:Get:${ProfileName}:${PropertyName}"

    if ($env:A1CM_TEST_FIREWALL_FAILURE -eq 'get') {
        throw "Simulated firewall profile read failure for ${ProfileName}:${PropertyName}."
    }

    if ($env:A1CM_TEST_FIREWALL -eq '1') {
        return Get-A1CMMockFirewallProfileValue -ProfileName $ProfileName -PropertyName $PropertyName
    }

    return (Get-NetFirewallProfile -Name $ProfileName).$PropertyName
}

function Set-A1CMFirewallProfileValue {
    param(
        [Parameter(Mandatory)]
        [string[]]$ProfileNames,

        [Parameter(Mandatory)]
        [string]$PropertyName,

        [Parameter(Mandatory)]
        $Value
    )

    foreach ($profileName in $ProfileNames) {
        Add-A1CMMockOperation -Value "Firewall:Set:${profileName}:${PropertyName}"

        if ($env:A1CM_TEST_FIREWALL_FAILURE -eq 'set') {
            throw "Simulated firewall profile write failure for ${profileName}:${PropertyName}."
        }

        if ($env:A1CM_TEST_FIREWALL -eq '1') {
            if ($env:A1CM_TEST_FIREWALL_VERIFICATION_DRIFT -eq '1') {
                continue
            }

            Set-A1CMMockFirewallProfileValue -ProfileName $profileName -PropertyName $PropertyName -Value $Value
            continue
        }

        $nativeValue = if ($PropertyName -in @('Enabled', 'NotifyOnListen', 'AllowLocalFirewallRules', 'AllowLocalIPsecRules', 'LogAllowed', 'LogBlocked')) {
            [Microsoft.PowerShell.Cmdletization.GeneratedTypes.NetSecurity.GpoBoolean]([string]([bool]$Value))
        }
        else {
            $Value
        }
        $arguments = @{
            Name = $profileName
        }
        $arguments[$PropertyName] = $nativeValue
        Set-NetFirewallProfile @arguments
    }
}

function ConvertTo-A1CMFirewallComparableValue {
    param(
        $Value
    )

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [bool]) {
        return [bool]$Value
    }

    return $Value.ToString()
}

function Invoke-A1CMFirewallProfileControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string[]]$ProfileNames,

        [Parameter(Mandatory)]
        [string]$PropertyName,

        [Parameter(Mandatory)]
        $DesiredValue,

        [Parameter(Mandatory)]
        [string]$EffectDescription
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()
    $expectedComparable = ConvertTo-A1CMFirewallComparableValue -Value $DesiredValue

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $profileState = foreach ($profileName in $ProfileNames) {
                $actual = Get-A1CMFirewallProfileValue -ProfileName $profileName -PropertyName $PropertyName
                [PSCustomObject]@{
                    ProfileName = $profileName
                    IsCompliant = ((ConvertTo-A1CMFirewallComparableValue -Value $actual) -eq $expectedComparable)
                }
            }
            $allCompliant = (@($profileState | Where-Object { -not $_.IsCompliant }).Count -eq 0)
            [PSCustomObject]@{
                IsCompliant                         = $allCompliant
                CompliantMessage                   = "Configured firewall profile state already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured firewall profile state does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured firewall profile state now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = "Configured firewall profile state still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMFirewallProfileValue -ProfileNames $ProfileNames -PropertyName $PropertyName -Value $DesiredValue
        }
}

function Assert-A1CMRegistryProviderPath {
    param(
        [Parameter(Mandatory)]
        [string]$RegistryPath
    )

    if ($RegistryPath -notmatch '^[^:]+:\\') {
        throw "Registry path must be provider-qualified and use a Registry PSDrive, for example HKLM:\Software\Policies\... Received: $RegistryPath"
    }

    $driveName = $RegistryPath.Substring(0, $RegistryPath.IndexOf(':'))
    $drive = Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue
    if ($null -eq $drive -or $drive.Provider.Name -ne 'Registry') {
        throw "Registry path must use a Registry provider PSDrive. Received: $RegistryPath"
    }
}

function Get-A1CMRegistryValue {
    param(
        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$ValueName
    )

    Add-A1CMMockOperation -Value "Get:$ValueName"

    if ($env:A1CM_TEST_REGISTRY -eq '1') {
        return Get-A1CMMockRegistryValue -RegistryPath $RegistryPath -Name $ValueName
    }

    Assert-A1CMRegistryProviderPath -RegistryPath $RegistryPath

    if (-not (Test-Path -LiteralPath $RegistryPath)) {
        return $null
    }

    $item = Get-ItemProperty -LiteralPath $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue
    if ($null -eq $item) {
        return $null
    }

    return $item.$ValueName
}

function Set-A1CMDwordRegistryValue {
    param(
        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$ValueName,

        [Parameter(Mandatory)]
        [int]$Value
    )

    Add-A1CMMockOperation -Value "Set:$ValueName"

    if ($env:A1CM_TEST_REGISTRY -eq '1') {
        if ($env:A1CM_TEST_REGISTRY_FAILURE -eq 'set') {
            throw "Simulated registry set failure for $ValueName"
        }

        if ($env:A1CM_TEST_REGISTRY_VERIFICATION_DRIFT -eq '1') {
            return
        }

        Set-A1CMMockRegistryValue -RegistryPath $RegistryPath -Name $ValueName -Value $Value
        if ($env:A1CM_TEST_DEFENDER_REGISTRY_EFFECTIVE_SYNC -eq '1' -and $ValueName -in @('DisableIOAVProtection', 'DisableScriptScanning')) {
            Set-A1CMMockDefenderPreferenceValue -PreferenceName $ValueName -Value ($Value -eq 1)
        }
        return
    }

    Assert-A1CMRegistryProviderPath -RegistryPath $RegistryPath

    if (-not (Test-Path -LiteralPath $RegistryPath)) {
        [void](New-Item -Path $RegistryPath -Force -ErrorAction Stop)
    }

    [void](New-ItemProperty -LiteralPath $RegistryPath -Name $ValueName -Value $Value -PropertyType DWord -Force -ErrorAction Stop)
}

function Set-A1CMStringRegistryValue {
    param(
        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$ValueName,

        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Value
    )

    Add-A1CMMockOperation -Value "Set:$ValueName"

    if ($env:A1CM_TEST_REGISTRY -eq '1') {
        if ($env:A1CM_TEST_REGISTRY_FAILURE -eq 'set') {
            throw "Simulated registry set failure for $ValueName"
        }

        if ($env:A1CM_TEST_REGISTRY_VERIFICATION_DRIFT -eq '1') {
            return
        }

        Set-A1CMMockRegistryValue -RegistryPath $RegistryPath -Name $ValueName -Value $Value
        return
    }

    Assert-A1CMRegistryProviderPath -RegistryPath $RegistryPath

    if (-not (Test-Path -LiteralPath $RegistryPath)) {
        [void](New-Item -Path $RegistryPath -Force -ErrorAction Stop)
    }

    [void](New-ItemProperty -LiteralPath $RegistryPath -Name $ValueName -Value $Value -PropertyType String -Force -ErrorAction Stop)
}

function Get-A1CMRegistryPolicyValue {
    param(
        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$ValueName
    )

    Get-A1CMRegistryValue -RegistryPath $RegistryPath -ValueName $ValueName
}

function Set-A1CMRegistryPolicyValue {
    param(
        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$ValueName,

        [Parameter(Mandatory)]
        [int]$Value
    )

    Set-A1CMDwordRegistryValue -RegistryPath $RegistryPath -ValueName $ValueName -Value $Value
}

function Remove-A1CMRegistryPolicyValue {
    param(
        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$ValueName
    )

    Add-A1CMMockOperation -Value "Remove:$ValueName"

    if ($env:A1CM_TEST_REGISTRY -eq '1') {
        Remove-A1CMMockRegistryValue -RegistryPath $RegistryPath -Name $ValueName
        return
    }

    Assert-A1CMRegistryProviderPath -RegistryPath $RegistryPath

    if (-not (Test-Path -LiteralPath $RegistryPath)) {
        return
    }

    Remove-ItemProperty -LiteralPath $RegistryPath -Name $ValueName -ErrorAction SilentlyContinue
}

function Invoke-A1CMAutoPlayDwordPolicyControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$RegistryValueName,

        [AllowNull()]
        [Nullable[int]]$DesiredValue,

        [Parameter(Mandatory)]
        [bool]$RemoveValue,

        [Parameter(Mandatory)]
        [string]$DesiredStateDescription
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()
    $effectDescription = 'Windows may require policy refresh or a Windows Explorer restart before the configured behavior is fully reflected.'

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $value = Get-A1CMRegistryPolicyValue -RegistryPath $RegistryPath -ValueName $RegistryValueName
            $isCompliant = if ($RemoveValue) {
                $null -eq $value
            }
            else {
                $value -eq $DesiredValue
            }

            [PSCustomObject]@{
                IsCompliant                         = $isCompliant
                CompliantMessage                   = "Configured AutoPlay policy already enforces $friendlyName as $DesiredStateDescription. $effectDescription"
                NonCompliantMessage                = "Configured AutoPlay policy does not yet enforce $friendlyName as $DesiredStateDescription. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured AutoPlay policy now enforces $friendlyName as $DesiredStateDescription. $effectDescription"
                PostRemediationNonCompliantMessage = "Configured AutoPlay policy still does not enforce $friendlyName as $DesiredStateDescription after one remediation attempt."
            }
        } `
        -Remediate {
            if ($RemoveValue) {
                Remove-A1CMRegistryPolicyValue -RegistryPath $RegistryPath -ValueName $RegistryValueName
                return
            }

            Set-A1CMRegistryPolicyValue -RegistryPath $RegistryPath -ValueName $RegistryValueName -Value $DesiredValue
        }
}

function Invoke-A1CMPrivacyDwordPolicyControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$RegistryValueName,

        [Parameter(Mandatory)]
        [int]$DesiredValue,

        [Parameter(Mandatory)]
        [string]$EffectDescription
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $value = Get-A1CMRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName
            [PSCustomObject]@{
                IsCompliant                         = ($value -eq $DesiredValue)
                CompliantMessage                   = "Configured privacy policy already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured privacy policy does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured privacy policy now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = "Configured privacy policy still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMDwordRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName -Value $DesiredValue
        }
}

function Invoke-A1CMRemoteDesktopDwordPolicyControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$RegistryValueName,

        [Parameter(Mandatory)]
        [int]$DesiredValue,

        [Parameter(Mandatory)]
        [string]$EffectDescription
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $value = Get-A1CMRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName
            [PSCustomObject]@{
                IsCompliant                         = ($value -eq $DesiredValue)
                CompliantMessage                   = "Configured Remote Desktop policy already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured Remote Desktop policy does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured Remote Desktop policy now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = "Configured Remote Desktop policy still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMDwordRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName -Value $DesiredValue
        }
}

function Get-A1CMMockSecurityPolicyValue {
    param(
        [Parameter(Mandatory)]
        [string]$Key
    )

    if ($null -eq $global:MockSecurityPolicy) {
        return $null
    }

    $property = $global:MockSecurityPolicy.PSObject.Properties[$Key]
    if ($property) {
        return $property.Value
    }

    return $null
}

function Get-A1CMMockSecurityTemplateValue {
    param(
        [Parameter(Mandatory)]
        [string]$Key
    )

    if ($null -eq $global:MockSecurityPolicy) {
        return $null
    }

    $property = $global:MockSecurityPolicy.PSObject.Properties[$Key]
    if ($property) {
        return [string]$property.Value
    }

    return $null
}

function Set-A1CMMockSecurityPolicyValue {
    param(
        [Parameter(Mandatory)]
        [string]$Key,

        [Parameter(Mandatory)]
        [int]$Value
    )

    if ($null -eq $global:MockSecurityPolicy) {
        $global:MockSecurityPolicy = [PSCustomObject]@{}
    }

    if ($global:MockSecurityPolicy.PSObject.Properties[$Key]) {
        $global:MockSecurityPolicy.PSObject.Properties[$Key].Value = $Value
    }
    else {
        $global:MockSecurityPolicy | Add-Member -NotePropertyName $Key -NotePropertyValue $Value
    }
}

function Set-A1CMMockSecurityTemplateValue {
    param(
        [Parameter(Mandatory)]
        [string]$Key,

        [Parameter(Mandatory)]
        [string]$Value
    )

    if ($null -eq $global:MockSecurityPolicy) {
        $global:MockSecurityPolicy = [PSCustomObject]@{}
    }

    if ($global:MockSecurityPolicy.PSObject.Properties[$Key]) {
        $global:MockSecurityPolicy.PSObject.Properties[$Key].Value = $Value
    }
    else {
        $global:MockSecurityPolicy | Add-Member -NotePropertyName $Key -NotePropertyValue $Value
    }
}

function Get-A1CMSecurityPolicySnapshot {
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("a1cm-security-policy-" + [Guid]::NewGuid().ToString('N'))
    $cfgPath = Join-Path $tempRoot 'export.inf'

    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

    try {
        & secedit /export /cfg $cfgPath /areas securitypolicy | Out-Null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $cfgPath)) {
            throw 'secedit /export failed. Run with administrative privileges.'
        }

        $snapshot = @{}
        $inSystemAccess = $false

        foreach ($line in Get-Content -LiteralPath $cfgPath) {
            $trimmed = $line.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith(';')) {
                continue
            }

            if ($trimmed -match '^\[(.+)\]$') {
                $inSystemAccess = ($matches[1] -eq 'System Access')
                continue
            }

            if (-not $inSystemAccess) {
                continue
            }

            if ($trimmed -match '^(?<key>[^=]+?)\s*=\s*(?<value>-?\d+)\s*$') {
                $snapshot[$matches.key.Trim()] = [int]$matches.value
            }
        }

        return $snapshot
    }
    finally {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Get-A1CMSecurityTemplateValue {
    param(
        [Parameter(Mandatory)]
        [string]$Section,

        [Parameter(Mandatory)]
        [string]$PolicyKey
    )

    Add-A1CMMockOperation -Value "SecurityTemplate:Get:${Section}:$PolicyKey"

    if ($env:A1CM_TEST_SECURITY_POLICY -eq '1') {
        return Get-A1CMMockSecurityTemplateValue -Key $PolicyKey
    }

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("a1cm-security-policy-" + [Guid]::NewGuid().ToString('N'))
    $cfgPath = Join-Path $tempRoot 'export.inf'

    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

    try {
        & secedit /export /cfg $cfgPath /areas securitypolicy | Out-Null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $cfgPath)) {
            throw 'secedit /export failed. Run with administrative privileges.'
        }

        $inTargetSection = $false

        foreach ($line in Get-Content -LiteralPath $cfgPath) {
            $trimmed = $line.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith(';')) {
                continue
            }

            if ($trimmed -match '^\[(.+)\]$') {
                $inTargetSection = ($matches[1] -eq $Section)
                continue
            }

            if (-not $inTargetSection) {
                continue
            }

            if ($trimmed -match '^(?<key>[^=]+?)\s*=\s*(?<value>.+?)\s*$' -and $matches.key.Trim() -eq $PolicyKey) {
                return $matches.value.Trim()
            }
        }

        return $null
    }
    finally {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Get-A1CMSecurityPolicyValue {
    param(
        [Parameter(Mandatory)]
        [string]$PolicyKey
    )

    Add-A1CMMockOperation -Value "SecurityPolicy:Get:$PolicyKey"

    if ($env:A1CM_TEST_SECURITY_POLICY -eq '1') {
        return Get-A1CMMockSecurityPolicyValue -Key $PolicyKey
    }

    $snapshot = Get-A1CMSecurityPolicySnapshot
    if ($snapshot.ContainsKey($PolicyKey)) {
        return $snapshot[$PolicyKey]
    }

    return $null
}

function Set-A1CMSecurityTemplateValue {
    param(
        [Parameter(Mandatory)]
        [string]$Section,

        [Parameter(Mandatory)]
        [string]$PolicyKey,

        [Parameter(Mandatory)]
        [string]$ValueData
    )

    Add-A1CMMockOperation -Value "SecurityTemplate:Set:${Section}:$PolicyKey"

    if ($env:A1CM_TEST_SECURITY_POLICY -eq '1') {
        Set-A1CMMockSecurityTemplateValue -Key $PolicyKey -Value $ValueData
        return
    }

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("a1cm-security-policy-" + [Guid]::NewGuid().ToString('N'))
    $cfgPath = Join-Path $tempRoot 'apply.inf'
    $dbPath = Join-Path $tempRoot 'apply.sdb'
    $logPath = Join-Path $tempRoot 'secedit.log'
    $content = @"
[Unicode]
Unicode=yes
[Version]
signature=`"`$CHICAGO`$`"
Revision=1
[$Section]
$PolicyKey=$ValueData
"@

    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

    try {
        Set-Content -LiteralPath $cfgPath -Value $content -Encoding Unicode
        $nativeOutput = (& secedit /configure /db $dbPath /cfg $cfgPath /areas securitypolicy /log $logPath /quiet 2>&1 | Out-String).Trim()
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            $logOutput = if (Test-Path -LiteralPath $logPath) { (Get-Content -LiteralPath $logPath -Raw).Trim() } else { '' }
            throw "secedit /configure failed for [$Section] $PolicyKey with exit code $exitCode. Native output: $nativeOutput. Secedit log: $logOutput"
        }
    }
    finally {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Set-A1CMSecurityPolicyValue {
    param(
        [Parameter(Mandatory)]
        [string]$PolicyKey,

        [Parameter(Mandatory)]
        [int]$Value
    )

    Add-A1CMMockOperation -Value "SecurityPolicy:Set:$PolicyKey"

    if ($env:A1CM_TEST_SECURITY_POLICY -eq '1') {
        Set-A1CMMockSecurityPolicyValue -Key $PolicyKey -Value $Value
        return
    }

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("a1cm-security-policy-" + [Guid]::NewGuid().ToString('N'))
    $cfgPath = Join-Path $tempRoot 'apply.inf'
    $dbPath = Join-Path $tempRoot 'apply.sdb'
    $logPath = Join-Path $tempRoot 'secedit.log'
    $content = @"
[Unicode]
Unicode=yes
[Version]
signature=`"`$CHICAGO`$`"
Revision=1
[System Access]
$PolicyKey = $Value
"@

    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

    try {
        Set-Content -LiteralPath $cfgPath -Value $content -Encoding Unicode
        $nativeOutput = (& secedit /configure /db $dbPath /cfg $cfgPath /areas securitypolicy /log $logPath /quiet 2>&1 | Out-String).Trim()
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            $logOutput = if (Test-Path -LiteralPath $logPath) { (Get-Content -LiteralPath $logPath -Raw).Trim() } else { '' }
            throw "secedit /configure failed for $PolicyKey with exit code $exitCode. Native output: $nativeOutput. Secedit log: $logOutput"
        }
    }
    finally {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-A1CMSecurityPolicyControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$PolicyKey,

        [Parameter(Mandatory)]
        [int]$DesiredValue,

        [Parameter(Mandatory)]
        [string]$PolicyAreaDescription,

        [Parameter(Mandatory)]
        [string]$EffectDescription
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $value = Get-A1CMSecurityPolicyValue -PolicyKey $PolicyKey
            [PSCustomObject]@{
                IsCompliant                         = ($value -eq $DesiredValue)
                CompliantMessage                   = "Configured $PolicyAreaDescription already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured $PolicyAreaDescription does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured $PolicyAreaDescription now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = "Configured $PolicyAreaDescription still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMSecurityPolicyValue -PolicyKey $PolicyKey -Value $DesiredValue
        }
}

function Invoke-A1CMSecurityTemplateRegistryValueControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$PolicyKey,

        [Parameter(Mandatory)]
        [string]$DesiredValueData,

        [Parameter(Mandatory)]
        [string]$PolicyAreaDescription,

        [Parameter(Mandatory)]
        [string]$EffectDescription
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $value = Get-A1CMSecurityTemplateValue -Section 'Registry Values' -PolicyKey $PolicyKey
            [PSCustomObject]@{
                IsCompliant                         = ($value -eq $DesiredValueData)
                CompliantMessage                   = "Configured $PolicyAreaDescription already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured $PolicyAreaDescription does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured $PolicyAreaDescription now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = "Configured $PolicyAreaDescription still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMSecurityTemplateValue -Section 'Registry Values' -PolicyKey $PolicyKey -ValueData $DesiredValueData
        }
}

function Get-A1CMMockSmbClientConfigurationValue {
    param(
        [Parameter(Mandatory)]
        [string]$PropertyName
    )

    if ($null -eq $global:MockSmbClientConfiguration) {
        return $null
    }

    $property = $global:MockSmbClientConfiguration.PSObject.Properties[$PropertyName]
    if ($property) {
        return $property.Value
    }

    return $null
}

function Set-A1CMMockSmbClientConfigurationValue {
    param(
        [Parameter(Mandatory)]
        [string]$PropertyName,

        [Parameter(Mandatory)]
        $Value
    )

    if ($null -eq $global:MockSmbClientConfiguration) {
        $global:MockSmbClientConfiguration = [PSCustomObject]@{}
    }

    if ($global:MockSmbClientConfiguration.PSObject.Properties[$PropertyName]) {
        $global:MockSmbClientConfiguration.PSObject.Properties[$PropertyName].Value = $Value
    }
    else {
        $global:MockSmbClientConfiguration | Add-Member -NotePropertyName $PropertyName -NotePropertyValue $Value
    }
}

function Get-A1CMMockSmbServerConfigurationValue {
    param(
        [Parameter(Mandatory)]
        [string]$PropertyName
    )

    if ($null -eq $global:MockSmbServerConfiguration) {
        return $null
    }

    $property = $global:MockSmbServerConfiguration.PSObject.Properties[$PropertyName]
    if ($property) {
        return $property.Value
    }

    return $null
}

function Set-A1CMMockSmbServerConfigurationValue {
    param(
        [Parameter(Mandatory)]
        [string]$PropertyName,

        [Parameter(Mandatory)]
        $Value
    )

    if ($null -eq $global:MockSmbServerConfiguration) {
        $global:MockSmbServerConfiguration = [PSCustomObject]@{}
    }

    if ($global:MockSmbServerConfiguration.PSObject.Properties[$PropertyName]) {
        $global:MockSmbServerConfiguration.PSObject.Properties[$PropertyName].Value = $Value
    }
    else {
        $global:MockSmbServerConfiguration | Add-Member -NotePropertyName $PropertyName -NotePropertyValue $Value
    }
}

function Get-A1CMSmbClientConfigurationValue {
    param(
        [Parameter(Mandatory)]
        [string]$PropertyName
    )

    Add-A1CMMockOperation -Value "SmbClient:Get:${PropertyName}"

    if ($env:A1CM_TEST_SMB -eq '1') {
        return Get-A1CMMockSmbClientConfigurationValue -PropertyName $PropertyName
    }

    return (Get-SmbClientConfiguration).$PropertyName
}

function Set-A1CMSmbClientConfigurationValue {
    param(
        [Parameter(Mandatory)]
        [string]$PropertyName,

        [Parameter(Mandatory)]
        $Value
    )

    Add-A1CMMockOperation -Value "SmbClient:Set:${PropertyName}"

    if ($env:A1CM_TEST_SMB -eq '1') {
        Set-A1CMMockSmbClientConfigurationValue -PropertyName $PropertyName -Value $Value
        return
    }

    $arguments = @{
        Confirm = $false
    }
    $arguments[$PropertyName] = $Value
    Set-SmbClientConfiguration @arguments
}

function Get-A1CMSmbServerConfigurationValue {
    param(
        [Parameter(Mandatory)]
        [string]$PropertyName
    )

    Add-A1CMMockOperation -Value "SmbServer:Get:${PropertyName}"

    if ($env:A1CM_TEST_SMB -eq '1') {
        return Get-A1CMMockSmbServerConfigurationValue -PropertyName $PropertyName
    }

    return (Get-SmbServerConfiguration).$PropertyName
}

function Set-A1CMSmbServerConfigurationValue {
    param(
        [Parameter(Mandatory)]
        [string]$PropertyName,

        [Parameter(Mandatory)]
        $Value
    )

    Add-A1CMMockOperation -Value "SmbServer:Set:${PropertyName}"

    if ($env:A1CM_TEST_SMB -eq '1') {
        Set-A1CMMockSmbServerConfigurationValue -PropertyName $PropertyName -Value $Value
        return
    }

    $arguments = @{
        Confirm = $false
    }
    $arguments[$PropertyName] = $Value
    Set-SmbServerConfiguration @arguments
}

function ConvertTo-A1CMSmbComparableValue {
    param(
        $Value
    )

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [bool]) {
        return [bool]$Value
    }

    if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int32] -or $Value -is [int64] -or $Value -is [uint32]) {
        return [int]$Value
    }

    return $Value.ToString()
}

function Invoke-A1CMSmbClientConfigurationControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$PropertyName,

        [Parameter(Mandatory)]
        $DesiredValue,

        [Parameter(Mandatory)]
        [string]$EffectDescription
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()
    $expectedComparable = ConvertTo-A1CMSmbComparableValue -Value $DesiredValue

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $actual = Get-A1CMSmbClientConfigurationValue -PropertyName $PropertyName
            $actualComparable = ConvertTo-A1CMSmbComparableValue -Value $actual
            [PSCustomObject]@{
                IsCompliant                         = ($actualComparable -eq $expectedComparable)
                CompliantMessage                   = "Configured SMB client state already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured SMB client state does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured SMB client state now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = "Configured SMB client state still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMSmbClientConfigurationValue -PropertyName $PropertyName -Value $DesiredValue
        }
}

function Invoke-A1CMSmbServerConfigurationControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$PropertyName,

        [Parameter(Mandatory)]
        $DesiredValue,

        [Parameter(Mandatory)]
        [string]$EffectDescription
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()
    $expectedComparable = ConvertTo-A1CMSmbComparableValue -Value $DesiredValue

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $actual = Get-A1CMSmbServerConfigurationValue -PropertyName $PropertyName
            $actualComparable = ConvertTo-A1CMSmbComparableValue -Value $actual
            [PSCustomObject]@{
                IsCompliant                         = ($actualComparable -eq $expectedComparable)
                CompliantMessage                   = "Configured SMB server state already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured SMB server state does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured SMB server state now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = "Configured SMB server state still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMSmbServerConfigurationValue -PropertyName $PropertyName -Value $DesiredValue
        }
}

function Get-A1CMMockDefenderPreferenceValue {
    param(
        [Parameter(Mandatory)]
        [string]$PreferenceName
    )

    if ($null -eq $global:MockDefenderPreference) {
        return $null
    }

    $property = $global:MockDefenderPreference.PSObject.Properties[$PreferenceName]
    if ($property) {
        return $property.Value
    }

    return $null
}

function Set-A1CMMockDefenderPreferenceValue {
    param(
        [Parameter(Mandatory)]
        [string]$PreferenceName,

        [Parameter(Mandatory)]
        $Value
    )

    if ($null -eq $global:MockDefenderPreference) {
        $global:MockDefenderPreference = [PSCustomObject]@{}
    }

    $normalizedValue = if ($Value -is [DateTime]) { $Value.ToString('HH:mm') } else { $Value }

    if ($global:MockDefenderPreference.PSObject.Properties[$PreferenceName]) {
        $global:MockDefenderPreference.PSObject.Properties[$PreferenceName].Value = $normalizedValue
    }
    else {
        $global:MockDefenderPreference | Add-Member -NotePropertyName $PreferenceName -NotePropertyValue $normalizedValue
    }
}

function Get-A1CMDefenderPreferenceValue {
    param(
        [Parameter(Mandatory)]
        [string]$PreferenceName
    )

    Add-A1CMMockOperation -Value "Defender:Get:$PreferenceName"

    if ($env:A1CM_TEST_DEFENDER -eq '1') {
        return Get-A1CMMockDefenderPreferenceValue -PreferenceName $PreferenceName
    }

    return (Get-MpPreference).$PreferenceName
}

function Set-A1CMDefenderPreferenceValue {
    param(
        [Parameter(Mandatory)]
        [string]$PreferenceName,

        [Parameter(Mandatory)]
        $Value,

        [switch]$StopOnError
    )

    Add-A1CMMockOperation -Value "Defender:Set:$PreferenceName"

    if ($env:A1CM_TEST_DEFENDER -eq '1') {
        if ($env:A1CM_TEST_DEFENDER_SET_MODE -eq 'error') {
            throw 'Simulated Set-MpPreference failure.'
        }
        if ($env:A1CM_TEST_DEFENDER_SET_MODE -eq 'unchanged') {
            return
        }
        Set-A1CMMockDefenderPreferenceValue -PreferenceName $PreferenceName -Value $Value
        return
    }

    $arguments = @{}
    $arguments[$PreferenceName] = $Value
    if ($StopOnError) { $arguments.ErrorAction = 'Stop' }
    Set-MpPreference @arguments
}

function Get-A1CMDefenderPostRemediationMismatchMessage {
    param(
        [Parameter(Mandatory)]
        [bool]$TamperProtectionEnabled,

        [string]$OperationError
    )

    $message = 'The effective Defender setting still does not match the configured desired state after local remediation.'
    if (-not [string]::IsNullOrWhiteSpace($OperationError)) {
        return "$message Operation error: $OperationError"
    }
    if ($TamperProtectionEnabled) {
        return "$message Microsoft Defender Tamper Protection is enabled and may prevent local changes."
    }
    return $message
}

function ConvertTo-A1CMDefenderAsrRuleId {
    param(
        [Parameter(Mandatory)]
        [string]$RuleId
    )

    return $RuleId.Trim().ToLowerInvariant()
}

function Get-A1CMDefenderAsrRuleArrays {
    $idsValue = Get-A1CMMockDefenderPreferenceValue -PreferenceName 'AttackSurfaceReductionRules_Ids'
    $actionsValue = Get-A1CMMockDefenderPreferenceValue -PreferenceName 'AttackSurfaceReductionRules_Actions'
    $ids = if ($null -eq $idsValue) { @() } else { @($idsValue) }
    $actions = if ($null -eq $actionsValue) { @() } else { @($actionsValue) }

    return [PSCustomObject]@{
        Ids     = $ids
        Actions = $actions
    }
}

function Set-A1CMDefenderAsrRuleArrays {
    param(
        [Parameter(Mandatory)]
        [System.Collections.IEnumerable]$Ids,

        [Parameter(Mandatory)]
        [System.Collections.IEnumerable]$Actions
    )

    Set-A1CMMockDefenderPreferenceValue -PreferenceName 'AttackSurfaceReductionRules_Ids' -Value @($Ids)
    Set-A1CMMockDefenderPreferenceValue -PreferenceName 'AttackSurfaceReductionRules_Actions' -Value @($Actions)
}

function Get-A1CMDefenderAsrRuleMap {
    Add-A1CMMockOperation -Value 'Defender:ASR:Get'

    if ($env:A1CM_TEST_DEFENDER_FAILURE -eq 'get') {
        throw 'Simulated Defender ASR get failure.'
    }

    if ($env:A1CM_TEST_DEFENDER -eq '1') {
        $arrays = Get-A1CMDefenderAsrRuleArrays
        $ruleMap = [ordered]@{}
        $count = [Math]::Min($arrays.Ids.Count, $arrays.Actions.Count)

        for ($index = 0; $index -lt $count; $index++) {
            $rawRuleId = [string]$arrays.Ids[$index]
            if ([string]::IsNullOrWhiteSpace($rawRuleId)) {
                continue
            }
            $ruleId = ConvertTo-A1CMDefenderAsrRuleId -RuleId $rawRuleId

            $ruleMap[$ruleId] = [int]$arrays.Actions[$index]
        }

        if ($env:A1CM_TEST_DEFENDER_VERIFICATION_DRIFT -eq '1' -and $global:A1CMDefenderAsrRemediated) {
            return [ordered]@{}
        }

        return $ruleMap
    }

    $preferences = Get-MpPreference
    $ids = @($preferences.AttackSurfaceReductionRules_Ids)
    $actions = @($preferences.AttackSurfaceReductionRules_Actions)
    $ruleMap = [ordered]@{}
    $count = [Math]::Min($ids.Count, $actions.Count)

    for ($index = 0; $index -lt $count; $index++) {
        $rawRuleId = [string]$ids[$index]
        if ([string]::IsNullOrWhiteSpace($rawRuleId)) {
            continue
        }
        $ruleId = ConvertTo-A1CMDefenderAsrRuleId -RuleId $rawRuleId

        $ruleMap[$ruleId] = [int]$actions[$index]
    }

    return $ruleMap
}

function Assert-A1CMDefenderAsrAction {
    param(
        [Parameter(Mandatory)]
        [int]$Action
    )

    if ($Action -notin @(0, 1, 2, 5, 6)) {
        throw "Unsupported Defender ASR action value: $Action"
    }
}

function Add-A1CMDefenderAsrRuleAction {
    param(
        [Parameter(Mandatory)]
        [string]$RuleId,

        [Parameter(Mandatory)]
        [int]$Action
    )

    $normalizedRuleId = ConvertTo-A1CMDefenderAsrRuleId -RuleId $RuleId
    Assert-A1CMDefenderAsrAction -Action $Action
    Add-A1CMMockOperation -Value "Defender:ASR:Add:$normalizedRuleId=$Action"

    if ($env:A1CM_TEST_DEFENDER_FAILURE -eq 'add') {
        throw 'Simulated Defender ASR add failure.'
    }

    if ($env:A1CM_TEST_DEFENDER -eq '1') {
        $arrays = Get-A1CMDefenderAsrRuleArrays
        $ids = [System.Collections.ArrayList]::new()
        $actions = [System.Collections.ArrayList]::new()

        foreach ($id in @($arrays.Ids)) {
            [void]$ids.Add([string]$id)
        }

        foreach ($existingAction in @($arrays.Actions)) {
            [void]$actions.Add([int]$existingAction)
        }

        $updated = $false
        for ($index = 0; $index -lt $ids.Count; $index++) {
            $rawRuleId = [string]$ids[$index]
            if ([string]::IsNullOrWhiteSpace($rawRuleId)) { continue }
            if ((ConvertTo-A1CMDefenderAsrRuleId -RuleId $rawRuleId) -eq $normalizedRuleId) {
                $actions[$index] = $Action
                $updated = $true
                break
            }
        }

        if (-not $updated) {
            [void]$ids.Add($normalizedRuleId)
            [void]$actions.Add($Action)
        }

        Set-A1CMDefenderAsrRuleArrays -Ids $ids -Actions $actions
        $global:A1CMDefenderAsrRemediated = $true
        return
    }

    Add-MpPreference -AttackSurfaceReductionRules_Ids $normalizedRuleId -AttackSurfaceReductionRules_Actions $Action
}

function Remove-A1CMDefenderAsrRuleAction {
    param(
        [Parameter(Mandatory)]
        [string]$RuleId,

        [Parameter(Mandatory)]
        [int]$Action
    )

    $normalizedRuleId = ConvertTo-A1CMDefenderAsrRuleId -RuleId $RuleId
    Assert-A1CMDefenderAsrAction -Action $Action
    Add-A1CMMockOperation -Value "Defender:ASR:Remove:$normalizedRuleId=$Action"

    if ($env:A1CM_TEST_DEFENDER_FAILURE -eq 'remove') {
        throw 'Simulated Defender ASR remove failure.'
    }

    if ($env:A1CM_TEST_DEFENDER -eq '1') {
        $arrays = Get-A1CMDefenderAsrRuleArrays
        $ids = [System.Collections.ArrayList]::new()
        $actions = [System.Collections.ArrayList]::new()
        $removed = $false
        $count = [Math]::Min($arrays.Ids.Count, $arrays.Actions.Count)

        for ($index = 0; $index -lt $count; $index++) {
            $rawRuleId = [string]$arrays.Ids[$index]
            if ([string]::IsNullOrWhiteSpace($rawRuleId)) { continue }
            $currentRuleId = ConvertTo-A1CMDefenderAsrRuleId -RuleId $rawRuleId
            $currentAction = [int]$arrays.Actions[$index]
            if (-not $removed -and $currentRuleId -eq $normalizedRuleId -and $currentAction -eq $Action) {
                $removed = $true
                continue
            }

            [void]$ids.Add([string]$arrays.Ids[$index])
            [void]$actions.Add($currentAction)
        }

        Set-A1CMDefenderAsrRuleArrays -Ids $ids -Actions $actions
        $global:A1CMDefenderAsrRemediated = $true
        return
    }

    Remove-MpPreference -AttackSurfaceReductionRules_Ids $normalizedRuleId -AttackSurfaceReductionRules_Actions $Action
}

function ConvertTo-A1CMDefenderComparableValue {
    param(
        $Value
    )

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [bool]) {
        return [bool]$Value
    }

    if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int32] -or $Value -is [int64] -or $Value -is [uint32]) {
        return [int]$Value
    }

    return $Value.ToString()
}

function Invoke-A1CMDefenderAsrPolicyControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [array]$DesiredRules,

        [Parameter(Mandatory)]
        [string]$EffectDescription
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()
    $normalizedDesiredRules = @($DesiredRules | ForEach-Object {
        $normalizedRuleId = ConvertTo-A1CMDefenderAsrRuleId -RuleId ([string]$_.RuleId)
        $action = [int]$_.Action
        Assert-A1CMDefenderAsrAction -Action $action
        [PSCustomObject]@{
            RuleId = $normalizedRuleId
            Action = $action
        }
    })

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $currentRules = Get-A1CMDefenderAsrRuleMap
            $isCompliant = $true

            foreach ($desiredRule in $normalizedDesiredRules) {
                if ($desiredRule.Action -eq 5) {
                    if ($currentRules.Contains($desiredRule.RuleId)) {
                        $isCompliant = $false
                        break
                    }

                    continue
                }

                if (-not $currentRules.Contains($desiredRule.RuleId) -or [int]$currentRules[$desiredRule.RuleId] -ne $desiredRule.Action) {
                    $isCompliant = $false
                    break
                }
            }

            [PSCustomObject]@{
                IsCompliant                         = $isCompliant
                CompliantMessage                   = "Configured Defender ASR policy already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured Defender ASR policy does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured Defender ASR policy now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = "Configured Defender ASR policy still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            $currentRules = Get-A1CMDefenderAsrRuleMap

            foreach ($desiredRule in $normalizedDesiredRules) {
                if ($desiredRule.Action -eq 5) {
                    if ($currentRules.Contains($desiredRule.RuleId)) {
                        Remove-A1CMDefenderAsrRuleAction -RuleId $desiredRule.RuleId -Action ([int]$currentRules[$desiredRule.RuleId])
                    }

                    continue
                }

                if ($currentRules.Contains($desiredRule.RuleId)) {
                    $currentAction = [int]$currentRules[$desiredRule.RuleId]
                    if ($currentAction -eq $desiredRule.Action) {
                        continue
                    }

                    Remove-A1CMDefenderAsrRuleAction -RuleId $desiredRule.RuleId -Action $currentAction
                }

                Add-A1CMDefenderAsrRuleAction -RuleId $desiredRule.RuleId -Action $desiredRule.Action
            }
        }
}

function ConvertTo-A1CMDefenderTimeString {
    param(
        $Value
    )

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [DateTime]) {
        return $Value.ToString('HH:mm')
    }

    if ($Value -is [TimeSpan]) {
        return $Value.ToString('hh\:mm')
    }

    $text = $Value.ToString()
    if ($text -match '^\d{1,2}:\d{2}$') {
        return $text
    }

    return ([DateTime]$Value).ToString('HH:mm')
}

function Invoke-A1CMDefenderDirectPreferenceControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$PreferenceName,

        [Parameter(Mandatory)]
        $DesiredValue,

        $ExpectedValue = $null,

        [Parameter(Mandatory)]
        [string]$EffectDescription,

        [switch]$AttemptWhenTamperProtected
    )

    $global:A1CMDefenderRemediationError = $null
    $friendlyName = $Context.ControlName.ToLowerInvariant()
    $comparisonValue = if ($null -ne $ExpectedValue) { $ExpectedValue } else { $DesiredValue }
    $expectedComparable = ConvertTo-A1CMDefenderComparableValue -Value $comparisonValue

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $actual = Get-A1CMDefenderPreferenceValue -PreferenceName $PreferenceName
            $actualComparable = ConvertTo-A1CMDefenderComparableValue -Value $actual
            $isCompliant = ($actualComparable -eq $expectedComparable)
            $tamper = $false
            try {
                if ($env:A1CM_TEST_MODE -eq '1') {
                    $tamper = [bool]$global:MockDefenderStatus.IsTamperProtected
                }
                else {
                    $tamper = [bool](Get-MpComputerStatus).IsTamperProtected
                }
            }
            catch { $tamper = $false }
            [PSCustomObject]@{
                IsCompliant                         = $isCompliant
                CompliantMessage                   = "Configured Defender preference already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured Defender preference does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured Defender preference now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = if ($global:A1CMDefenderRemediationError -or $tamper) { Get-A1CMDefenderPostRemediationMismatchMessage -TamperProtectionEnabled:$tamper -OperationError $global:A1CMDefenderRemediationError } else { "Configured Defender preference still does not enforce $friendlyName after one remediation attempt." }
                RemediationBlocked                  = $false
                RemediationBlockedMessage           = $null
            }
        } `
        -Remediate {
            try {
                Set-A1CMDefenderPreferenceValue -PreferenceName $PreferenceName -Value $DesiredValue -StopOnError
            }
            catch {
                if (-not $AttemptWhenTamperProtected) { throw }
                $global:A1CMDefenderRemediationError = $_.Exception.Message
            }
        }
}

function Invoke-A1CMDefenderBooleanPreferenceControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$PreferenceName,

        [Parameter(Mandatory)]
        [bool]$DesiredEnabled,

        [Parameter(Mandatory)]
        [string]$EffectDescription,

        [switch]$InvertStoredBoolean,

        [switch]$AttemptWhenTamperProtected
    )

    $storedValue = if ($InvertStoredBoolean) { -not $DesiredEnabled } else { $DesiredEnabled }

    Invoke-A1CMDefenderDirectPreferenceControl `
        -Context $Context `
        -PreferenceName $PreferenceName `
        -DesiredValue $storedValue `
        -AttemptWhenTamperProtected:$AttemptWhenTamperProtected `
        -EffectDescription $EffectDescription
}

function Invoke-A1CMDefenderTimePreferenceControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$PreferenceName,

        [Parameter(Mandatory)]
        [string]$DesiredTime,

        [Parameter(Mandatory)]
        [string]$EffectDescription,

        [switch]$AttemptWhenTamperProtected
    )

    $global:A1CMDefenderRemediationError = $null
    $friendlyName = $Context.ControlName.ToLowerInvariant()

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $actual = Get-A1CMDefenderPreferenceValue -PreferenceName $PreferenceName
            $actualComparable = ConvertTo-A1CMDefenderTimeString -Value $actual
            $isCompliant = ($actualComparable -eq $DesiredTime)
            $tamper = $false
            try {
                if ($env:A1CM_TEST_MODE -eq '1') {
                    $tamper = [bool]$global:MockDefenderStatus.IsTamperProtected
                }
                else {
                    $tamper = [bool](Get-MpComputerStatus).IsTamperProtected
                }
            }
            catch { $tamper = $false }
            [PSCustomObject]@{
                IsCompliant                         = $isCompliant
                CompliantMessage                   = "Configured Defender preference already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured Defender preference does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured Defender preference now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = if ($global:A1CMDefenderRemediationError -or $tamper) { Get-A1CMDefenderPostRemediationMismatchMessage -TamperProtectionEnabled:$tamper -OperationError $global:A1CMDefenderRemediationError } else { "Configured Defender preference still does not enforce $friendlyName after one remediation attempt." }
                RemediationBlocked                  = $false
                RemediationBlockedMessage           = $null
            }
        } `
        -Remediate {
            $value = if ($env:A1CM_TEST_DEFENDER -eq '1') {
                $DesiredTime
            }
            else {
                [DateTime]::ParseExact($DesiredTime, 'HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)
            }

            try {
                Set-A1CMDefenderPreferenceValue -PreferenceName $PreferenceName -Value $value -StopOnError
            }
            catch {
                if (-not $AttemptWhenTamperProtected) { throw }
                $global:A1CMDefenderRemediationError = $_.Exception.Message
            }
        }
}

function Invoke-A1CMDefenderDwordPolicyControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$RegistryValueName,

        [Parameter(Mandatory)]
        [int]$DesiredValue,

        [Parameter(Mandatory)]
        [string]$EffectDescription,

        [switch]$AttemptWhenTamperProtected
    )

    $global:A1CMDefenderRemediationError = $null
    $friendlyName = $Context.ControlName.ToLowerInvariant()

    $effective = @{
        DisableIOAVProtection = @{ adapter = 'preference'; property = 'DisableIOAVProtection'; invert = $true }
        DisableOnAccessProtection = @{ adapter = 'status'; property = 'OnAccessProtectionEnabled'; invert = $true }
        DisableScriptScanning = @{ adapter = 'preference'; property = 'DisableScriptScanning'; invert = $true }
        QuickScanIncludeExclusions = @{ adapter = 'preference'; property = 'QuickScanIncludeExclusions' }
        RealtimeScanDirection = @{ adapter = 'preference'; property = 'RealTimeScanDirection' }
        DisableBlockAtFirstSeen = @{ adapter = 'preference'; property = 'DisableBlockAtFirstSeen'; invert = $true }
        MpCloudBlockLevel = @{ adapter = 'preference'; property = 'CloudBlockLevel' }
        CloudBlockLevel = @{ adapter = 'preference'; property = 'CloudBlockLevel' }
        OobeEnableRtpAndSigUpdate = @{ adapter = 'preference'; property = 'OobeEnableRtpAndSigUpdate' }
        EnableDynamicSignatureDroppedEventReporting = @{ adapter = 'preference'; property = 'ReportDynamicSignatureDroppedEvent' }
        ReportDynamicSignatureDroppedEvent = @{ adapter = 'preference'; property = 'ReportDynamicSignatureDroppedEvent' }
        EnableConvertWarnToBlock = @{ adapter = 'preference'; property = 'EnableConvertWarnToBlock' }
        EnableNetworkProtection = @{ adapter = 'preference'; property = 'EnableNetworkProtection' }
    }[$RegistryValueName]

    $getEffective = {
        if ($null -eq $effective) { return $null }
        if ($env:A1CM_TEST_MODE -eq '1') {
            if ($env:A1CM_TEST_DEFENDER_EFFECTIVE_UNAVAILABLE -eq '1') { return $null }
            if ($effective.adapter -eq 'status') { return $global:MockDefenderStatus.($effective.property) }
            return $global:MockDefenderPreference.($effective.property)
        }
        if ($effective.adapter -eq 'status') { return (Get-MpComputerStatus).($effective.property) }
        return (Get-MpPreference).($effective.property)
    }

    $testEffective = {
        if ($null -eq $effective) { return $null }
        try { $raw = & $getEffective } catch { return $null }
        if ($null -eq $raw) { return $null }
        $expected = if ($effective.invert) { $DesiredValue -eq 0 } else { $DesiredValue }
        $actual = if ($effective.invert) { -not [bool]$raw } else { $raw }
        return [PSCustomObject]@{ Actual = $actual; Expected = $expected; Matched = ($actual -eq $expected) }
    }

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $value = Get-A1CMRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName
            $native = & $testEffective
            $effectiveUnavailable = ($null -ne $effective -and $null -eq $native -and ($env:A1CM_TEST_MODE -ne '1' -or $env:A1CM_TEST_DEFENDER_EFFECTIVE_UNAVAILABLE -eq '1'))
            $isCompliant = if ($null -ne $native) { $native.Matched } elseif ($null -eq $effective) { $value -eq $DesiredValue } else { $false }
            $tamper = $false
            try {
                if ($env:A1CM_TEST_MODE -eq '1') {
                    $tamper = [bool]$global:MockDefenderStatus.IsTamperProtected
                }
                else {
                    $tamper = [bool](Get-MpComputerStatus).IsTamperProtected
                }
            }
            catch { $tamper = $false }
            [PSCustomObject]@{
                IsCompliant                         = $isCompliant
                CompliantMessage                   = "The effective Defender setting matches the configured desired state."
                NonCompliantMessage                = "The effective Defender setting does not match the configured desired state. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured Defender policy now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = if ($global:A1CMDefenderRemediationError -or $tamper) { Get-A1CMDefenderPostRemediationMismatchMessage -TamperProtectionEnabled:$tamper -OperationError $global:A1CMDefenderRemediationError } else { "Configured Defender policy still does not enforce $friendlyName after one remediation attempt." }
                RemediationBlocked                  = $effectiveUnavailable -and -not $isCompliant
                RemediationBlockedMessage           = "The effective Defender setting could not be independently verified. Local remediation was not claimed successful; use the supported Defender management plane."
            }
        } `
        -Remediate {
            try {
                Set-A1CMDwordRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName -Value $DesiredValue
            }
            catch {
                if (-not $AttemptWhenTamperProtected) { throw }
                $global:A1CMDefenderRemediationError = $_.Exception.Message
            }
        }
}

function ConvertTo-A1CMUserFacingResultMessage {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Result
    )

    $message = ([string]$Result.Message).Trim()
    $message = $message -replace '\s+ASSESS_ONLY did not modify the endpoint\.?$', ''
    $message = $message -replace '\s+ASSESS_AND_REMEDIATE did not modify the endpoint\.?$', ''
    $message = $message -replace '\bASSESS_ONLY\b', 'Assessment only'
    $message = $message -replace '\bASSESS_AND_REMEDIATE\b', 'Assessment and remediation'
    $message = $message.Trim().TrimEnd('.')

    if ($message -match '^The effective Defender setting still does not match the configured desired state after local remediation\.') {
        return "$message."
    }

    if ([bool]$Result.RemediationAttempted) {
        if ($Result.Status -eq 'Compliant') {
            return "$message. Remediation was applied and the setting is now compliant."
        }

        return "$message. Remediation was attempted, but the setting is still non-compliant."
    }

    if ($Result.Status -eq 'NonCompliant') {
        return "$message. Assessment only; no changes were made."
    }

    return $message
}

function Write-A1CMControlState {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [PSCustomObject]$Result
    )

    $policyDir = Join-Path -Path (Get-A1CMStateRoot) -ChildPath $Context.PolicyId
    if (-not (Test-Path -LiteralPath $policyDir)) {
        [void](New-Item -ItemType Directory -Path $policyDir -Force)
    }

    $targetPath = Join-Path -Path $policyDir -ChildPath ($Context.ControlId + '.json')
    $tempPath = $targetPath + '.tmp'

    $state = [ordered]@{
        policyId             = $Context.PolicyId
        policyName           = $Context.PolicyName
        controlId            = $Context.ControlId
        controlVersion       = $Context.ControlVersion
        controlName          = $Context.ControlName
        status               = $Result.Status
        lastCheckedAt        = Get-A1CMUtcTimestamp
        remediationAttempted = [bool]$Result.RemediationAttempted
        lastRemediatedAt     = $Result.LastRemediatedAt
        message              = ConvertTo-A1CMUserFacingResultMessage -Result $Result
        schemaVersion        = 1
        policyMode           = $Context.PolicyMode
        controlFamilyId      = $Context.ControlFamilyId
        controlFamilyName    = $Context.ControlFamilyName
        automationGroupId    = $Context.AutomationGroupId
        automationGroupName  = $Context.AutomationGroupName
    }

    $json = ([PSCustomObject]$state | ConvertTo-Json -Depth 8)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tempPath, $json, $encoding)

    if (Test-Path -LiteralPath $targetPath) {
        $backupPath = $targetPath + '.bak'
        if (Test-Path -LiteralPath $backupPath) {
            Remove-Item -LiteralPath $backupPath -Force
        }

        [System.IO.File]::Replace($tempPath, $targetPath, $backupPath)

        if (Test-Path -LiteralPath $backupPath) {
            Remove-Item -LiteralPath $backupPath -Force
        }
    }
    else {
        [System.IO.File]::Move($tempPath, $targetPath)
    }
}

function Invoke-A1CMConfiguredControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [scriptblock]$Assess,

        [Parameter(Mandatory)]
        [scriptblock]$Remediate
    )

    $assessment = & $Assess
    if ($assessment.IsCompliant) {
        return [PSCustomObject]@{
            Status               = 'Compliant'
            RemediationAttempted = $false
            LastRemediatedAt     = $null
            Message              = $assessment.CompliantMessage
        }
    }

    if ($Context.PolicyMode -eq 'ASSESS_ONLY') {
        return [PSCustomObject]@{
            Status               = 'NonCompliant'
            RemediationAttempted = $false
            LastRemediatedAt     = $null
            Message              = $assessment.NonCompliantMessage
        }
    }

    if ($assessment.RemediationBlocked) {
        return [PSCustomObject]@{
            Status               = 'NonCompliant'
            RemediationAttempted = $false
            LastRemediatedAt     = $null
            Message              = $assessment.RemediationBlockedMessage
        }
    }

    $lastRemediatedAt = Get-A1CMUtcTimestamp
    & $Remediate

    $verification = & $Assess
    if ($verification.IsCompliant) {
        return [PSCustomObject]@{
            Status               = 'Compliant'
            RemediationAttempted = $true
            LastRemediatedAt     = $lastRemediatedAt
            Message              = $verification.RemediatedMessage
        }
    }

    return [PSCustomObject]@{
        Status               = 'NonCompliant'
        RemediationAttempted = $true
        LastRemediatedAt     = $lastRemediatedAt
        Message              = $verification.PostRemediationNonCompliantMessage
    }
}

function ConvertFrom-A1CMParameterDefinitionsJson {
    param(
        [Parameter(Mandatory)]
        [string]$ParameterDefinitionsJson
    )

    if ([string]::IsNullOrWhiteSpace($ParameterDefinitionsJson)) {
        return @()
    }

    $parsed = $ParameterDefinitionsJson | ConvertFrom-Json
    if ($null -eq $parsed) {
        return @()
    }

    $items = @($parsed) | Where-Object { $null -ne $_ }
    if ($items.Count -eq 0) {
        return @()
    }

    return @($items)
}

function Test-A1CMIntegerLikeValue {
    param(
        [Parameter(Mandatory)]
        $Value
    )

    if ($Value -is [string] -or $Value -is [bool] -or $null -eq $Value) {
        return $false
    }

    try {
        $number = [double]$Value
    }
    catch {
        return $false
    }

    return [math]::Floor($number) -eq $number
}

function Assert-A1CMParameterValue {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Definition,

        [Parameter(Mandatory)]
        $Value,

        [Parameter(Mandatory)]
        [string]$ControlId
    )

    $parameterId = $Definition.id
    $location = "$ControlId.$parameterId"

    switch ($Definition.type) {
        'boolean' {
            if ($Value -isnot [bool]) {
                throw "Policy envelope parameter $location must be boolean."
            }
        }
        'integer' {
            if (-not (Test-A1CMIntegerLikeValue -Value $Value)) {
                throw "Policy envelope parameter $location must be an integer."
            }

            $intValue = [int64]$Value
            if ($null -ne $Definition.minimum -and $intValue -lt [int64]$Definition.minimum) {
                throw "Policy envelope parameter $location must be greater than or equal to $($Definition.minimum)."
            }

            if ($null -ne $Definition.maximum -and $intValue -gt [int64]$Definition.maximum) {
                throw "Policy envelope parameter $location must be less than or equal to $($Definition.maximum)."
            }

            if ($null -ne $Definition.step -and $null -ne $Definition.minimum) {
                if ((($intValue - [int64]$Definition.minimum) % [int64]$Definition.step) -ne 0) {
                    throw "Policy envelope parameter $location must follow step $($Definition.step)."
                }
            }
        }
        'enum' {
            if ($Value -isnot [string]) {
                throw "Policy envelope parameter $location must be a string enum value."
            }

            $optionValues = @($Definition.options) | ForEach-Object { $_.value }
            if ($Value -notin $optionValues) {
                throw "Policy envelope parameter $location must match a declared stable option value."
            }
        }
        'string' {
            if ($Value -isnot [string]) {
                throw "Policy envelope parameter $location must be a string."
            }

            if ($null -ne $Definition.minimumLength -and $Value.Length -lt [int]$Definition.minimumLength) {
                throw "Policy envelope parameter $location must be at least $($Definition.minimumLength) characters."
            }

            if ($null -ne $Definition.maximumLength -and $Value.Length -gt [int]$Definition.maximumLength) {
                throw "Policy envelope parameter $location must be at most $($Definition.maximumLength) characters."
            }

            if (-not [string]::IsNullOrWhiteSpace($Definition.pattern) -and $Value -notmatch $Definition.pattern) {
                throw "Policy envelope parameter $location must match pattern $($Definition.pattern)."
            }
        }
        'multiline-string' {
            if ($Value -isnot [string]) {
                throw "Policy envelope parameter $location must be a string."
            }

            if ($null -ne $Definition.minimumLength -and $Value.Length -lt [int]$Definition.minimumLength) {
                throw "Policy envelope parameter $location must be at least $($Definition.minimumLength) characters."
            }

            if ($null -ne $Definition.maximumLength -and $Value.Length -gt [int]$Definition.maximumLength) {
                throw "Policy envelope parameter $location must be at most $($Definition.maximumLength) characters."
            }
        }
        'time' {
            if ($Value -isnot [string] -or $Value -notmatch '^([01]\d|2[0-3]):[0-5]\d$') {
                throw "Policy envelope parameter $location must use HH:mm format."
            }
        }
        default {
            throw "Policy envelope parameter $location uses unsupported type $($Definition.type)."
        }
    }
}

function Resolve-A1CMControlParameters {
    param(
        [Parameter(Mandatory)]
        [string]$ControlId,

        [Parameter(Mandatory)]
        [AllowNull()]
        $ParameterDefinitions,

        [Parameter(Mandatory)]
        [PSCustomObject]$Parameters
    )

    $resolved = [ordered]@{}
    $definitionById = @{}

    $normalizedDefinitions = @($ParameterDefinitions | Where-Object { $null -ne $_ })

    foreach ($definition in $normalizedDefinitions) {
        $definitionById[$definition.id] = $definition
    }

    foreach ($property in @($Parameters.PSObject.Properties)) {
        if (-not $definitionById.ContainsKey($property.Name)) {
            throw "Policy envelope contains unknown parameter $($property.Name) for $ControlId."
        }
    }

    foreach ($definition in $normalizedDefinitions) {
        $property = $Parameters.PSObject.Properties[$definition.id]
        if ($null -ne $property) {
            Assert-A1CMParameterValue -Definition $definition -Value $property.Value -ControlId $ControlId
            $resolved[$definition.id] = $property.Value
            continue
        }

        if ([bool]$definition.required) {
            throw "Policy envelope required parameter $($definition.id) is missing for $ControlId."
        }

        $resolved[$definition.id] = $definition.defaultValue
    }

    return [PSCustomObject]$resolved
}

function Assert-A1CMPolicyEnvelope {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$PolicyConfiguration,

        [Parameter(Mandatory)]
        [string]$AutomationGroupId,

        [Parameter(Mandatory)]
        [string]$AutomationGroupVersion,

        [Parameter(Mandatory)]
        [hashtable]$ControlDefinitions
    )

    if ($null -eq $PolicyConfiguration) {
        throw 'Policy envelope is required.'
    }

    if ($PolicyConfiguration.schemaVersion -ne 1) {
        throw 'Policy envelope schemaVersion must be 1.'
    }

    if ([string]::IsNullOrWhiteSpace($PolicyConfiguration.policyId)) {
        throw 'Policy envelope policyId is required.'
    }

    if ($PolicyConfiguration.policyId -notmatch '^POL-\d{6,}$') {
        throw 'Policy envelope policyId must use the Marketplace format POL-000123.'
    }

    if ([string]::IsNullOrWhiteSpace($PolicyConfiguration.policyName)) {
        throw 'Policy envelope policyName is required.'
    }

    if ($PolicyConfiguration.policyMode -notin @('ASSESS_ONLY', 'ASSESS_AND_REMEDIATE')) {
        throw 'Policy envelope policyMode is invalid.'
    }

    if ($PolicyConfiguration.automationGroupId -ne $AutomationGroupId) {
        throw 'Policy envelope automationGroupId does not match this bundle.'
    }

    if ($PolicyConfiguration.automationGroupVersion -ne $AutomationGroupVersion) {
        throw 'Policy envelope automationGroupVersion does not match this bundle.'
    }

    $seen = @{}
    foreach ($selectedControl in @($PolicyConfiguration.controls)) {
        if ($seen.ContainsKey($selectedControl.controlId)) {
            throw "Policy envelope contains duplicate controlId $($selectedControl.controlId)."
        }

        $seen[$selectedControl.controlId] = $true

        if (-not $ControlDefinitions.ContainsKey($selectedControl.controlId)) {
            throw "Policy envelope contains unknown controlId $($selectedControl.controlId)."
        }

        $definition = $ControlDefinitions[$selectedControl.controlId]
        if ($selectedControl.controlVersion -ne $definition.ControlVersion) {
            throw "Policy envelope controlVersion does not match bundle metadata for $($selectedControl.controlId)."
        }

        $parameters = $selectedControl.parameters
        if ($null -eq $parameters) {
            throw "Policy envelope parameters are required for $($selectedControl.controlId)."
        }
        $resolvedParameters = Resolve-A1CMControlParameters `
            -ControlId $selectedControl.controlId `
            -ParameterDefinitions (ConvertFrom-A1CMParameterDefinitionsJson -ParameterDefinitionsJson $definition.ParameterDefinitionsJson) `
            -Parameters $parameters
        $selectedControl | Add-Member -NotePropertyName resolvedParameters -NotePropertyValue $resolvedParameters -Force
    }
}

function Invoke-A1CMGroup {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$PolicyConfiguration,

        [Parameter(Mandatory)]
        [string]$AutomationGroupId,

        [Parameter(Mandatory)]
        [string]$AutomationGroupVersion,

        [Parameter(Mandatory)]
        [string]$AutomationGroupName,

        [Parameter(Mandatory)]
        [string]$FamilyId,

        [Parameter(Mandatory)]
        [string]$FamilyName,

        [Parameter(Mandatory)]
        [array]$ControlOrder,

        [Parameter(Mandatory)]
        [hashtable]$ControlDefinitions
    )

    Assert-A1CMPolicyEnvelope `
        -PolicyConfiguration $PolicyConfiguration `
        -AutomationGroupId $AutomationGroupId `
        -AutomationGroupVersion $AutomationGroupVersion `
        -ControlDefinitions $ControlDefinitions

    $selectedById = @{}
    foreach ($selected in @($PolicyConfiguration.controls)) {
        $selectedById[$selected.controlId] = $selected
    }

    $failures = New-Object System.Collections.Generic.List[string]

    foreach ($controlId in $ControlOrder) {
        if (-not $selectedById.ContainsKey($controlId)) {
            continue
        }

        $definition = $ControlDefinitions[$controlId]
        $selected = $selectedById[$controlId]
        $context = [PSCustomObject]@{
            PolicyId            = $PolicyConfiguration.policyId
            PolicyName          = $PolicyConfiguration.policyName
            PolicyMode          = $PolicyConfiguration.policyMode
            ControlId           = $definition.ControlId
            ControlVersion      = $definition.ControlVersion
            ControlName         = $definition.ControlName
            ControlFamilyId     = $FamilyId
            ControlFamilyName   = $FamilyName
            AutomationGroupId   = $AutomationGroupId
            AutomationGroupName = $AutomationGroupName
        }

        try {
            $result = & $definition.EntryPoint -Context $context -Parameters $selected.resolvedParameters
            Write-A1CMControlState -Context $context -Result $result
        }
        catch {
            $failures.Add($controlId) | Out-Null
            Write-Error "Control $controlId failed technically: $($_.Exception.Message)"
        }
    }

    if ($failures.Count -gt 0) {
        $global:A1CM_ExitCode = 1
    }
    else {
        $global:A1CM_ExitCode = 0
    }
}

function Invoke-A1CMRemovableStoragePolicyControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$RegistryValueName,

        [Parameter(Mandatory)]
        [int]$DesiredValue,

        [Parameter(Mandatory)]
        [string]$AccessDescription,

        [Parameter(Mandatory)]
        [ValidateSet('Allow', 'Deny')]
        [string]$DesiredState
    )

    if ($env:A1CM_TEST_FAIL_CONTROL -and $env:A1CM_TEST_FAIL_CONTROL -eq $Context.ControlId) {
        throw "Injected technical failure for $($Context.ControlId)."
    }

    $configuredVerb = if ($DesiredState -eq 'Deny') { 'denies' } else { 'allows' }

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $value = Get-A1CMRegistryPolicyValue -RegistryPath $RegistryPath -ValueName $RegistryValueName
            [PSCustomObject]@{
                IsCompliant                         = ($value -eq $DesiredValue)
                CompliantMessage                   = "Configured machine policy already $configuredVerb $AccessDescription. Live enforcement may still require policy refresh or restart."
                NonCompliantMessage                = "Configured machine policy does not yet $($DesiredState.ToLowerInvariant()) $AccessDescription. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured machine policy now $configuredVerb $AccessDescription. Live enforcement may still require policy refresh or restart."
                PostRemediationNonCompliantMessage = "Configured machine policy still does not $($DesiredState.ToLowerInvariant()) $AccessDescription after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMRegistryPolicyValue -RegistryPath $RegistryPath -ValueName $RegistryValueName -Value $DesiredValue
        }
}

function Invoke-A1CMInteractiveSignInDwordPolicyControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$RegistryValueName,

        [Parameter(Mandatory)]
        [int]$DesiredValue
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $value = Get-A1CMRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName
            [PSCustomObject]@{
                IsCompliant                         = ($value -eq $DesiredValue)
                CompliantMessage                   = "Configured interactive sign-in policy already enforces $friendlyName. Live sign-in behavior may update at the next sign-in or policy refresh."
                NonCompliantMessage                = "Configured interactive sign-in policy does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured interactive sign-in policy now enforces $friendlyName. Live sign-in behavior may update at the next sign-in or policy refresh."
                PostRemediationNonCompliantMessage = "Configured interactive sign-in policy still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMDwordRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName -Value $DesiredValue
        }
}

function Invoke-A1CMInteractiveSignInStringPolicyControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$RegistryValueName,

        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$DesiredValue
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $value = Get-A1CMRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName
            [PSCustomObject]@{
                IsCompliant                         = ($value -ceq $DesiredValue)
                CompliantMessage                   = "Configured interactive sign-in policy already enforces $friendlyName. Live sign-in behavior may update at the next sign-in or policy refresh."
                NonCompliantMessage                = "Configured interactive sign-in policy does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured interactive sign-in policy now enforces $friendlyName. Live sign-in behavior may update at the next sign-in or policy refresh."
                PostRemediationNonCompliantMessage = "Configured interactive sign-in policy still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMStringRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName -Value $DesiredValue
        }
}

function Invoke-A1CMPlatformDwordPolicyControl {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [string]$RegistryValueName,

        [Parameter(Mandatory)]
        [int]$DesiredValue,

        [Parameter(Mandatory)]
        [string]$EffectDescription
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $value = Get-A1CMRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName
            [PSCustomObject]@{
                IsCompliant                         = ($value -eq $DesiredValue)
                CompliantMessage                   = "Configured platform security policy already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured platform security policy does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured platform security policy now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = "Configured platform security policy still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMDwordRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName -Value $DesiredValue
        }
}

function Invoke-A1CMControl_CurrentVersionInternetSettingsCertificateRevocation {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [PSCustomObject]$Parameters
    )

    $desiredValue = if ([bool]$Parameters.checkServerCertificateRevocation) { 1 } else { 0 }

    Invoke-A1CMPlatformDwordPolicyControl `
        -Context $Context `
        -RegistryPath 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\Internet Settings' `
        -RegistryValueName 'CertificateRevocation' `
        -DesiredValue $desiredValue `
        -EffectDescription 'Internet Explorer applies the configured server certificate revocation checking behavior after policy refresh.'
}

function Invoke-A1CMControl_CurrentVersionInternetSettingsEnableSsl3Fallback {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [PSCustomObject]$Parameters
    )

    $desiredValue = switch ($Parameters.ssl3FallbackScope) {
        'NoSites' { 0 }
        'NonProtectedModeSites' { 1 }
        'AllSites' { 3 }
        default { throw "Unsupported SSL 3.0 fallback scope '$($Parameters.ssl3FallbackScope)'." }
    }

    Invoke-A1CMPlatformDwordPolicyControl `
        -Context $Context `
        -RegistryPath 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\Internet Settings' `
        -RegistryValueName 'EnableSSL3Fallback' `
        -DesiredValue $desiredValue `
        -EffectDescription 'Internet Explorer applies the configured SSL 3.0 fallback scope after policy refresh.'
}

function Invoke-A1CMControl_CurrentVersionInternetSettingsPreventIgnoreCertErrors {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [PSCustomObject]$Parameters
    )

    $desiredValue = if ([bool]$Parameters.ignoreCertificateErrorsAllowed) { 0 } else { 1 }

    Invoke-A1CMPlatformDwordPolicyControl `
        -Context $Context `
        -RegistryPath 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\Internet Settings' `
        -RegistryValueName 'PreventIgnoreCertErrors' `
        -DesiredValue $desiredValue `
        -EffectDescription 'Internet Explorer applies the configured certificate-error bypass behavior after policy refresh.'
}

function Invoke-A1CMControl_CurrentVersionInternetSettingsSecureProtocols {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [PSCustomObject]$Parameters
    )

    $desiredValue = switch ($Parameters.secureProtocolCombination) {
        'None' { 0 }
        'Ssl2' { 8 }
        'Ssl3' { 32 }
        'Ssl2Ssl3' { 40 }
        'Tls10' { 128 }
        'Ssl2Tls10' { 136 }
        'Ssl3Tls10' { 160 }
        'Ssl2Ssl3Tls10' { 168 }
        'Tls11' { 512 }
        'Ssl2Tls11' { 520 }
        'Ssl3Tls11' { 544 }
        'Ssl2Ssl3Tls11' { 552 }
        'Tls10Tls11' { 640 }
        'Ssl2Tls10Tls11' { 648 }
        'Ssl3Tls10Tls11' { 672 }
        'Ssl2Ssl3Tls10Tls11' { 680 }
        'Tls12' { 2048 }
        'Ssl2Tls12' { 2056 }
        'Ssl3Tls12' { 2080 }
        'Ssl2Ssl3Tls12' { 2088 }
        'Tls10Tls12' { 2176 }
        'Ssl2Tls10Tls12' { 2184 }
        'Ssl3Tls10Tls12' { 2208 }
        'Ssl2Ssl3Tls10Tls12' { 2216 }
        'Tls11Tls12' { 2560 }
        'Ssl2Tls11Tls12' { 2568 }
        'Ssl3Tls11Tls12' { 2592 }
        'Ssl2Ssl3Tls11Tls12' { 2600 }
        'Tls10Tls11Tls12' { 2688 }
        'Ssl2Tls10Tls11Tls12' { 2696 }
        'Ssl3Tls10Tls11Tls12' { 2720 }
        'Ssl2Ssl3Tls10Tls11Tls12' { 2728 }
        'Tls13' { 8192 }
        'Tls12Tls13' { 10240 }
        'Tls11Tls12Tls13' { 10752 }
        'Tls10Tls11Tls12Tls13' { 10880 }
        'Ssl3Tls10Tls11Tls12Tls13' { 10912 }
        default { throw "Unsupported secure protocol combination '$($Parameters.secureProtocolCombination)'." }
    }

    Invoke-A1CMPlatformDwordPolicyControl `
        -Context $Context `
        -RegistryPath 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\Internet Settings' `
        -RegistryValueName 'SecureProtocols' `
        -DesiredValue $desiredValue `
        -EffectDescription 'Internet Explorer negotiates using the configured secure protocol combination after policy refresh.'
}

function Invoke-A1CMControl_CurrentVersionInternetSettingsWarnOnBadCertRecving {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [PSCustomObject]$Parameters
    )

    $registryPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\Internet Settings'
    $registryValueName = 'WarnOnBadCertRecving'
    $alwaysWarn = [bool]$Parameters.alwaysWarnOnCertificateAddressMismatch
    $desiredStateDescription = if ($alwaysWarn) {
        'always warn on certificate address mismatch'
    }
    else {
        'allow the certificate address mismatch warning to follow the user or system default behavior'
    }

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $value = Get-A1CMRegistryPolicyValue -RegistryPath $registryPath -ValueName $registryValueName
            $isCompliant = if ($alwaysWarn) {
                $value -eq 1
            }
            else {
                $null -eq $value
            }

            [PSCustomObject]@{
                IsCompliant                         = $isCompliant
                CompliantMessage                   = "Configured platform security policy already enforces $($Context.ControlName.ToLowerInvariant()) to $desiredStateDescription. Internet Explorer applies the configured certificate address mismatch warning behavior after policy refresh."
                NonCompliantMessage                = "Configured platform security policy does not yet enforce $($Context.ControlName.ToLowerInvariant()) to $desiredStateDescription. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured platform security policy now enforces $($Context.ControlName.ToLowerInvariant()) to $desiredStateDescription. Internet Explorer applies the configured certificate address mismatch warning behavior after policy refresh."
                PostRemediationNonCompliantMessage = "Configured platform security policy still does not enforce $($Context.ControlName.ToLowerInvariant()) to $desiredStateDescription after one remediation attempt."
            }
        } `
        -Remediate {
            if ($alwaysWarn) {
                Set-A1CMRegistryPolicyValue -RegistryPath $registryPath -ValueName $registryValueName -Value 1
                return
            }

            Remove-A1CMRegistryPolicyValue -RegistryPath $registryPath -ValueName $registryValueName
        }
}

$script:A1CMControlOrder = @(

    'platform-os-hardening.current-version-internet-settings-certificate-revocation',
    'platform-os-hardening.current-version-internet-settings-enable-ssl3-fallback',
    'platform-os-hardening.current-version-internet-settings-prevent-ignore-cert-errors',
    'platform-os-hardening.current-version-internet-settings-secure-protocols',
    'platform-os-hardening.current-version-internet-settings-warn-on-bad-cert-recving'

)

$script:A1CMControlDefinitions = @{

    'platform-os-hardening.current-version-internet-settings-certificate-revocation' = [PSCustomObject]@{
        ControlId = 'platform-os-hardening.current-version-internet-settings-certificate-revocation'
        ControlVersion = '0.1.0'
        ControlName = 'Check for server certificate revocation'
        EntryPoint = 'Invoke-A1CMControl_CurrentVersionInternetSettingsCertificateRevocation'
        ParameterDefinitionsJson = '[{"id":"checkServerCertificateRevocation","type":"boolean","label":"Check server certificate revocation","description":"Controls whether Internet Explorer checks whether server certificates have been revoked while this policy manages the setting.","required":true,"defaultValue":true}]'
    }
    'platform-os-hardening.current-version-internet-settings-enable-ssl3-fallback' = [PSCustomObject]@{
        ControlId = 'platform-os-hardening.current-version-internet-settings-enable-ssl3-fallback'
        ControlVersion = '0.1.0'
        ControlName = 'Block fallback to SSL 3.0'
        EntryPoint = 'Invoke-A1CMControl_CurrentVersionInternetSettingsEnableSsl3Fallback'
        ParameterDefinitionsJson = '[{"id":"ssl3FallbackScope","type":"enum","label":"SSL 3.0 fallback scope","description":"Controls which sites Internet Explorer may fall back to SSL 3.0 for while this policy manages the setting.","required":true,"defaultValue":"NoSites","options":[{"value":"NoSites","label":"No Sites"},{"value":"NonProtectedModeSites","label":"Non-Protected Mode Sites"},{"value":"AllSites","label":"All Sites"}]}]'
    }
    'platform-os-hardening.current-version-internet-settings-prevent-ignore-cert-errors' = [PSCustomObject]@{
        ControlId = 'platform-os-hardening.current-version-internet-settings-prevent-ignore-cert-errors'
        ControlVersion = '0.1.0'
        ControlName = 'Prevent ignoring certificate errors'
        EntryPoint = 'Invoke-A1CMControl_CurrentVersionInternetSettingsPreventIgnoreCertErrors'
        ParameterDefinitionsJson = '[{"id":"ignoreCertificateErrorsAllowed","type":"boolean","label":"Allow ignoring certificate errors","description":"Controls whether users can continue browsing after SSL or TLS certificate errors while this policy manages the setting.","required":true,"defaultValue":false}]'
    }
    'platform-os-hardening.current-version-internet-settings-secure-protocols' = [PSCustomObject]@{
        ControlId = 'platform-os-hardening.current-version-internet-settings-secure-protocols'
        ControlVersion = '0.1.0'
        ControlName = 'Use TLS 1.1 and TLS 1.2'
        EntryPoint = 'Invoke-A1CMControl_CurrentVersionInternetSettingsSecureProtocols'
        ParameterDefinitionsJson = '[{"id":"secureProtocolCombination","type":"enum","label":"Secure protocol combination","description":"Controls which SSL and TLS protocol combinations Internet Explorer negotiates while this policy manages the setting.","required":true,"defaultValue":"Tls11Tls12","options":[{"value":"None","label":"Use no secure protocols"},{"value":"Ssl2","label":"Only use SSL 2.0"},{"value":"Ssl3","label":"Only use SSL 3.0"},{"value":"Ssl2Ssl3","label":"Use SSL 2.0 and SSL 3.0"},{"value":"Tls10","label":"Only use TLS 1.0"},{"value":"Ssl2Tls10","label":"Use SSL 2.0 and TLS 1.0"},{"value":"Ssl3Tls10","label":"Use SSL 3.0 and TLS 1.0"},{"value":"Ssl2Ssl3Tls10","label":"Use SSL 2.0, SSL 3.0, and TLS 1.0"},{"value":"Tls11","label":"Only use TLS 1.1"},{"value":"Ssl2Tls11","label":"Use SSL 2.0 and TLS 1.1"},{"value":"Ssl3Tls11","label":"Use SSL 3.0 and TLS 1.1"},{"value":"Ssl2Ssl3Tls11","label":"Use SSL 2.0, SSL 3.0, and TLS 1.1"},{"value":"Tls10Tls11","label":"Use TLS 1.0 and TLS 1.1"},{"value":"Ssl2Tls10Tls11","label":"Use SSL 2.0, TLS 1.0, and TLS 1.1"},{"value":"Ssl3Tls10Tls11","label":"Use SSL 3.0, TLS 1.0, and TLS 1.1"},{"value":"Ssl2Ssl3Tls10Tls11","label":"Use SSL 2.0, SSL 3.0, TLS 1.0, and TLS 1.1"},{"value":"Tls12","label":"Only use TLS 1.2"},{"value":"Ssl2Tls12","label":"Use SSL 2.0 and TLS 1.2"},{"value":"Ssl3Tls12","label":"Use SSL 3.0 and TLS 1.2"},{"value":"Ssl2Ssl3Tls12","label":"Use SSL 2.0, SSL 3.0, and TLS 1.2"},{"value":"Tls10Tls12","label":"Use TLS 1.0 and TLS 1.2"},{"value":"Ssl2Tls10Tls12","label":"Use SSL 2.0, TLS 1.0, and TLS 1.2"},{"value":"Ssl3Tls10Tls12","label":"Use SSL 3.0, TLS 1.0, and TLS 1.2"},{"value":"Ssl2Ssl3Tls10Tls12","label":"Use SSL 2.0, SSL 3.0, TLS 1.0, and TLS 1.2"},{"value":"Tls11Tls12","label":"Use TLS 1.1 and TLS 1.2"},{"value":"Ssl2Tls11Tls12","label":"Use SSL 2.0, TLS 1.1, and TLS 1.2"},{"value":"Ssl3Tls11Tls12","label":"Use SSL 3.0, TLS 1.1, and TLS 1.2"},{"value":"Ssl2Ssl3Tls11Tls12","label":"Use SSL 2.0, SSL 3.0, TLS 1.1, and TLS 1.2"},{"value":"Tls10Tls11Tls12","label":"Use TLS 1.0, TLS 1.1, and TLS 1.2"},{"value":"Ssl2Tls10Tls11Tls12","label":"Use SSL 2.0, TLS 1.0, TLS 1.1, and TLS 1.2"},{"value":"Ssl3Tls10Tls11Tls12","label":"Use SSL 3.0, TLS 1.0, TLS 1.1, and TLS 1.2"},{"value":"Ssl2Ssl3Tls10Tls11Tls12","label":"Use SSL 2.0, SSL 3.0, TLS 1.0, TLS 1.1, and TLS 1.2"},{"value":"Tls13","label":"Only use TLS 1.3"},{"value":"Tls12Tls13","label":"Use TLS 1.2 and TLS 1.3"},{"value":"Tls11Tls12Tls13","label":"Use TLS 1.1, TLS 1.2, and TLS 1.3"},{"value":"Tls10Tls11Tls12Tls13","label":"Use TLS 1.0, TLS 1.1, TLS 1.2, and TLS 1.3"},{"value":"Ssl3Tls10Tls11Tls12Tls13","label":"Use SSL 3.0, TLS 1.0, TLS 1.1, TLS 1.2, and TLS 1.3"}]}]'
    }
    'platform-os-hardening.current-version-internet-settings-warn-on-bad-cert-recving' = [PSCustomObject]@{
        ControlId = 'platform-os-hardening.current-version-internet-settings-warn-on-bad-cert-recving'
        ControlVersion = '0.1.0'
        ControlName = 'Warn on certificate address mismatch'
        EntryPoint = 'Invoke-A1CMControl_CurrentVersionInternetSettingsWarnOnBadCertRecving'
        ParameterDefinitionsJson = '[{"id":"alwaysWarnOnCertificateAddressMismatch","type":"boolean","label":"Always warn on certificate address mismatch","description":"Controls whether the certificate address mismatch warning always appears while this policy manages the setting.","required":true,"defaultValue":true}]'
    }

}

Invoke-A1CMGroup -PolicyConfiguration $policyConfiguration -AutomationGroupId 'platform.web-certificate-and-tls' -AutomationGroupVersion '0.1.0' -AutomationGroupName 'Web Certificate & TLS Security' -FamilyId 'platform-security' -FamilyName 'Platform Security' -ControlOrder $script:A1CMControlOrder -ControlDefinitions $script:A1CMControlDefinitions

if ($env:A1CM_TEST_MODE -ne '1') { exit $global:A1CM_ExitCode }