#!/usr/bin/env python3
"""
Парсер фискального Z-отчёта (текстовый дамп чековой ленты, ZK*.txt).

Формат ленты:
    <шапка отчёта>
    ┌ шапка чека (реквизиты предприятия, "0001  Operator 01")
    │ BILET Nr. ... (1..N билетов)
    └ подвал чека (итог, НДС, оплата, "B O N  F I S C A L", Ser.N, N.Inr.)

Результат:
    receipts.csv  — чеки (шапка/итоги)
    tickets.csv   — билеты (по одному на место)
    zreport.db    — та же информация в SQLite (таблицы receipts, tickets + view)

Использование:
    python3 parse_zreport.py ZK00407604_045259_22.08.2026.txt -o out/
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import sqlite3
import sys
from dataclasses import dataclass, field, asdict, fields

# --------------------------------------------------------------------------- #
# Регулярные выражения
# --------------------------------------------------------------------------- #
RE_OPERATOR = re.compile(r"^(\d{4})\s+Operator\s+(\S+)")
RE_CF = re.compile(r"^C\.F\.\s+(\d+)")
RE_BILET = re.compile(r"^BILET Nr\.:\s*(\S+)")
RE_CURSA = re.compile(r"^Cursa:\s*(.+?)\s*$")
RE_RUTA = re.compile(r"^Codul rutei:\s*(\S+)")
RE_NUMAR = re.compile(r"^Nr de inmatriculare:\s*(\S+)")
RE_PLECARE = re.compile(r"^Plecare:\s*(.+?)\s*$")
RE_DATA_ORA = re.compile(r"^Data:\s*(\d{2}\.\d{2}\.\d{4})\s+Ora:\s*(\d{2}:\d{2})")
RE_DEST = re.compile(r"^Destinatia:\s*(.*?)\s*$")
RE_LOC = re.compile(r"^LOCUL\s+(\d+)")
RE_COST = re.compile(r"^Costul calatoriei:\s*([\d.,]+)")
RE_TOTAL_T = re.compile(r"^TOTAL:\s*([\d.,]+)")
RE_CASIER = re.compile(r"^Casier:\s*(\S+)\s+Casa:\s*(\S+)")
RE_DATA_V = re.compile(r"^Data vanzarii:\s*(\d{2}\.\d{2}\.\d{4})")
RE_ORA_V = re.compile(r"^Ora\s+vanzarii:\s*(\d{2}:\d{2})")
RE_SEP = re.compile(r"^-{5,}$")
RE_STARS = re.compile(r"^\*{5,}$")

RE_ITEM = re.compile(r"^([\d.,]+)\s*X\s*([\d.,]+)\s+([\d.,]+)\s*([A-Z])?$")
RE_TOTAL_SPACED = re.compile(r"^T\s*O\s*T\s*A\s*L\s*_+\s*([\d\s.,]+)$")
RE_TVA = re.compile(r"^TVA\s+(\S+)\s+([\d.,]+)%\s+([\d.,]+)$")
RE_PAY = re.compile(r"^(NUMERAR|CARD|CEC|CREDIT)\s*_+\s*([\d.,]+)$")
RE_FISCAL_TS = re.compile(r"^(\d{2}-\d{2}-\d{4})\s+(\d+)\s+(\d{2}:\d{2}:\d{2})$")
RE_BON = re.compile(r"^B\s*O\s*N\s+F\s*I\s*S\s*C\s*A\s*L\s*:\s*([\d\s]+)$")
RE_SER = re.compile(r"^Ser\.N\s+(\S+)")
RE_INR = re.compile(r"^N\.Inr\.\s+(\S+)")
RE_ART = re.compile(r"^(\d+)\s+ART$")


def _num(s: str | None) -> float | None:
    """'1 0 6 . 5 6' / '106,56' -> 106.56"""
    if s is None:
        return None
    s = re.sub(r"\s+", "", s).replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


# --------------------------------------------------------------------------- #
# Модель данных
# --------------------------------------------------------------------------- #
@dataclass
class Ticket:
    receipt_id: int = 0
    bon_nr: str = ""
    line_no: int = 0
    ticket_nr: str = ""
    cursa: str = ""
    route_code: str = ""
    vehicle: str = ""
    departure_stop: str = ""
    trip_date: str = ""
    trip_time: str = ""
    destination: str = ""
    seat: str = ""
    price: float | None = None
    total: float | None = None
    cashier: str = ""
    till: str = ""
    sale_date: str = ""
    sale_time: str = ""


@dataclass
class Receipt:
    receipt_id: int = 0
    bon_nr: str = ""
    serial: str = ""
    reg_nr: str = ""
    fiscal_code: str = ""
    operator: str = ""
    operator_code: str = ""
    fiscal_date: str = ""
    fiscal_time: str = ""
    doc_nr: str = ""
    items_count: int = 0
    qty: float | None = None
    unit_price: float | None = None
    total: float | None = None
    vat_letter: str = ""
    vat_rate: float | None = None
    vat_sum: float | None = None
    payment_type: str = ""
    payment_sum: float | None = None
    tickets_count: int = 0
    tickets_sum: float = 0.0
    start_line: int = 0
    end_line: int = 0
    tickets: list = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Парсер
# --------------------------------------------------------------------------- #
def parse(path: str) -> tuple[list[Receipt], list[Ticket], list[str]]:
    with open(path, "r", encoding="utf-8", errors="replace", newline="") as fh:
        raw = [ln.rstrip("\r\n") for ln in fh]
    lines = [ln.strip() for ln in raw]

    receipts: list[Receipt] = []
    tickets: list[Ticket] = []
    problems: list[str] = []

    cur = Receipt(receipt_id=1, start_line=1)
    tk: Ticket | None = None
    dest_pending = False  # 'Destinatia:' без текста -> адрес на следующих строках

    def flush_ticket() -> None:
        nonlocal tk, dest_pending
        if tk is not None:
            tk.destination = re.sub(r"\s+", " ", tk.destination).strip()
            tk.receipt_id = cur.receipt_id
            cur.tickets.append(tk)
            tickets.append(tk)
            tk = None
        dest_pending = False

    def close_receipt(end_line: int) -> None:
        nonlocal cur
        flush_ticket()
        if cur.tickets or cur.total is not None:
            cur.end_line = end_line
            cur.tickets_count = len(cur.tickets)
            cur.tickets_sum = round(sum(t.total or 0.0 for t in cur.tickets), 2)
            for t in cur.tickets:
                t.bon_nr = cur.bon_nr
            if cur.total is not None and abs(cur.total - cur.tickets_sum) > 0.01:
                problems.append(
                    f"чек {cur.bon_nr or '?'} (строка {cur.start_line}): "
                    f"итог {cur.total} != сумма билетов {cur.tickets_sum}"
                )
            receipts.append(cur)
        nid = cur.receipt_id + 1
        cur = Receipt(receipt_id=nid, start_line=end_line + 1)

    for i, ln in enumerate(lines, start=1):
        if not ln or RE_SEP.match(ln) or RE_STARS.match(ln):
            continue

        # ---- билет -------------------------------------------------------- #
        m = RE_BILET.match(ln)
        if m:
            flush_ticket()
            tk = Ticket(ticket_nr=m.group(1), line_no=i)
            continue

        if tk is not None:
            if (m := RE_CURSA.match(ln)):
                tk.cursa = m.group(1); continue
            if (m := RE_RUTA.match(ln)):
                tk.route_code = m.group(1); continue
            if (m := RE_NUMAR.match(ln)):
                tk.vehicle = m.group(1); continue
            if (m := RE_PLECARE.match(ln)):
                tk.departure_stop = m.group(1); continue
            if (m := RE_DATA_ORA.match(ln)):
                tk.trip_date, tk.trip_time = m.group(1), m.group(2); continue
            if (m := RE_DEST.match(ln)):
                tk.destination = m.group(1)
                dest_pending = not tk.destination
                continue
            if (m := RE_LOC.match(ln)):
                tk.seat = m.group(1); dest_pending = False; continue
            if (m := RE_COST.match(ln)):
                tk.price = _num(m.group(1)); dest_pending = False; continue
            if (m := RE_TOTAL_T.match(ln)):
                tk.total = _num(m.group(1)); continue
            if (m := RE_CASIER.match(ln)):
                tk.cashier, tk.till = m.group(1), m.group(2); continue
            if (m := RE_DATA_V.match(ln)):
                tk.sale_date = m.group(1); continue
            if (m := RE_ORA_V.match(ln)):
                tk.sale_time = m.group(1); continue
            if dest_pending:
                tk.destination = (tk.destination + " " + ln).strip()
                continue

        # ---- подвал / шапка чека ------------------------------------------ #
        if (m := RE_ITEM.match(ln)):
            flush_ticket()
            cur.items_count += 1
            cur.qty = _num(m.group(1))
            cur.unit_price = _num(m.group(2))
            continue
        if (m := RE_TOTAL_SPACED.match(ln)):
            flush_ticket()
            cur.total = _num(m.group(1)); continue
        if (m := RE_TVA.match(ln)):
            cur.vat_letter = m.group(1)
            cur.vat_rate = _num(m.group(2))
            cur.vat_sum = _num(m.group(3))
            continue
        if (m := RE_PAY.match(ln)):
            cur.payment_type = m.group(1)
            cur.payment_sum = _num(m.group(2))
            continue
        if (m := RE_FISCAL_TS.match(ln)):
            cur.fiscal_date = m.group(1)
            cur.doc_nr = m.group(2)
            cur.fiscal_time = m.group(3)
            continue
        if (m := RE_BON.match(ln)):
            cur.bon_nr = _digits(m.group(1)); continue
        if (m := RE_SER.match(ln)):
            cur.serial = m.group(1); continue
        if (m := RE_INR.match(ln)):
            cur.reg_nr = m.group(1)
            close_receipt(i)          # N.Inr. — последняя строка чека
            continue
        if (m := RE_ART.match(ln)):
            continue
        if (m := RE_CF.match(ln)):
            cur.fiscal_code = m.group(1); continue
        if (m := RE_OPERATOR.match(ln)):
            cur.operator_code, cur.operator = m.group(1), m.group(2); continue

    close_receipt(len(lines))
    return receipts, tickets, problems


# --------------------------------------------------------------------------- #
# Выгрузка
# --------------------------------------------------------------------------- #
RECEIPT_COLS = [f.name for f in fields(Receipt) if f.name != "tickets"]
TICKET_COLS = [f.name for f in fields(Ticket)]


def write_csv(path: str, cols: list[str], rows) -> None:
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, delimiter=";")
        w.writeheader()
        for r in rows:
            d = asdict(r)
            w.writerow({c: d[c] for c in cols})


SCHEMA = """
PRAGMA journal_mode=WAL;
DROP VIEW  IF EXISTS v_tickets_full;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS receipts;

CREATE TABLE receipts (
    receipt_id   INTEGER PRIMARY KEY,
    bon_nr       TEXT, serial TEXT, reg_nr TEXT, fiscal_code TEXT,
    operator     TEXT, operator_code TEXT,
    fiscal_date  TEXT, fiscal_time TEXT, doc_nr TEXT,
    items_count  INTEGER, qty REAL, unit_price REAL, total REAL,
    vat_letter   TEXT, vat_rate REAL, vat_sum REAL,
    payment_type TEXT, payment_sum REAL,
    tickets_count INTEGER, tickets_sum REAL,
    start_line   INTEGER, end_line INTEGER,
    source_file  TEXT
);

CREATE TABLE tickets (
    ticket_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id  INTEGER REFERENCES receipts(receipt_id),
    bon_nr      TEXT, line_no INTEGER,
    ticket_nr   TEXT, cursa TEXT, route_code TEXT, vehicle TEXT,
    departure_stop TEXT, trip_date TEXT, trip_time TEXT,
    destination TEXT, seat TEXT, price REAL, total REAL,
    cashier TEXT, till TEXT, sale_date TEXT, sale_time TEXT
);

CREATE INDEX ix_t_receipt ON tickets(receipt_id);
CREATE INDEX ix_t_nr      ON tickets(ticket_nr);
CREATE INDEX ix_t_cursa   ON tickets(cursa);
CREATE INDEX ix_t_date    ON tickets(sale_date, sale_time);
CREATE INDEX ix_r_bon     ON receipts(bon_nr);

CREATE VIEW v_tickets_full AS
SELECT t.*, r.fiscal_date, r.fiscal_time, r.doc_nr, r.payment_type,
       r.total AS receipt_total, r.serial
FROM tickets t JOIN receipts r USING(receipt_id);
"""


def write_sqlite(path: str, receipts, tickets, source: str) -> None:
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    con.executemany(
        f"INSERT INTO receipts ({','.join(RECEIPT_COLS)},source_file) "
        f"VALUES ({','.join('?' * len(RECEIPT_COLS))},?)",
        [[getattr(r, c) for c in RECEIPT_COLS] + [source] for r in receipts],
    )
    con.executemany(
        f"INSERT INTO tickets ({','.join(TICKET_COLS)}) "
        f"VALUES ({','.join('?' * len(TICKET_COLS))})",
        [[getattr(t, c) for c in TICKET_COLS] for t in tickets],
    )
    con.commit()
    con.execute("ANALYZE")
    con.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Парсинг фискальной ленты в CSV и SQLite")
    ap.add_argument("input", help="текстовый файл ленты (ZK*.txt)")
    ap.add_argument("-o", "--outdir", default="out", help="каталог результатов (по умолчанию out/)")
    a = ap.parse_args(argv)

    os.makedirs(a.outdir, exist_ok=True)
    receipts, tickets, problems = parse(a.input)

    rcsv = os.path.join(a.outdir, "receipts.csv")
    tcsv = os.path.join(a.outdir, "tickets.csv")
    db = os.path.join(a.outdir, "zreport.db")
    write_csv(rcsv, RECEIPT_COLS, receipts)
    write_csv(tcsv, TICKET_COLS, tickets)
    write_sqlite(db, receipts, tickets, os.path.basename(a.input))

    total = round(sum(r.total or 0 for r in receipts), 2)
    print(f"Чеков:   {len(receipts)}")
    print(f"Билетов: {len(tickets)}")
    print(f"Сумма по чекам: {total}")
    print(f"Сумма по билетам: {round(sum(t.total or 0 for t in tickets), 2)}")
    print(f"CSV: {rcsv}, {tcsv}")
    print(f"SQLite: {db}")
    if problems:
        print(f"\nПредупреждения ({len(problems)}):", file=sys.stderr)
        for p in problems[:20]:
            print("  " + p, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
