#!/usr/bin/env python3
"""
Табличный просмотр чеков в терминале (без зависимостей).

Примеры:
    python3 show.py                       # все чеки таблицей
    python3 show.py --limit 0             # без ограничения строк
    python3 show.py tickets --find CHISINAU
    python3 show.py flat                  # билеты + реквизиты чека
    python3 show.py by-route              # свод по рейсам
    python3 show.py by-hour               # свод по часам продаж
    python3 show.py one 0007              # один чек: шапка + его билеты
    python3 show.py receipts --format csv > receipts.csv
"""
from __future__ import annotations

import argparse
import csv
import os
import sqlite3
import sys

DEFAULT_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "zreport.db")

VIEWS = {
    "receipts": ("""
        SELECT bon_nr AS "Чек", fiscal_date AS "Дата", fiscal_time AS "Время",
               doc_nr AS "Док", tickets_count AS "Билетов",
               printf('%.2f', total) AS "Сумма", payment_type AS "Оплата",
               tickets_sum AS "_chk"
        FROM receipts {where} ORDER BY receipt_id""",
     ["bon_nr", "doc_nr", "payment_type"]),

    "tickets": ("""
        SELECT bon_nr AS "Чек", ticket_nr AS "Билет", cursa AS "Рейс",
               route_code AS "Маршрут", vehicle AS "Авто",
               trip_date AS "Дата рейса", trip_time AS "Отпр",
               destination AS "Назначение", seat AS "Место",
               printf('%.2f', price) AS "Цена", sale_time AS "Продан"
        FROM tickets {where} ORDER BY ticket_id""",
     ["bon_nr", "ticket_nr", "cursa", "destination", "vehicle", "route_code"]),

    "flat": ("""
        SELECT bon_nr AS "Чек", fiscal_date AS "Дата", fiscal_time AS "Время чека",
               ticket_nr AS "Билет", cursa AS "Рейс", destination AS "Назначение",
               seat AS "Место", printf('%.2f', price) AS "Цена",
               payment_type AS "Оплата", serial AS "Ser.N"
        FROM v_tickets_full {where} ORDER BY ticket_id""",
     ["bon_nr", "ticket_nr", "cursa", "destination"]),

    "by-route": ("""
        SELECT cursa AS "Рейс", route_code AS "Маршрут",
               COUNT(*) AS "Билетов", COUNT(DISTINCT receipt_id) AS "Чеков",
               printf('%.2f', SUM(price)) AS "Сумма",
               printf('%.2f', AVG(price)) AS "Средний билет"
        FROM tickets {where} GROUP BY cursa, route_code ORDER BY SUM(price) DESC""",
     ["cursa", "destination", "route_code"]),

    "by-hour": ("""
        SELECT substr(sale_time, 1, 2) || ':00' AS "Час",
               COUNT(*) AS "Билетов", COUNT(DISTINCT receipt_id) AS "Чеков",
               printf('%.2f', SUM(price)) AS "Сумма"
        FROM tickets {where} GROUP BY 1 ORDER BY 1""",
     ["cursa", "destination"]),
}


def query(con, view: str, find: str | None, limit: int):
    sql, searchable = VIEWS[view]
    args: list = []
    where = ""
    if find:
        where = "WHERE " + " OR ".join(f"{c} LIKE ?" for c in searchable)
        args = [f"%{find}%"] * len(searchable)
    sql = sql.format(where=where)
    if limit:
        sql += f" LIMIT {int(limit)}"
    return con.execute(sql, args).fetchall()


def render(rows, out=sys.stdout) -> None:
    if not rows:
        print("(нет данных)", file=out)
        return
    cols = [c for c in rows[0].keys() if not c.startswith("_")]
    data = [[("" if r[c] is None else str(r[c])) for c in cols] for r in rows]
    w = [max(len(c), *(len(row[i]) for row in data)) for i, c in enumerate(cols)]
    num = [all(v.replace(".", "").replace("-", "").isdigit() or v == ""
               for v in (row[i] for row in data)) for i in range(len(cols))]
    line = "+" + "+".join("-" * (x + 2) for x in w) + "+"

    def fmt(vals):
        cells = [f" {v:>{w[i]}} " if num[i] else f" {v:<{w[i]}} " for i, v in enumerate(vals)]
        return "|" + "|".join(cells) + "|"

    print(line, file=out)
    print(fmt(cols), file=out)
    print(line, file=out)
    for row in data:
        print(fmt(row), file=out)
    print(line, file=out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Табличный просмотр разобранной ленты")
    ap.add_argument("view", nargs="?", default="receipts",
                    choices=list(VIEWS) + ["one"], help="что показать")
    ap.add_argument("bon", nargs="?", help="номер чека для view=one")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--find", help="подстрока поиска")
    ap.add_argument("-n", "--limit", type=int, default=30,
                    help="сколько строк (0 — все, по умолчанию 30)")
    ap.add_argument("--format", choices=["table", "csv"], default="table")
    a = ap.parse_args(argv)

    if not os.path.exists(a.db):
        print(f"Нет базы {a.db}. Сначала: python3 parse_zreport.py <файл.txt> -o out",
              file=sys.stderr)
        return 1
    con = sqlite3.connect(a.db)
    con.row_factory = sqlite3.Row

    if a.view == "one":
        if not a.bon:
            print("Укажите номер чека: python3 show.py one 0007", file=sys.stderr)
            return 2
        head = con.execute("SELECT * FROM receipts WHERE bon_nr=? OR bon_nr=?",
                           (a.bon, a.bon.zfill(4))).fetchone()
        if not head:
            print(f"Чек {a.bon} не найден", file=sys.stderr)
            return 3
        print(f"Чек {head['bon_nr']}  {head['fiscal_date']} {head['fiscal_time']}  "
              f"док. {head['doc_nr']}  {head['payment_type']} {head['total']:.2f}  "
              f"Ser.N {head['serial']}\n")
        rows = con.execute("""
            SELECT ticket_nr AS "Билет", cursa AS "Рейс", vehicle AS "Авто",
                   trip_date AS "Дата рейса", trip_time AS "Отпр",
                   destination AS "Назначение", seat AS "Место",
                   printf('%.2f', price) AS "Цена"
            FROM tickets WHERE receipt_id=? ORDER BY ticket_id""",
            (head["receipt_id"],)).fetchall()
        render(rows)
        return 0

    rows = query(con, a.view, a.find, a.limit)
    if a.format == "csv":
        cols = [c for c in rows[0].keys() if not c.startswith("_")] if rows else []
        w = csv.writer(sys.stdout, delimiter=";")
        w.writerow(cols)
        w.writerows([[r[c] for c in cols] for r in rows])
        return 0

    render(rows)
    total_rows = len(query(con, a.view, a.find, 0))
    if a.limit and total_rows > len(rows):
        print(f"Показано {len(rows)} из {total_rows} (все: -n 0)")
    if a.view in ("receipts", "tickets", "flat"):
        col = "total" if a.view == "receipts" else "price"
        tbl = "receipts" if a.view == "receipts" else \
              ("tickets" if a.view == "tickets" else "v_tickets_full")
        s = con.execute(f"SELECT COUNT(*), SUM({col}) FROM {tbl}").fetchone()
        print(f"Всего в базе: {s[0]} строк, сумма {s[1]:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
