# Admin Component Docs

Updated: 2026-04-28
Status: current
Owner: frontend / admin surface

Purpose:
- make the admin component lane easier to enter
- separate route ownership from service seams
- keep admin truth backend-led instead of client-spaghetti-led

## Read Paths

If working on:
- admin route layout, tab structure, or page-level behavior
  - read `admin-market-management.md`

- market admin commands
  - read `admin-market-service.md`

- Oracle operator reads/actions
  - read `admin-oracle-service.md`

- user ops and user read panel
  - read `admin-user-service.md`

## Ownership Map

- `admin-market-management.md`
  - route-level ownership
  - which admin surfaces exist on the page
  - what the route may show or gate

- `admin-market-service.md`
  - market command service seam

- `admin-oracle-service.md`
  - Oracle service seam

- `admin-user-service.md`
  - user-ops service seam

## Shared Rule

The admin route may consume all three services.

That does not make the route doc the owner of all three contracts.
