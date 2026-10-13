# Windows Endpoint Configuration Control Pack 0.10.1

This document describes the Windows configuration Controls and security baseline mappings included in **Control Pack version 0.10.1** for Action1 Configuration Manager.

Control Pack 0.10.1 includes **399 Controls across 12 Control families**, with mappings for supported recommendations from:

- **CIS Microsoft Windows 11 Enterprise Benchmark v5.1.0**
- **Microsoft Windows 11 25H2 Security Baseline**

Baseline mappings include recommendations supported by the current Control Pack and do not represent complete coverage of every recommendation in either baseline.

## Control families

### Identity & Access

Controls for Windows authentication, sign-in, account protection, and access security, including:

- password and account lockout policies;
- User Account Control (UAC);
- Windows sign-in and authentication settings;
- NTLM, LDAP, and Kerberos security;
- anonymous access restrictions;
- Netlogon security.

### Threat Protection

Controls for built-in Windows threat protection and security features, including:

- Microsoft Defender Antivirus protection and scanning;
- real-time and behavior monitoring;
- cloud-delivered protection;
- potentially unwanted application protection;
- phishing and credential protection;
- virtualization-based security.

### Audit & Logging

Controls for Windows security auditing and event collection, including:

- Advanced Audit Policy settings;
- Windows event log configuration;
- PowerShell logging;
- process creation and command-line auditing;
- account, logon, policy change, privilege use, and system auditing.

### Network Security

Controls for protecting Windows network communications and reducing network exposure, including:

- Windows Firewall;
- SMB security;
- RPC security;
- name resolution and network discovery;
- proxy and DNS settings;
- network authentication and communication settings;
- Windows network-stack hardening.

### Remote Access

Controls for securing remote administration and remote connectivity, including:

- Remote Desktop;
- Remote Assistance;
- Windows Remote Management (WinRM);
- Remote Shell;
- remote-access services and related security settings.

### Devices & Hardware

Controls for device access and hardware-related Windows security, including:

- removable storage restrictions;
- device installation policies;
- biometric settings;
- BitLocker and pre-boot security;
- DMA protection;
- power and sleep security settings.

### Printing

Controls for Windows printing security, including:

- Point and Print;
- print driver installation;
- Print RPC;
- Print Spooler security;
- protected printing settings.

### Applications

Controls for Windows application installation, execution, and platform features, including:

- App Installer;
- Microsoft Store;
- Windows Installer;
- File Explorer;
- Windows Runtime;
- application compatibility features;
- Windows Sandbox.

### Windows Experience & Privacy

Controls for Windows user experience, privacy, cloud integration, and data collection, including:

- diagnostic data and telemetry;
- personalization;
- activity history;
- cloud and consumer features;
- Windows Search;
- lock-screen features;
- camera access;
- application privacy settings.

### Web & Internet Security

Controls for Windows web, certificate, and Internet security settings, including:

- TLS configuration;
- certificate handling;
- Internet and Local Intranet security zones;
- ActiveX and legacy web components;
- locked-down security zones and related restrictions.

### Update & Servicing

Controls for Windows Update behavior and servicing configuration.

### Windows Services & Platform

Controls for Windows services and core operating-system behavior, including:

- Windows service startup and security settings;
- network discovery services;
- diagnostic services;
- server services;
- Windows Time;
- Group Policy processing and related platform settings.

## Security baseline mappings

Control Pack 0.10.1 includes mappings for supported recommendations from the following security baselines.

### CIS Microsoft Windows 11 Enterprise Benchmark v5.1.0

Supported CIS recommendations are mapped to the corresponding Controls in the pack. These mappings make it possible to select the supported CIS configuration recommendations when creating a Policy.

The mapping covers recommendations that can be represented and managed by the current Configuration Manager Control model. Recommendations that require capabilities outside that model, additional validation, or further implementation are not included as supported Controls in this release.

### Microsoft Windows 11 25H2 Security Baseline

Supported recommendations from the Microsoft Windows 11 25H2 Security Baseline are mapped to the corresponding Controls in the pack.

As with the CIS mapping, the included mappings represent recommendations supported by the current Control Pack and should not be interpreted as complete coverage or certification against the full Microsoft baseline.

## Important considerations

Windows can prevent or delay some configuration changes depending on the endpoint state and operating-system protections. A Control may therefore report a result other than successful remediation even when the requested configuration is valid.

### Restart requirements

Some Windows settings do not take full effect until Windows or a related service is restarted. When a restart is required, Configuration Manager does not force an immediate endpoint restart as part of the Control unless the Control specifically requires that behavior.

An endpoint may therefore continue to report its previous effective state until the required restart has occurred and the Control is evaluated again.

### Windows security protections

Windows security features can prevent certain settings from being changed programmatically. For example, Microsoft Defender settings protected by **Tamper Protection** may reject a remediation attempt while Tamper Protection is enabled.

In these cases, the Control reports the result instead of attempting to bypass the Windows protection. The underlying Windows protection or management configuration must be addressed before remediation can succeed.

### Hardware and Windows feature dependencies

Some Controls apply only when the endpoint has the required hardware capability, Windows feature, service, or installed component.

A Control may report that a setting is not applicable when the required capability is not present. Examples can include settings that depend on security hardware, virtualization-based security, BitLocker capabilities, or optional Windows components.

### Other management policies

Settings managed by Active Directory Group Policy, Microsoft Intune, or another configuration-management system may override or conflict with settings applied by Configuration Manager.

When the same Windows setting is managed from multiple sources, the effective endpoint configuration depends on Windows policy processing and the precedence of those management sources.

