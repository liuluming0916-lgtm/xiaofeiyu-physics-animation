/**
 * 测试台：在 Node 里用 mock canvas 跑一遍模板页的真实播放路径。
 *
 * 存在的理由（§7.1 的反面说明）：Dry-Run 不需要 mock canvas，因为 drawFrame 不接触 DOM。
 * 但**模板页的渲染器**（replayToCanvas + AutoView + createPlayer）需要一次接线验证，
 * 否则"15 道题都能播"这句话没有证据。这里用一个记录型 2D 上下文，验证的是
 * "命令缓冲 → 屏幕像素"这条链路能跑通且画笔调用数合理，而不是像素级回归。
 */

import { createPlayerFromFactory, assembleProgramSource, sandboxBundle } from '../../sdk/runtime/animation-runtime.mjs';

export function makeMockCanvas(width = 880, height = 388) {
  const calls = [];
  const handler = {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      // 未定义的方法一律记为调用；属性读写走默认。
      // `texts` 记录字符串实参（`fillText` / `strokeText`）——取证"画布上到底印了什么字"要用它：
      // 只查命令记录会漏掉**渲染器内部拼出来**的字符串（例如箭头标签里的物理量）。
      return (...args) => {
        calls.push({
          op: String(prop),
          args: args.filter((a) => typeof a === 'number'),
          texts: args.filter((a) => typeof a === 'string'),
        });
        return undefined;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  };
  const ctx2d = new Proxy(
    {
      canvas: null,
      measureText: (text) => ({ width: String(text).length * 7 }),
      drawImage: () => {},
      save: () => {},
      restore: () => {},
    },
    handler,
  );
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getContext: () => ctx2d,
    __calls: calls,
  };
  ctx2d.canvas = canvas;
  return canvas;
}

export function renderQuestion(program, opts = {}) {
  const canvas = makeMockCanvas(opts.width ?? 880, opts.height ?? 388);
  const assembly = assembleProgramSource(program.slots, { mode: program.mode ?? 'NUMERIC' });
  // eslint-disable-next-line no-new-func
  const factory = new Function('runtime', `${assembly}\nreturn buildProgram;`)(sandboxBundle());
  const player = createPlayerFromFactory(factory, { canvas, dpr: 1 });
  const samples = opts.samples ?? 24;
  const out = [];
  let paintBase = canvas.__calls.length;
  for (let i = 0; i <= samples; i += 1) {
    player.state.t = (player.duration * i) / samples;
    const frame = player.render();
    const paint = canvas.__calls.length - paintBase;
    paintBase = canvas.__calls.length;
    out.push({
      t: player.state.t,
      commands: frame.records.length,
      painted: frame.painted,
      paintCalls: paint,
      readouts: frame.readouts.length,
      transform: frame.transform.scale,
      /** 相机中心（世界坐标）：锁死相机时应全时段恒定 */
      camera: { x: frame.transform.centerX, y: frame.transform.centerY },
      /** 直接读缓冲，排除 render() 内部快照的干扰 */
      bufferNow: player.buffer.records.length,
      frameStateKeys: frame.state && typeof frame.state === 'object' ? Object.keys(frame.state).length : -1,
    });
  }
  return { player, frames: out, canvas, paintCalls: canvas.__calls.length };
}
