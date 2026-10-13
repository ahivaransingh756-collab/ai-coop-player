# Speedrun Co-op Bot · Bedrock

An in-world survival teammate built on Bedrock's **GameTest SimulatedPlayer** API. Version **0.2.0** adds an evidence-checked, 18-stage **co-op** progression route from wood to a recorded dragon death.

> **Not a fully autonomous speedrunner.** Crafting, furnace operation, fortress/stronghold exploration, bartering, crystal destruction and dragon combat still require a human. This release does not invent those capabilities, grant items, or treat missing entities as victory. Node tests pass; actual Bedrock gameplay has **not** been tested in this development environment. Do not use on a valuable world without a backup.

## What it actually does

| Capability | Implementation |
|---|---|
| Follow / basic defense | Native navigation, repath throttling, stuck detection; avoids automatically provoking endermen/piglins |
| Gathering | Wood, cobblestone, raw iron, coal, gravel; correct minimum pickaxe tier, physical breaking and pickup |
| Local excavation safety | Rejects unknown/liquid/hazard neighbors, sand/gravel overhead, and mining the supporting column |
| Survival | Uses food from an inventory slot; verifies consumption; pauses at critical health; death/respawn handling |
| Progression | 18 stages; live inventory/block/dimension evidence; no manual “mark done” bypass |
| Portal travel | Traverses **human-built, observed, marked** portals; verifies dimension change, not just movement acceptance |
| Stronghold assistance | Least-squares estimate from **human-reported** eye flights, with degeneracy/backward-ray checks |
| Recovery | Owner/version-scoped route checkpoints, paused restoration, retry backoff, task interruption without extra gathering |
| Observability | `status`, `route`, capability disclosures, structured content logs, active-tick timing and stored splits |

Local safety checks are **not** a global hazard-proof pathfinder. Native navigation can still fail on cliffs, liquids, stairs, unloaded chunks and portals. Mining can fail on enclosed or unreachable ore; there is no autonomous cave exploration or tunneling.

## Target version

This pack retains the repository's **Bedrock 1.21.114** target and manifest dependencies:

- `@minecraft/server`: `2.3.0-beta`
- `@minecraft/server-gametest`: `1.0.0-beta`

Development declarations are pinned to the corresponding `1.21.114-stable` npm builds. These are **not promises of compatibility with every newer Bedrock/Preview release**. Beta API versions can change. See [the research audit](docs/BEDROCK_RESEARCH.md) before porting.

## Build and install

Requires Node.js 22+ and Python 3 for packaging; Minecraft runs separately.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run pack
```

The last command creates `dist/SpeedrunCoop-0.2.0.mcpack`. Import it into a compatible Bedrock installation, activate the behavior pack in a **backup/test world**, and enable the **Beta APIs** experiment. Enable cheats if you need the `/scriptevent` fallback. Enable the content log for diagnostics. If your installation refuses the declared module versions, use the target version or port and re-test—do not silently change dependency versions.

`.npmrc` uses legacy peer resolution because the matching GameTest package's broad stable semver peer range excludes the explicitly pinned server prerelease. These packages are **development declarations**, not an emulator of the game engine. No npm dependencies are bundled in the pack.

## First run

Stand on a flat, safe surface, then:

```text
!bot ping
!bot spawn
!bot capabilities
!bot resume
!bot confirm
!bot status
!bot route
```

Only the spawning player can control the bot; other players may use help/ping. `resume`, `go` and `reset run` require confirmation within 30 seconds. `!bot stop` immediately cancels actions and pending confirmation.

If chat events do not work, run commands **as a player**:

```text
/scriptevent speedrunbot:cmd spawn
/scriptevent speedrunbot:cmd resume
/scriptevent speedrunbot:cmd confirm
```

### Resource handoffs

```text
!bot gather wood 6
!bot gather cobblestone 16
!bot gather iron 10
!bot drop oak_log
!bot drop raw_iron
```

Ad-hoc gathering asks for **additional** items; route gathering uses **inventory totals**, so interrupted tasks do not start their quotas over. Supply a wooden-or-better pickaxe for stone/coal and stone-or-better for iron (a gold pickaxe cannot harvest iron).

At co-op handoffs, take materials with `!bot drop <item_id>`, craft/smelt them yourself, then physically drop the output near the bot. The drop command pauses the bot and calls the native selected-item drop operation; repeat if more is needed. It does not duplicate or directly inject inventory. Stay within six blocks for drops. Resume/confirm after supplying the next objective.

### Portals

Build and light portals yourself. Look directly at a live portal block within six blocks:

```text
!bot mark overworld_portal
!bot mark nether_portal
!bot mark end_portal
```

Mark each from its proper dimension. Bring the bot within eight blocks of the source portal before resuming its travel stage. For `end_portal`, activate the stronghold portal **before** marking it. Choose an accessible **lower** Nether portal block, clear the approach and stand back while the bot enters. If it cannot traverse, it times out and retries within a bounded budget; help it rather than assuming pathfinding works everywhere.

For a general waypoint:

```text
!bot mark rally
!bot go rally
!bot confirm
```

Waypoints are not structure detections. Cross-dimension following does not teleport: use portal stages and correct-side marks.

### Stronghold estimate

Throw an eye and **stay at the throw position**. Record a visible point on its outward flight (not its falling/drop trajectory):

```text
!bot eye <flight_x> <flight_z>
```

Move sideways at least 16 blocks (a wider baseline is better), repeat, then use `!bot stronghold`. `!bot clear eyes` discards previous bearings. The result is a geometric estimate from your observations, **not** a verified stronghold or portal-room location. Two noisy rays can have zero residual; re-throw near the estimate.

### Saving and resetting

Progress and waypoints save every 200 game ticks and at explicit lifecycle events. Restoration is owner-scoped and **always paused**. Completed stages are historical checkpoints, not a guarantee that the bot still owns consumed/lost supplies. Tool and portal checks are live when the corresponding action starts; replenish lost gear yourself.

**Inventory/entities are not serialized.** Retrieve supplies before `!bot despawn`. Despawn before `/reload`; if a tagged bot survives a reload, duplicate spawning is refused—reopen the world. Do not rely on simulated-player inventory surviving disconnection. Eye bearings and uncompleted dragon-death evidence are deliberately not restored.

For a fresh run:

```text
!bot reset run
!bot confirm
```

This resets the route, timing and waypoints, **not** your world or inventory. Active simulation time excludes paused/offline periods and is **not a leaderboard timer**. This experimental scripted pack makes no leaderboard-eligibility claim.

## Engineering references

- [Primary-source Bedrock/API audit and route analysis](docs/BEDROCK_RESEARCH.md)
- [Architecture and known limitations](docs/ARCHITECTURE.md)
- [Required real-game acceptance tests](docs/VALIDATION.md)

CI runs syntax/import checks, Node tests and packaging, then uploads the `.mcpack`. The tests include a **mocked** 18-stage co-op scenario; they are not evidence of a real autonomous dragon kill.
