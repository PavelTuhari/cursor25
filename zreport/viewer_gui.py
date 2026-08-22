#!/usr/bin/env python3
"""
Просмотрщик фискальных чеков (native GUI, tkinter — без внешних зависимостей).

Мастер-деталь:
    слева  — список чеков (фильтр, поиск, диапазон дат);
    справа — билеты выбранного чека + «бумажный» вид чека.

Запуск:
    python3 viewer_gui.py out/zreport.db
    python3 viewer_gui.py            # возьмёт ./out/zreport.db или спросит файл
"""
from __future__ import annotations

import csv
import os
import sqlite3
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

RECEIPT_COLS = [
    ("bon_nr", "Чек", 70),
    ("fiscal_date", "Дата", 90),
    ("fiscal_time", "Время", 75),
    ("doc_nr", "Док.", 70),
    ("tickets_count", "Билетов", 70),
    ("total", "Сумма", 90),
    ("payment_type", "Оплата", 80),
]
TICKET_COLS = [
    ("ticket_nr", "Билет", 95),
    ("cursa", "Рейс", 210),
    ("route_code", "Маршрут", 75),
    ("vehicle", "Авто", 75),
    ("trip_date", "Дата рейса", 90),
    ("trip_time", "Отпр.", 60),
    ("destination", "Назначение", 200),
    ("seat", "Место", 55),
    ("price", "Цена", 75),
    ("sale_time", "Продан", 70),
]


class App(tk.Tk):
    def __init__(self, db_path: str):
        super().__init__()
        self.title("Просмотр чеков — Z-отчёт")
        self.geometry("1280x760")
        self.minsize(900, 560)

        self.con = sqlite3.connect(db_path)
        self.con.row_factory = sqlite3.Row
        self.db_path = db_path
        self._rows: list[sqlite3.Row] = []

        self._build_ui()
        self.reload()

    # ------------------------------------------------------------------ UI --
    def _build_ui(self) -> None:
        top = ttk.Frame(self, padding=(8, 6))
        top.pack(fill="x")

        ttk.Label(top, text="Поиск:").pack(side="left")
        self.q = tk.StringVar()
        e = ttk.Entry(top, textvariable=self.q, width=34)
        e.pack(side="left", padx=(4, 10))
        e.bind("<Return>", lambda _e: self.reload())
        self.q.trace_add("write", lambda *_: self._debounce())

        ttk.Label(top, text="Дата:").pack(side="left")
        self.date = tk.StringVar(value="(все)")
        self.date_cb = ttk.Combobox(top, textvariable=self.date, width=14, state="readonly")
        self.date_cb.pack(side="left", padx=(4, 10))
        self.date_cb.bind("<<ComboboxSelected>>", lambda _e: self.reload())

        ttk.Label(top, text="Оплата:").pack(side="left")
        self.pay = tk.StringVar(value="(все)")
        self.pay_cb = ttk.Combobox(top, textvariable=self.pay, width=12, state="readonly")
        self.pay_cb.pack(side="left", padx=(4, 10))
        self.pay_cb.bind("<<ComboboxSelected>>", lambda _e: self.reload())

        ttk.Button(top, text="Сбросить", command=self.reset).pack(side="left")
        ttk.Button(top, text="Экспорт CSV", command=self.export).pack(side="right")
        ttk.Button(top, text="Открыть БД…", command=self.open_db).pack(side="right", padx=6)

        pan = ttk.Panedwindow(self, orient="horizontal")
        pan.pack(fill="both", expand=True, padx=8, pady=(0, 4))

        left = ttk.Frame(pan)
        self.tv_r = self._make_tree(left, RECEIPT_COLS)
        self.tv_r.bind("<<TreeviewSelect>>", lambda _e: self.on_receipt())
        pan.add(left, weight=1)

        right = ttk.Panedwindow(pan, orient="vertical")
        rt = ttk.Frame(right)
        self.tv_t = self._make_tree(rt, TICKET_COLS)
        right.add(rt, weight=3)

        pf = ttk.Frame(right)
        self.paper = tk.Text(pf, width=36, height=14, font=("Courier New", 10),
                             state="disabled", wrap="none")
        sb = ttk.Scrollbar(pf, orient="vertical", command=self.paper.yview)
        self.paper.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.paper.pack(fill="both", expand=True)
        right.add(pf, weight=2)
        pan.add(right, weight=2)

        self.status = tk.StringVar()
        ttk.Label(self, textvariable=self.status, anchor="w",
                  relief="sunken", padding=(6, 3)).pack(fill="x")

        self.bind("<Control-f>", lambda _e: e.focus_set())
        self.bind("<Escape>", lambda _e: self.reset())

    @staticmethod
    def _make_tree(parent: ttk.Frame, cols) -> ttk.Treeview:
        keys = [c[0] for c in cols]
        tv = ttk.Treeview(parent, columns=keys, show="headings", selectmode="browse")
        for key, title, width in cols:
            tv.heading(key, text=title,
                       command=lambda t=tv, k=key: App._sort(t, k))
            tv.column(key, width=width, anchor="e" if key in ("total", "price", "seat")
                      else "w", stretch=key in ("cursa", "destination"))
        vs = ttk.Scrollbar(parent, orient="vertical", command=tv.yview)
        hs = ttk.Scrollbar(parent, orient="horizontal", command=tv.xview)
        tv.configure(yscrollcommand=vs.set, xscrollcommand=hs.set)
        vs.pack(side="right", fill="y")
        hs.pack(side="bottom", fill="x")
        tv.pack(fill="both", expand=True)
        return tv

    @staticmethod
    def _sort(tv: ttk.Treeview, key: str) -> None:
        data = [(tv.set(i, key), i) for i in tv.get_children("")]
        try:
            data.sort(key=lambda p: float(p[0].replace(" ", "") or 0))
        except ValueError:
            data.sort()
        if getattr(tv, "_last_sort", None) == key:
            data.reverse()
            tv._last_sort = None
        else:
            tv._last_sort = key
        for pos, (_v, iid) in enumerate(data):
            tv.move(iid, "", pos)

    # --------------------------------------------------------------- data --
    def _debounce(self) -> None:
        if getattr(self, "_job", None):
            self.after_cancel(self._job)
        self._job = self.after(220, self.reload)

    def _fill_filters(self) -> None:
        dates = [r[0] for r in self.con.execute(
            "SELECT DISTINCT fiscal_date FROM receipts ORDER BY 1")]
        pays = [r[0] for r in self.con.execute(
            "SELECT DISTINCT payment_type FROM receipts ORDER BY 1")]
        self.date_cb["values"] = ["(все)"] + dates
        self.pay_cb["values"] = ["(все)"] + pays

    def reset(self) -> None:
        self.q.set("")
        self.date.set("(все)")
        self.pay.set("(все)")
        self.reload()

    def reload(self) -> None:
        where, args = [], []
        q = self.q.get().strip()
        if q:
            like = f"%{q}%"
            fields = ["r.bon_nr", "r.doc_nr"]
            tfields = ["t.ticket_nr", "t.cursa", "t.destination", "t.vehicle", "t.route_code"]
            where.append(
                "(" + " OR ".join(f"{f} LIKE ?" for f in fields)
                + " OR EXISTS (SELECT 1 FROM tickets t WHERE t.receipt_id = r.receipt_id AND ("
                + " OR ".join(f"{f} LIKE ?" for f in tfields) + ")))")
            args += [like] * (len(fields) + len(tfields))
        if self.date.get() != "(все)":
            where.append("r.fiscal_date = ?")
            args.append(self.date.get())
        if self.pay.get() != "(все)":
            where.append("r.payment_type = ?")
            args.append(self.pay.get())
        sql = "SELECT * FROM receipts r"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY r.receipt_id"

        self._rows = self.con.execute(sql, args).fetchall()

        self.tv_r.delete(*self.tv_r.get_children())
        for row in self._rows:
            self.tv_r.insert("", "end", iid=str(row["receipt_id"]),
                             values=[self._fmt(row[k]) for k, _t, _w in RECEIPT_COLS])
        total = sum(r["total"] or 0 for r in self._rows)
        tk_cnt = sum(r["tickets_count"] or 0 for r in self._rows)
        self.status.set(f"{os.path.basename(self.db_path)} — чеков: {len(self._rows)}, "
                        f"билетов: {tk_cnt}, сумма: {total:,.2f}".replace(",", " "))
        self._fill_filters()
        kids = self.tv_r.get_children()
        if kids:
            self.tv_r.selection_set(kids[0])
            self.tv_r.see(kids[0])
        else:
            self.tv_t.delete(*self.tv_t.get_children())
            self._paper("")

    def on_receipt(self) -> None:
        sel = self.tv_r.selection()
        if not sel:
            return
        rid = int(sel[0])
        rows = self.con.execute(
            "SELECT * FROM tickets WHERE receipt_id=? ORDER BY ticket_id", (rid,)).fetchall()
        self.tv_t.delete(*self.tv_t.get_children())
        for t in rows:
            self.tv_t.insert("", "end", values=[self._fmt(t[k]) for k, _ti, _w in TICKET_COLS])
        head = self.con.execute("SELECT * FROM receipts WHERE receipt_id=?", (rid,)).fetchone()
        self._paper(self._render(head, rows))

    @staticmethod
    def _fmt(v) -> str:
        if isinstance(v, float):
            return f"{v:.2f}"
        return "" if v is None else str(v)

    @staticmethod
    def _render(r: sqlite3.Row, tickets) -> str:
        W = 34
        out = ["I.S. DIRECTIA PENTRU".center(W), "EXPLOATAREA IMOBILULUI".center(W),
               f"C.F. {r['fiscal_code']}".center(W), "-" * W,
               f"BON FISCAL: {r['bon_nr']}", f"Дата: {r['fiscal_date']} {r['fiscal_time']}",
               f"Документ: {r['doc_nr']}   Оператор: {r['operator']}", "-" * W]
        for t in tickets:
            out += [f"BILET {t['ticket_nr']}",
                    f"  {t['cursa']}",
                    f"  {t['trip_date']} {t['trip_time']}  место {t['seat']}",
                    f"  -> {t['destination']}",
                    f"  {(t['price'] or 0):>{W - 4}.2f}"]
        out += ["-" * W,
                f"ИТОГО{(r['total'] or 0):>{W - 5}.2f}",
                f"{r['payment_type']}{(r['payment_sum'] or 0):>{W - len(r['payment_type'] or '')}.2f}",
                f"TVA {r['vat_letter']} {r['vat_rate']}%{(r['vat_sum'] or 0):>{W - 12}.2f}",
                f"Ser.N {r['serial']}", f"N.Inr. {r['reg_nr']}"]
        return "\n".join(out)

    def _paper(self, text: str) -> None:
        self.paper.configure(state="normal")
        self.paper.delete("1.0", "end")
        self.paper.insert("1.0", text)
        self.paper.configure(state="disabled")

    # ------------------------------------------------------------ actions --
    def export(self) -> None:
        if not self._rows:
            return
        path = filedialog.asksaveasfilename(defaultextension=".csv",
                                            filetypes=[("CSV", "*.csv")],
                                            initialfile="filtered_tickets.csv")
        if not path:
            return
        ids = [r["receipt_id"] for r in self._rows]
        marks = ",".join("?" * len(ids))
        rows = self.con.execute(
            f"SELECT * FROM v_tickets_full WHERE receipt_id IN ({marks}) ORDER BY ticket_id",
            ids).fetchall()
        with open(path, "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh, delimiter=";")
            w.writerow(rows[0].keys() if rows else [])
            w.writerows([list(r) for r in rows])
        messagebox.showinfo("Экспорт", f"Сохранено строк: {len(rows)}\n{path}")

    def open_db(self) -> None:
        path = filedialog.askopenfilename(filetypes=[("SQLite", "*.db *.sqlite"), ("Все", "*")])
        if not path:
            return
        self.con.close()
        self.con = sqlite3.connect(path)
        self.con.row_factory = sqlite3.Row
        self.db_path = path
        self.reset()


def main() -> int:
    if len(sys.argv) > 1:
        db = sys.argv[1]
    else:
        db = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "zreport.db")
        if not os.path.exists(db):
            root = tk.Tk(); root.withdraw()
            db = filedialog.askopenfilename(title="Выберите zreport.db",
                                            filetypes=[("SQLite", "*.db *.sqlite")])
            root.destroy()
    if not db or not os.path.exists(db):
        print("База не найдена. Сначала: python3 parse_zreport.py <файл.txt> -o out", file=sys.stderr)
        return 1
    App(db).mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
