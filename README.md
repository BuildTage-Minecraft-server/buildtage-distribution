# BuildTage Distribution

Mod set, configuration and file hosting for [BuildTage Launcher](https://github.com/Asesu23/buildtage-launcher).

This repository is the single source of truth for what the launcher installs. It holds the server definitions that [Nebula](https://github.com/dscalzi/Nebula) turns into a `distribution.json`, which the launcher reads on startup. A GitHub Actions workflow runs Nebula on every push to `main` and publishes the result to GitHub Pages at `https://cdn.nekrasovdev.space/`.

## How it works

1. A push to `main` starts the `Publish distribution` workflow.
2. The workflow installs Java 17 and Node.js 22 and runs the Forge installer without a window (`scripts/prepare-forge.mjs`), because Nebula expects it to be run by hand. Then it fetches Nebula and runs `generate distro` against this repository.
3. `scripts/collect-site.mjs` copies exactly the files referenced by `distribution.json` into `site/`, fails if one of them is missing and checks the 1 GiB limit of GitHub Pages.
4. The `site/` folder is published to the configured hosting target, GitHub Pages by default.

## Repository layout

```
meta/distrometa.json                   distribution-wide metadata
servers/<id>/servermeta.json           server name, address and Forge version
servers/<id>/forgemods/required/       mods every player gets
servers/<id>/forgemods/optionalon/     optional mods, enabled by default
servers/<id>/forgemods/optionaloff/    optional mods, disabled by default
servers/<id>/files/                    configs and other files
scripts/prepare-forge.mjs              installs Forge into the cache that Nebula reads
scripts/collect-site.mjs               builds the folder that gets published
```

## Updating the mod set

1. Add, replace or remove jars in `servers/<id>/forgemods/required/`.
2. Optionally raise `meta.version` in `servermeta.json`.
3. Commit and push. The workflow republishes the site, and players receive the changes the next time they start the launcher.

## Hosting targets

The same build can be published to two places. The `DEPLOY_TARGET` repository variable (Settings, Secrets and variables, Actions, Variables) selects one:

| Value | Where the files go |
| --- | --- |
| `pages` (default) | GitHub Pages, served from the custom domain |
| `r2` | A Cloudflare R2 bucket, uploaded through its S3 API |

`BASE_URL` is another repository variable, it defaults to `https://cdn.nekrasovdev.space/`. It is the public address the files are served from and it is written into `distribution.json`, so it has to match the real host.

### Switching to R2

1. Create a bucket, connect a custom domain to it and create an API token with read and write access to that bucket.
2. Add the repository secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET`.
3. Set the variable `DEPLOY_TARGET` to `r2` and `BASE_URL` to the public address of the bucket, for example `https://cdn.example.com/`.
4. Point the launcher at the new address (`CDN_URL` in `app/assets/js/apiconstants.js` of the launcher repository) and release a new launcher build.
5. Run the workflow. `distribution.json` is uploaded last, so players never see a list that refers to files that are not there yet.

## Notes

- GitHub Pages accepts a site of up to 1 GiB, so this setup fits mod sets of that size. Larger sets need another host. The URLs inside `distribution.json` are built from `BASE_URL` in the workflow, so moving the files only means changing that value and the DNS record.
- Commit only mods that may be redistributed, the repository is public.
- Nebula is cloned from its default branch on every run. Pin a commit in the workflow for reproducible builds.
