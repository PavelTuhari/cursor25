# Парсинг фискальной ленты (Z-отчёт автовокзала) → CSV + SQLite + GUI

## Состав

| Файл | Назначение |
|---|---|
| `parse_zreport.py` | Парсер текстовой ленты `ZK*.txt` → `receipts.csv`, `tickets.csv`, `zreport.db` |
| `viewer_gui.py` | Нативный GUI-просмотрщик (tkinter, без внешних зависимостей) |

Зависимостей нет — только стандартная библиотека Python 3.10+.

## 1. Парсинг

```bash
python3 parse_zreport.py ZK00407604_045259_22.08.2026.txt -o out
```

Вывод на проверенном файле:

```
Чеков:   173
Билетов: 785
Сумма по чекам: 18975.45
Сумма по билетам: 18975.45
```

Парсер сверяет итог каждого чека с суммой его билетов и печатает расхождения
в stderr (на текущем файле расхождений нет).

### Структура данных

`receipts.csv` — один ряд на фискальный чек: `bon_nr`, `serial` (Ser.N),
`reg_nr` (N.Inr.), `fiscal_code`, `operator`, `fiscal_date`/`fiscal_time`,
`doc_nr`, `qty`/`unit_price`/`total`, НДС (`vat_letter`, `vat_rate`, `vat_sum`),
оплата (`payment_type`, `payment_sum`), `tickets_count`, `tickets_sum`,
`start_line`/`end_line` (позиция чека в исходном файле).

`tickets.csv` — один ряд на билет (место): `ticket_nr`, `cursa`, `route_code`,
`vehicle`, `departure_stop`, `trip_date`/`trip_time`, `destination`, `seat`,
`price`, `total`, `cashier`, `till`, `sale_date`/`sale_time`, `receipt_id`.
Многострочное поле `Destinatia:` склеивается в одну строку.

CSV — разделитель `;`, кодировка UTF-8 BOM (Excel открывает без плясок).

`zreport.db` — таблицы `receipts` и `tickets` (FK по `receipt_id`), индексы по
`ticket_nr`, `cursa`, `bon_nr`, дате продажи, плюс представление
`v_tickets_full` (билет + реквизиты его чека).

## 2. Просмотр

```bash
python3 viewer_gui.py out/zreport.db     # или просто: python3 viewer_gui.py
```

Мастер-деталь: слева список чеков, справа билеты выбранного чека и
«бумажный» вид чека моноширинным шрифтом.

* поиск (Ctrl+F) — по номеру чека/документа, номеру билета, рейсу,
  назначению, госномеру, коду маршрута; фильтр применяется с задержкой 220 мс;
* фильтры по дате и типу оплаты;
* сортировка кликом по заголовку колонки (повторный клик — обратный порядок);
* «Экспорт CSV» — выгрузка текущей выборки из `v_tickets_full`;
* «Открыть БД…» — переключение на другой файл базы;
* Esc — сброс фильтров;
* в статус-строке — количество чеков/билетов и сумма по текущей выборке.

На Linux tkinter может требовать пакет `python3-tk`
(`sudo apt install python3-tk`); в Windows и macOS он входит в поставку Python.
