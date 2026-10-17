import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
function internalFetch(url) {
  const code = `fetch(${JSON.stringify(url)}).then(async r=>{if(!r.ok)throw new Error('HTTP '+r.status);console.log(await r.text())}).catch(e=>{console.error(e.message);process.exit(1)})`;
  return JSON.parse(
    execFileSync('docker', ['compose', 'exec', '-T', 'api', 'node', '-e', code], {
      encoding: 'utf8',
      timeout: 15_000,
    }),
  );
}
async function waitFor(check, label) {
  let last;
  for (let n = 0; n < 30; n++) {
    try {
      return await check();
    } catch (error) {
      last = error;
      await setTimeout(2000);
    }
  }
  throw new Error(`${label}: ${last?.message}`);
}
await waitFor(() => {
  const targets = internalFetch('http://prometheus:9090/api/v1/targets').data.activeTargets;
  assert.equal(targets.length, 6);
  for (const target of targets)
    assert.equal(target.health, 'up', `${target.labels.job}: ${target.lastError}`);
}, 'Prometheus targets');
console.log('PASS: all six Prometheus targets are up');
for (const query of [
  'todo_database_up',
  'node_memory_MemAvailable_bytes',
  'node_cpu_seconds_total',
  'node_filesystem_avail_bytes',
  'container_memory_working_set_bytes{container_label_com_docker_compose_project="amin-todo"}',
  'probe_success',
]) {
  await waitFor(() => {
    const result = internalFetch(
      `http://prometheus:9090/api/v1/query?query=${encodeURIComponent(query)}`,
    ).data.result;
    assert.ok(result.length > 0, `No data for ${query}`);
    if (query === 'probe_success' || query === 'todo_database_up')
      for (const entry of result) assert.equal(Number(entry.value[1]), 1);
  }, query);
}
console.log('PASS: host, container, database and HTTP probe metrics contain data');
const authorization = `Basic ${Buffer.from(`${process.env.GRAFANA_ADMIN_USER ?? 'admin'}:${process.env.GRAFANA_ADMIN_PASSWORD}`).toString('base64')}`;
async function grafana(path, body) {
  const response = await fetch(`http://127.0.0.1:3000${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(response.ok, `Grafana ${path}: ${response.status}`);
  return response.json();
}
await waitFor(async () => {
  assert.equal((await grafana('/api/health')).database, 'ok');
}, 'Grafana startup');
await waitFor(async () => {
  assert.equal((await grafana('/api/datasources/uid/visits/health')).status, 'OK');
}, 'PostgreSQL datasource recovery');
const dashboard = (await grafana('/api/dashboards/uid/amin-todo')).dashboard;
assert.equal(dashboard.timezone, 'Asia/Yekaterinburg');
assert.equal(dashboard.panels.length, 17);
for (const panel of dashboard.panels.slice(0, 12)) {
  await waitFor(() => {
    const result = internalFetch(
      `http://prometheus:9090/api/v1/query?query=${encodeURIComponent(panel.targets[0].expr)}`,
    ).data.result;
    assert.ok(result.length > 0, `Empty dashboard panel: ${panel.title}`);
  }, panel.title);
}
const result = await grafana('/api/ds/query', {
  from: String(Date.now() - 86400_000),
  to: String(Date.now()),
  queries: [
    {
      refId: 'A',
      datasource: { uid: 'visits', type: 'grafana-postgresql-datasource' },
      rawSql: dashboard.panels.at(-1).targets[0].rawSql,
      format: 'time_series',
    },
  ],
});
assert.ok(!result.results.A.error, result.results.A.error);
assert.ok(result.results.A.frames.length > 0);
console.log('PASS: Grafana datasource, provisioned dashboard and hourly visits SQL query');
