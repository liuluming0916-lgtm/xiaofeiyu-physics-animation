/**
 * 场景分组：一个元件可以有多套“从 0 开始的另一种情形”。
 *
 * 普通分支（q08）：branch 段 t0 = 主过程结束时刻，时间继续，位置重置。
 * 零时刻场景切换（q07）：branch 段 t0 = 0，前面已有主过程 ⇒ 这是一套新场景，
 * 动画时间轴把两套场景**首尾相接**：主场景 0..D1，新场景 D1..D1+D2。
 *
 * 这里只做布局计算；解析、生成、门禁都读同一份。
 */

const EPS = 1e-9;

/** 某个元件的场景布局（按 segment 顺序） */
export function scenariosOfElement(element) {
  const segs = [...(element?.segments ?? [])].sort((a, b) => Number(a.segment) - Number(b.segment));
  const groups = [];
  let current = [];
  for (const seg of segs) {
    const reset = seg.branch === true && Math.abs(Number(seg.t0)) <= EPS && current.length > 0;
    if (reset) {
      groups.push(current);
      current = [];
    }
    current.push(seg);
  }
  if (current.length) groups.push(current);

  let filmStart = 0;
  const scenarios = groups.map((group, index) => {
    const t0 = Math.min(...group.map((s) => Number(s.t0)));
    const t1 = Math.max(...group.map((s) => Number(s.t1)));
    const duration = Math.max(0, t1 - t0);
    const item = {
      index,
      segments: group,
      localT0: t0,
      localT1: t1,
      duration,
      filmStart,
      filmEnd: filmStart + duration,
      /** 这一组的第一段是 branch:true 且 t0=0 ⇒ 零时刻场景切换 */
      reset: index > 0 && group[0]?.branch === true && Math.abs(Number(group[0].t0)) <= EPS,
    };
    filmStart += duration;
    return item;
  });
  return { scenarios, filmDuration: filmStart };
}

/** 整个运动表的动画总时长（各元件取最大） */
export function analysisFilmDuration(analysis) {
  let max = 0;
  for (const el of analysis?.elements ?? []) {
    max = Math.max(max, scenariosOfElement(el).filmDuration);
  }
  return max;
}

/** 场景切换时刻（animation 时间轴；升序去重） */
export function branchFilmTimes(analysis) {
  const times = [];
  for (const el of analysis?.elements ?? []) {
    const { scenarios } = scenariosOfElement(el);
    for (const sc of scenarios) {
      for (const seg of sc.segments) {
        if (seg.branch !== true) continue;
        // 零时刻切换：新场景的起点；普通分支：段起点在主场景时间轴上的位置
        const film = sc.reset && Math.abs(Number(seg.t0)) <= EPS
          ? sc.filmStart
          : sc.filmStart + (Number(seg.t0) - sc.localT0);
        if (Number.isFinite(film) && film >= 0) times.push(film);
      }
    }
  }
  return [...new Set(times.map((v) => Math.round(v * 1e9) / 1e9))]
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
}
