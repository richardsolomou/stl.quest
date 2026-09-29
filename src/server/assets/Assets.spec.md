# Assets

Model generation queue and standalone worker execution.

## entrances

- generation worker job: the parent process transfers a model and requested preview stages.
  handler: work in worker.ts
  trust: internal

## invariants
