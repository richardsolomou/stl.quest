# Changesets

Add a changeset for every pull request that changes the released application:

```sh
pnpm changeset
```

Choose `patch`, `minor`, or `major` for `printhub`, then describe the user-visible change. Documentation, tests, refactors, and release tooling changes do not need a changeset unless they affect the released application.

After changes land on `main`, CI versions the application directly on `main`, creates the matching Git tag and GitHub Release, and adds the version tag to the container image.
