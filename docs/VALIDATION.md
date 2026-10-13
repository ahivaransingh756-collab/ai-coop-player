# Validation and release gates

## Executed in this workspace

- `npm ci --ignore-scripts`: pinned declaration dependencies install.
- `npm run check`: JavaScript syntax, relative imports, basic manifest layout.
- `npm test`: deterministic Node tests using mocked bodies/worlds; includes all 18 co-op stages and negative victory checks.
- `npm run pack`: ZIP-format `.mcpack` containing the manifest and script files only.
- `git diff --check`: whitespace/error-marker hygiene.

**Not executed:** Bedrock engine startup, actual in-game commands, physical mining/drops/food, portal traversal, actual dragon fight, watchdog/performance profiling or complete random-seed gameplay. There is no Bedrock process in this environment. Passing mocks must not be presented as a real game run.

## Real-game acceptance matrix — all pending

Use disposable copies with the exact game/build number, difficulty, experiment flags, pack version and content log recorded. Test the target version before trying a newer Preview.

| Area | Scenario / expected result |
|---|---|
| Load | Enable Beta APIs and pack; no missing export/dependency errors; ping and player `/scriptevent` both work |
| Safe spawn | Flat ground succeeds; lava, insufficient headroom and unloaded terrain do not spawn a bot unsafely |
| Authority | Second player cannot order/reset/drop/despawn; wrong-player confirmation cannot consume owner request |
| Emergency stop | While following, mining, eating and entering a portal: cancel ongoing actions and pending confirmation |
| Gathering | Oak/birch logs; stone with wood/gold pick; iron with stone pick; iron with gold rejected; ore behind a wall fails safely |
| Mining timing | One continuous break request; real pickup increases the objective count; broken block alone does not complete |
| Inventory | Full inventory with a partial compatible stack works; actually full inventory fails; broken tool causes tool-required failure |
| Hazard veto | Water/lava adjacent to target, gravel/sand above and support column underneath bot are rejected |
| Interruption | Hostile appears after four of six logs; defense/eating followed by task resumption requires only remaining quota |
| Food | Bread/cooked meat consumption actually reduces inventory and increases hunger; no free synthetic ItemStack use |
| Health | Critical HP stops with clear message; bot does not automatically resume into danger; owner can heal and resume |
| Defense | Nearby neutral piglins/endermen not provoked; other-dimension owner coordinates ignored; test basic melee and disengagement |
| Portal | Accessible lower portal block, incorrect high marker, blocked approach, destroyed portal, long transition; only dimension change succeeds |
| Nether return | Mark Nether-side portal independently; no coordinate division/teleport assumption; actual arrival in Overworld |
| End entry | Filled portal mark accepted; unfilled frame not accepted; conservative approach allows real portal entry |
| Eye geometry | Two/three separated outward flights; near-parallel and mistaken/backward flights rejected; human estimate never auto-completes stronghold |
| Drop | Owner within six blocks receives native dropped item(s); repeat as necessary; no inventory duplication |
| Journal | Complete several stages, despawn after retrieving supplies, respawn; same owner restores paused; other owner does not inherit route |
| Reload | Despawn before reload; unexpected surviving managed bot blocks duplicate spawn with actionable message |
| Death | Death location recorded; respawn attempts bounded; no automatically resumed mining in wrong dimension |
| Dragon | Unloaded/absent dragon never succeeds; wrong type/dimension/range/paused run ignored; nearby real death during active End-stage route succeeds |
| Timing | Active-tick timer pauses and does not count offline time; label makes clear this is not speedrun timing |
| Fresh run | Confirmed reset clears milestones/waypoints/victory evidence but does not change world or inventory |

## Performance trials before “efficient” claims

Record device/server hardware, configured scan radius/budget, render/simulation distance, concurrent players, difficulty and game version. Measure at least:

- Controller tick runtime mean/P95/P99 and watchdog warnings.
- Blocks queried per tick, including safety-neighbor reads.
- Native navigation requests per second and full/partial/failed outcomes.
- Resource throughput including discovery, approach, break, pickup and failed targets.
- Time spent waiting for human handoffs versus executing autonomous work.
- Deaths, failed tasks, retries, stranded portal attempts and successful co-op completions per trial.

Use repeated controlled worlds, then diverse random worlds. Compare changes using both completion time and completion rate. Do not label a configuration “expert”, “optimal” or “extremely efficient” based solely on a single happy-path test.

## Release blockers for autonomous claims

- Zero fake recipe outputs; a tested legitimate crafting/smelting action layer.
- Verified terrain exploration and hazard recovery across dimensions.
- Safe portal construction and traversal on the target build.
- Reproducible blaze/pearl procurement with stochastic resource accounting.
- Real eye observation and portal-room discovery.
- Bedrock-specific ranged/crystal/dragon-phase combat and positive victory observation.
- Multiple documented real end-to-end trials with no human handoffs.
