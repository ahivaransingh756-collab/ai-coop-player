# Autonomous Overworld production · v0.3

## Scope and honest status

`!bot auto` is an **independent, closed-loop Overworld preparation controller**, not a new name for the previous co-op checklist. It can plan and attempt the supported sequence without human material handoffs:

```text
empty inventory → logs → planks/sticks/table → wooden pickaxe
→ cobblestone → stone tools/furnace → hunted and cooked food
→ exposed iron → engine smelting → iron kit
```

The controller replans from actual inventory after every action instead of assuming a historical task is still satisfied. Missing resources trigger observed-target search, remembered-location revisits or bounded exploration. Completion is only claimed when the supported current-inventory goal is satisfied.

**It does not implement autonomous portal construction, Nether exploration, blaze/pearl procurement, stronghold discovery or dragon combat. It has not been run in the Bedrock engine in this workspace.** A deterministic mock production scenario passes; that is not proof of success on real random seeds.

## Start and inspect

```text
!bot spawn
!bot auto
!bot confirm
!bot why
!bot surroundings
!bot status
!bot stop
```

`auto` requires owner confirmation. The prompt explicitly discloses world modification, animal hunting and **modded crafting/container automation**. Use a disposable backed-up world. `stop` cancels movement/mining/item use and disables the production adapter. Switching to follow, gather or the co-op route also disables it. `resume` remains the co-op command; use `auto` again to restart autonomous preparation.

### Goal

The bot stops successfully after verifying:

- At least 40 safe food points.
- An iron-or-better pickaxe.
- An iron sword.
- A bucket or water bucket.
- Flint and steel.
- A shield.

It does not claim that the shield is equipped or that this inventory is sufficient for autonomous End combat. This goal is deliberately separate from the 18-step co-op route journal; automatic actions do not silently mark unrelated route stages complete.

## What “understands the environment” means here

There is no claim of general intelligence, visual understanding or a remotely hosted LLM. This is an explainable, deterministic agent:

1. **Perceive:** sample known loaded blocks, nearby threats, adult food animals, drops, current inventory, hunger and health.
2. **Remember:** maintain fresh local terrain facts plus longer-lived resource/station hints. Track spatial visits and failed targets.
3. **Plan:** recursively derive immediate ingredients, tools, stations and fuel needed for the next objective.
4. **Resolve:** choose a reachable standing position with a clear interaction path; otherwise revisit a relevant hint or explore less-visited terrain.
5. **Act:** execute one bounded action, checking live terrain and permissions.
6. **Verify:** require inventory, block or engine-produced furnace output evidence; then replan.

`why` reports the chosen action and prerequisite chain. `surroundings` reports known blocks, resources, hazards, scan progress and rejected targets. These are diagnostic facts, not fabricated natural-language world knowledge.

### Perception policy

- Default radius: 8 blocks; 128 candidate reads per tick.
- Maximum fresh-cell cache: 8,192; fresh facts expire after 400 ticks.
- Up to 256 resource/station hints survive for 12,000 ticks. Old hints guide travel but do not authorize mining/crafting.
- Ordinary stone does not crowd rare resources or stations out of the hint cache.
- Unknown/unloaded blocks are not air. Dimension changes clear the local model.
- This is direct Script API block access, **not screen-only perception**. It can observe nearby blocks not visible to a human; executable targets still require a clear reachable interaction path. Do not describe it as vanilla observation parity.

### Navigation policy

A bounded local BFS searches at most 384 stand positions, using cardinal edges, one-block steps and two-block headroom. No diagonal corner cuts, blind jumps, bridging, swimming or tunneling. A path is executed one checked edge at a time using native navigation. Every next edge is rechecked against live terrain. Old path data cannot authorize walking over a newly removed floor.

Longer movement repeatedly plans local paths toward a remembered hint; this is not a complete global pathfinder. Complex mazes and cul-de-sacs can still defeat it. No productive action for ten game minutes ends the session instead of exploring forever.

## Explicitly modded crafting and container access

The inspected target API does not expose general crafting-grid UI automation. To make the supported production loop executable, v0.3 introduces `Production`, a **scripted recipe bridge**:

- Disabled by default; authorized only for confirmed auto mode.
- Small reviewed recipe allowlist; no arbitrary item-ID crafting command.
- Actual required ingredients must exist in the bot's inventory.
- Named, lore-bearing, dynamic-property-bearing and enchanted ingredient stacks are excluded.
- Table recipes require an actual nearby table and clear reach, rechecked at execution time.
- A pure dry run computes ingredient debits, compatible output stacks and capacity before any write.
- The synchronous commit preserves unchanged stacks, verifies writes, and performs a compensating rollback on failure.
- A failed rollback latches a **hard fault**. No automatic retry, new grant or “best effort” output creation follows. Inspect the inventory/content log and restart only after resolving the fault.

**This is not a database transaction or a game-provided atomic craft API.** JavaScript performs the writes without yielding, but an unrecoverable engine/API failure could leave a partial transaction. The hard-fault policy and fault-injection tests limit the damage; they do not prove atomicity under engine crashes. Recipe-book unlocks, arbitrary add-on recipes and every metadata variant are not reproduced.

The allowlist includes supported Overworld wood-to-plank recipes, sticks, table, wooden/stone/iron pickaxes, stone/iron swords, furnace, bucket, flint and steel, shield and bread. See `scripts/autonomy/recipes.js` for exact costs and conservative supported variants.

### Actual furnace operation

Smelting is **not** a timer that creates an ingot in script:

- A furnace must be placed using an existing inventory item and verified with both block appearance and item consumption.
- Only a furnace position registered by that placement is eligible for container access in the current session. Human furnaces are not automatically claimed.
- Inputs and fuel move using native `Container.swapItems` into empty input/fuel slots.
- Outputs move using native `transferItem`; overflow remains in the furnace.
- Minecraft's furnace, fuel consumption and recipe engine produce the output.
- Existing input batches are completed/refueled before switching recipes; interruptions do not overwrite them.
- Coal/charcoal are preferred if carried; otherwise the planner supplies renewable planks. Entire existing stacks may be transferred, so usable fuel can remain in the furnace afterward.

Supported input/output pairs are raw iron and common raw meats. Fuel burning progress is not exposed by this adapter, so it may acquire extra fuel conservatively. Furnace state is observed afresh; no completion is inferred from elapsed time alone. A session records ownership by dimension/position, not a tamper-proof identity—use private test worlds, not as a public-server access-control system.

### Hunting and survival

Only whitelisted adult cows, pigs, sheep and chickens are candidates; named/tamed animals are excluded. The bot still cannot infer ownership of an unnamed farm animal. Hunting requires known reachable terrain; success requires picked-up meat, not entity disappearance. It uses basic melee, not advanced animal trapping.

Nearby threats or hazardous footing can preempt production with an attempt to increase separation along a known safe path. Eating and critical-health recovery take priority over continued production. No observed escape route results in a safety stop rather than an invented path. Three deaths end the session; earlier deaths trigger respawn and replanning from current inventory, with opportunistic recovery of reachable dropped supplies. There is no guaranteed corpse retrieval or full fire/drowning/void recovery policy.

## Modules

| Module | Responsibility |
|---|---|
| `autonomy/perception.js` | Bounded observed map, TTL, hints, visit counts and failure memory |
| `autonomy/navigation.js` | Stand-position graph, line-of-reach checks and live-validated path execution |
| `autonomy/planner.js` | Live-inventory prerequisite resolution and production goal |
| `autonomy/actions.js` | Bounded mining, pickup, hunting, placement, crafting and smelting actions |
| `autonomy/crafting.js` | Pure recipe planning and compensating inventory transaction |
| `autonomy/controller.js` | Observe–plan–act loop, preemption, decision history and stop conditions |
| `adapter/production.js` | Opt-in bridge to actual inventory/block/container APIs |

Auto-mode map, action state, history and furnace ownership are session-local. They are **not** stored in the co-op route journal or automatically resumed after reload. Inventory/world contents remain whatever Minecraft actually saved. Stop before reload, retrieve supplies if despawning, and restart explicitly.

## Evidence and tests

Target API signatures were checked against the pinned `@minecraft/server` and `@minecraft/server-gametest` 1.21.114 declarations, including `useItemInSlotOnBlock`, `BlockInventoryComponent`, `Container.swapItems`, `transferItem`, `setItem`, `ItemStack.clone` and metadata inspection methods.

Recipe/food references checked in Mojang's pinned sample revision:

- [Wooden pickaxe](https://github.com/Mojang/bedrock-samples/blob/f653a0493bff08699f79264205c4408a9fac06f0/behavior_pack/recipes/wooden_pickaxe.json)
- [Stone pickaxe](https://github.com/Mojang/bedrock-samples/blob/f653a0493bff08699f79264205c4408a9fac06f0/behavior_pack/recipes/stone_pickaxe.json) — bridge conservatively accepts cobblestone, not every member of the vanilla material tag.
- [Shield](https://github.com/Mojang/bedrock-samples/blob/f653a0493bff08699f79264205c4408a9fac06f0/behavior_pack/recipes/shield.json)
- [Beef cooking](https://github.com/Mojang/bedrock-samples/blob/f653a0493bff08699f79264205c4408a9fac06f0/behavior_pack/recipes/furnace_beef.json)
- [Chicken cooking](https://github.com/Mojang/bedrock-samples/blob/f653a0493bff08699f79264205c4408a9fac06f0/behavior_pack/recipes/furnace_chicken.json)
- [Porkchop cooking](https://github.com/Mojang/bedrock-samples/blob/f653a0493bff08699f79264205c4408a9fac06f0/behavior_pack/recipes/furnace_porkchop.json)

Tests cover exact ingredients/outputs, mixed planks, protected metadata, overflow, write/rollback failures, opt-in permissions, live station reach, native furnace material conservation, memory budgets/expiry, safe path invalidation, prerequisite replanning, queued furnace batches, death cutoff and no false full-run completion.

The closed-loop scenario starts with an empty inventory in a resource-rich **mock** world. The controller selects every resource, recipe, placement, hunt and furnace action; the test does not inject intermediate tools to advance it. Physics, animal movement and furnace timing are simplified/accelerated. Real-game acceptance gates are listed in [VALIDATION.md](VALIDATION.md).
