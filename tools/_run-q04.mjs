import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';

const q = JSON.parse(readFileSync('tests/real-exam/pilot.json', 'utf8')).items.find((x) => x.id === 'q04');
const b64 = readFileSync(`tests/real-exam/${q.image}`).toString('base64');
const body = JSON.stringify({
  problem: {
    text: q.problem,
    description: '图(a)左侧为传送带与物块A，右侧定滑轮下方挂B和C；图(b)为F-x直线，过(0,0)，x=1时F=-20N，x=6时F=-120N；图(c)为v-x曲线，x=1时A与传送带共速。',
  },
  images: [{ mime: 'image/png', dataUrl: `data:image/png;base64,${b64}`, name: 'q04.png' }],
  mode: 'NUMERIC',
  devMode: true,
});

const logPath = 'tests/reports/q04-live.log';
appendFileSync(logPath, `START ${new Date().toISOString()}\n`);

const events = [];
const lines = [];

const req = http.request(
  {
    host: '127.0.0.1',
    port: 8123,
    path: '/api/run',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  },
  (res) => {
    if (res.statusCode !== 200) {
      let txt = '';
      res.on('data', (c) => (txt += c));
      res.on('end', () => {
        appendFileSync(logPath, `HTTP ${res.statusCode} ${txt}\n`);
        process.exit(1);
      });
      return;
    }
    res.setEncoding('utf8');
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        if (!data) continue;
        let ev;
        try { ev = JSON.parse(data); } catch { continue; }
        events.push(ev);
        const line = `${ev.type}${ev.stage ? ':' + ev.stage : ''}`;
        lines.push(line);
        appendFileSync(logPath, line + '\n');
        if (ev.type === 'stage_error') appendFileSync(logPath, `ERR ${JSON.stringify(ev).slice(0, 2000)}\n`);
        if (ev.type === 'run_done') appendFileSync(logPath, `DONE ${JSON.stringify(ev.verdict ?? ev).slice(0, 1000)}\n`);
        if (ev.type === 'run_error') appendFileSync(logPath, `RUNERR ${JSON.stringify(ev).slice(0, 2000)}\n`);
      }
    });
    res.on('end', () => {
      writeFileSync('tests/reports/q04-run-events.json', JSON.stringify(events, null, 2));
      writeFileSync('tests/reports/q04-run-summary.txt', lines.join('\n'));
      appendFileSync(logPath, `END ${new Date().toISOString()}\n`);
      console.log('events', events.length);
      console.log(lines.slice(-20).join('\n'));
    });
    res.on('error', (e) => appendFileSync(logPath, `RESERR ${e.message}\n`));
  },
);

req.on('error', (e) => {
  appendFileSync(logPath, `REQERR ${e.message}\n`);
  process.exit(1);
});
req.setTimeout(0);
req.write(body);
req.end();
