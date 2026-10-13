# Architecture and invariants

**v0.3 update:** This page describes the retained co-op route. The separate `!bot auto` controller and its explicit modded crafting/furnace bridge are documented in [AUTONOMY.md](AUTONOMY.md). Its behavior deliberately differs from the v0.2 human-handoff design below.

## Layer boundaries

```text
Bedrock events / !bot commands
        │
        ▼
main.js ── authorization + confirmation + lifecycle + checkpoint storage
        │
        ▼
Brain ── survival preemption / one active behavior / task scheduling
  ├── TaskGraph ── DAG, prerequisites, retry budget, backoff, progress
  ├── RunState ── owner-scoped journal, waypoints, active ticks, splits
  └── behaviors
       ├── Follow / Defend
       ├── GatherBlocks: search → approach → break → collect
       ├── Eat: inventory-slot use → observed consumption
       ├── Travel / PortalTravel: bounded navigation → observed arrival/dimension
       └── Observe: truthful human handoff → live objective evidence
                │
                ▼
       ScriptBody / ScriptWorld ── Bedrock API calls and observations
```

`core`, `speedrun` and behavior modules do not import Minecraft packages; Node tests inject a world/body. Adapter modules and the entry point run **only inside Bedrock**. npm declarations are not runtime implementations.

## Invariants

1. **One controller at a time.** Interruptions cancel movement/mining/item use for the current behavior. Eating takes priority, then critical-health stopping, then configured defense, then base work. Stop is authoritative and also clears pending confirmation at the command boundary.
2. **Requested action ≠ verified objective.** A successful API return does not finish a route milestone. Route `verify` predicates are checked again by Brain before recording success.
3. **No magical crafting.** Route observation stages do not mutate inventory, create items, locate hidden structures or set blocks. Slot swaps equip existing items; drops use the native inventory action.
4. **Unknown ≠ safe.** Unloaded block queries return undefined. Excavation, waypoint approach and spawn checks reject unknown required terrain. This does not make native navigation globally hazard-proof.
5. **Dimension identity is part of every location.** Waypoint marking constrains portal sides; travel checks the source dimension. Human threat coordinates are used only in the bot's dimension.
6. **Inventory totals survive route interruption.** Route gathering checks total inventory; ad-hoc gathering freezes its starting baseline in task parameters. Interruptions do not spend retries.
7. **Retry storms are bounded.** A task gets one initial attempt plus `maxRetries`; failures set `availableAtTick`. Backoff is exponential from 40 ticks, capped at 600. Bounded behavior-level timeouts also apply.
8. **Human waiting does not block runnable work.** Executable frontier tasks are preferred over unsatisfied handoffs; active handoffs reconsider eligible independent work every 20 ticks.
9. **Death is positive evidence, absence is not.** Only an eligible nearby dragon-death event sets current-run victory evidence. A co-op death observation is not proof the bot dealt the killing blow.
10. **Persistence resumes paused.** Saves contain route version and owner. Running tasks serialize as pending without charging another retry. Inventory and simulated-player entities are not serialized or recreated from items.

## Budgets

- Tick snapshot cache: once per game tick; health and inventory still refresh each tick.
- Entity queries: once per ten ticks, or on dimension change. Threat positions can be stale up to nine ticks.
- Gathering scan: configurable candidate count; nearest-first offsets cached by radius. Safety neighbor reads are additional work.
- Gather approach: 600 ticks; breaking: 600; drop collection: 200.
- Travel: 1,200 ticks, three stuck/no-path strikes, navigation at most every 20 ticks.
- Food use: 80 ticks; failed food retry suppressed for 200 ticks.
- Co-op reminders: every 600 ticks; individual handoff attempt timeout: 30 game minutes.
- Persistence interval: 200 ticks (up to ten seconds of journal loss on abrupt interruption).
- Ad-hoc graph history: approximately 64 nodes; telemetry records: 200; resource sightings: 150; failure keys: 256; portal memory: 32; deaths: 20.

All timing assumes nominal 20 ticks/second. It is controller timing, not real-time speedrun timing under lag.

## Known limitations and extension seams

- No global terrain planner, autonomous exploration, ore tunneling, bridging, armor equipping, shield tactics or ranged aiming.
- The co-op route retains its handoffs. Auto mode now supports the documented crafting allowlist and real furnace operation, but not portal construction, fortress search, bartering or dragon fighting.
- Default auto-defense excludes neutral endermen/piglins even if they become angry. It does not infer aggression state; manually manage those encounters. Other hostile engagements are basic melee, not expert combat.
- Low-health policy stops rather than planning a retreat/healing shelter; the human must secure the area. Food use also stops movement while eating.
- Native portal navigation is particularly sensitive to portal block height, path shape and the engine build. Test it with a clear lower-block target before any real run.
- `prep_end` verifies only food, blocks and water; it explicitly does **not** certify armor, weapons or dragon readiness.
- Player identity uses the existing player-name authorization model. This is not a hardened public-server permissions/security framework.
- A snapshot aggregates item type/count, not durability/enchantments. Silk Touch can prevent expected ore/cobblestone drops. Unknown/custom loot tables may invalidate strategy assumptions.
- Checkpoints record historical milestones, not conserved current supplies. Restore never invents lost items; replenish tools/materials or reset the run when appropriate.
- A reload is not an attachment API for an existing simulated player. Tag detection refuses duplicate spawning; despawn first, retrieve supplies, then reload/reopen.
- Route shape/estimates are static policy, not a learned optimal strategy. Risk-adjusted time is a scheduling heuristic, not a success-probability model.

New executors should keep the same `start/tick/cancel` contract, use existing-item actions, state their preconditions, budget all work, supply positive evidence and include failure/interrupt tests before replacing a co-op handoff.
