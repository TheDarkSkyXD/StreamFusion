---
name: superdev-setup
description: "Configure a repository for SuperDev by setting its issue tracker, triage labels, domain docs, role-to-model map, and reasoning budget. Use for /superdev-setup, first-time SuperDev setup, SuperDev budget, or changes to either configuration."
---

# SuperDev setup

Configure the repository conventions and model choices that SuperDev skills share.

For a first-time setup or a general rerun, complete both parts in order:

1. Read and follow [repository setup](./references/repository-setup.md).
2. Read and follow [SuperDev model setup](./references/superdev-models.md).

If the user asks to change only the issue tracker, triage labels, domain layout, SuperDev models, or reasoning budget, run only the relevant part. Inspect current files before editing so reruns preserve choices outside the requested change.

At the end, list the files created or updated. Explain that SuperDev skills read these files directly and that rerunning `$superdev-setup` updates the configuration.
