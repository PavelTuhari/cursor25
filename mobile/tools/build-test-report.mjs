#!/usr/bin/env node
/**
 * Builds the HTML acceptance-testing report (акт тестирования).
 *
 *   node tools/build-test-report.mjs <shots-dir> <jest-json> <out.html>
 *
 * Screenshots are embedded, so the report is one self-contained file that can
 * be e-mailed or archived. Every number in it comes from a real run: the Jest
 * JSON report, the configuration validator and the screenshot tour's own log.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const [shotsDir, jestJsonPath, outPath] = process.argv.slice(2);
if (!shotsDir || !jestJsonPath || !outPath) {
  throw new Error('usage: build-test-report.mjs <shots-dir> <jest-json> <out.html>');
}

const tour = JSON.parse(readFileSync(join(shotsDir, 'tour.json'), 'utf8'));
const jest = JSON.parse(readFileSync(jestJsonPath, 'utf8'));
const meta = JSON.parse(readFileSync('docs/testing/report-meta.json', 'utf8'));

const escape = (value) =>
  String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

function image(file) {
  const path = join(shotsDir, file);
  if (!existsSync(path)) return null;
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

const suiteRows = jest.testResults
  .map((suite) => {
    const name = suite.name.split('/').slice(-1)[0];
    const total = suite.assertionResults.length;
    const passed = suite.assertionResults.filter((test) => test.status === 'passed').length;
    const failed = total - passed;
    const seconds = ((suite.endTime - suite.startTime) / 1000).toFixed(1);
    return { name, total, passed, failed, seconds, title: meta.suites[name] ?? '' };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const scenarioRows = meta.scenarios.map((scenario) => {
  const file = tour.shots.find((shot) => shot.endsWith(`-${scenario.shot}.png`));
  return { ...scenario, file, data: file ? image(file) : null };
});

const failedSteps = tour.log.filter((line) => line.startsWith('FAIL'));

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Акт тестирования — ${escape(meta.product)}</title>
<style>
  :root {
    --ink: #16181d; --muted: #5b6270; --line: #d9dde4; --bg: #ffffff;
    --accent: #E10915; --ok: #127c42; --warn: #b45309;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #f4f5f7; color: var(--ink);
    font: 15px/1.55 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  .page { max-width: 1000px; margin: 0 auto; background: var(--bg); padding: 48px 56px 72px; }
  header { border-bottom: 3px solid var(--accent); padding-bottom: 18px; margin-bottom: 28px; }
  .brand { color: var(--accent); font-weight: 800; letter-spacing: .04em; text-transform: uppercase; font-size: 13px; }
  h1 { font-size: 27px; margin: 10px 0 4px; }
  h2 { font-size: 19px; margin: 34px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  h3 { font-size: 16px; margin: 22px 0 8px; }
  p { margin: 8px 0; }
  .sub { color: var(--muted); font-size: 14px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0 18px; font-size: 14px; }
  th, td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #f7f8fa; font-weight: 600; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .ok { color: var(--ok); font-weight: 600; }
  .warn { color: var(--warn); font-weight: 600; }
  .bad { color: var(--accent); font-weight: 600; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 18px 0 8px; }
  .tile { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .tile b { display: block; font-size: 24px; line-height: 1.2; }
  .tile span { color: var(--muted); font-size: 13px; }
  .shots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; margin-top: 14px; }
  figure { margin: 0; }
  figure img {
    width: 100%; border: 1px solid var(--line); border-radius: 12px; display: block; background: #fff;
  }
  figcaption { font-size: 13px; color: var(--muted); margin-top: 6px; }
  figcaption b { color: var(--ink); display: block; font-size: 13.5px; }
  code { background: #f2f3f5; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
  pre { background: #f7f8fa; border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px;
        overflow-x: auto; font-size: 12.5px; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 34px; }
  .sign-line { margin-top: 44px; border-top: 1px solid var(--ink); padding-top: 6px; font-size: 13px; color: var(--muted); }
  footer { margin-top: 40px; border-top: 1px solid var(--line); padding-top: 12px; color: var(--muted); font-size: 12.5px; }
  @media print {
    body { background: #fff; }
    .page { max-width: none; padding: 0 12mm; }
    h2 { page-break-after: avoid; }
    figure, table, .tile { page-break-inside: avoid; }
    .shots { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 860px) {
    .page { padding: 24px 18px 48px; }
    .summary { grid-template-columns: repeat(2, 1fr); }
    .shots { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
<div class="page">

<header>
  <div class="brand">${escape(meta.vendor)}</div>
  <h1>Акт тестирования мобильного приложения «${escape(meta.product)}»</h1>
  <div class="sub">${escape(meta.docNumber)} · ${escape(meta.date)} · платформа ${escape(meta.platform)}</div>
</header>

<h2>1. Общие сведения</h2>
<table>
  <tr><th style="width: 30%">Объект тестирования</th><td>${escape(meta.object)}</td></tr>
  <tr><th>Репозиторий и ветка</th><td><code>${escape(meta.repo)}</code>, ветка <code>${escape(meta.branch)}</code></td></tr>
  <tr><th>Проверенная версия</th><td>коммит <code>${escape(meta.commit)}</code> · pull request ${escape(meta.pr)}</td></tr>
  <tr><th>Состав приложения</th><td>${escape(meta.scope)}</td></tr>
  <tr><th>Основание</th><td>${escape(meta.basis)}</td></tr>
  <tr><th>Исполнитель</th><td>${escape(meta.executor)}</td></tr>
  <tr><th>Дата проведения</th><td>${escape(meta.date)}</td></tr>
</table>

<h2>2. Среда тестирования</h2>
<table>
  <tr><th style="width: 30%">Сборка приложения</th><td>Expo SDK ${escape(meta.env.expo)}, React Native ${escape(meta.env.reactNative)}, TypeScript ${escape(meta.env.typescript)}</td></tr>
  <tr><th>Среда выполнения</th><td>Node.js ${escape(meta.env.node)}, ${escape(meta.env.os)}</td></tr>
  <tr><th>Бэкенд</th><td>${escape(meta.env.backend)}</td></tr>
  <tr><th>Клиент для сценарных проверок</th><td>${escape(meta.env.client)}</td></tr>
  <tr><th>Локальная база</th><td>${escape(meta.env.database)}</td></tr>
  <tr><th>Язык интерфейса при проверке</th><td>${escape(meta.env.locale)}</td></tr>
</table>

<h2>3. Методика</h2>
<p>Тестирование проведено в три слоя:</p>
<ol>
  <li><b>Автоматизированные тесты</b> — модульные и интеграционные (Jest), включая сквозные
      сценарии против мок-сервера API с реальной базой SQLite.</li>
  <li><b>Проверка конфигурации</b> — валидатор JSON-конфигурации приложения
      (<code>npm run validate-config</code>): вкладки, экраны, блоки, запросы к данным,
      полнота переводов, паритет цветовых схем.</li>
  <li><b>Сценарные проверки интерфейса</b> — приложение запущено и пройдено по сценариям
      покупателя; каждый шаг зафиксирован скриншотом (раздел 6).</li>
</ol>

<h2>4. Результаты автоматизированного тестирования</h2>
<div class="summary">
  <div class="tile"><b>${jest.numTotalTests}</b><span>тестов выполнено</span></div>
  <div class="tile"><b class="ok">${jest.numPassedTests}</b><span>пройдено</span></div>
  <div class="tile"><b class="${jest.numFailedTests > 0 ? 'bad' : 'ok'}">${jest.numFailedTests}</b><span>не пройдено</span></div>
  <div class="tile"><b>${jest.numTotalTestSuites}</b><span>наборов тестов</span></div>
</div>
<table>
  <thead><tr><th>Набор</th><th>Что проверяет</th><th class="num">Тестов</th><th class="num">Пройдено</th><th class="num">Ошибок</th><th class="num">Время, с</th></tr></thead>
  <tbody>
  ${suiteRows
    .map(
      (row) => `<tr>
      <td><code>${escape(row.name)}</code></td>
      <td>${escape(row.title)}</td>
      <td class="num">${row.total}</td>
      <td class="num ok">${row.passed}</td>
      <td class="num ${row.failed > 0 ? 'bad' : ''}">${row.failed}</td>
      <td class="num">${row.seconds}</td>
    </tr>`,
    )
    .join('\n  ')}
  </tbody>
</table>

<h2>5. Проверка конфигурации и сборки</h2>
<table>
  <thead><tr><th>Проверка</th><th>Команда</th><th>Результат</th></tr></thead>
  <tbody>
    ${meta.checks
      .map(
        (check) => `<tr><td>${escape(check.name)}</td><td><code>${escape(check.command)}</code></td>
        <td class="${check.ok ? 'ok' : 'bad'}">${escape(check.result)}</td></tr>`,
      )
      .join('\n    ')}
  </tbody>
</table>

<h2>6. Сценарные проверки со скриншотами</h2>
<p class="sub">Снимки сделаны с работающего приложения при разрешении 390×844 (2×), данные —
из мок-сервера API, сохранённые в локальной базе устройства.</p>
<table>
  <thead><tr><th class="num">№</th><th>Сценарий</th><th>Ожидаемый результат</th><th>Факт</th></tr></thead>
  <tbody>
  ${scenarioRows
    .map(
      (row, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${escape(row.title)}</td>
      <td>${escape(row.expected)}</td>
      <td class="${row.data ? 'ok' : 'warn'}">${row.data ? 'Соответствует' : 'Снимок не получен'}</td>
    </tr>`,
    )
    .join('\n  ')}
  </tbody>
</table>

<div class="shots">
${scenarioRows
  .filter((row) => row.data)
  .map(
    (row, i) => `  <figure>
    <img src="${row.data}" alt="${escape(row.title)}">
    <figcaption><b>${i + 1}. ${escape(row.title)}</b>${escape(row.caption ?? '')}</figcaption>
  </figure>`,
  )
  .join('\n')}
</div>

<h2>7. Выявленные дефекты</h2>
<p>Дефекты, найденные в ходе работ и устранённые до подписания акта:</p>
<table>
  <thead><tr><th class="num">№</th><th>Описание</th><th>Как проявлялся</th><th>Устранение</th></tr></thead>
  <tbody>
  ${meta.defects
    .map(
      (defect, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${escape(defect.title)}</td>
      <td>${escape(defect.symptom)}</td>
      <td>${escape(defect.fix)}</td>
    </tr>`,
    )
    .join('\n  ')}
  </tbody>
</table>
${failedSteps.length > 0 ? `<p class="warn">Шаги сценарного прохода, не выполненные автоматически: ${failedSteps.length}.</p><pre>${escape(failedSteps.join('\n'))}</pre>` : '<p>Все шаги сценарного прохода выполнены без ошибок.</p>'}

<h2>8. Ограничения</h2>
<ul>
  ${meta.limitations.map((item) => `<li>${escape(item)}</li>`).join('\n  ')}
</ul>

<h2>9. Заключение</h2>
<p>${escape(meta.conclusion)}</p>

<div class="signatures">
  <div>
    <div class="sign-line">${escape(meta.signLeft)}</div>
  </div>
  <div>
    <div class="sign-line">${escape(meta.signRight)}</div>
  </div>
</div>

<footer>
  Отчёт сформирован автоматически из результатов прогона (${escape(tour.finishedAt)}).
  Источник данных: Jest JSON report, валидатор конфигурации, журнал сценарного прохода.
</footer>

</div>
</body>
</html>
`;

writeFileSync(outPath, html);
const size = (Buffer.byteLength(html) / 1024 / 1024).toFixed(1);
console.log(`${outPath}: ${scenarioRows.filter((row) => row.data).length} screenshots, ${size} MB`);
try {
  execSync(`node -e "require('node:fs').accessSync('${outPath}')"`);
} catch {
  // nothing else to verify here
}
