# Continuous Android parity contract

- Status: proposed design for [Define the continuous parity contract and Android release gate](https://github.com/TheDarkSkyXD/StreamFusion/issues/101), pending product approval
- Desktop source: [generated capability ledger](./desktop-parity-inventory.md)
- Machine contract: [`android-parity-contract.schema.json`](./android-parity-contract.schema.json)

## Decision

StreamFusion measures Android parity against the semantic Desktop outcome inventory. Every Desktop Capability ID has exactly one Android Parity Record. The record separates progress, delivery, freshness, blockers, evidence, approvals, and Development Exceptions.

A Public Android Release must match the latest Desktop outcome inventory at promotion time. Every capability must be verified through either direct or adapted delivery. All evidence must be current for the candidate. No blocker or Development Exception may remain.

Published GitHub prereleases are public and pass the same gate as stable releases. Incomplete builds stay in access-controlled EAS distribution or private CI artifacts.

## Contract boundaries

The contract compares user outcomes. It does not compare Electron and Android internals, route shapes, layouts, or source trees.

The existing Desktop inventory owns capability IDs and outcome descriptions. The future Android parity manifest owns Android delivery decisions and evidence references. Neither client owns the other client's implementation.

Automation establishes facts such as coverage, digests, test results, device observations, expiry, and APK identity. A human approves product equivalence, permanent Adaptations, Platform risk, and promotion. An approval cannot override a failed automated fact.

## Desktop baseline

The Desktop generator will produce these values from canonical JSON:

- `structuralInventoryDigest` covers the complete normalized structural inventory. It provides drift and audit evidence.
- `outcomeInventoryDigest` covers the ordered platform-neutral capability contract.
- `desktopCapabilityDigest` covers one capability's outcome and acceptance criteria.
- `acceptanceCriteriaDigest` covers the ordered criteria for one capability.

Use RFC 8785 canonical JSON and SHA-256. Sort capabilities by `id` and criteria by criterion ID before hashing.

The outcome digest excludes routes, Electron boundaries, source paths, and Desktop test filenames. A refactor must not invalidate Android proof when the user outcome stays the same. A Desktop change that changes a user outcome must update that capability's outcome or criteria, which changes its digest.

The observed Desktop `main` commit remains part of the baseline for audit. Commit equality does not decide freshness. This allows promotion after an unrelated `main` change when the regenerated outcome digest remains identical.

The current structural scanner cannot infer every behavior change inside an existing file. Desktop review must classify user-visible changes and update the outcome contract when required.

## Android parity record

The JSON Schema defines the transport shape. A later validator computes progress and freshness from the source contract, evidence policy, evidence artifacts, and candidate APK. CI rejects stored computed values that differ from recomputation.

Each active Desktop Capability ID appears exactly once as a key in `capabilities`. Removed Desktop capabilities leave the active manifest. Historical release records retain their earlier evidence.

### Progress

Progress records how far Android work has advanced:

| Value         | Meaning                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| `unassessed`  | No current Android outcome specification and delivery approval exist.          |
| `specified`   | The Android outcome criteria and delivery choice have current approvals.       |
| `implemented` | Candidate behavior exists, but required verification is incomplete or failing. |
| `verified`    | Every evidence requirement passes with current bindings.                       |

`blocked` is not a progress value. Blockers remain issue references so the record can say what exists and what prevents completion without collapsing those facts into one label.

### Delivery

Delivery has two values:

- `direct` preserves the outcome without a material Android limit. Android-native layout, permissions, navigation, and system dialogs do not make delivery adapted by themselves.
- `adapted` preserves the supported user goal through a material Android-specific flow or visible limit.

An Adaptation is acceptable only when all conditions hold:

1. The supported user goal and effect remain available.
2. Platform scope, privacy intent, and security intent remain intact.
3. The app explains a visible limit before it affects the user's work.
4. Failure leaves a clear recovery path or a recoverable artifact.
5. Acceptance criteria map the Android behavior to the Desktop outcome.
6. The approval binds to the current capability and criteria digests.
7. The behavior complies with the approved device and Platform policies.

An unavailable outcome on a supported device is not an Adaptation. It leaves the capability unverified unless the approved device policy places that device outside the supported contract.

### Freshness

Freshness is computed independently from progress:

| Value     | Meaning                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `missing` | At least one required evidence item or approval is absent.                                                                |
| `stale`   | Evidence exists but targets an old capability, criteria, policy, mobile commit, build, or APK, or exceeds its policy age. |
| `current` | Every required item matches the candidate and remains inside its policy age.                                              |

A Desktop outcome change makes only the affected capability evidence stale. A changed capability set also blocks the exact-set check.

## Development exceptions

A Development Exception permits incomplete work only in access-controlled development distribution. It never changes the outcome contract, progress, or freshness.

Every exception records:

- an owner.
- a tracking issue.
- a specific reason.
- affected evidence requirement IDs.
- an approval reference.
- an expiry time.
- removal criteria.
- the Desktop capability digest in force when approved.

The exception expires at its recorded time or when the capability digest changes, whichever occurs first. Renewal is a new approval.

No Development Exception may authorize embedded provider secrets, production signing-key misuse, destructive local-data behavior, or publication with an invalid package identity or signature.

A draft GitHub Release may stage an incomplete candidate because it is not public. Publishing either a stable release or a prerelease requires zero Development Exceptions.

## Evidence contract

Evidence points to immutable artifacts. A screenshot alone does not prove playback, background work, recovery, deep links, provider behavior, or installation.

The evidence policy will assign requirement IDs and decide which capabilities need each evidence class:

- deterministic unit, integration, and contract results.
- Android emulator or physical-device outcome runs.
- live Twitch and Kick probes for Platform-dependent behavior.
- performance, lifecycle, and recovery runs for native media work.
- end-to-end trusted-service and notification delivery results.
- accessibility review and product approval.
- final signed APK installation, upgrade, identity, integrity, and provenance checks.

Each evidence fact records its requirement ID, result, immutable artifact reference, observation time, Desktop capability digest, criteria digest, evidence-policy digest, mobile commit, build ID when applicable, and APK digest when applicable.

[Define Android verification and GitHub release evidence](https://github.com/TheDarkSkyXD/StreamFusion/issues/106) owns the detailed requirement matrix, supported artifact formats, device checks, and age limits. This contract owns the binding rules and their release effect.

## Continuous reconciliation

Desktop development does not wait for an Android implementation. It does acknowledge Android impact.

1. A Desktop pull request runs the existing structural inventory check.
2. A later parity validator compares the generated Desktop outcome inventory with the Android manifest.
3. A new capability requires a new `unassessed` Android Parity Record before merge.
4. A changed capability digest resets current Android proof for that capability.
5. A removed capability requires removal from the active Android manifest.
6. CI reports every changed record and its blockers. It does not allow a missing or silently stale record.
7. Android work advances each record through specification, implementation, and verification.

The structural inventory and the Android parity manifest remain separate files. Desktop owns the baseline. Android owns its response. The validator joins them by stable capability ID.

## Public release predicate

Let `L` be the semantic inventory generated from the latest Desktop `main` during promotion. Let `R` be the Android release decision record. Let `A` be the final signed APK.

```text
CAN_PUBLISH_PUBLIC_APK(R, L, A) =
  supportedSchema(R)
  AND R.visibility IN {"stable", "prerelease"}
  AND R.desktopBaseline.outcomeInventoryDigest = L.outcomeInventoryDigest
  AND keys(R.capabilities) = capabilityIds(L)
  AND allPolicyDigestsResolvedAndApproved(R)
  AND FOR EVERY capability c IN L:
        R.capabilities[c.id].specification.desktopCapabilityDigest = c.desktopCapabilityDigest
        AND R.capabilities[c.id].computed.progress = "verified"
        AND R.capabilities[c.id].computed.freshness = "current"
        AND validOutcomeApproval(R.capabilities[c.id], c)
        AND validDeliveryApproval(R.capabilities[c.id], c)
        AND blockerRefs(R.capabilities[c.id]) = []
        AND developmentException(R.capabilities[c.id]) = null
        AND allRequiredEvidencePassesWithExactBindings(c, R, A)
  AND allRequiredReleaseEvidencePassesWithExactBindings(R, A)
  AND apkSignatureVerified(A)
  AND apkPackageMatchesApprovedPolicy(A)
  AND apkVersionCodeIsMonotonic(A)
  AND apkDigestMatchesReleaseMetadata(A)
  AND apkBuildSourceMatches(R.mobileCandidate.commit)
  AND apkProvenanceMatchesApprovedPolicy(A)
  AND validPromotionApproval(digestOfCompleteReleaseDecision(R, A))
```

An unresolved policy digest evaluates false. This blocks publication until the related Wayfinder decision is approved and encoded.

The promotion workflow regenerates `L` immediately before publication. If the outcome digest changes, promotion stops and CI identifies the stale capabilities. The protected release job serializes the final digest check, approval, and publication so another release cannot reuse the decision record.

## Policy handoffs

This contract leaves four precise policy bodies to later Wayfinder decisions:

- [Define Android verification and GitHub release evidence](https://github.com/TheDarkSkyXD/StreamFusion/issues/106) defines evidence requirements, device checks, accessibility proof, security checks, and expiry.
- [Choose Android device support and constrained-capability policy](https://github.com/TheDarkSkyXD/StreamFusion/issues/108) defines supported API levels, device tiers, and applicability rules for constrained capabilities.
- [Choose the Platform integration support policy for Android](https://github.com/TheDarkSkyXD/StreamFusion/issues/109) defines allowed undocumented integrations, probes, fallbacks, disclosure, and removal rules.
- [Choose Android publisher, signing, and update ownership](https://github.com/TheDarkSkyXD/StreamFusion/issues/110) defines publisher identity, signing custody, build authority, production update policy, and updater scope.

Each approved policy produces a canonical policy digest. A Public Android Release requires all four digests and their approvals.

## Rejected alternatives

| Alternative                              | Reason                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| One parity status enum                   | It mixes progress, delivery, blockers, freshness, and exceptions. Contradictory states become possible. |
| Exact Desktop commit equality            | It invalidates Android proof for documentation, packaging, and refactors that do not change outcomes.   |
| A permanent waiver or Desktop-only state | It conflicts with the full Android Outcome Parity promise.                                              |
| Public beta with known parity gaps       | A published GitHub prerelease is public and shareable. It would break the stated release boundary.      |
| Tests as the only authority              | Tests establish facts. They cannot decide whether an Adaptation preserves the product outcome.          |

## Implementation sequence

Later implementation should land in verifiable units:

1. Add canonical Desktop outcome criteria and digest generation.
2. Add the Android manifest and schema validation with `unassessed` records allowed.
3. Add exact capability-set reconciliation and stale-record reporting to pull-request CI.
4. Add evidence ingestion and computed progress and freshness.
5. Add the strict public predicate to the protected Android promotion workflow.
6. Add the final current-`main` digest check immediately before GitHub publication.

Do not add strict public-release enforcement to ordinary Desktop builds. Desktop CI requires honest reconciliation. Only Android promotion requires every capability to be verified.

## Sources

- [Desktop parity inventory](./desktop-parity-inventory.md)
- [Android feasibility for Desktop capability parity](./android-full-parity-feasibility.md)
- [Twitch and Kick integration constraints on Android](./2026-08-29-android-twitch-kick-integration-constraints.md)
- [Signed GitHub APK delivery and update safety](./github-apk-delivery-and-update-safety.md)
- [StreamFusion feature map](../../../.agents/skills/streamfusion-feature-map/references/features.md)
- [StreamFusion Desktop domain language](../../../apps/desktop/CONTEXT.md)
- [StreamFusion Worker boundary](../../../apps/worker/CONTEXT.md)
