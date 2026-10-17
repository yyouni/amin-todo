import { writeFile } from 'node:fs/promises';

const panels = [];
function panel(
  title,
  expr,
  { type = 'timeseries', unit = 'short', legend = '', description = '' } = {},
) {
  const id = panels.length + 1;
  panels.push({
    id,
    title,
    description,
    type,
    datasource: { type: 'prometheus', uid: 'prometheus' },
    gridPos: { x: ((id - 1) % 2) * 12, y: Math.floor((id - 1) / 2) * 8, w: 12, h: 8 },
    targets: [{ expr, refId: 'A', legendFormat: legend }],
    fieldConfig: {
      defaults: {
        unit,
        color: { mode: 'palette-classic' },
        custom: { drawStyle: 'line', fillOpacity: 10 },
      },
      overrides: [],
    },
    options: {
      legend: { displayMode: 'list', placement: 'bottom' },
      tooltip: { mode: 'multi' },
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
    },
  });
}
panel('Доступность приложения', 'probe_success{job="http"}', {
  type: 'stat',
  legend: '{{instance}}',
  description: '1 — HTTP 200, 0 — проверка не прошла',
});
panel('PostgreSQL', 'todo_database_up', {
  type: 'stat',
  description: 'Проверка подключения SELECT 1',
});
panel(
  'CPU сервера: используется',
  '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))',
  { unit: 'percent' },
);
panel('CPU сервера: доступные ядра', 'count(node_cpu_seconds_total{mode="idle"})', {
  type: 'stat',
});
panel('RAM сервера: используется', 'node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes', {
  unit: 'bytes',
});
panel('RAM сервера: доступно', 'node_memory_MemAvailable_bytes', { unit: 'bytes' });
panel(
  'Диск сервера: используется',
  'max by (device) (node_filesystem_size_bytes{fstype!~"tmpfs|overlay|rootfs|9p|fuse.*"} - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|rootfs|9p|fuse.*"})',
  { unit: 'bytes', legend: '{{device}}' },
);
panel(
  'Диск сервера: доступно',
  'max by (device) (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|rootfs|9p|fuse.*"})',
  { unit: 'bytes', legend: '{{device}}' },
);
const filter =
  'container_label_com_docker_compose_project="amin-todo",container_label_com_docker_compose_service!=""';
panel(
  'CPU контейнеров, ядер',
  `sum by (container_label_com_docker_compose_service) (rate(container_cpu_usage_seconds_total{${filter}}[5m]))`,
  { legend: '{{container_label_com_docker_compose_service}}' },
);
panel(
  'Лимит CPU контейнеров, ядер',
  `max by (container_label_com_docker_compose_service) (container_spec_cpu_quota{${filter}} / container_spec_cpu_period{${filter}})`,
  { legend: '{{container_label_com_docker_compose_service}}' },
);
panel(
  'RAM контейнеров',
  `max by (container_label_com_docker_compose_service) (container_memory_working_set_bytes{${filter}})`,
  { unit: 'bytes', legend: '{{container_label_com_docker_compose_service}}' },
);
panel(
  'Лимит RAM контейнеров',
  `max by (container_label_com_docker_compose_service) (container_spec_memory_limit_bytes{${filter}})`,
  { unit: 'bytes', legend: '{{container_label_com_docker_compose_service}}' },
);
panel('Запросов в секунду', 'sum by (route) (rate(todo_http_requests_total[5m]))', {
  unit: 'reqps',
  legend: '{{route}}',
});
panel(
  'Ошибки API 5xx в секунду',
  'sum(rate(todo_http_requests_total{status=~"5.."}[5m])) or vector(0)',
  { unit: 'reqps' },
);
panel(
  'Задержка API, p95',
  'histogram_quantile(0.95, sum by (le) (rate(todo_http_request_duration_seconds_bucket[5m])))',
  { unit: 's' },
);
panel('Состояние сборщиков метрик', 'up', { type: 'stat', legend: '{{job}}' });
const id = panels.length + 1;
panels.push({
  id,
  title: 'Посещения по часам',
  description:
    'Каждая полная загрузка/перезагрузка страницы. UTC в БД, отображение Asia/Yekaterinburg. Текущий час еще неполный.',
  type: 'timeseries',
  datasource: { type: 'grafana-postgresql-datasource', uid: 'visits' },
  gridPos: { x: 0, y: Math.floor((id - 1) / 2) * 8, w: 24, h: 8 },
  targets: [
    {
      refId: 'A',
      format: 'time_series',
      rawQuery: true,
      rawSql: `SELECT h AS time, coalesce(p.views, 0) AS "Посещения" FROM generate_series(date_trunc('hour', $__timeFrom()::timestamptz, 'UTC'), date_trunc('hour', $__timeTo()::timestamptz, 'UTC'), interval '1 hour') h LEFT JOIN page_view_hours p ON p.hour = h ORDER BY h`,
    },
  ],
  fieldConfig: {
    defaults: {
      unit: 'short',
      min: 0,
      decimals: 0,
      custom: { drawStyle: 'bars', fillOpacity: 80, lineWidth: 0 },
    },
    overrides: [],
  },
  options: { legend: { displayMode: 'hidden' }, tooltip: { mode: 'single' } },
});
await writeFile(
  new URL('../infra/monitoring/grafana/dashboards/todo.json', import.meta.url),
  `${JSON.stringify(
    {
      uid: 'amin-todo',
      title: 'Порядок — приложение и ресурсы',
      schemaVersion: 41,
      version: 1,
      refresh: '15s',
      timezone: 'Asia/Yekaterinburg',
      time: { from: 'now-24h', to: 'now' },
      tags: ['todo'],
      panels,
    },
    null,
    2,
  )}\n`,
);
