---
name: Universal Application Architecture
description: Use whenever the user asks where code belongs; how UI, API, transport, domain, capabilities, vendors, databases, web, mobile, desktop, server, worker, CLI, or local-first layers communicate; or requests architecture design, review, refactoring, dependency-boundary checks, or separation of business logic from delivery and infrastructure code.
providers: [claude, codex]
model: inherit
store-description: A universal responsibility-based architecture workflow covering UI, transport, domain, capabilities, vendor adapters, persistence, offline synchronization, and cross-platform boundaries.
---

# Universal Application Architecture

Use this skill when the user wants to design, review, explain, scaffold, or reorganize an application architecture. It applies to web, mobile, desktop, server, background-worker, CLI, online, offline, and local-first applications.

Do not assume every platform exists. Inspect the request and repository, identify the active platforms, and apply only the relevant sections. Preserve the same responsibility boundaries on every platform.

## Working behavior

First determine what the user asked for:

- For a design request, propose the layer map, package ownership, dependency rules, and representative request flows.
- For a placement question, name the correct layer, explain why, list allowed dependencies, and identify what must be split out.
- For a review or audit, inspect the repository before drawing conclusions. Report misplaced responsibilities, forbidden imports, bypassed boundaries, and mixed-purpose modules with file evidence.
- For an implementation or reorganization request, inspect existing conventions, make the requested edits, preserve unrelated work, and verify relevant checks.
- Do not edit files when the user asked only for an explanation, review, or diagnosis.

When information is missing, make safe, reversible assumptions if the intent is still clear. Ask a concise question only when platform, scope, or product behavior would materially change the architecture.

## Core architecture

Organize code into six responsibility layers:

1. UI
2. Transport and application entry points
3. Domain
4. Capabilities
5. Vendor and platform adapters
6. Supporting foundations

The primary runtime flow is:

```text
UI
→ Transport or application entry point
→ Domain
→ Capabilities
→ Vendor/platform adapters or supporting foundations
```

Possible application locations include:

```text
apps/web
apps/mobile
apps/desktop
apps/server
apps/worker
apps/cli
```

Possible shared packages include:

```text
packages/api
packages/core
packages/shared
packages/database
packages/payments
packages/storage
packages/email
packages/analytics
```

Names may differ. Classify code by responsibility, not merely by its current directory.

## 1. UI layer

The UI displays information, collects input, manages presentation state, and sends user intentions into the application.

### Web UI may contain

- Pages, routes, layouts, and navigation
- Components, forms, dialogs, tables, charts, and design-system elements
- Client-side state, query state, filters, sorting, and pagination state
- Loading, empty, error, and optimistic states
- Browser-specific behavior and accessibility
- Presentation formatting and view-model mapping
- Typed Transport client hooks and calls

### Mobile UI may contain

- Screens, navigation stacks, tabs, sheets, and modals
- Touch, gesture, keyboard, orientation, and safe-area behavior
- Mobile forms and presentation state
- Permission-request screens
- Offline and synchronization indicators
- Push-notification presentation
- Deep-link navigation after the link has been parsed and validated
- React Native, SwiftUI, UIKit, Compose, or Android views

### Desktop UI may contain

- Windows, panels, menus, toolbars, dialogs, and tray interfaces
- Renderer-process components
- Window presentation state and keyboard shortcuts
- Drag-and-drop presentation
- File-picker and update presentation
- Electron, Tauri, .NET, Swift, Qt, or other desktop views

### Shared UI may contain

- Design tokens, icons, colors, and typography
- Framework-compatible visual primitives
- Presentation models and formatting functions
- Reusable feature components that are genuinely portable

Do not force unlike platform behavior into a single abstraction. Prefer shared business behavior and small platform adapters over large modules full of platform conditionals.

### UI rules

UI may use a typed Transport client, a restricted local application bridge, and safe shared contracts.

UI must not directly:

- Query production or local persistence as a shortcut around application boundaries
- Import ORM models
- Call remote vendor SDKs such as Stripe, S3, email providers, or PostHog
- Store privileged server secrets
- Implement authoritative business rules or trusted authorization
- Access unrestricted desktop operating-system APIs
- Access sensitive native APIs without a Capability boundary

Client validation improves feedback. Transport and Domain validation remain authoritative.

## 2. Transport and application entry layer

Transport is any boundary that delivers a command, query, event, or message into the application. It is not limited to HTTP.

### Network transport

- REST and HTTP endpoints
- RPC procedures
- GraphQL resolvers
- WebSockets and Server-Sent Events
- Streaming endpoints
- File-upload endpoints
- Incoming webhooks

### Web client transport

- Typed API or RPC clients
- Transport links and base URL configuration
- Safe header, cookie, serialization, cancellation, timeout, and retry behavior
- Query-client integration
- Client transport error normalization

### Mobile transport

- Mobile API clients
- Native-module bridges
- Push-notification receivers
- Deep-link, universal-link, and app-link receivers
- Operating-system intent handlers
- Background fetch and mobile background-task entry points
- Share extensions and other app-extension entry points

### Desktop transport

- Renderer-to-main-process IPC
- Electron handlers and restricted preload bridges
- Tauri commands
- Native message bridges
- File-open and custom URL protocol events
- Menu, tray, global-shortcut, and update event handlers
- Local sockets or named pipes

### Backend and automation transport

- Queue consumers and event subscribers
- Scheduled jobs and cron handlers
- Background workers
- Service-to-service handlers

### CLI transport

- CLI commands and argument parsing
- Standard-input parsing
- Interactive command prompts
- Console formatting and exit-code mapping

### Local-only applications

A local-only mobile or desktop application may have no remote server. Its flow is still layered:

```text
UI
→ local controller, IPC handler, or native bridge
→ Domain
→ Capabilities
→ local database, filesystem, device, or operating-system adapter
```

### Transport owns

Protocol parsing:

- Routes, query parameters, headers, cookies, bodies, multipart data, and uploads
- IPC, native bridge, push, deep-link, queue, webhook, CLI, and operating-system event payloads
- Serialization, deserialization, content types, and payload limits

Boundary validation:

- Required fields and primitive types
- String lengths, numeric ranges, enums, UUIDs, email addresses, and URLs
- File type and size
- Pagination limits
- Message schemas and protocol versions

Authentication:

- Reading and verifying sessions or tokens
- Resolving the authenticated actor
- Token expiry checks
- Webhook signature verification
- Service identity verification
- IPC sender validation

Coarse access control:

- Requiring authentication
- Requiring a role, tenant membership, or API scope
- Restricting internal endpoints and privileged IPC commands

Request or execution context:

- Actor, tenant, request ID, correlation ID, locale, time zone, platform, device information, app version, trace context, and approved feature flags

Middleware and protocol concerns:

- CORS, CSRF protection, security headers, rate limiting, request limits, timeouts, cancellation, compression, idempotency-key extraction, trace propagation, request logging, and API version negotiation

Response translation:

- HTTP status codes, RPC errors, CLI exit codes, IPC responses, native bridge responses, serialization, streaming, safe errors, and caching headers

Operational observability:

- Request duration, response status, endpoint metrics, correlation IDs, traces, error counts, and delivery failures

### Transport does not own

- Pricing, eligibility, refund, subscription, ownership, or workflow decisions
- Business state transitions
- Business authorization tied to a specific entity or invariant
- Vendor SDK operations
- Arbitrary database queries
- Product analytics decisions
- Large business workflows

Use this distinction:

- “Is the delivered message structurally valid?” belongs in Transport.
- “Is this business operation allowed?” belongs in Domain.

### Standard entry-point sequence

1. Receive the message.
2. Parse its platform-specific format.
3. Validate its structure.
4. Authenticate when applicable.
5. Apply coarse access control.
6. Build an application-owned command or query.
7. Call one Domain use case.
8. Translate the result into the platform response.
9. Map errors safely.
10. Record operational telemetry.

Transport handlers should remain thin enough that their delivery role is obvious.

### Transport security

- Treat browsers and mobile applications as untrusted clients.
- Never embed privileged server secrets in client applications.
- Validate all remote input on the trusted side.
- In desktop applications, treat the renderer as a UI boundary.
- Expose only an allowlisted IPC or native bridge.
- Validate every IPC message and keep privileged OS access outside the renderer.

## 3. Domain layer

Domain contains platform-independent product meaning and business behavior. The same use case should work from web, mobile, desktop, CLI, webhook, or worker entry points.

Domain may contain:

- Entities, value objects, aggregates, identifiers, and state machines
- Use cases, commands, queries, and application services
- Business policies, invariants, eligibility, pricing, ownership, and approval rules
- Business authorization and state transitions
- Workflow coordination
- Domain events and errors
- Repository and Capability contracts owned by the application
- Application-owned inputs and results

Domain must not know about:

- UI frameworks
- HTTP, RPC, WebSockets, IPC, push payloads, deep links, or CLI arguments
- Framework request objects
- ORM records or raw SQL
- Vendor SDKs
- Device and operating-system APIs
- Environment-variable access scattered through business logic

Domain may call Capability APIs and persistence abstractions. It must not import UI, Transport, frameworks, raw vendor SDKs, or platform-specific APIs.

## 4. Capabilities layer

Capabilities define stable operations the application needs without exposing a particular vendor, device, framework, or operating system.

Server-oriented examples:

- Payments, email, storage, analytics, search, authentication, notifications, tax, PDF generation, AI services, and message publishing

Device-oriented examples:

- Camera, photos, microphone, location, biometrics, contacts, clipboard, secure storage, local notifications, file selection, sharing, haptics, and connectivity

Desktop-oriented examples:

- Filesystem, native dialogs, tray, window management, global shortcuts, auto-update, printing, credential storage, and local process integration

Local-first examples:

- Local persistence, synchronization, conflict detection, command queueing, offline storage, cache management, and connectivity monitoring

Capability rules:

- Expose application-owned names, inputs, outputs, and errors.
- Keep APIs small and intentional.
- Hide SDK objects, native handles, provider responses, and platform terminology.
- Provide separate adapters where platform behavior differs.
- Normalize implementation errors.
- Do not import UI or Transport.
- Allow implementations to be replaced without rewriting Domain.

Prefer `chargePayment(input): PaymentResult` over a provider-specific method such as `createStripePaymentIntent`.

## 5. Vendor and platform adapter layer

Adapters implement Capabilities using particular providers, devices, frameworks, or operating systems.

Examples include:

- Stripe, S3, PostHog, SendGrid, Twilio, Auth0, Algolia, OpenAI, APNs, and FCM
- iOS Keychain, Android Keystore, StoreKit, and Google Play Billing
- Windows Credential Manager, macOS Keychain, native filesystem and notification APIs
- Electron or Tauri plugins
- Browser IndexedDB, service workers, Web Notifications, Web Share, and browser file APIs

Adapter rules:

- Keep platform-specific imports inside adapters.
- Translate Capability inputs into provider or platform calls.
- Translate implementation results into application-owned outputs.
- Normalize provider-specific errors.
- Do not make business decisions.
- Do not expose provider SDK types upward.
- Do not import UI components.
- Keep credentials in the correct trusted environment.

## 6. Supporting foundations

### Shared package

Shared foundations may contain:

- Stable contracts and serialization-safe types
- Shared schemas and branded identifiers
- Date, money, result, and other framework-independent primitives
- Small, genuinely shared utilities
- Platform-neutral test factories

Shared must not become a miscellaneous dumping ground or contain business workflows, UI components, vendor SDKs, or arbitrary persistence logic. It must not import higher layers.

### Database and persistence

Persistence foundations may contain:

- Database and ORM setup
- Schemas, tables, migrations, and connection management
- Queries, transactions, repositories, and persistence adapters
- Record-to-application mapping
- Persistence errors and test utilities
- Server databases, SQLite, IndexedDB, embedded databases, or encrypted local stores

Persistence rules:

- UI must not access persistence directly as a shortcut.
- Transport must not issue arbitrary queries.
- Domain uses repositories or narrow persistence abstractions.
- ORM and record types must not leak into Domain.
- Business decisions must not hide inside queries or ORM hooks.
- Database integrity constraints remain appropriate in the database.

## Offline and synchronization

For offline or local-first applications:

- UI displays offline, pending, optimistic, and conflict states.
- Transport receives synchronization messages and delivers queued commands.
- Domain protects invariants and owns business-specific conflict or merge policy.
- Capabilities define synchronization, connectivity, queue, and local repository APIs.
- Adapters store pending commands, detect connectivity, run background synchronization, and communicate with remote services.

Do not put business conflict-resolution rules inside UI components or raw synchronization handlers.

## Cross-cutting ownership

### Authentication

- Login presentation: UI
- Token or session parsing: Transport
- Identity-provider integration: Capability and adapter
- Secure credential storage: Capability and platform adapter
- Business access decisions: Domain

### Push notifications

- Provider delivery: Vendor adapter
- Device receipt: Transport
- Meaning and resulting business action: Domain
- Presentation: UI or notification Capability
- Token persistence: narrow persistence API

### Deep links

- Receipt and parsing: Transport
- Navigation presentation: UI
- Permission and business validation: Domain

### Payments

- Checkout presentation: UI
- Delivered request validation: Transport
- Eligibility and policy: Domain
- Stable payment API: Capability
- Stripe, StoreKit, or Play Billing: Adapter

### Files

- Picker presentation: UI
- File event intake: Transport
- Permitted business use: Domain
- Stable file operations: Capability
- Browser, device, desktop, or cloud implementation: Adapter
- Metadata persistence: Database

### Analytics and logging

- UI may report interaction intent.
- Domain decides important product events.
- Analytics Capability exposes the stable API.
- PostHog or another SDK stays in an adapter.
- Request timing, response status, and error counts are Transport telemetry.
- Database performance telemetry belongs with persistence infrastructure.

### Validation

- Immediate form feedback: UI
- Message shape and protocol validation: Transport
- Business rule validation: Domain
- Provider constraints: Capability or adapter
- Data integrity constraints: Database

### Errors

- User-facing presentation: UI
- Protocol/status mapping: Transport
- Business errors: Domain
- Stable integration errors: Capabilities
- Provider-specific errors: Adapters
- Persistence errors: Database

## Dependency policy

Generally allowed:

```text
Platform UI → platform Transport/client
Transport → Domain public API
Domain → Capability APIs
Capabilities → Vendor/platform adapters at runtime through intentional wiring
Domain → persistence abstractions
Persistence implementations → shared foundations
Appropriate layers → stable shared contracts
```

Forbidden shortcuts:

```text
UI → raw database
UI → privileged vendor or operating-system APIs
UI → internal Domain implementation
Transport → arbitrary database queries
Transport → vendor SDKs
Domain → UI or Transport
Domain → protocol or native frameworks
Domain → vendor SDKs
Adapters → UI
Database → UI or Transport
Shared foundations → higher platform layers
```

Where dependency inversion is used, distinguish runtime call direction from source import direction. Define stable ports with the application-owned layer and wire concrete adapters at a composition root. Do not introduce circular package dependencies.

## Placement test

Before placing or moving code, ask:

- Does it display information or collect input? Place it in UI.
- Does it receive HTTP, RPC, IPC, CLI, push, deep-link, queue, cron, webhook, native bridge, or OS messages? Place it in Transport.
- Does it parse, authenticate, structurally validate, or translate a delivered message? Place it in Transport.
- Does it decide what the product should do? Place it in Domain.
- Does it describe a stable operation needed from a service, device, or OS? Place it in Capabilities.
- Does it use a particular provider, SDK, native API, or OS API? Place it in an adapter.
- Is it a stable framework-independent contract or primitive? Place it in shared foundations.
- Does it persist or retrieve data? Place it in a persistence implementation.

If a file answers more than one question, split it into responsibility-specific modules connected through explicit application-owned interfaces.

## Required output

When applying this skill, report only the sections useful to the request. For a full architecture design or audit, include:

1. Detected platforms and entry points
2. Proposed or observed layer map
3. Responsibility and file-placement decisions
4. Allowed communication paths
5. Forbidden or suspicious dependencies
6. Platform-specific adapters
7. Persistence and offline strategy when relevant
8. Recommended changes in priority order
9. Verification performed or still needed

Prefer concrete repository paths and examples over abstract advice. Do not force additional layers, packages, or abstractions when the project is simple enough not to need them.
