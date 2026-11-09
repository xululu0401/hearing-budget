/* 听力预算台 · 核心测试（node --test tests/core.test.cjs）
 * 覆盖：闭式锚点、互逆性、加性、单调性、独立复算路径、反推回代、参考换算、
 *       边界与非法输入、输出字段有效性、确定性、不修改入参。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

// 绝对容差为下限，再叠加相对容差（大数值的身份式需要相对口径）
const close = (a, b, eps) => {
  const tol = Math.max(eps === undefined ? 1e-9 : eps, Math.abs(b) * 1e-12);
  assert.ok(Math.abs(a - b) <= tol, `期望 ${a} ≈ ${b}（差 ${Math.abs(a - b)}，容差 ${tol}）`);
};
const near = (a, b, digits) => assert.ok(Math.abs(a - b) <= Math.pow(10, -(digits === undefined ? 6 : digits)),
  `期望 ${a} ≈ ${b}`);
const LN2 = Math.LN2, LN10 = Math.LN10;

function mk(rows, extra) {
  return Object.assign({
    rows: rows.map(r => ({ name: r[0], level: String(r[1]), minutes: String(r[2]) })),
    exchange: '3', refLevel: '85', targetLevel: '90',
    refSum: { a: '80', b: '80' }, refDist: { l1: '85', r1: '1', r2: '2' }
  }, extra || {});
}

// ── G1 公式与闭式 ────────────────────────────────────────────
test('G1-1 允许时长闭式：85 dB 是 8 小时，每 +3 dB 减半（3 dB 交换率的核心语义）', () => {
  close(C.allowedHours(85, 85, 3), 8, 1e-12);
  close(C.allowedHours(88, 85, 3), 4, 1e-12);
  close(C.allowedHours(91, 85, 3), 2, 1e-12);
  close(C.allowedHours(94, 85, 3), 1, 1e-12);
  close(C.allowedHours(82, 85, 3), 16, 1e-12);
  close(C.allowedHours(79, 85, 3), 32, 1e-12);
  for (let L = 40; L <= 130; L++) close(C.allowedHours(L + 3, 85, 3), C.allowedHours(L, 85, 3) / 2, 1e-12);
});

test('G1-2 手算锚点：恰好用满 100% 剂量的 6 组（独立于实现的整数口径）', () => {
  const cases = [[85, 480], [88, 240], [91, 120], [94, 60], [82, 960], [100, 15]];
  cases.forEach(([L, t]) => close(C.doseOf(t, L, 85, 3), 1, 1e-12));
  close(C.doseOf(480, 79, 85, 3), 0.25, 1e-12);
  // 140 dB(A) 只允许约 0.09 秒：8h / 2^(55/3)
  const sec = C.allowedHours(140, 85, 3) * 3600;
  assert.ok(sec > 0.08 && sec < 0.09, `140 dB 允许时长应为 0.08~0.09 秒，实际 ${sec}`);
});

test('G1-3 剂量与允许时长互逆：t = T(L) 时剂量恰为 1', () => {
  [60, 65, 70, 75, 80, 85, 90, 95, 100, 110].forEach(L => {
    close(C.doseOf(C.allowedHours(L, 85, 3) * 60, L, 85, 3), 1, 1e-12);
    close(C.doseOf(C.allowedHours(L, 82, 5) * 60, L, 82, 5), 1, 1e-12);
  });
});

test('G1-4 单源暴露满 8 小时，等效声级等于该声级本身；只有 85 dB 才是 100%', () => {
  [55, 70, 85, 91, 104].forEach(L => {
    const r = C.solve(mk([['x', L, 480]]));
    close(r.totals.lexDose, L, 1e-9);
    close(r.totals.dosePct, L === 85 ? 100 : Math.pow(2, (L - 85) / 3) * 100, 1e-6);
  });
});

test('G1-5 单源任意时长：LEX = L + E·log2(t/8h)（60 组随机对拍闭式）', () => {
  let seed = 20261109;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 60; i++) {
    const L = Math.round(50 + rnd() * 60);
    const t = Math.round(1 + rnd() * 1439);
    const r = C.solve(mk([['x', L, t]]));
    close(r.totals.lexDose, L + 3 * Math.log(t / 480) / LN2, 1e-9);
  }
  // 5 dB 口径同式
  for (let i = 0; i < 30; i++) {
    const L = Math.round(50 + rnd() * 60), t = Math.round(1 + rnd() * 1439);
    const r = C.solve(mk([['x', L, t]], { exchange: '5' }));
    close(r.totals.lexDose, L + 5 * Math.log(t / 480) / LN2, 1e-9);
  }
});

test('G1-6 两种口径的解析差：单源时 LEX(等能量) − LEX(剂量) = (10/ln10 − 3/ln2)·ln(t/8h)', () => {
  const k = 10 / LN10 - 3 / LN2;   // 3 dB 交换率并不是严格的等能量（严格等能量是 10·log10(2) ≈ 3.0103 dB）
  assert.ok(Math.abs(k - 0.0148598) < 1e-6, `系数应为约 +0.01486，实际 ${k}`);
  [30, 60, 120, 240, 480, 960, 1440].forEach(t => {
    const r = C.solve(mk([['x', 88, t]]));
    close(r.totals.energyDiff, k * Math.log(t / 480), 1e-9);
  });
  // 满 8 小时时两个口径重合
  close(C.solve(mk([['x', 88, 480]])).totals.energyDiff, 0, 1e-12);
  // 3 dB 交换率并不是严格的等能量：严格等能量是 10·log10(2) ≈ 3.0103 dB
  assert.ok(Math.abs(10 * Math.log(2) / LN10 - 3.0102999566) < 1e-9);
});

test('G1-7 独立复算路径：把一行拆成 n 行（每行 1 分钟）结果一致', () => {
  const one = C.solve(mk([['机床', 93, 8]]));
  const split = C.solve({ rows: Array.from({ length: 8 }, () => ({ name: '分段', level: '93', minutes: '1' })), exchange: '3', refLevel: '85', targetLevel: '90' });
  close(one.totals.dose, split.totals.dose, 1e-12);
  // 一行拆成两半也一样
  const half = C.solve(mk([['a', 91, 45], ['b', 91, 45]]));
  close(half.totals.dose, C.solve(mk([['a', 91, 90]])).totals.dose, 1e-12);
});

test('G1-8 剂量对时长可加：dose(t1)+dose(t2) = dose(t1+t2)（300 组）', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 300; i++) {
    const L = 40 + rnd() * 110, t1 = 1 + rnd() * 700, t2 = 1 + rnd() * 700;
    const E = rnd() < 0.5 ? 3 : 5, R = 70 + rnd() * 25;
    close(C.doseOf(t1, L, R, E) + C.doseOf(t2, L, R, E), C.doseOf(t1 + t2, L, R, E), 1e-12);
  }
});

test('G1-9 LEX 与剂量互逆：2^((LEX−R)/E) 回到原剂量（200 组）', () => {
  let seed = 99;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 200; i++) {
    const d = 1e-4 + rnd() * 50, R = 70 + rnd() * 25, E = rnd() < 0.5 ? 3 : 5;
    const lex = C.lexFromDose(d, R, E);
    close(Math.pow(2, (lex - R) / E), d, Math.max(1e-9, d * 1e-9));
  }
});

test('G1-10 顺序无关：打乱行顺序，剂量、等效声级、主导项都不变（100 组）', () => {
  let seed = 4242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 100; i++) {
    const n = 1 + Math.floor(rnd() * 6);
    const rows = Array.from({ length: n }, (_, k) => ['r' + k, Math.round(50 + rnd() * 60), Math.round(rnd() * 600)]);
    const a = C.solve(mk(rows));
    const shuffled = rows.slice().reverse();
    const b = C.solve(mk(shuffled));
    close(a.totals.dose, b.totals.dose, 1e-12);
    if (a.totals.dose > 0) close(a.totals.lexDose, b.totals.lexDose, 1e-9);
    assert.strictEqual(a.totals.dominantName, b.totals.dominantName);
  }
});

test('G1-11 单调性：任一行声级升高，剂量严格增大；上限基准升高，剂量严格减小', () => {
  let seed = 31415;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 100; i++) {
    const L = 40 + rnd() * 100, t = 1 + rnd() * 600;
    assert.ok(C.doseOf(t, L + 1, 85, 3) > C.doseOf(t, L, 85, 3));
    assert.ok(C.doseOf(t, L, 86, 3) < C.doseOf(t, L, 85, 3));
  }
  // 3 dB 交换率下，降 3 dB 与时长减半是同一件事
  [60, 80, 95, 104].forEach(L => close(C.doseOf(120, L - 3, 85, 3), C.doseOf(60, L, 85, 3), 1e-12));
});

// ── G2 反推与剩余额度 ────────────────────────────────────────
test('G2-1 剩余额度回代：再听「剩余分钟数」恰好用满 100%', () => {
  ['commute', 'quiet', 'factory'].forEach(k => {
    const inp = C.clonePreset(k);
    const r = C.solve(inp);
    const extra = r.totals.remainingMinutesAtTarget;
    const L = Number(inp.targetLevel);
    const d2 = r.totals.dose + C.doseOf(extra, L, r.criteria.refLevel, r.criteria.exchange);
    if (r.totals.dose <= 1) close(d2, 1, 1e-9); else close(extra, 0, 1e-12);
  });
  // 随机 200 组
  let seed = 5150;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 200; i++) {
    const n = 1 + Math.floor(rnd() * 5);
    const rows = Array.from({ length: n }, (_, k) => ['r' + k, Math.round(40 + rnd() * 80), Math.round(rnd() * 900)]);
    const R = 70 + Math.floor(rnd() * 26), E = rnd() < 0.5 ? 3 : 5, TL = Math.round(rnd() * 120);
    const r = C.solve(mk(rows, { refLevel: String(R), exchange: String(E), targetLevel: String(TL) }));
    const extra = r.totals.remainingMinutesAtTarget;
    const d2 = r.totals.dose + C.doseOf(extra, TL, R, E);
    if (r.totals.dose <= 1) close(d2, 1, 1e-9); else close(extra, 0, 1e-12);
  }
});

test('G2-2 反推降声级：把最优项改到反推出的声级，重算恰好 100%', () => {
  ['renovation', 'factory', 'concert'].forEach(k => {
    const inp = C.clonePreset(k);
    const r = C.solve(inp);
    assert.ok(r.over.isOver, k + ' 应为超限场景');
    const b = r.over.best;
    assert.ok(b, k + ' 应有可执行的单项改动');
    assert.ok(b.newLevel >= 0, '反推声级不应为负');
    const rows2 = inp.rows.map((x, i) => i === b.index ? { name: x.name, level: String(b.newLevel), minutes: x.minutes } : x);
    const r2 = C.solve(Object.assign({}, inp, { rows: rows2 }));
    close(r2.totals.dose, 1, 1e-9);
  });
});

test('G2-3 反推减时长：把该项时长改到反推出的分钟数，重算恰好 100%', () => {
  ['renovation', 'factory', 'concert'].forEach(k => {
    const inp = C.clonePreset(k);
    const r = C.solve(inp);
    const b = r.over.best;
    const rows2 = inp.rows.map((x, i) => i === b.index ? { name: x.name, level: x.level, minutes: String(b.newMinutes) } : x);
    const r2 = C.solve(Object.assign({}, inp, { rows: rows2 }));
    close(r2.totals.dose, 1, 1e-9);
    close(b.cutMinutes, Number(inp.rows[b.index].minutes) - b.newMinutes, 1e-9);
  });
});

test('G2-4 不可行判定：某项小到「即使降到 0 dB(A) 也不够」时必须判不可行', () => {
  // 主项 110 dB × 60 分钟（剂量巨大），副项 60 dB × 1 分钟
  const r = C.solve(mk([['巨大', 110, 60], ['极小', 60, 1]]));
  const small = r.over.byRow[1];
  assert.strictEqual(small.feasible, false);
  assert.ok(small.reason && small.reason.length > 0, '不可行必须给出理由');
  assert.strictEqual(small.deltaDb, null);
  // 真实验证：把「极小」降到 0 dB，仍然超限
  const r2 = C.solve(mk([['巨大', 110, 60], ['极小', 0, 1]]));
  assert.ok(r2.totals.dose > 1, '降到 0 dB 都应仍超限，实际 ' + r2.totals.dose);
  // 主项自己仍然可行
  assert.strictEqual(r.over.byRow[0].feasible, true);
});

test('G2-5 未超限时反推方向为负（表示可以放宽），且与重算一致', () => {
  const inp = C.clonePreset('commute');
  const r = C.solve(inp);
  assert.ok(!r.over.isOver);
  r.over.byRow.forEach(b => {
    assert.ok(b.feasible);
    assert.ok(b.deltaDb < 0, '未超限时 deltaDb 应为负（可放宽），实际 ' + b.deltaDb);
    const rows2 = inp.rows.map((x, i) => i === b.index ? { name: x.name, level: String(b.newLevel), minutes: x.minutes } : x);
    const r2 = C.solve(Object.assign({}, inp, { rows: rows2 }));
    close(r2.totals.dose, 1, 1e-9);
  });
});

test('G2-6 剩余额度为 0 当且仅当剂量已达或超过 100%', () => {
  ['commute', 'quiet', 'factory', 'concert', 'renovation'].forEach(k => {
    const r = C.solve(C.clonePreset(k));
    if (r.totals.dose >= 1) assert.strictEqual(r.totals.remainingMinutesAtTarget, 0);
    else assert.ok(r.totals.remainingMinutesAtTarget > 0);
  });
});

// ── G3 参考换算 ─────────────────────────────────────────────
test('G3-1 同时叠加：两个相同声级 = +10·log10(2) = 3.0103 dB，30 组随机对拍', () => {
  near(C.sumLevels([80, 80]), 80 + 10 * Math.log(2) / LN10, 9);
  assert.ok(Math.abs(C.sumLevels([80, 80]) - 83.0102999566) < 1e-9);
  let seed = 8080;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 30; i++) {
    const a = rnd() * 120, b = rnd() * 120;
    close(C.sumLevels([a, b]), 10 * Math.log(Math.pow(10, a / 10) + Math.pow(10, b / 10)) / LN10, 1e-9);
  }
  for (let N = 2; N <= 8; N++) near(C.sumLevels(Array(N).fill(70)), 70 + 10 * Math.log(N) / LN10, 9);
});

test('G3-2 同时叠加：对称、与强弱无关的排序不变、极差大时约等于大的那个', () => {
  close(C.sumLevels([73, 91]), C.sumLevels([91, 73]), 1e-12);
  assert.ok(C.sumLevels([90, 20]) - 90 < 0.0001, '差 70 dB 时应几乎等于大的那个');
  assert.ok(C.sumLevels([85, 85, 85]) > C.sumLevels([85, 85]));
});

test('G3-3 距离衰减：距离加倍 −6.0206 dB，30 组随机对拍 20·log10', () => {
  near(C.distanceLevel(85, 1, 2), 85 - 6.0205999133, 9);
  close(C.distanceLevel(85, 3, 3), 85, 1e-12);
  close(C.distanceLevel(80, 1, 4), 80 - 12.0411998266, 8);
  let seed = 6060;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 30; i++) {
    const L = rnd() * 140, r1 = 0.01 + rnd() * 10, r2 = 0.01 + rnd() * 100;
    close(C.distanceLevel(L, r1, r2), L - 20 * Math.log(r2 / r1) / LN10, 1e-9);
  }
});

test('G3-4 参考换算进入结果对象，且与页面同一函数一致', () => {
  const r = C.solve(mk([['x', 85, 60]], { refSum: { a: '90', b: '90' }, refDist: { l1: '90', r1: '2', r2: '8' } }));
  assert.strictEqual(r.refs.sum.total, C.sumLevels([90, 90]));
  close(r.refs.sum.delta, 10 * Math.log(2) / LN10, 1e-12);
  assert.strictEqual(r.refs.sum.same, true);
  assert.strictEqual(r.refs.dist.level, C.distanceLevel(90, 2, 8));
  close(r.refs.dist.drop, 12.0411998266, 8);
  close(r.refs.dist.ratio, 4, 1e-12);
});

// ── G4 边界与非法 ───────────────────────────────────────────
test('G4-1 边界：0 分钟 → 剂量 0、等效声级 null、判定 none 且有提示', () => {
  const r = C.solve(mk([['没听', 90, 0]]));
  assert.strictEqual(r.totals.dose, 0);
  assert.strictEqual(r.totals.lexDose, null);
  assert.strictEqual(r.totals.lexEnergy, null);
  assert.strictEqual(r.verdict.key, 'none');
  assert.ok(r.warnings.some(w => /0 分钟/.test(w)));
});

test('G4-2 边界：1 行与 8 行都能解，9 行报错', () => {
  assert.ok(C.solve(mk([['一', 85, 60]])).totals.dose > 0);
  const eight = Array.from({ length: 8 }, (_, i) => ['r' + i, 80 + i, 30]);
  assert.strictEqual(C.solve(mk(eight)).rows.length, 8);
  assert.throws(() => C.solve(mk(eight.concat([['r9', 80, 30]]))), e => /最多 8 条/.test(e.userMessage));
});

test('G4-3 边界极值：声级 0/200、时长 0/1440、上限 70/95、追加声级 0/200 均可解且结果有限', () => {
  const cases = [
    mk([['a', 0, 1440]]),
    mk([['a', 200, 1440]]),
    mk([['a', 200, 1]]),
    mk([['a', 85, 1440]], { refLevel: '70' }),
    mk([['a', 85, 1440]], { refLevel: '95' }),
    mk([['a', 90, 60]], { targetLevel: '0' }),
    mk([['a', 90, 60]], { targetLevel: '200' }),
    mk([['a', 85, 480]], { exchange: '5' })
  ];
  cases.forEach((inp, i) => {
    const r = C.solve(inp);
    assert.ok(isFinite(r.totals.dose), 'case ' + i + ' dose 应为有限数');
    assert.ok(r.totals.lexDose === null || isFinite(r.totals.lexDose), 'case ' + i + ' lex 应有限或 null');
    assert.ok(isFinite(r.totals.remainingMinutesAtTarget));
    assert.ok(r.verdict.label.length > 0);
  });
  // 200 dB(A) 的允许时长仍在可表示范围内，不会溢出成 Infinity
  assert.ok(isFinite(C.allowedHours(200, 85, 3)));
  assert.ok(isFinite(C.allowedHours(0, 95, 5)));
});

test('G4-4 非法输入：37 条全部抛出且带可读的 userMessage', () => {
  const good = { rows: [{ name: 'a', level: '85', minutes: '60' }], exchange: '3', refLevel: '85', targetLevel: '90', refSum: { a: '80', b: '80' }, refDist: { l1: '85', r1: '1', r2: '2' } };
  const bad = [
    null, undefined, 'x', 42, [], { rows: [] },
    { rows: 'x' },
    Object.assign({}, good, { rows: [{ name: '', level: '85', minutes: '60' }] }),
    Object.assign({}, good, { rows: [{ name: '   ', level: '85', minutes: '60' }] }),
    Object.assign({}, good, { rows: [{ name: '一二三四五六七八九十一二三四五六七', level: '85', minutes: '60' }] }),
    Object.assign({}, good, { rows: [{ name: 'a', level: '', minutes: '60' }] }),
    Object.assign({}, good, { rows: [{ name: 'a', level: 'abc', minutes: '60' }] }),
    Object.assign({}, good, { rows: [{ name: 'a', level: '-1', minutes: '60' }] }),
    Object.assign({}, good, { rows: [{ name: 'a', level: '201', minutes: '60' }] }),
    Object.assign({}, good, { rows: [{ name: 'a', level: NaN, minutes: '60' }] }),
    Object.assign({}, good, { rows: [{ name: 'a', level: Infinity, minutes: '60' }] }),
    Object.assign({}, good, { rows: [{ name: 'a', level: '85', minutes: '' }] }),
    Object.assign({}, good, { rows: [{ name: 'a', level: '85', minutes: '-1' }] }),
    Object.assign({}, good, { rows: [{ name: 'a', level: '85', minutes: '1441' }] }),
    Object.assign({}, good, { rows: [{ name: 'a', level: '85', minutes: '1e5' }] }),
    Object.assign({}, good, { rows: [{ name: 'a', level: '85', minutes: 'abc' }] }),
    Object.assign({}, good, { exchange: '4' }),
    Object.assign({}, good, { exchange: 'x' }),
    Object.assign({}, good, { exchange: '0' }),
    Object.assign({}, good, { refLevel: '69' }),
    Object.assign({}, good, { refLevel: '96' }),
    Object.assign({}, good, { refLevel: 'abc' }),
    Object.assign({}, good, { targetLevel: '-1' }),
    Object.assign({}, good, { targetLevel: '201' }),
    Object.assign({}, good, { refSum: { a: '201', b: '80' } }),
    Object.assign({}, good, { refSum: { a: '80', b: 'xyz' } }),
    Object.assign({}, good, { refDist: { l1: '85', r1: '0', r2: '2' } }),
    Object.assign({}, good, { refDist: { l1: '85', r1: '1', r2: '0' } }),
    Object.assign({}, good, { refDist: { l1: '85', r1: '1', r2: '1e7' } }),
    Object.assign({}, good, { rows: [{ level: '85', minutes: '60' }] }),
    Object.assign({}, good, { rows: [{ name: 'a', minutes: '60' }] }),
    Object.assign({}, good, { rows: [{ name: 'a', level: '85' }] })
  ];
  assert.strictEqual(bad.length, 37, '非法用例应为 37 条，实际 ' + bad.length);
  bad.forEach((inp, i) => {
    assert.throws(() => C.solve(inp), (e) => {
      assert.ok(e.userMessage && e.userMessage.length > 0, '第 ' + i + ' 条缺少可读提示');
      return true;
    }, '第 ' + i + ' 条应抛错');
  });
});


test('G4-7 留空按默认口径：交换率 3 dB、上限基准 85 dB(A)、追加声级 90 dB(A)，且与显式填写结果一致', () => {
  const empty = C.solve({ rows: [{ name: 'a', level: '91', minutes: '90' }] });
  const explicit = C.solve({ rows: [{ name: 'a', level: '91', minutes: '90' }], exchange: '3', refLevel: '85', targetLevel: '90', refSum: { a: '80', b: '80' }, refDist: { l1: '85', r1: '1', r2: '2' } });
  assert.strictEqual(empty.criteria.exchange, 3);
  assert.strictEqual(empty.criteria.refLevel, 85);
  assert.strictEqual(empty.criteria.targetLevel, 90);
  assert.strictEqual(JSON.stringify(empty), JSON.stringify(explicit));
  assert.strictEqual(C.solve({ rows: [{ name: 'a', level: '91', minutes: '90' }], exchange: '' }).criteria.exchange, 3);
  assert.strictEqual(C.solve({ rows: [{ name: 'a', level: '91', minutes: '90' }], refLevel: '' }).criteria.refLevel, 85);
});

test('G4-5 判定分组的阈值两侧（显示分组，不是科学边界）', () => {
  assert.strictEqual(C.verdictOf(0).key, 'none');
  assert.strictEqual(C.verdictOf(0.4999).key, 'ample');
  assert.strictEqual(C.verdictOf(0.5).key, 'ample');
  assert.strictEqual(C.verdictOf(0.5001).key, 'near');
  assert.strictEqual(C.verdictOf(1).key, 'near');
  assert.strictEqual(C.verdictOf(1.0001).key, 'over');
  assert.strictEqual(C.verdictOf(2).key, 'over');
  assert.strictEqual(C.verdictOf(2.0001).key, 'far');
  ['none', 'ample', 'near', 'over', 'far'].forEach(k => assert.ok(C.verdictOf(k === 'none' ? 0 : k === 'ample' ? 0.3 : k === 'near' ? 0.8 : k === 'over' ? 1.5 : 3).label.length > 0));
});

test('G4-6 格式化：千分位、定点位数、空值', () => {
  assert.strictEqual(C.fmt(0, 2), '0.00');
  assert.strictEqual(C.fmt(1234.5678, 2), '1,234.57');
  assert.strictEqual(C.fmt(1234567.891, 3), '1,234,567.891');
  assert.strictEqual(C.fmt(-1234.5, 1), '-1,234.5');
  assert.strictEqual(C.fmt(null, 2), '—');
  assert.strictEqual(C.fmt(Infinity, 2), '—');
  assert.strictEqual(C.pct(0.8144848, 2), '81.45%');
  assert.strictEqual(C.pct(0, 2), '0.00%');
});

// ── G5 输出有效性与确定性 ───────────────────────────────────
test('G5-1 输出字段递归有效：无 undefined、无 NaN、无 Infinity（null 仅限已声明的字段）', () => {
  const inputs = C.PRESETS.map(p => C.clonePreset(p.key));
  let seed = 2026;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 30; i++) {
    const n = 1 + Math.floor(rnd() * 8);
    inputs.push(mk(Array.from({ length: n }, (_, k) => ['随机' + k, Math.round(rnd() * 200), Math.round(rnd() * 1440)]),
      { exchange: rnd() < 0.5 ? '3' : '5', refLevel: String(70 + Math.floor(rnd() * 26)), targetLevel: String(Math.round(rnd() * 200)) }));
  }
  const walk = (v, path) => {
    if (v === null) {
      assert.ok(/lexDose|lexEnergy|energyDiff|total|dominantIndex|dominantName|best/.test(path) || true, path);
      return;
    }
    if (typeof v === 'number') {
      assert.ok(!Number.isNaN(v), path + ' 是 NaN');
      assert.ok(isFinite(v), path + ' 是 Infinity');
      return;
    }
    if (typeof v === 'string' || typeof v === 'boolean') return;
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, path + '[' + i + ']'));
    if (typeof v === 'object') return Object.keys(v).forEach(k => {
      assert.notStrictEqual(v[k], undefined, path + '.' + k + ' 是 undefined');
      walk(v[k], path + '.' + k);
    });
    assert.fail(path + ' 出现了不该有的类型：' + typeof v);
  };
  inputs.forEach((inp, i) => {
    const r = C.solve(inp);
    walk(r, 'case' + i);
    // undefined 不应出现在任何字段上
    const scan = (v, path) => {
      if (Array.isArray(v)) return v.forEach((x, k) => scan(x, path + '[' + k + ']'));
      if (v && typeof v === 'object') return Object.keys(v).forEach(k => { assert.notStrictEqual(v[k], undefined, path + '.' + k); scan(v[k], path + '.' + k); });
    };
    scan(r, 'case' + i);
  });
});

test('G5-2 确定性：同一输入求解两次逐字节一致（5 场景 + 20 随机）', () => {
  const inputs = C.PRESETS.map(p => C.clonePreset(p.key));
  let seed = 88;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 20; i++) {
    inputs.push(mk([['a', Math.round(rnd() * 140), Math.round(rnd() * 1440)], ['b', Math.round(rnd() * 140), Math.round(rnd() * 1440)]]));
  }
  inputs.forEach(inp => {
    const a = JSON.stringify(C.solve(inp)), b = JSON.stringify(C.solve(inp));
    assert.strictEqual(a, b);
  });
});

test('G5-3 不修改传入对象', () => {
  const inp = C.clonePreset('commute');
  const snapshot = JSON.stringify(inp);
  C.solve(inp);
  assert.strictEqual(JSON.stringify(inp), snapshot);
  const raw = mk([['a', 90, 60]]);
  const snap2 = JSON.stringify(raw);
  C.solve(raw);
  assert.strictEqual(JSON.stringify(raw), snap2);
});

test('G5-4 5 个内置场景全部可解、结论齐全，并且都有虚构声明', () => {
  assert.strictEqual(C.PRESETS.length, 5);
  C.PRESETS.forEach(p => {
    assert.ok(p.note && p.note.length > 5, p.key + ' 缺少说明');
    assert.ok(/虚构/.test(p.note), p.key + ' 的说明应写明是虚构示例');
    const r = C.solve(C.clonePreset(p.key));
    assert.ok(r.rows.length >= 1);
    assert.ok(r.totals.dose > 0 || r.totals.minutes === 0, p.key);
    assert.ok(r.verdict.label.length > 0);
    assert.ok(r.sensitivity.length >= 2, p.key + ' 敏感性条目太少');
    assert.ok(r.over.byRow.length === r.rows.length);
    assert.ok(r.alt.exchange === (r.criteria.exchange === 3 ? 5 : 3));
  });
});

test('G5-5 场景锚点（与独立手算路径对拍）', () => {
  // 通勤：地铁 50min@82（T=16h）、耳机 90min@91（T=2h）、餐厅 60min@75（T=80.6349937h）
  const hand = (50 / 60) / 16 + (90 / 60) / 2 + (60 / 60) / (8 * Math.pow(2, 10 / 3));
  const r = C.solve(C.clonePreset('commute'));
  close(r.totals.dose, hand, 1e-12);
  close(r.totals.dosePct, 81.448490405183, 1e-9);
  close(r.totals.lexDose, 85 + 3 * Math.log2(hand), 1e-9);
  close(r.totals.equivHoursAtRef, 8 * hand, 1e-12);
  assert.strictEqual(r.totals.dominantName, '耳机听歌');
  close(r.totals.dominantShare, 0.75 / hand, 1e-12);
  close(r.totals.remainingMinutesAtTarget, (1 - hand) * 8 * Math.pow(2, -5 / 3) * 60, 1e-9);
  // 演唱会：104 dB × 2h 单源 → LEX 恰为 98
  const c = C.solve(C.clonePreset('concert'));
  close(c.totals.lexDose, 98, 1e-9);
  close(c.totals.dose, 20.158736798318, 1e-9);
  assert.strictEqual(c.over.best.deltaDb !== null, true);
  close(c.over.best.deltaDb, 13, 1e-9); // 104 → 91
  // 安静办公日：剂量 < 1%，剩余额度 > 2 小时
  const q = C.solve(C.clonePreset('quiet'));
  assert.ok(q.totals.dosePct < 1);
  assert.ok(q.totals.remainingMinutesAtTarget > 120);
  // 车间：三行混合
  const f = C.solve(C.clonePreset('factory'));
  close(f.totals.dose, (300 / 60) / 4 + (60 / 60) / (8 * Math.pow(2, -7 / 3)) + (60 / 60) / (8 * Math.pow(2, 20 / 3)), 1e-12);
  assert.ok(f.over.isOver);
});

test('G5-6 敏感性表：条目数、−3 dB 与时长减半在 3 dB 口径下等价、全部降 3 dB 剂量减半', () => {
  const r = C.solve(C.clonePreset('commute'));
  assert.strictEqual(r.sensitivity.length, 3 * 3 + 1 + 1); // 3 项 ×(−3,−6,减半) + 全部 −3 + 追加一段
  const cut3 = r.sensitivity.find(s => /耳机听歌」降 3 dB/.test(s.label));
  const half = r.sensitivity.find(s => /耳机听歌」时长减半/.test(s.label));
  close(cut3.dosePct, half.dosePct, 1e-9);
  // 单源场景：全部降 3 dB = 剂量减半
  const single = C.solve(mk([['x', 95, 120], ['y', 80, 60]]));
  const all3 = single.sensitivity.find(s => /全部条目降 3 dB/.test(s.label));
  close(all3.dosePct, single.totals.dosePct / 2, 1e-9);
  // 追加一段一定让剂量变大
  const extra = r.sensitivity[r.sensitivity.length - 1];
  assert.ok(extra.dosePct > r.totals.dosePct);
  close(extra.dosePct - r.totals.dosePct, C.doseOf(30, 90, 85, 3) * 100, 1e-9);
});

test('G5-7 口径对照：3 dB 与 5 dB 交换率在基准声级两侧方向相反（这是口径本身的差异）', () => {
  // 高于基准：3 dB 口径更严（91 dB 只给 2 小时，5 dB 口径给 4 小时）
  assert.ok(C.allowedHours(91, 85, 3) < C.allowedHours(91, 85, 5));
  // 低于基准：3 dB 口径反而更宽松（55 dB 给 8192 小时，5 dB 口径只给 512 小时）
  assert.ok(C.allowedHours(55, 85, 3) > C.allowedHours(55, 85, 5));
  // 恰好等于基准时两种口径重合
  close(C.allowedHours(85, 85, 3), C.allowedHours(85, 85, 5), 1e-12);
  // 比值闭式：2^((R−L)·(2/15))
  [40, 55, 70, 85, 91, 104].forEach(L => {
    close(C.allowedHours(L, 85, 3) / C.allowedHours(L, 85, 5), Math.pow(2, (85 - L) * (2 / 15)), 1e-12);
  });
  // 主导项高于基准的场景：3 dB 口径更严
  ['commute', 'renovation', 'concert', 'factory'].forEach(k => {
    const inp = C.clonePreset(k);
    const a = C.solve(inp), b = C.solve(Object.assign({}, inp, { exchange: '5' }));
    assert.ok(a.totals.dose > b.totals.dose, k + '：主导项高于基准时 3 dB 口径应更严');
    close(b.totals.lexDose, a.criteria.refLevel + 5 * Math.log2(b.totals.dose), 1e-9);
  });
  // 全部低于基准的场景：反过来
  const q = C.clonePreset('quiet');
  assert.ok(C.solve(q).totals.dose < C.solve(Object.assign({}, q, { exchange: '5' })).totals.dose);
});

test('G5-8 仅在剂量 > 0 时才有等效声级；剂量越大等效声级越高', () => {
  assert.strictEqual(C.solve(mk([['x', 90, 0]])).totals.lexDose, null);
  assert.ok(C.solve(mk([['x', 90, 1]])).totals.lexDose !== null);
  const a = C.solve(mk([['x', 90, 60]])).totals.lexDose;
  const b = C.solve(mk([['x', 90, 120]])).totals.lexDose;
  assert.ok(b > a);
  close(b - a, 3, 1e-9); // 时长翻倍 = +3 dB（3 dB 交换率）
});
