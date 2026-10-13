/** Least-squares intersection of forward horizontal rays. Bedrock-neutral geometry, not a seed/structure oracle. */
export function triangulate(rays) {
    if (!Array.isArray(rays) || rays.length < 2) return { ok: false, reason: 'record at least two eye flights from separated positions' };
    let a = 0, b = 0, c = 0, u = 0, v = 0;
    const lines = [];
    for (const r of rays) {
        if (![r.x, r.z, r.dx, r.dz].every(Number.isFinite)) return { ok: false, reason: 'invalid bearing' };
        const length = Math.hypot(r.dx, r.dz);
        if (length < 1e-6) return { ok: false, reason: 'eye flight is too short' };
        const dx = r.dx / length, dz = r.dz / length, nx = -dz, nz = dx;
        const k = nx * r.x + nz * r.z;
        a += nx * nx; b += nx * nz; c += nz * nz; u += nx * k; v += nz * k;
        lines.push({ ...r, dx, dz, nx, nz, k });
    }
    const det = a * c - b * b;
    if (det / (a + c) ** 2 < 0.002) return { ok: false, reason: 'bearings nearly parallel; move sideways and throw again' };
    const x = (u * c - b * v) / det, z = (a * v - b * u) / det;
    if (lines.some(r => (x-r.x)*r.dx + (z-r.z)*r.dz < 0)) return { ok: false, reason: 'intersection behind an eye flight; check observations' };
    const residual = Math.sqrt(lines.reduce((sum, r) => sum + (r.nx*x + r.nz*z-r.k)**2, 0) / lines.length);
    if (residual > 32) return { ok: false, reason: 'inconsistent bearings; repeat eye observations' };
    return { ok: true, x, z, residual, observations: lines.length };
}
