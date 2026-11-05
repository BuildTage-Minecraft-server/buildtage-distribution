# Lobby Shooter

A Forge 1.20.1 mod that turns a server into a team shooter: a lobby with a match queue, team matches on dedicated arenas, and gun loadouts with attachments powered by [TACZ](https://github.com/MCModderAnchor/TACZ).

## Features

- Lobby with match creation, quick join and spectating
- Team matches with capture points and respawns
- Loadouts with attachments, skins and perks
- In-game arena editor
- Match replays
- Levels, daily quests, leaderboards and friends

## Requirements

- Minecraft 1.20.1 with Forge 47.x
- Java 17
- Optional: TACZ, Curios API, FancyMenu

## Build

```bash
./gradlew build
```

The jar is written to `build/libs/`.

## Releases

Every release is cut with a single command. The version lives in `gradle.properties` and is bumped automatically (patch by default).

```bash
./gradlew release --message "fix: handle empty lobby"
./gradlew release --message "feat: add replay browser" --minor
./gradlew release --message "feat!: change loadout format" --major
```

The task bumps `mod_version`, commits all pending changes with the given Conventional Commit message, tags `vX.Y.Z` and pushes both. The tag triggers the GitHub Actions workflow, which builds the mod and publishes a [GitHub Release](../../releases) with the jar attached and notes grouped by commit type.

When the `DISTRIBUTION_DEPLOY_KEY` secret is set, the same workflow also replaces `lobbyshooter-*.jar` in the `BuildTage-Minecraft-server/buildtage-distribution` repository (`servers/CBO-1.20.1/forgemods/required/`) and pushes the change to `main`. That push publishes the new mod set to the launcher and, if enabled there, deploys it to the server. The secret holds the private half of an SSH deploy key that has write access to that repository only and never expires. The target repository and folder can be overridden with the `DISTRIBUTION_REPO` and `DISTRIBUTION_MODS_PATH` repository variables.

Every push and pull request is also built by CI, and the resulting jar is available as a workflow artifact.
