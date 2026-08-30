# StreamFusion Mobile

The Android client delivers StreamFusion outcomes through Expo, React Native, Android adapters, and targeted native modules. It remains a separate client from StreamFusion Desktop.

## Language

**Android Outcome Parity**:
The Android client lets a user complete the same supported product goal as the current Desktop Capability. Android may use a different layout, interaction, lifecycle, or implementation.
_Avoid_: Feature parity, screen parity, implementation parity.

**Desktop Baseline**:
The canonical Desktop outcome inventory used to assess one Android candidate. The baseline records the observed `main` commit, but its outcome digest determines parity freshness.
_Avoid_: Latest commit, Desktop version.

**Android Parity Record**:
The record for one Desktop Capability ID. It keeps delivery, progress, freshness, blockers, evidence, approvals, and any Development Exception separate.
_Avoid_: Status row, parity checkbox.

**Adaptation**:
An approved Android behavior that preserves Android Outcome Parity through a different interaction, lifecycle, or visible limit. An unavailable outcome is not an Adaptation.
_Avoid_: Exception, degradation, missing feature.

**Compatibility Integration**:
An Android adapter that uses a Platform behavior outside a documented public contract because no official path can deliver a parity-critical outcome. Each Compatibility Integration is isolated, observable, remotely disableable, covered by stronger verification, paired with an explicit fallback, and governed by a removal policy.
_Avoid_: Unofficial API, workaround, official integration.

**Integration Relay**:
The trusted hosted boundary for operations an installed Android client cannot safely or reliably perform, including secret-backed public reads, Platform event receipt, Live Notification delivery, foreground Kick chat fan-out, and signed capability policy. It does not own user Platform credentials or device-owned StreamFusion data.
_Avoid_: Backend, API server, general proxy.

**Installation Identity**:
The random device-local identity and rotating relay credential that represent one installed Android app instance to the Integration Relay. It is not a StreamFusion account, hardware identifier, or push token.
_Avoid_: User account, device ID, push token.

**Capability Manifest**:
The versioned, expiring, signed policy that states whether each Compatibility Integration may run. Android accepts only a valid signature and monotonic version, caches the last valid manifest, and otherwise applies baked safe defaults.
_Avoid_: Feature flags, remote config, kill-switch response.

**Development Exception**:
A temporary authorization for an access-controlled development build to miss a parity requirement. A Development Exception never satisfies parity and always blocks public release.
_Avoid_: Waiver, accepted gap, release exception.

**Evidence Set**:
Immutable references to the automated results, Android device runs, live Platform probes, approvals, and release checks required by policy. Each reference binds to the Desktop Baseline and the Android candidate it proves.
_Avoid_: Test list, screenshots, proof notes.

**Public Android Release**:
Any Android APK published where people outside the project can download it. A published GitHub prerelease is public. A draft release or an access-controlled development artifact is not public.
_Avoid_: Stable release when referring to all public APKs.

**Android Release Gate**:
The single publish decision that combines Android Outcome Parity, current evidence, policy approval, and final signed APK checks. Every condition must pass.
_Avoid_: Release checklist, parity score.

**Parity-Qualified Device**:
An installable Android device that passes the lowest approved runtime profile and therefore belongs to StreamFusion Mobile's public support contract.
_Avoid_: Supported model, compatible device, high-end device.

**Capability Profile**:
The current measured record of the Android workloads that one device can sustain while preserving Android Outcome Parity.
_Avoid_: Hardware tier, device class, model allowlist.

**Runtime Degradation**:
A temporary, visible reduction in concurrency, quality, or duration that protects a focused task or recoverable artifact without removing an Android outcome.
_Avoid_: Unsupported feature, silent fallback, permanent Adaptation.
