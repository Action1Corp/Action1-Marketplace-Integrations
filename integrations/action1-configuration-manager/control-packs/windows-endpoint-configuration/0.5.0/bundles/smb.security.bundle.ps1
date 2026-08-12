# Action1 Configuration Manager Control Pack
# Pack: Windows Endpoint Configuration (windows-endpoint-configuration) v0.5.0
# Automation Group: SMB Security (smb.security) v0.1.0
# Contains: 6 fixed Control implementation(s)
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

        $arguments = @{
            Name = $profileName
        }
        $arguments[$PropertyName] = $Value
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
    $content = @"
[Unicode]
Unicode=yes
[Version]
signature=`"$CHICAGO$`"
Revision=1
[$Section]
$PolicyKey=$ValueData
"@

    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

    try {
        Set-Content -LiteralPath $cfgPath -Value $content -Encoding Unicode
        & secedit /configure /db $dbPath /cfg $cfgPath /areas securitypolicy /quiet | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "secedit /configure failed for [$Section] $PolicyKey. Run with administrative privileges."
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
    $content = @"
[Unicode]
Unicode=yes
[Version]
signature=`"$CHICAGO$`"
Revision=1
[System Access]
$PolicyKey = $Value
"@

    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

    try {
        Set-Content -LiteralPath $cfgPath -Value $content -Encoding Unicode
        & secedit /configure /db $dbPath /cfg $cfgPath /areas securitypolicy /quiet | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "secedit /configure failed for $PolicyKey. Run with administrative privileges."
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
        $Value
    )

    Add-A1CMMockOperation -Value "Defender:Set:$PreferenceName"

    if ($env:A1CM_TEST_DEFENDER -eq '1') {
        Set-A1CMMockDefenderPreferenceValue -PreferenceName $PreferenceName -Value $Value
        return
    }

    $arguments = @{}
    $arguments[$PreferenceName] = $Value
    Set-MpPreference @arguments
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
            $ruleId = ConvertTo-A1CMDefenderAsrRuleId -RuleId ([string]$arrays.Ids[$index])
            if ([string]::IsNullOrWhiteSpace($ruleId)) {
                continue
            }

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
        $ruleId = ConvertTo-A1CMDefenderAsrRuleId -RuleId ([string]$ids[$index])
        if ([string]::IsNullOrWhiteSpace($ruleId)) {
            continue
        }

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
            if ((ConvertTo-A1CMDefenderAsrRuleId -RuleId ([string]$ids[$index])) -eq $normalizedRuleId) {
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
            $currentRuleId = ConvertTo-A1CMDefenderAsrRuleId -RuleId ([string]$arrays.Ids[$index])
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

        [Parameter(Mandatory)]
        [string]$EffectDescription
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()
    $expectedComparable = ConvertTo-A1CMDefenderComparableValue -Value $DesiredValue

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $actual = Get-A1CMDefenderPreferenceValue -PreferenceName $PreferenceName
            $actualComparable = ConvertTo-A1CMDefenderComparableValue -Value $actual
            [PSCustomObject]@{
                IsCompliant                         = ($actualComparable -eq $expectedComparable)
                CompliantMessage                   = "Configured Defender preference already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured Defender preference does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured Defender preference now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = "Configured Defender preference still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMDefenderPreferenceValue -PreferenceName $PreferenceName -Value $DesiredValue
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

        [switch]$InvertStoredBoolean
    )

    $storedValue = if ($InvertStoredBoolean) { -not $DesiredEnabled } else { $DesiredEnabled }

    Invoke-A1CMDefenderDirectPreferenceControl `
        -Context $Context `
        -PreferenceName $PreferenceName `
        -DesiredValue $storedValue `
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
        [string]$EffectDescription
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $actual = Get-A1CMDefenderPreferenceValue -PreferenceName $PreferenceName
            $actualComparable = ConvertTo-A1CMDefenderTimeString -Value $actual
            [PSCustomObject]@{
                IsCompliant                         = ($actualComparable -eq $DesiredTime)
                CompliantMessage                   = "Configured Defender preference already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured Defender preference does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured Defender preference now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = "Configured Defender preference still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            $value = if ($env:A1CM_TEST_DEFENDER -eq '1') {
                $DesiredTime
            }
            else {
                [DateTime]::ParseExact($DesiredTime, 'HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)
            }

            Set-A1CMDefenderPreferenceValue -PreferenceName $PreferenceName -Value $value
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
        [string]$EffectDescription
    )

    $friendlyName = $Context.ControlName.ToLowerInvariant()

    Invoke-A1CMConfiguredControl `
        -Context $Context `
        -Assess {
            $value = Get-A1CMRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName
            [PSCustomObject]@{
                IsCompliant                         = ($value -eq $DesiredValue)
                CompliantMessage                   = "Configured Defender policy already enforces $friendlyName. $EffectDescription"
                NonCompliantMessage                = "Configured Defender policy does not yet enforce $friendlyName. ASSESS_ONLY did not modify the endpoint."
                RemediatedMessage                  = "Configured Defender policy now enforces $friendlyName. $EffectDescription"
                PostRemediationNonCompliantMessage = "Configured Defender policy still does not enforce $friendlyName after one remediation attempt."
            }
        } `
        -Remediate {
            Set-A1CMDwordRegistryValue -RegistryPath $RegistryPath -ValueName $RegistryValueName -Value $DesiredValue
        }
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
        message              = $Result.Message
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

function Invoke-A1CMControl_SmbClientRequireSigning {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [PSCustomObject]$Parameters
    )

    $enabled = [bool]$Parameters.enabled

    # Control-specific adapter only.
    # Shared assess/remediate/verify behavior lives in runtime modules.
    # The builder combines this adapter and the runtime into the generated Automation Group bundle.
    Invoke-A1CMSmbClientConfigurationControl `
        -Context $Context `
        -PropertyName 'RequireSecuritySignature' `
        -DesiredValue $enabled `
        -EffectDescription 'Configured SMB client signing policy affects future outbound SMB connection negotiation without claiming the state of already established sessions.'
}

function Invoke-A1CMControl_SmbServerRequireSigning {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [PSCustomObject]$Parameters
    )

    $enabled = [bool]$Parameters.enabled

    # Control-specific adapter only.
    # Shared assess/remediate/verify behavior lives in runtime modules.
    # The builder combines this adapter and the runtime into the generated Automation Group bundle.
    Invoke-A1CMSmbServerConfigurationControl `
        -Context $Context `
        -PropertyName 'RequireSecuritySignature' `
        -DesiredValue $enabled `
        -EffectDescription 'Configured SMB server signing policy affects future inbound SMB connection negotiation without claiming the state of already established sessions.'
}

function Invoke-A1CMControl_SmbClientInsecureGuestAuth {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [PSCustomObject]$Parameters
    )

    $enabled = [bool]$Parameters.enabled

    # Control-specific adapter only.
    # Shared assess/remediate/verify behavior lives in runtime modules.
    # The builder combines this adapter and the runtime into the generated Automation Group bundle.
    Invoke-A1CMSmbClientConfigurationControl `
        -Context $Context `
        -PropertyName 'EnableInsecureGuestLogons' `
        -DesiredValue $enabled `
        -EffectDescription 'Configured SMB client guest-authentication policy affects future SMB connection attempts without claiming the state of already established sessions.'
}

function Invoke-A1CMControl_SmbServerRequireEncryption {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [PSCustomObject]$Parameters
    )

    $enabled = [bool]$Parameters.enabled

    # Control-specific adapter only.
    # Shared assess/remediate/verify behavior lives in runtime modules.
    # The builder combines this adapter and the runtime into the generated Automation Group bundle.
    Invoke-A1CMSmbServerConfigurationControl `
        -Context $Context `
        -PropertyName 'EncryptData' `
        -DesiredValue $enabled `
        -EffectDescription 'Configured SMB server encryption policy affects future SMB session negotiation without claiming the state of already established sessions.'
}

function Invoke-A1CMControl_SmbServerSmb1Protocol {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [PSCustomObject]$Parameters
    )

    $enabled = [bool]$Parameters.enabled

    # Control-specific adapter only.
    # Shared assess/remediate/verify behavior lives in runtime modules.
    # The builder combines this adapter and the runtime into the generated Automation Group bundle.
    Invoke-A1CMSmbServerConfigurationControl `
        -Context $Context `
        -PropertyName 'EnableSMB1Protocol' `
        -DesiredValue $enabled `
        -EffectDescription 'Configured SMB server protocol policy affects future SMB negotiation without claiming the state of already established sessions or the installation state of optional Windows features.'
}

function Invoke-A1CMControl_SmbServerDefaultWorkstationShares {
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Context,

        [Parameter(Mandatory)]
        [PSCustomObject]$Parameters
    )

    $enabled = [bool]$Parameters.enabled

    # Control-specific adapter only.
    # Shared assess/remediate/verify behavior lives in runtime modules.
    # The builder combines this adapter and the runtime into the generated Automation Group bundle.
    Invoke-A1CMSmbServerConfigurationControl `
        -Context $Context `
        -PropertyName 'AutoShareWorkstation' `
        -DesiredValue $enabled `
        -EffectDescription 'Configured SMB server share-publication policy affects future exposure of default administrative workstation shares without claiming the state of unrelated custom shares.'
}

$script:A1CMControlOrder = @(

    'smb.client.require-signing',
    'smb.server.require-signing',
    'smb.client.insecure-guest-auth',
    'smb.server.require-encryption',
    'smb.server.smb1-protocol',
    'smb.server.default-workstation-shares'

)

$script:A1CMControlDefinitions = @{

    'smb.client.require-signing' = [PSCustomObject]@{
        ControlId = 'smb.client.require-signing'
        ControlVersion = '0.1.0'
        ControlName = 'Require SMB client signing'
        EntryPoint = 'Invoke-A1CMControl_SmbClientRequireSigning'
        ParameterDefinitionsJson = '[{"id":"enabled","type":"boolean","label":"Enabled","description":"Whether the SMB client requires security signatures for outbound SMB connections.","required":true,"defaultValue":true}]'
    }
    'smb.server.require-signing' = [PSCustomObject]@{
        ControlId = 'smb.server.require-signing'
        ControlVersion = '0.1.0'
        ControlName = 'Require SMB server signing'
        EntryPoint = 'Invoke-A1CMControl_SmbServerRequireSigning'
        ParameterDefinitionsJson = '[{"id":"enabled","type":"boolean","label":"Enabled","description":"Whether the SMB server component requires security signatures for inbound SMB connections.","required":true,"defaultValue":true}]'
    }
    'smb.client.insecure-guest-auth' = [PSCustomObject]@{
        ControlId = 'smb.client.insecure-guest-auth'
        ControlVersion = '0.1.0'
        ControlName = 'Allow insecure SMB guest authentication'
        EntryPoint = 'Invoke-A1CMControl_SmbClientInsecureGuestAuth'
        ParameterDefinitionsJson = '[{"id":"enabled","type":"boolean","label":"Enabled","description":"Whether the SMB client allows insecure guest logons.","required":true,"defaultValue":false}]'
    }
    'smb.server.require-encryption' = [PSCustomObject]@{
        ControlId = 'smb.server.require-encryption'
        ControlVersion = '0.1.0'
        ControlName = 'Require SMB server encryption'
        EntryPoint = 'Invoke-A1CMControl_SmbServerRequireEncryption'
        ParameterDefinitionsJson = '[{"id":"enabled","type":"boolean","label":"Enabled","description":"Whether the SMB server component requires SMB encryption.","required":true,"defaultValue":true}]'
    }
    'smb.server.smb1-protocol' = [PSCustomObject]@{
        ControlId = 'smb.server.smb1-protocol'
        ControlVersion = '0.1.0'
        ControlName = 'SMB1 server protocol'
        EntryPoint = 'Invoke-A1CMControl_SmbServerSmb1Protocol'
        ParameterDefinitionsJson = '[{"id":"enabled","type":"boolean","label":"Enabled","description":"Whether the SMB server component allows SMB1.","required":true,"defaultValue":false}]'
    }
    'smb.server.default-workstation-shares' = [PSCustomObject]@{
        ControlId = 'smb.server.default-workstation-shares'
        ControlVersion = '0.1.0'
        ControlName = 'Default workstation shares'
        EntryPoint = 'Invoke-A1CMControl_SmbServerDefaultWorkstationShares'
        ParameterDefinitionsJson = '[{"id":"enabled","type":"boolean","label":"Enabled","description":"Whether the SMB server component publishes default administrative workstation shares.","required":true,"defaultValue":false}]'
    }

}

Invoke-A1CMGroup -PolicyConfiguration $policyConfiguration -AutomationGroupId 'smb.security' -AutomationGroupVersion '0.1.0' -AutomationGroupName 'SMB Security' -FamilyId 'network-security' -FamilyName 'Network Security' -ControlOrder $script:A1CMControlOrder -ControlDefinitions $script:A1CMControlDefinitions

if ($env:A1CM_TEST_MODE -ne '1') { exit $global:A1CM_ExitCode }