# Source inventory and access

Inspected 18 October 2026. Review workspace: `/workspace/scratch/fd82e6654aac`. Original frontend/backend preserved without modification at `/workspace/scratch/4509b6b0c24d/`.

| Repository | Source found / state | Upstream access |
|---|---|---|
| brekmate-fe | Current local working folder and COD combined archive; no .git directory; mobile AGENTS.md read and SDK58 documentation checked | Expected shivam1470/brekmate-fe metadata returns 404. Local branch/remotes/dirty status/history cannot be determined. |
| brekmate-be | Current local working folder and archive; no .git directory | Expected repository returns 404; history comparison and upstream secret scan blocked. |
| brekmate-infra | Recovered original Infrastructure ZIP from supplied Drive folder, compared to folder text files; no .git | Expected repository returns 404. Provider locked to 6.69.1, CLI1.12.6. |
| brekmate-quality | Recovered original Quality ZIP from supplied Drive folder, compared to folder text files; no .git | Expected repository returns 404. 158 authored specs; 37,296 arithmetic vectors exist and were executed against real bundled pricing. |
| brekmate-tc | GitHub tree accessible on master, three files: README, LICENSE, .gitignore | No runnable quality suite; inspected remotely, left unchanged. Returned tree SHA e4e61e00cf1f472d8576971a4af43fa9cbf29b31 is a tree identifier, not a tested release commit. |

All four supplied Drive folders were readable. 271 current non-generated/non-binary text files were compared to the preserved baseline before editing, with no differences. Assets/dist were excluded from the text comparison; frontend assets were retained from the preserved working folder and verified only through successful builds. No newer source was overwritten with an older archive. The combined COD archive was present but did not replace the current FE/BE folders. Drive timestamps and matching bytes establish copy consistency, not upstream Git history.

No repositories were pushed, branches changed upstream, applications deployed, infrastructure applied, native builds submitted or production data changed. No paid service was enabled. Source manifests and review patches identify this local candidate. No local commits were manufactured without the upstream histories. Proposed branches/commit subjects and reconciliation commands are in RUNBOOK.md.

The GitHub connected repository listing for this owner returned an empty list even though direct public tc access worked. A 404 does not prove the other repositories do not exist; names/access/installation scope require resolution. No AWS account, Expo account, Apple/Play account or user's Mac session was verified.
