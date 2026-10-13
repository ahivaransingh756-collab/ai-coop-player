# Bedrock speedrun engineering audit

**Historical v0.2 audit.** v0.3 implements a separately authorized, modded crafting/container bridge and local autonomous production. The original API finding (no general crafting UI automation) remains valid. See [AUTONOMY.md](AUTONOMY.md) for the new scope; statements below about unimplemented crafting/furnace operation describe v0.2.

**Audit date:** 2026-10-13 UTC. **Runtime target:** repository baseline Bedrock 1.21.114. **Scope:** source/API inspection and deterministic controller tests, not exhaustive reverse engineering of the closed-source Bedrock engine or empirical speedrun benchmarking.

## 1. Sources and reproducibility

Primary sources were retrieved directly from GitHub's API and the npm registry. Public Learn documentation is available as the MicrosoftDocs source mirror. Versioned links below freeze the evidence instead of silently following future changes.

| ID | Evidence | Version / use |
|---|---|---|
| A | [Microsoft SimulatedPlayer reference](https://github.com/MicrosoftDocs/minecraft-creator/blob/b75ceddc27b5523279cf62bcbc8acc059dc65618/creator/ScriptAPI/minecraft/server-gametest/SimulatedPlayer.md) | Documentation snapshot; method contracts |
| B | [GameTest module reference](https://github.com/MicrosoftDocs/minecraft-creator/blob/b75ceddc27b5523279cf62bcbc8acc059dc65618/creator/ScriptAPI/minecraft/server-gametest/minecraft-server-gametest.md) | Top-level `spawnSimulatedPlayer` outside a registered test |
| C | [EntityDieAfterEvent](https://github.com/MicrosoftDocs/minecraft-creator/blob/b75ceddc27b5523279cf62bcbc8acc059dc65618/creator/ScriptAPI/minecraft/server/EntityDieAfterEvent.md) | Positive death event, not entity absence |
| D | [Dimension reference](https://github.com/MicrosoftDocs/minecraft-creator/blob/b75ceddc27b5523279cf62bcbc8acc059dc65618/creator/ScriptAPI/minecraft/server/Dimension.md) | World access and unloaded-location errors |
| E | [Exact GameTest package](https://registry.npmjs.org/@minecraft/server-gametest/1.0.0-beta.1.21.114-stable) | Downloaded `index.d.ts`; authoritative target-version signature check |
| F | [Exact server package](https://registry.npmjs.org/@minecraft/server/2.3.0-beta.1.21.114-stable) | Target-version world/entity/container declarations |
| G | [Mojang Bedrock samples v1.21.110.2](https://github.com/Mojang/bedrock-samples/tree/f653a0493bff08699f79264205c4408a9fac06f0) | Nearby baseline vanilla recipe, loot and entity data; not proof that every 1.21.114 behavior is identical |

The lockfile records downloaded package versions and integrity hashes. Current npm tags at audit time differed from this target (`server` latest 2.10.0, beta 2.13.0-beta.1.26.70-preview.20; GameTest beta 1.0.0-beta.1.26.70-preview.20). Those tags were **not** used as an excuse to change the pack's engine target. Their existence does not prove runtime compatibility.

## 2. API findings that affect correctness

### Real player actions versus privileged shortcuts

Sources A/E document these distinct operations:

- `breakBlock` respects the simulated player's game mode. It continues hitting until the block breaks, an item is used, or breaking is stopped. The old controller reissued it every second; this release starts it once per attempt and waits for block/inventory evidence.
- `navigateToBlock`/`navigateToLocation` return a navigation result. A full path is **not arrival**, and native navigation can stop when stuck. Starting navigation requires ground contact. The controller bounds retries and verifies progress independently.
- `useItem(ItemStack)` explicitly **does not consume the item**. Using it to generate pearls, food effects or Eyes of Ender would be a major integrity error. This release uses `useItemInSlot` for food and requires inventory/hunger evidence.
- `giveItem`/`setItem` exist, but are not legitimate crafting. This release does not use them to fabricate outputs.
- `dropSelectedItem` is a native physical inventory handoff. `drop` uses it instead of spawning a replacement entity and editing counts.
- The inspected SimulatedPlayer surface has interaction methods but **no general crafting-recipe or crafting-grid UI automation API**. Opening/interacting with a crafting table is not equivalent to completing a recipe. Full survival crafting therefore remains an explicit integration problem, not an invented method call.

There may be other architectures for crafting (external client control, a separate UI bridge, or an intentionally assisted server-side recipe implementation). None has been implemented or validated here. A recipe bridge would need recipe/version validation, ingredient/durability accounting, inventory-capacity checks, atomicity tests and an explicit distinction from ordinary player input.

### Observation limits

Unloaded blocks can be unavailable or throw (D/F). `ScriptWorld` preserves this as unknown, not air. A missing dragon could mean unloaded chunks, dimension mismatch or query limitations; victory requires an `entityDie` event for the correct entity type, within 128 blocks of a living bot in the End, after the End stage while the route is active (C/F plus our policy).

The monster family is not a dragon-fight API. The pinned [dragon entity data](https://github.com/Mojang/bedrock-samples/blob/f653a0493bff08699f79264205c4408a9fac06f0/behavior_pack/entities/ender_dragon.json) uses a `dragon`/`mob` family and separate flying, sitting and death behavior groups. Ordinary nearest-monster sword attacks cannot stand in for a phase-aware dragon controller.

## 3. Route and material accounting

This release chooses a **conservative, explainable co-op route**, not an optimized random-seed route. Every milestone has an actual verification predicate. World geometry, seed category, allowed modifications, difficulty and inventory are not assumed to be identical across runs.

1. Six logs → human table/pickaxe crafting.
2. Sixteen cobblestone → human stone pickaxe/furnace; enough for a pickaxe, furnace, sword and a small spare under ordinary recipes, but human usage can change that budget.
3. Ten raw iron → human smelting → ten ingots → iron kit.
4. Human-built active Nether portal → observed traversal.
5. Human fortress combat and pearl acquisition → seven rods and fourteen pearls.
6. Human crafting → fourteen eyes → marked return portal.
7. Human eye navigation/stronghold search and portal activation → End supplies → observed End entry.
8. Human crystal/dragon fight → positive nearby dragon-death observation.

### Eyes and rods

Mojang's [blaze powder recipe](https://github.com/Mojang/bedrock-samples/blob/f653a0493bff08699f79264205c4408a9fac06f0/behavior_pack/recipes/blaze_powder.json) produces **two powder per rod**. The [eye recipe](https://github.com/Mojang/bedrock-samples/blob/f653a0493bff08699f79264205c4408a9fac06f0/behavior_pack/recipes/ender_eye.json) consumes one pearl plus one powder per eye. Therefore seven rods plus fourteen pearls can produce fourteen eyes; this is arithmetic, not an acquisition guarantee.

Fourteen is a configurable-in-code planning target with two eyes beyond a twelve-frame worst-case fill. Eye throws, losses, portal prefill and already-owned materials should ultimately drive an adaptive target. This release does not model an exact eye-break probability or guarantee that two spare eyes suffice. Avoid importing Java-only throw/stronghold assumptions without Bedrock validation.

### Iron

The [bucket recipe](https://github.com/Mojang/bedrock-samples/blob/f653a0493bff08699f79264205c4408a9fac06f0/behavior_pack/recipes/bucket.json) costs three ingots; [flint and steel](https://github.com/Mojang/bedrock-samples/blob/f653a0493bff08699f79264205c4408a9fac06f0/behavior_pack/recipes/flint_and_steel.json) requires an ingot **and flint**. The fixed budget reserves iron for pickaxe, bucket, ignition, sword and shield, but only pickaxe/bucket/ignition are verified by `iron_kit`. Gravel gathering does not promise flint, and armor is not included in that budget. Human flint/fuel acquisition remains necessary.

### Blaze drops

The pinned [blaze loot table](https://github.com/Mojang/bedrock-samples/blob/f653a0493bff08699f79264205c4408a9fac06f0/behavior_pack/loot_tables/entities/blaze.json) specifies a player-or-pet kill condition and a base rod count range of zero to one, with a looting modifier. Counting seven kills is therefore **not** equivalent to obtaining seven rods. The milestone checks inventory.

### Pearl procurement: the danger of assuming a fixed gold budget

The pinned [piglin barter table](https://github.com/Mojang/bedrock-samples/blob/f653a0493bff08699f79264205c4408a9fac06f0/behavior_pack/loot_tables/entities/piglin_barter.json) has total entry weight **469**, pearl weight **10**, and **2–4 pearls** on a pearl result. It includes the dried-ghast entry; copying a probability from an older Java guide would miss version-specific table changes.

Under the **explicit assumptions** of independent weighted draws, no added loot modifiers, and a uniform integer pearl count from 2 to 4:

- Pearl-result probability: `10 / 469 ≈ 2.132%` per barter.
- Expected pearls per barter: `3 × 10 / 469 ≈ 0.06397`.
- Exact discrete convolution gives approximate probabilities of reaching at least 14 pearls:

| Barters | P(pearls ≥ 14) |
|---:|---:|
| 32 | 0.120% |
| 64 | 1.655% |
| 96 | 6.443% |
| 128 | 14.997% |

These are **source-table-derived calculations, not measured gameplay rates**. They omit time to obtain gold, simultaneous piglins, mob safety and alternative pearl sources. Expected-value division is not a reliable minimum gold budget. An efficient future planner must compare observed world options and tail risk instead of promising “a stack of gold is enough.” The current code verifies actual pearls and leaves procurement to the human.

## 4. Stronghold geometry

For each reported horizontal eye-flight ray with origin `p` and unit direction `d`, use perpendicular normal `n = (-dz, dx)`. Minimize `Σ(n·q − n·p)²`. Solve the resulting 2×2 normal equations for estimated intersection `q`.

Implementation rejects too few observations, nonfinite/zero vectors, near-singular geometry, intersections behind a forward ray, and large multi-ray residuals. The command requires separated origins and retains at most eight observations. This is standard geometry, **not reverse-engineered Bedrock structure generation**.

Important uncertainty: two inaccurate rays can intersect exactly with residual zero. A low residual is not confidence in portal-room coordinates. Origins must remain at the actual throw position; flight coordinates are human-reported; eye behavior near a stronghold may require new observations. No automatic flight tracking, seed cracking, `/locate`, or portal-room excavation is implemented.

## 5. Forensic repository findings and corrections

| Finding in baseline | Correction |
|---|---|
| Most route kinds lacked executors | Replaced unsupported automation claims with explicit evidence-checked co-op handoffs |
| Interrupted gather restarted its inventory baseline | Route uses totals; ad-hoc requests preserve baseline across interruptions |
| Failure at final node could print “Route complete” | Completion requires every route node to have succeeded |
| Failed start could retry immediately | Bounded retries with exponential tick backoff and visible failure reason |
| Persisted progress accepted arbitrary statuses/attempts | Validated import, dependency-consistent successes, owner and route-version scoping |
| Failed navigation still treated as ongoing unbounded work in some paths | Bounded travel, stuck detection, source dimension and local safety checks |
| Following inside stop radius did not cancel old movement | Explicit stop on idle/dimension-blocked follow state |
| Weapon re-equip could leave mining with the wrong tool | Tool requirement checks and explicit pickaxe selection before mining |
| Full inventory always failed even with stack room | Compatible partial stack accepted |
| Chat confirmation could be cleared by a non-owner call | Wrong-player confirmation does not consume the pending action |
| Fixed spawn offset could be in air/hazard/solid blocks | Nearby known-ground/two-air-block safe spawn search |
| Unbounded ad-hoc tasks/failure records | Bounded task history and failure maps |

## 6. Efficiency: what is and is not established

Implemented: nearest-first cached spatial offsets, budgeted block scans, once-per-tick snapshot cache, entity-query cache every ten ticks, navigation throttling, no repeated break command, executable-frontier preference over unsatisfied handoffs, and retry backoff.

**Not established:** optimal route quality, Bedrock tick cost at configured scan radii, navigation success rate, mean/P95 completion time, or survival rate. A nominal `probesPerTick` budget covers candidate probes; neighbor safety checks add reads. First-use offset generation is synchronous. Default radius 16 is deliberately local; radius 32 can still allocate/sort a large sphere. Benchmark on target hardware before increasing budgets. No performance numbers are invented here.

## 7. Remaining work for genuine full autonomy

1. Validate runtime integration against a real supported Bedrock build and complete the acceptance matrix.
2. Choose a legitimate action architecture for crafting and furnace operation; prove ingredient conservation and real output evidence.
3. Add incremental terrain mapping, safe stand-position selection, resource-aware exploration, digging/building and dimension-aware path planning.
4. Add portal casting/ignition with verified fluid/solid state and safe recovery, not instant block replacement.
5. Implement Bedrock-tested structure search; classify observations honestly and bound exploration costs.
6. Implement shield/armor use, threat-specific combat, blaze line-of-sight tactics, safe piglin bartering and pearl recovery.
7. Track real eye entities/projectiles and correlate throws before replacing manual observations.
8. Implement crystal visibility/aim/cover and dragon-phase control, including fall protection, ranged ammo, breath hazards and positive kill attribution.
9. Run reproducible seed/difficulty/device trials; optimize time **subject to a measured survival/completion rate**, not just an aggressive risk constant.

This audit is a grounded starting point, not a claim of exhaustive knowledge of Minecraft Bedrock or a finished expert autonomous agent.
