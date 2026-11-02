# BuildTage Distribution

Mod set, configuration and file hosting for [BuildTage Launcher](https://github.com/Asesu23/buildtage-launcher) and the CBO server.

This repository is the single source of truth for what the launcher installs and what the server runs. It holds the server definitions that [Nebula](https://github.com/dscalzi/Nebula) turns into a `distribution.json`, which the launcher reads on startup. A GitHub Actions workflow runs Nebula on every push to `main` and publishes the result to GitHub Pages at `https://cdn.nekrasovdev.space/`. A second workflow applies the same mods and configs to the Docker container that runs the server.

## How it works

1. A push to `main` starts the `Publish distribution` workflow.
2. The workflow installs Java 17 and Node.js 22 and runs the Forge installer without a window (`scripts/prepare-forge.mjs`), because Nebula expects it to be run by hand. Then it fetches Nebula and runs `generate distro` against this repository.
3. `scripts/collect-site.mjs` copies exactly the files referenced by `distribution.json` into `site/`, fails if one of them is missing and checks the 1 GiB limit of GitHub Pages.
4. The `site/` folder is published to the configured hosting target, GitHub Pages by default.
5. If server deployment is enabled, the `Deploy server` workflow starts after a successful publish and updates the Minecraft server, see [Server deployment](#server-deployment).

## Repository layout

```
meta/distrometa.json                   distribution-wide metadata
servers/<id>/servermeta.json           server name, address and Forge version
servers/<id>/forgemods/required/       mods for players and the server
servers/<id>/forgemods/optionalon/     optional mods, enabled by default, players only
servers/<id>/forgemods/optionaloff/    optional mods, disabled by default, players only
servers/<id>/files/                    configs and other files for players
servers/<id>/files/config/             configs for players and the server
servers/<id>/server/mods/              mods for the server only
servers/<id>/server/config/            configs for the server only
scripts/prepare-forge.mjs              installs Forge into the cache that Nebula reads
scripts/collect-site.mjs               builds the folder that gets published
scripts/deploy-server.mjs              syncs mods and configs into the server container
repomix.config.json                    settings for packing the repository with Repomix
```

## Updating the mod set

1. Add, replace or remove jars in `servers/<id>/forgemods/required/`. Mods that only the server needs go to `servers/<id>/server/mods/`. Mods that only players need, such as a minimap or shaders, go to `optionalon/` or `optionaloff/`.
2. Optionally raise `meta.version` in `servermeta.json`.
3. Commit and push. The workflow republishes the site, and players receive the changes the next time they start the launcher. If server deployment is enabled, the server receives the mod set as well.

## Configs

Everything in `servers/<id>/files/` is installed into the game directory of the player under the same relative path. For example, `servers/<id>/files/config/<mod>-common.toml` ends up as `config/<mod>-common.toml`. The launcher checks these files on every start and restores the repository version of any file that was changed locally.

Files that players may change, such as client settings, can be listed in `untrackedFiles` in `servermeta.json`. An untracked file is downloaded when it is missing and is never replaced afterwards:

```json
"untrackedFiles": [
  {
    "appliesTo": ["files"],
    "patterns": ["config/*-client.toml"]
  }
]
```

Configs in `files/config/` are applied to the server too, see below.

## Server deployment

The `Deploy server` workflow keeps the `CBO` Docker container in sync with the repository. It can always be started by hand. With the `DEPLOY_SERVER` variable set to `true` it also starts after every successful `Publish distribution` run.

| Repository path | Players | Server |
| --- | --- | --- |
| `forgemods/required/` | yes | yes |
| `forgemods/optionalon/`, `forgemods/optionaloff/` | yes | no |
| `files/config/` | yes | yes, except `*-client.toml` |
| other paths in `files/` | yes | no |
| `server/mods/` | no | yes |
| `server/config/` | no | yes, overrides `files/config/` |

Each run works as follows:

1. `scripts/deploy-server.mjs` builds the wanted state from the paths above.
2. Mods are compared by SHA-256 with the jars in the `mods` folder of the server, so manual changes there are reverted. Other files in that folder are never touched. An empty mod set is refused, which protects the server from a wrong path.
3. Configs are compared with the manifest of the previous deployment instead of the live files, because mods often rewrite their own configs. A config is sent only when its content in the repository changed, and a config removed from the repository stays on the server.
4. If nothing changed, the run ends here. A push that only touches the README does not restart the server.
5. The container is stopped with a grace period of two minutes, so the world is saved.
6. The changes are copied into the data directory of the container. Replaced and removed files are moved to `.deploy-backup/<timestamp>/` first, the last five backups are kept.
7. The container is started and the run waits until its health check passes. A server that does not come up fails the run and prints the last log lines.

To roll back, revert the commit. The next run puts the previous files back.

### Setting it up

The job runs on a [self-hosted runner](https://docs.github.com/actions/hosting-your-own-runners) installed on the machine that hosts the container. The runner only makes outgoing connections, so no port has to be opened for deployments.

1. Add a runner to the repository (Settings, Actions, Runners) with the label `cbo` and install it as a service.
2. Run the service as a user that can use Docker and write to the data directory of the container.
3. Start the `Deploy server` workflow by hand with `dry_run` enabled. It lists the changes without touching the server. The first run makes the `mods` folder match the repository, so every jar that is not in the repository would be moved to the backup folder.
4. Start it by hand again without `dry_run` to apply the changes.
5. Set the repository variable `DEPLOY_SERVER` to `true` to deploy after every successful publish. Without it the workflow never starts on its own, so forks are not affected.

Optional repository variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SERVER_ID` | `CBO-1.20.1` | Folder in `servers/` to deploy |
| `CBO_CONTAINER` | `CBO` | Name of the Docker container |
| `CBO_DATA_DIR` | read from the container | Host path that is mounted at `/data` in the container |

The `cbo-server` environment can be protected with required reviewers (Settings, Environments) if each deployment should be confirmed by hand.

### Security and limits

- The workflow starts only after `Publish distribution` runs on `main` and from manual runs. It has no pull request trigger, so code from forks never reaches the runner. Keep it that way.
- Anyone who can push to `main` can run code on the runner, so restrict write access to the repository accordingly.
- The restart is immediate. Players who are online are disconnected, and the world is saved by the normal shutdown.

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
- Keep one version of each mod in `required/`. Forge refuses to load two files of the same mod, on players' machines and on the server.
- Mod file names must not contain `%`, for example `mod%20name.jar` left over from a browser download. Nebula writes the name into the URL unescaped, so the URL would point to a different file than the one in the repository and the publish step fails. Rename such files.
- Never commit secrets. Configs that contain tokens or passwords do not belong here, they would be public too.
- Nebula is cloned from its default branch on every run. Pin a commit in the workflow for reproducible builds.
