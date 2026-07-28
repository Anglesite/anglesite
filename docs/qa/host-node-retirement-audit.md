# Host Node Retirement Audit

**Issues:** [#59](https://github.com/Anglesite/Anglesite/issues/59), [#70](https://github.com/Anglesite/Anglesite/issues/70)  
**Scope:** #70 retirement checklist for the embedded host Node path.

## Purpose

The host subprocess runtime has been removed from the app path. This audit keeps the retired
surface visible while #70 waits on container validation evidence before merge.

Run:

```sh
scripts/audit-host-node-retirement.sh
```

Expected:

- The command exits 0.
- It prints `No tracked host-side Node dependencies remain.`

## Retirement Gate

Before merging #70, rerun:

```sh
scripts/audit-host-node-retirement.sh --expect-retired
```

Expected after #70 cleanup:

- The command exits 0.
- It prints `No tracked host-side Node dependencies remain.`

Fail if it reports bundled Node scripts/resources, npm cache resources, or the retired host preview
runtime. `ProcessSupervisor` and the MCP stdio transport are generic test/tooling surfaces and are
not part of this retirement gate.

## Evidence To Record On #70

- Commit or PR that removes each tracked dependency.
- Output of `scripts/audit-host-node-retirement.sh --expect-retired`.
- Confirmation that the app build no longer runs the Node vendor/re-sign phases.
- Confirmation that app entitlements no longer carry host-Node-only JIT carve-outs.
