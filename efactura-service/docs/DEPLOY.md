# Установка

Сервис ставится тремя способами: отдельно у клиента (systemd или служба
Windows), контейнером, или в OCI. Во всех случаях это один и тот же образ и
один и тот же набор переменных окружения — различается только супервизор.

## 0. Что нужно заранее

| | |
|---|---|
| Node.js | 22 или новее (нужен только для установки без контейнера) |
| Oracle | 12.1+ или Autonomous Database. Instant Client **не нужен** — thin-режим |
| Учётные данные SFS | API-пользователь, созданный директором в кабинете e-Factura |
| Сертификат | `.p12`/`.pfx`, если подписывать локально (`signing.mode: pkcs12`) |
| Сеть | исходящий доступ к `efactura-api.sfs.md:443` |

## 1. База данных

Схема сервиса отдельная от ERP:

```sql
CREATE USER EFACTURA IDENTIFIED BY "<пароль>"
  DEFAULT TABLESPACE USERS QUOTA UNLIMITED ON USERS;
GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE TO EFACTURA;
```

Затем:

```bash
npm run migrate
```

Мигратор применяет пронумерованные файлы из `sql/`, пропуская уже применённые,
и записывает каждый в `EFACT_SCHEMA_VERSION`.

**Вьюшки на ERP** (`sql/002_erp_views.sql`) по умолчанию не применяются: они
принадлежат владельцу учётной схемы и почти всегда переписываются под клиента.
Приведите определения к реальным таблицам, сохранив список колонок, выполните
от владельца ERP и выдайте права:

```sql
GRANT SELECT ON V_EFACT_DOCUMENTS      TO EFACTURA;
GRANT SELECT ON V_EFACT_DOCUMENT_LINES TO EFACTURA;
GRANT SELECT ON V_EFACT_PARTNERS       TO EFACTURA;
```

Сервис не получает и не просит прав на запись в ERP.

## 2. Конфигурация

```bash
cp .env.example /etc/una-efactura/efactura.env
chmod 600 /etc/una-efactura/efactura.env
```

Минимум, что нужно заполнить:

```ini
EFACT__SERVICE__TENANTID=una-md
EFACT__SERVICE__APITOKEN=<длинная случайная строка>
EFACT__SFS__USERNAME=<API-пользователь e-Factura>
EFACT__SFS__PASSWORD=<пароль>
EFACT__ORACLE__CONNECTSTRING=db-host:1521/ERPPDB
EFACT__ORACLE__USER=EFACTURA
EFACT__ORACLE__PASSWORD=<пароль>
EFACT__SIGNING__MODE=pkcs12
EFACT__SIGNING__PKCS12__FILE=/etc/una-efactura/certs/company.p12
EFACT__SIGNING__PKCS12__PASSPHRASE=<пароль сертификата>
```

Проверить до запуска:

```bash
npm run validate-config
```

Команда печатает применённые переменные и **предупреждает об опечатках** —
`EFACT__SFS__USERNMAE` не будет молча проигнорирован.

## 3. Ubuntu / systemd

```bash
sudo useradd --system --home /opt/una-efactura --shell /usr/sbin/nologin efactura
sudo mkdir -p /opt/una-efactura /etc/una-efactura/certs
sudo rsync -a --exclude node_modules --exclude .git ./ /opt/una-efactura/
cd /opt/una-efactura
sudo -u efactura npm ci --omit=dev
sudo -u efactura npm run build
sudo chown -R efactura:efactura /opt/una-efactura
sudo chmod 400 /etc/una-efactura/certs/company.p12
sudo chown efactura /etc/una-efactura/certs/company.p12

sudo cp deploy/systemd/una-efactura.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now una-efactura
journalctl -u una-efactura -f
```

Юнит ограничивает сервис тем, что ему действительно нужно: `ProtectSystem=strict`,
`PrivateTmp`, `NoNewPrivileges`, а `/etc/una-efactura` смонтирован только на
чтение. `TimeoutStopSec=45` даёт незавершённому циклу дописать результат, чтобы
отправленная фактура не осталась записанной как неотправленная.

## 4. Windows

```powershell
npm ci --omit=dev
npm run build
# NSSM: https://nssm.cc - один бинарник, положить в PATH
.\deploy\windows\install-service.ps1 `
    -InstallDir "C:\Program Files\una-efactura" `
    -EnvFile   "C:\ProgramData\una-efactura\efactura.env"
```

Запускать из PowerShell с правами администратора. Скрипт читает `.env`,
переносит его в окружение службы, включает автозапуск и ротацию логов.

Проверка:

```powershell
Invoke-RestMethod http://127.0.0.1:8090/efactura/v1/health
```

## 5. Docker

```bash
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml logs -f
```

Сертификат монтируется с хоста только на чтение и в образ не попадает.

## 6. OCI

См. [deploy/oci/README.md](../deploy/oci/README.md): Container Instances,
Autonomous Database, OKE и список исходящих адресов.

Для **Autonomous Database** thin-режим подключается по TLS без кошелька, если
БД настроена на одностороннюю TLS:

```ini
EFACT__ORACLE__CONNECTSTRING=(description=(retry_count=20)(retry_delay=3)(address=(protocol=tcps)(port=1521)(host=adb.eu-frankfurt-1.oraclecloud.com))(connect_data=(service_name=<service>))(security=(ssl_server_dn_match=yes)))
```

При взаимной TLS понадобится кошелёк — смонтируйте его и укажите путь через
`TNS_ADMIN`.

## 7. Проверка после установки

```bash
curl -s localhost:8090/efactura/v1/health
curl -s -H "Authorization: Bearer $TOKEN" localhost:8090/efactura/v1/ready
curl -s -H "Authorization: Bearer $TOKEN" localhost:8090/efactura/v1/taxpayers/1000000000033
```

Третий запрос — самая полезная проба: он идёт в реальный SFS и проверяет разом
сеть, TLS, учётные данные и разбор ответа.

## 8. Эксплуатация

**Что мониторить**

| Сигнал | Где |
|---|---|
| `GET /stats` → `failed` > 0 | документы, исчерпавшие попытки |
| `sign.certificate.expiring` в логе | сертификат истекает через <30 дней |
| `sign.certificate.expired` | истёк — каждая фактура будет падать |
| `config.env.unknown` | опечатка в переменной окружения |
| `pipeline.series.failed` | не удаётся зарезервировать серии в SFS |
| `/ready` → 503 | потеряна база |

Логи — JSON по строке на событие, прямо в stdout: systemd, Docker и OCI Logging
принимают их без настройки.

**Несколько экземпляров.** Очередь выбирается с `FOR UPDATE SKIP LOCKED`,
поэтому два и более процессов на одной базе не возьмут один документ дважды.
Но при штатной нагрузке одного достаточно.

**Смена сертификата.** Положите новый `.p12`, перезапустите службу. В логе при
старте будет `sign.certificate` с субъектом и датой окончания — проверьте, что
подхватился нужный.
