---
name: shipping-deploy-config
description: Fan-out checklist for deployment-affecting changes (env vars, volumes, ports, upload formats) — the manifests that must change together. Use when touching .env.example, Dockerfile, docker-compose.yml, or anything an operator configures.
---

# Shipping deployment config

Read [Changing deployment configuration](../../../docs/development/deployment-configuration.md) before editing manifests. That guide is the source of truth for the files that move together and the container's runtime constraints.

Workflow:

1. Identify every affected deployment surface from the guide's checklist.
2. Update the application and all relevant manifests together.
3. Update operator documentation.
4. Run `pnpm check` and test the affected deployment path.
