#!/usr/bin/env node
/**
 * Снятие фактической структуры UNA.md вместо предположений.
 *
 * Скрипт отвечает ровно на те вопросы, которые перечислены в
 * db/oracle/README.md как непроверенные, и пишет отчёт в
 * db/oracle/INTROSPECTION.md.
 *
 * Только чтение: ни одного DDL и DML. Запускать с любой машины, у которой
 * есть сетевой доступ к слушателю Oracle.
 *
 *   export UNA_ORACLE_USER=...
 *   export UNA_ORACLE_PASSWORD=...        # из Vault, не из репозитория
 *   node scripts/una-introspect.mjs
 *
 * Драйвер oracledb работает в thin-режиме: Instant Client не нужен.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import oracledb from 'oracledb';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'db/oracle/INTROSPECTION.md');

/**
 * Дескриптор clouddev: пять адресов одного и того же слушателя.
 * Драйвер обходит их по порядку, поэтому локальный адрес идёт последним —
 * снаружи он всё равно недоступен и только съедает таймаут.
 */
const DEFAULT_DESCRIPTOR = `(DESCRIPTION=
  (ADDRESS=(PROTOCOL=TCP)(HOST=una.md)(PORT=4024))
  (ADDRESS=(PROTOCOL=TCP)(HOST=orange.una.md)(PORT=4024))
  (ADDRESS=(PROTOCOL=TCP)(HOST=93.115.136.18)(PORT=4024))
  (ADDRESS=(PROTOCOL=TCP)(HOST=195.22.241.126)(PORT=4024))
  (ADDRESS=(PROTOCOL=TCP)(HOST=192.168.0.24)(PORT=1521))
  (CONNECT_DATA=(SERVER=DEDICATED)(SERVICE_NAME=clouddev.world)))`.replace(/\s+/g, '');

const sections = [];
let connection;

function md(title, body) {
  sections.push(`## ${title}\n\n${body}\n`);
}

function table(rows, columns) {
  if (!rows || rows.length === 0) return '_нет данных_';
  const cols = columns ?? Object.keys(rows[0]);
  const head = `| ${cols.join(' | ')} |`;
  const sep = `|${cols.map(() => '---').join('|')}|`;
  const body = rows
    .map((r) => `| ${cols.map((c) => String(r[c] ?? '').replace(/\|/g, '\\|').slice(0, 200)).join(' | ')} |`)
    .join('\n');
  return [head, sep, body].join('\n');
}

/** Выполняет запрос, не роняя весь прогон: недоступный объект — это тоже факт. */
async function safe(label, sql, binds = {}) {
  try {
    const result = await connection.execute(sql, binds);
    return { ok: true, rows: result.rows ?? [] };
  } catch (error) {
    console.error(`  [!] ${label}: ${String(error.message).split('\n')[0]}`);
    return { ok: false, rows: [], error: String(error.message).split('\n')[0] };
  }
}

async function columnsOf(owner, tableName) {
  const { ok, rows, error } = await safe(
    `${owner}.${tableName}`,
    `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE, DATA_DEFAULT
       FROM ALL_TAB_COLUMNS
      WHERE OWNER = :owner AND TABLE_NAME = :tab
      ORDER BY COLUMN_ID`,
    { owner, tab: tableName },
  );
  if (!ok) return `_ошибка доступа: ${error}_`;
  if (rows.length === 0) return `_таблица ${owner}.${tableName} не найдена или недоступна_`;
  return table(
    rows.map((r) => ({
      COLUMN_NAME: r.COLUMN_NAME,
      TYPE:
        r.DATA_TYPE === 'NUMBER' && r.DATA_PRECISION
          ? `NUMBER(${r.DATA_PRECISION}${r.DATA_SCALE ? `,${r.DATA_SCALE}` : ''})`
          : `${r.DATA_TYPE}${['VARCHAR2', 'CHAR'].includes(r.DATA_TYPE) ? `(${r.DATA_LENGTH})` : ''}`,
      NULLABLE: r.NULLABLE,
      DEFAULT: r.DATA_DEFAULT ?? '',
    })),
  );
}

async function main() {
  const user = process.env.UNA_ORACLE_USER;
  const password = process.env.UNA_ORACLE_PASSWORD;
  if (!user || !password) {
    console.error('Задайте UNA_ORACLE_USER и UNA_ORACLE_PASSWORD (пароль берите из Vault).');
    process.exit(2);
  }

  console.error('Подключение...');
  connection = await oracledb.getConnection({
    user,
    password,
    connectString: process.env.UNA_ORACLE_DSN ?? DEFAULT_DESCRIPTOR,
    connectTimeout: Number(process.env.UNA_ORACLE_TIMEOUT ?? 15),
  });
  console.error('Подключено.');

  // ---- окружение --------------------------------------------------------
  const env = await safe(
    'окружение',
    `SELECT USER AS CURRENT_USER,
            SYS_CONTEXT('USERENV','DB_NAME')      AS DB_NAME,
            SYS_CONTEXT('USERENV','SERVICE_NAME') AS SERVICE,
            (SELECT BANNER FROM V$VERSION WHERE ROWNUM = 1) AS VERSION
       FROM DUAL`,
  );
  md('Окружение', table(env.rows));

  // ---- схемы ------------------------------------------------------------
  const schemas = await safe(
    'схемы',
    `SELECT OWNER, COUNT(*) AS OBJECTS
       FROM ALL_OBJECTS
      WHERE OWNER NOT IN ('SYS','SYSTEM','XDB','MDSYS','CTXSYS','OUTLN','DBSNMP','APPQOSSYS','WMSYS','ORDSYS','LBACSYS','OLAPSYS','AUDSYS','GSMADMIN_INTERNAL','DVSYS')
      GROUP BY OWNER ORDER BY OBJECTS DESC`,
  );
  md('Доступные схемы', table(schemas.rows));

  // Схема, где реально лежат объекты UNA: ищем по наличию TMDB_DOCS.
  const ownerRow = await safe(
    'владелец TMDB_DOCS',
    `SELECT OWNER FROM ALL_TABLES WHERE TABLE_NAME = 'TMDB_DOCS' ORDER BY OWNER`,
  );
  const owners = ownerRow.rows.map((r) => r.OWNER);
  const owner = process.env.UNA_SCHEMA ?? owners[0] ?? 'UN4';
  md(
    'Схема с оперативными данными',
    `TMDB_DOCS найдена в: ${owners.length ? owners.join(', ') : '_не найдена_'}\n\n` +
      `Для дальнейших запросов используется \`${owner}\`.`,
  );

  // ---- вопрос 1-2: состав TMDB_DOCS_ADD и TMDB_DOCS_LOG -----------------
  md('TMDB_DOCS — фактический состав', await columnsOf(owner, 'TMDB_DOCS'));
  md('TMDB_DOCS_ADD — фактический состав', await columnsOf(owner, 'TMDB_DOCS_ADD'));
  md('TMDB_DOCS_LOG — фактический состав', await columnsOf(owner, 'TMDB_DOCS_LOG'));
  md('TMDB_CM — фактический состав', await columnsOf(owner, 'TMDB_CM'));

  // ---- вопрос 3: как выдаётся COD ---------------------------------------
  const seq = await safe(
    'последовательности',
    `SELECT SEQUENCE_OWNER, SEQUENCE_NAME, LAST_NUMBER, INCREMENT_BY
       FROM ALL_SEQUENCES
      WHERE SEQUENCE_OWNER = :owner
        AND (SEQUENCE_NAME LIKE '%DOC%' OR SEQUENCE_NAME LIKE '%COD%' OR SEQUENCE_NAME LIKE '%CM%')
      ORDER BY SEQUENCE_NAME`,
    { owner },
  );
  const docTriggers = await safe(
    'триггеры TMDB_DOCS',
    `SELECT TRIGGER_NAME, TRIGGERING_EVENT, STATUS
       FROM ALL_TRIGGERS
      WHERE TABLE_OWNER = :owner AND TABLE_NAME = 'TMDB_DOCS'`,
    { owner },
  );
  md(
    'Выдача COD документа',
    `Последовательности:\n\n${table(seq.rows)}\n\nТриггеры на TMDB_DOCS:\n\n${table(docTriggers.rows)}`,
  );

  // ---- вопрос 4: кодировка DOCCOLOR --------------------------------------
  const colors = await safe(
    'DOCCOLOR',
    `SELECT DOCCOLOR, COUNT(*) AS CNT, MIN(SYSFID) AS SAMPLE_SYSFID
       FROM ${owner}.TMDB_DOCS
      GROUP BY DOCCOLOR ORDER BY CNT DESC`,
  );
  md('Фактические значения DOCCOLOR', table(colors.rows));

  const sysfids = await safe(
    'SYSFID',
    `SELECT SYSFID, COUNT(*) AS CNT, MAX(DATAMANUAL) AS LAST_DOC, MAX(NRMANUAL) AS LAST_NR
       FROM ${owner}.TMDB_DOCS
      GROUP BY SYSFID ORDER BY CNT DESC FETCH FIRST 40 ROWS ONLY`,
  );
  md(
    'Используемые типы документов (SYSFID) и формат номера',
    `${table(sysfids.rows)}\n\n> Проверить, что предлагаемые коды WSEO01..WSEO15 не конфликтуют с существующими.`,
  );

  // ---- вопрос 5: TextIncrement и прочие утилиты --------------------------
  const utils = await safe(
    'утилиты UN4PUBLIC',
    `SELECT OWNER, OBJECT_NAME, PROCEDURE_NAME
       FROM ALL_PROCEDURES
      WHERE (OBJECT_NAME IN ('UN$G$UTIL','UN$GFC','UN$SOLD','UN$DIV','ENVUN4','SECURE_CM')
             OR PROCEDURE_NAME IN ('TEXTINCREMENT','GET_ENV','MSG','WARN','SAY','NNN','S2N','P$CHGLOG_MAKE_TRIGGER'))
      ORDER BY OWNER, OBJECT_NAME, PROCEDURE_NAME`,
  );
  md('Штатные пакеты и процедуры UNA', table(utils.rows));

  // ---- вопрос 6: сигнатура UN$GFC ----------------------------------------
  const gfcArgs = await safe(
    'аргументы UN$GFC',
    `SELECT OBJECT_NAME, SUBPROGRAM_ID, ARGUMENT_NAME, DATA_TYPE, IN_OUT, POSITION
       FROM ALL_ARGUMENTS
      WHERE PACKAGE_NAME = 'UN$GFC'
      ORDER BY SUBPROGRAM_ID, POSITION`,
  );
  md(
    'Сигнатура UN$GFC (генерация проводок)',
    `${table(gfcArgs.rows)}\n\n> Это ответ на главный открытый вопрос: без него контур не умеет проводить документы.`,
  );

  const chglogArgs = await safe(
    'аргументы P$CHGLOG_MAKE_TRIGGER',
    `SELECT OWNER, OBJECT_NAME, ARGUMENT_NAME, DATA_TYPE, IN_OUT, POSITION
       FROM ALL_ARGUMENTS
      WHERE OBJECT_NAME = 'P$CHGLOG_MAKE_TRIGGER'
      ORDER BY POSITION`,
  );
  md('Сигнатура P$CHGLOG_MAKE_TRIGGER', table(chglogArgs.rows));

  // ---- вопрос 7: валюты и курс -------------------------------------------
  const syssHeaders = await safe(
    'разделы TMS_SYSSV',
    `SELECT TIP, COD, VDENUMIREA, VNUMBER1, VNUMBER2, VPRET
       FROM ${owner}.TMS_SYSSV
      WHERE TIP IN ('S','W') ORDER BY TIP, COD`,
  );
  const currencies = await safe(
    'валюты TMS_SYSS (S,3)',
    `SELECT COD1, DENUMIREA, UM, NUMBER1, NUMBER2, PRET
       FROM ${owner}.TMS_SYSS
      WHERE TIP = 'S' AND COD = 3 ORDER BY COD1`,
  );
  md(
    'Справочник валют и курса',
    `Описание разделов:\n\n${table(syssHeaders.rows)}\n\nСодержимое (S,3):\n\n${table(currencies.rows)}\n\n` +
      '> Проверить, лежит ли курс в PRET и на какую дату он актуален. ' +
      'Занятые номера разделов TIP=W определяют, свободны ли предлагаемые (W,1)..(W,7).',
  );

  // ---- вопрос 8: план счетов ---------------------------------------------
  const accounts = await safe(
    'план счетов',
    `SELECT CONT, DENUMIREA FROM ${owner}.TMS_PDC
      WHERE CONT LIKE '71%' OR CONT LIKE '52%' OR CONT LIKE '26%' OR CONT LIKE '24%' OR CONT LIKE '53%'
      ORDER BY CONT`,
  );
  md(
    'Счета, релевантные маркетингу',
    `${table(accounts.rows)}\n\n> Значения для YSEO_TMS_SETUP: ACC_MARKETING_EXPENSE, ACC_SUPPLIER, ACC_PREPAID.`,
  );

  // ---- существующие Y-таблицы и занятые префиксы --------------------------
  const yTables = await safe(
    'существующие Y-таблицы',
    `SELECT TABLE_NAME FROM ALL_TABLES
      WHERE OWNER = :owner AND TABLE_NAME LIKE 'Y%' ORDER BY TABLE_NAME`,
    { owner },
  );
  md(
    'Занятые Y-префиксы',
    `${table(yTables.rows)}\n\n> Убедиться, что префикс YSEO_ свободен.`,
  );

  // ---- права текущего пользователя ---------------------------------------
  const privs = await safe(
    'права',
    `SELECT PRIVILEGE FROM USER_SYS_PRIVS
     UNION ALL SELECT GRANTED_ROLE FROM USER_ROLE_PRIVS`,
  );
  md(
    'Права текущего пользователя',
    `${table(privs.rows)}\n\n> Для установки контура нужны CREATE TABLE, CREATE VIEW, CREATE PROCEDURE в целевой схеме.`,
  );

  const header = [
    '# Фактическая структура UNA.md',
    '',
    'Отчёт сформирован скриптом `scripts/una-introspect.mjs` (только чтение).',
    'Он заменяет предположения из `db/oracle/README.md` на проверенные факты.',
    '',
    `Дата снятия: ${new Date().toISOString()}`,
    '',
    '> Ни логинов, ни паролей, ни данных клиентов этот файл не содержит и не должен содержать.',
    '',
  ].join('\n');

  writeFileSync(OUT, `${header}\n${sections.join('\n')}`, 'utf8');
  console.error(`Готово: ${OUT}`);
  await connection.close();
}

main().catch(async (error) => {
  console.error('Не удалось снять структуру:', error.message);
  if (connection) await connection.close().catch(() => {});
  process.exit(1);
});
