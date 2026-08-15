# Catalogul proceselor de business — UNA.md/ONG

**Configurația:** UNA.md/ONG — Contabilitatea Organizației Necomerciale (UNA.md ERP · Oracle Database 26ai · OCI)
**Ediția:** 2026 · Diagrame în notația Mermaid (redate nativ de GitHub)

Acest catalog însoțește fișa de produs `modul-contabilitate-ong-una-oracle.html` (secțiunea 15) și poate fi folosit ca bază pentru manualul de proceduri interne al organizației.

## Registrul proceselor

| Cod | Proces | Responsabil principal | Frecvență | Subsistem (fișa de produs, secț. 4) |
|-----|--------|----------------------|-----------|--------------------------------------|
| BP-00 | Harta generală a proceselor (de la donator la raportare) | Director executiv | continuu | toate |
| BP-01 | Ciclul de viață al grantului | Manager de proiect + contabil-șef | per contract | 4.1, 4.9 |
| BP-02 | Bugetare și realocări între linii de buget | Manager de proiect | per proiect / la amendamente | 4.9 |
| BP-03 | De la achiziție la plată (Procure-to-Pay) | Contabil + director | zilnic | 4.3, 4.7 |
| BP-04 | **Salarizare pe proiecte** (time-sheets, calcul, plată, IPC21) | Contabil salarii | lunar | 4.6 |
| BP-05 | Recepția și distribuirea ajutorului umanitar | Gestionar depozit + manager de proiect | per lot | 4.5 |
| BP-06 | Închiderea lunii și raportarea reglementată | Contabil-șef | lunar | 4.2, secț. 5 |
| BP-07 | Deconturi de avans și delegații | Titular de avans + contabil | la eveniment | 4.3 |
| BP-08 | Actualizare legislativă (Monitorul Oficial → OTRS → producție) | Partener de suport | la modificări | secț. 12.1 |

---

## BP-00 · Harta generală a proceselor

```mermaid
flowchart LR
  subgraph SF["1 · Atragere finanțări"]
    A1["Negociere cu donatorul"] --> A2["Contract de grant semnat"]
  end
  subgraph PL["2 · Planificare"]
    B1["Buget de proiect pe linii, în valuta donatorului"] --> B2["Aprobare buget"]
  end
  subgraph EX["3 · Execuție"]
    C1["Achiziții și contracte"]
    C2["Plăți, casă și bancă"]
    C3["Salarizare pe proiecte"]
    C4["Distribuire ajutor umanitar"]
    C1 --> C2
  end
  subgraph CT["4 · Contabilitate"]
    D1["Contare documente pe surse de finanțare"] --> D2["Închiderea lunii"]
  end
  subgraph RP["5 · Raportare"]
    E1["Rapoarte către donatori"]
    E2["Rapoarte reglementate: SFS, CNAS, CNAM, BNS"]
    E3["Audit donator / audit statutar"]
  end
  A2 --> B1
  B2 --> C1
  B2 --> C3
  B2 --> C4
  C2 --> D1
  C3 --> D1
  C4 --> D1
  D2 --> E1
  D2 --> E2
  E1 --> E3
  E2 --> E3
```

---

## BP-01 · Ciclul de viață al grantului

```mermaid
flowchart TD
  G1["Semnare contract de grant"] --> G2["Înregistrare sursă de finanțare și proiect"]
  G2 --> G3["Introducere buget pe linii, în valuta donatorului"]
  G3 --> G3a{"Buget aprobat de donator?"}
  G3a -- "Nu — amendament" --> G3
  G3a -- "Da" --> G4["Primire tranșă de finanțare (extras bancar)"]
  G4 --> G5["Execuție cheltuieli cu control automat de buget"]
  G5 --> G6{"Depășire pe linia de buget?"}
  G6 -- "Da" --> G7["Blocare document → realocare internă sau cerere de amendament la donator"]
  G7 --> G5
  G6 -- "Nu" --> G8["Recunoașterea veniturilor pe măsura efectuării cheltuielilor"]
  G8 --> G9["Raport financiar intermediar către donator"]
  G9 --> G10{"Ultima perioadă de raportare?"}
  G10 -- "Nu" --> G4
  G10 -- "Da" --> G11["Raport final + audit al donatorului"]
  G11 --> G12["Închiderea proiectului: sold nevalorificat restituit sau realocat"]
```

---

## BP-03 · De la achiziție la plată (Procure-to-Pay)

```mermaid
flowchart TD
  A["Cerere de achiziție — manager de proiect"] --> B{"Disponibil pe linia de buget?"}
  B -- "Insuficient" --> B1["Respingere sau realocare (BP-02)"]
  B1 --> A
  B -- "Da" --> C{"Peste pragul de achiziții al donatorului?"}
  C -- "Sub prag" --> D["Comandă directă"]
  C -- "Peste prag" --> E["Colectare oferte + proces-verbal de selecție"]
  E --> F["Contract cu furnizorul, legat de proiect"]
  D --> F
  F --> G["Recepție factură (e-Factura) sau decont de avans (BP-07)"]
  G --> H{"Aprobare pe niveluri: contabil → director"}
  H -- "Respins" --> A
  H -- "Aprobat" --> I["Ordin de plată → export către bancă"]
  I --> J["Import extras bancar, reconciliere automată"]
  J --> K["Contare pe proiect și linia de buget"]
  K --> L["Dosarul achiziției arhivat pentru auditul donatorului"]
```

---

## BP-04 · Salarizare pe proiecte — procesul detaliat

Procesul-cheie pentru ONG-urile cu posturi finanțate din mai multe granturi: costul salarial se repartizează pe proiecte strict după time-sheets, iar dările de seamă pleacă electronic la SFS.

```mermaid
flowchart TD
  subgraph HR["Resurse umane"]
    H1["Contract: muncă / prestări servicii / voluntariat"] --> H2["Ordin de angajare, salariu de funcție, stat de personal"]
    H2 --> H3["Evidența lunară: prezență, concedii, medicale, delegații"]
  end
  subgraph PM["Manageri de proiect"]
    P1["Completare time-sheet lunar pe proiecte"] --> P2{"Time-sheet aprobat?"}
    P2 -- "Nu — corecții" --> P1
  end
  subgraph CALC["Contabilitate — calculul salariilor"]
    C1["Calcul avans (dacă este prevăzut)"]
    C2["Calcul brut: salariu de funcție, premii, concedii, medicale"]
    C3["Aplicarea scutirilor personale și deducerilor"]
    C4["Rețineri din salariu: impozit pe venit + prime CNAM, conform cotelor în vigoare"]
    C5["Contribuții ale angajatorului: CNAS, conform cotelor în vigoare"]
    C6{"Post finanțat din mai multe proiecte?"}
    C7["Repartizarea costului salarial și a contribuțiilor pe proiecte și linii de buget, proporțional time-sheet-ului"]
    C8["Contare automată pe surse de finanțare"]
  end
  subgraph PAY["Plata"]
    Y1["Fluturași de salariu pe e-mail"]
    Y2["Fișier pentru proiectul salarial al băncii (plata pe card)"]
    Y3["Ordine de plată: salarii nete + impozit + CNAS + CNAM"]
    Y4["Import extras bancar — confirmarea plăților"]
  end
  subgraph REP["Raportare"]
    R1["IPC21 — darea de seamă lunară unificată, până pe 25 a lunii următoare"]
    R2["Depunere prin Declarația electronică SFS"]
    R3["IALS — nota informativă anuală"]
    R4["Raport de cost salarial pe donatori și proiecte"]
  end
  H3 --> C2
  C1 --> C2
  P2 -- "Da" --> C7
  C2 --> C3 --> C4
  C2 --> C5
  C4 --> C6
  C5 --> C6
  C6 -- "Da" --> C7
  C6 -- "Nu — un singur proiect" --> C8
  C7 --> C8
  C8 --> Y1
  C8 --> Y2 --> Y3 --> Y4
  C8 --> R1 --> R2
  C8 --> R3
  C8 --> R4
```

**Controale încorporate în BP-04:**

- suma repartizărilor pe proiecte = 100 % din costul salarial;
- blocarea calculului dacă lipsește time-sheet-ul aprobat;
- verificarea încadrării în linia de buget „Personal" a fiecărui proiect înainte de contare;
- jurnalul modificărilor pentru auditul donatorului.

---

## BP-05 · Recepția și distribuirea ajutorului umanitar

```mermaid
flowchart TD
  U1["Notificare lot de ajutor umanitar de la donator"] --> U2["Import / recepție cu facilitățile vamale și TVA aplicabile"]
  U2 --> U3["Recepție la depozit: evidență cantitativ-valorică pe lot și proiect"]
  U3 --> U4["Plan de distribuire aprobat pe proiect"]
  U4 --> U5["Liste nominale de beneficiari — date personale protejate, acces pe roluri"]
  U5 --> U6["Distribuire către beneficiari + act de predare-primire semnat"]
  U6 --> U7{"Stoc rămas în lot?"}
  U7 -- "Da" --> U4
  U7 -- "Nu" --> U8["Raport de distribuire către donator"]
  U8 --> U9["Contare: decontarea finanțării cu destinație specială, descărcarea stocului"]
  U9 --> U10["Arhivare dosar lot pentru audit"]
```

---

## BP-06 · Închiderea lunii și raportarea reglementată

```mermaid
flowchart TD
  Z1["Verificarea completitudinii documentelor primare"] --> Z2["Import extrase bancare, curs BNM, reevaluare valutară"]
  Z2 --> Z3["Calculul amortizării mijloacelor fixe"]
  Z3 --> Z4["Repartizarea cheltuielilor indirecte pe proiecte, după cotele aprobate"]
  Z4 --> Z5["Calculul și contarea salariilor (BP-04)"]
  Z5 --> Z6["Verificări de control: balanța, soldurile finanțărilor pe surse, decontări"]
  Z6 --> Z7{"Erori sau abateri?"}
  Z7 -- "Da — corecții" --> Z1
  Z7 -- "Nu" --> Z8["Închiderea perioadei — blocarea editării documentelor"]
  Z8 --> Z9["IPC21, TVA12 și celelalte dări de seamă → Declarația electronică SFS"]
  Z8 --> Z10["Rapoarte către donatori și management (plan-fapt pe bugete)"]
  Z9 --> Z11["Confirmări de recepție SFS arhivate"]
```

---

*Document informativ, ediția 2026. Toate procesele sunt acoperite de configurația standard UNA.md/ONG; adaptările specifice organizației se realizează prin Grok Builder (opțional).*
