import { getReleasePlan } from '@changesets/get-release-plan'

// Reading the release plan parses every pending changeset and rejects one that names a package outside the workspace.
const { releases } = await getReleasePlan(process.cwd())
console.log(`Pending changesets release ${releases.map(({ name, type }) => `${name} (${type})`).join(', ') || 'nothing'}`)
