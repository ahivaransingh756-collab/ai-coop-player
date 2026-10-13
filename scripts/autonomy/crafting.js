import { RECIPES } from './recipes.js';
/** Pure dry-run: no input mutation, no partial consumption, no overflow drops. */
export function planCraft(slots, recipeId, batches = 1) {
    const r = Object.hasOwn(RECIPES, recipeId) ? RECIPES[recipeId] : undefined;
    if (!r || !Number.isInteger(batches) || batches < 1 || batches > 16)
        return { ok: false, reason: 'unsupported recipe or batch count' };
    if (
        !Array.isArray(slots) ||
        slots.length > 128 ||
        slots.some(
            (s) =>
                s &&
                (!Number.isInteger(s.amount) ||
                    s.amount < 1 ||
                    !Number.isInteger(s.maxAmount) ||
                    s.amount > s.maxAmount),
        )
    )
        return { ok: false, reason: 'invalid inventory snapshot' };
    const next = slots.map((s, source) => (s ? { ...s, source } : undefined));
    for (const input of r.inputs) {
        let need = input.count * batches;
        for (let i = 0; i < next.length && need > 0; i++) {
            const s = next[i];
            if (!s || s.eligible === false || !input.ids.includes(s.typeId)) continue;
            const used = Math.min(need, s.amount);
            s.amount -= used;
            need -= used;
            if (s.amount === 0) next[i] = undefined;
        }
        if (need) return { ok: false, reason: `missing ${need} ${input.ids.join(' or ')}` };
    }
    let remaining = r.amount * batches;
    for (const s of next) {
        if (!s || s.eligible === false || s.typeId !== r.output || r.maxAmount === 1) continue;
        const n = Math.min(remaining, s.maxAmount - s.amount);
        s.amount += n;
        remaining -= n;
    }
    for (let i = 0; i < next.length && remaining > 0; i++) {
        if (next[i]) continue;
        const n = Math.min(remaining, r.maxAmount);
        next[i] = { typeId: r.output, amount: n, maxAmount: r.maxAmount, eligible: true };
        remaining -= n;
    }
    if (remaining) return { ok: false, reason: 'not enough inventory space for crafted output' };
    return { ok: true, recipe: r, next };
}

/** Synchronous compensating transaction. A failed rollback is a HARD fault, not a retry. */
export function commitCraft(container, makeStack, recipeId, batches = 1) {
    const original = Array.from({ length: container.size }, (_, i) => container.getItem(i)?.clone());
    const slots = original.map(
        (s) =>
            s && {
                typeId: s.typeId,
                amount: s.amount,
                maxAmount: s.maxAmount,
                eligible:
                    !s.nameTag &&
                    s.getLore().length === 0 &&
                    (s.getDynamicPropertyIds?.().length ?? 0) === 0 &&
                    (s.getComponent('minecraft:enchantable')?.getEnchantments().length ?? 0) === 0,
            },
    );
    const plan = planCraft(slots, recipeId, batches);
    if (!plan.ok) return plan;
    const touched = plan.next
        .map((s, i) => (s?.typeId !== slots[i]?.typeId || s?.amount !== slots[i]?.amount ? i : -1))
        .filter((i) => i >= 0);
    try {
        // Remove/reduce ingredients before introducing outputs; no world events/yields between writes.
        const ordered = [...touched].sort(
            (a, b) => Number(plan.next[a]?.source === undefined) - Number(plan.next[b]?.source === undefined),
        );
        for (const i of ordered) {
            const s = plan.next[i];
            let item;
            if (s) {
                item = s.source === undefined ? makeStack(s.typeId, s.amount) : original[s.source].clone();
                item.amount = s.amount;
            }
            container.setItem(i, item);
        }
        for (const i of touched) {
            const actual = container.getItem(i),
                expected = plan.next[i];
            if (actual?.typeId !== expected?.typeId || actual?.amount !== expected?.amount)
                throw new Error('craft write verification failed');
        }
        return { ok: true, output: plan.recipe.output, amount: plan.recipe.amount * batches };
    } catch (error) {
        try {
            // Clear changed slots first so an output cannot remain while ingredients are restored.
            for (const i of touched) container.setItem(i, undefined);
            for (const i of touched) container.setItem(i, original[i]);
            for (const i of touched) {
                const actual = container.getItem(i);
                if (actual?.typeId !== original[i]?.typeId || actual?.amount !== original[i]?.amount)
                    throw new Error('rollback verification failed');
            }
        } catch (rollback) {
            return {
                ok: false,
                fatal: true,
                reason: `inventory transaction fault: ${String(error)}; rollback failed: ${String(rollback)}`,
            };
        }
        return { ok: false, reason: `craft rolled back: ${String(error)}` };
    }
}
