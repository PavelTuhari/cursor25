# Ofertă Comercială — CRM Autohton cu Integrare 1C
## Solução personalizată pentru Prodcom Fit SRL

**Data ofertei:** 24 august 2026  
**Valabilitate:** 30 zile de la emitere  
**Beneficiar:** Prodcom Fit SRL  
**Furnizor:** UNA.md Solutions (Pavel Tuhari)  
**Limba contract:** Română  
**Jurisdicție:** Republica Moldova  

---

## 1. Descrierea Serviciului

### 1.1 Soluția CRM Propusă

**Denumire:** CRM Autohton Prodcom Fit — Versiunea 2026  
**Tip:** Sistem integrat de gestionare a relațiilor cu clienții, personalizat pentru vânzări B2B/B2C cu suport telefonie, email, messaging, și integrare 1C.

**Componente principale:**
- Interfață web responsivă (acces desktop + mobil)
- Bază de date hosted în Moldova (TopHost) sau cloud OCI (opțional)
- Integrări: 1C, Facebook/Instagram, Viber, SMS, Email, Telefonie IP
- Moduli specialized: Pâlnii de vânzări, Automatizări, Analytics, Voice AI, Document Generator
- Dashboard real-time cu KPI-uri și rapoarte configurabile
- Sales Bot + Voice AI pentru calificarea și procesarea leadurilor

### 1.2 Ecosistem Tehnologic

| Componentă | Tehnologie | Hosting |
|-----------|-----------|---------|
| **Frontend** | React.js / Vue.js (responsive, PWA) | CDN (TopHost Moldova) |
| **Backend** | Node.js + Express / Python (FastAPI) | Server dedicate (TopHost) |
| **Bază de date** | PostgreSQL 15 / MySQL 8.0 | Serverul fizic în Chișinău |
| **Integrări** | REST API, webhooks, amoCRM-compatible | Conector middleware în Moldova |
| **Telefonie IP** | Asterisk / Twilio (cu suport local) | Gateway PBX Moldova |
| **Email** | Postfix + Gmail API / Microsoft 365 | Mail relay Moldova |
| **Backup** | Automated daily, 30-day retention | Local NAS + OCI (opțional) |

**Opțiuni de hosting:**
- **Opțiunea 1 — TopHost Moldova (Recomandată):** Serverele fizice în Chișinău, latență <50ms, suport local 24/5
- **Opțiunea 2 — OCI Cloud (Frankfurt/Amsterdam):** Redundanță multi-regiune, auto-scaling, backup geo-distribuit, plată separate (€200–400/lună)
- **Opțiunea 3 — Hibrid:** TopHost pentru baza de date + backup în cloud OCI (€100 adițional/lună)

---

## 2. Cerințe Funcționale — Plan de Implementare (22 Module)

### Modul 1: Setări de Bază și Roluri Utilizatori

**1.1 Crearea și setarea contului CRM**
- Configurare titlu companie, tip companie (retail, manufacturare, servicii), domeniu acces (subdomeniu.crm.local)
- Selectare monedă (MDL, EUR, USD, RUB cu curs actualizat daily din BNM)
- Definire anuț fiscal și adresă legală

**1.2 Configurare Roluri și Permisiuni**
- Rol Admin: Acces total la toți utilizatorii, configurări, rapoarte, backup
- Rol Manager: Vizualizare/editare tranzacții și contacte din pâlniaua asignată, limitare după nivel ierarhic
- Rol Departament (Vânzări, Marketing, Suport): Vizualizare date publice + proprii, editare limitată
- Rol Observator: Doar citire rapoarte și dashboard (pentru management)

**1.3 Configurare Grupuri de Departamente**
- Creare dinamică de grupuri (Vânzări, Suport Clienți, Marketing, Contabilitate)
- Delimitare vizualizării: contacte, tranzacții, email, pâlnii pe grup
- Atribuire manager de grup cu drepturi de moderare

**1.4 Configurare Dashboard Personal**
- Fiecare utilizator are dashboard personalizabil cu widget-uri proprii
- Salvare preferințe de vizualizare

**Durată implementare:** 3 zile  
**Cost inclus:** ✓ În pachet

---

### Modul 2: Configurare Tipuri de Sarcini

**2.1 Definire Tipuri de Sarcini**
- Sarcini standard: Apel, Email, Întâlnire, Vizită, Urmărire (follow-up), Propunere, Semnare contract
- Sarcini custom: În funcție de pâlnie și proces

**2.2 Asignare Pictograme și Culori**
- Fiecare tip are pictogramă unic (apel = telefon, email = plicuri, etc.)
- Culoare codare: urgent (roșu), normal (gri), completă (verde)

**2.3 Setare Priorități și Durate Estimative**
- Prioritate: Urgentă (0–4h), Înaltă (1 zi), Normală (3 zile), Redusă (5+ zile)
- Durată estimată pentru fiecare tip (folosit în planificarea managerilor)

**Durată implementare:** 2 zile  
**Cost inclus:** ✓ În pachet

---

### Modul 3: Configurare Câmpuri Tranzacție

**3.1 Câmpuri Standard Pre-configurate**
- Identificator unic (ID tranzacție auto-generat)
- Nume tranzacție / Subiect (text lung)
- Valoare monetară (monedă selectabilă)
- Etapă în pâlnie (dropdown: Lead, Interes, Propunere, Negociere, Contract, Vânzare, Pierdută)
- Contacte asociate (multi-select cu link din baza de contacte)
- Companie asociată (din baza de companii)
- Manager responsabil (user assigned)
- Data creării și modificării (timestamp auto)
- Probabilitate de închidere (0–100%, default 50%)
- Data de închidere estimată (date picker)

**3.2 Câmpuri Custom Configurabile**
- Tip custom: Text simplu, Text lung, Număr, Monedă, Data, Selectare din listă, Checkbox, Radio, Email, Telefon
- Obligativitate: Dependent de etapă (ex: "Valoare" obligatorie din etapa Propunere)
- Ordine de completare: Câmpurile s-au reordona pe interfață conform priorității

**3.3 Validări și Constrangeri**
- Format validare (ex: valoare >0, email valid)
- Avertismente dacă câmp obligatoriu nu este completat
- Blocarea trecerii la etapa următoare dacă câmpuri crítico nu sunt completate

**Durată implementare:** 4 zile (inclusiv custom fields)  
**Cost inclus:** ✓ În pachet + €50/zile suplimentare per 10 câmpuri suplimentare

---

### Modul 4: Configurare Automatizări

**4.1 Reguli de Automatizare**
- Trigger: Crearea tranzacției, schimbarea etapei, schimbarea valorii câmpului, etichetă (tag) adăugată, valoare peste prag
- Acțiuni automate:
  - Atribuire automată manager (rond-robin sau regula custom)
  - Generare sarcină (apel, email, întâlnire)
  - Notificare (push, email, SMS)
  - Schimbare etapă (conditional)
  - Adăugare etichetă (tag)
  - Apel la webhook (integrare API externă)

**4.2 Cronometru Proces**
- Setare timer pentru fiecare etapă (ex: Max 3 zile în etapa "Propunere")
- Alertă dacă timer expirat (notificare manager)
- Escalare automată la manager superior dacă timeout
- Raportare monatică pe procese stagnat

**4.3 Condiții Declanșatoare (Trigger-uri)**
- Valoare câmp (ex: valoare > 10,000 MDL → escalare la director)
- Etichetă specifică (ex: tag "VIP" → responsabil dedicat)
- Ziua săptămânii / ora (ex: apel urmărire doar luni–vineri 9–18)
- Durata în etapă (ex: >7 zile fără interacțiune → remind manager)
- Provenință lead (ex: din Facebook → Sales Bot auto-calificării)

**4.4 Scenarii Automate Complexe (Workflow-uri)**
- Lead intră din Facebook → Sales Bot calificare → Dacă calificat → Creare tranzacție → Atribuire manager → Sarcină apel
- Tranzacție "Pierdută" → Notificare manager → Raport analitic → Marcare pentru urmărire după 30 zile

**Durată implementare:** 5–7 zile (depinde de complexitate)  
**Cost inclus:** ✓ În pachet (până la 15 automatizări). Suplimentar: €80/zi per 5 automatizări complexe

---

### Modul 5: Pâlnia de Vânzări — Recepție Leaduri

**5.1 Pâlnia Standard: Lead → Interes → Propunere → Negociere → Contract → Vânzare/Pierdută**
- Vizualizare Kanban board (drag-drop tranzacții între etape)
- Vizualizare listă (tabel sortabil cu câmpuri configurabile)
- Filtru rapid: După manager, tag, valoare, dată creări

**5.2 Surse de Leaduri Integrate:**
- **Campanii SMM (Facebook, Instagram):** Auto-conectare conturi business (vezi Modul 12, 13)
- **Messenger / Instagram DM:** Mesajele capturate auto în tranzacții (vezi Modul 13)
- **Website Contact Form:** API Integration (vezi Modul 10)
- **Apeluri telefonice:** Inregistrare automată + creare tranzacție (vezi Modul 7)
- **Email:** Forwarding către CRM inbox (vezi Modul 9)

**5.3 Prelucrare Imediată a Lead-urilor (Inbound Call Center)**
- Timer pentru răspuns: Standard 3 minute (configurable)
- Alert dacă lead nu este contactat în 24 ore
- Indicatori: % lead-uri contactate, % conversie per manager

**Durată implementare:** 3 zile  
**Cost inclus:** ✓ În pachet

---

### Modul 6: Pâlnia Baza de Date — Cold Calling

**6.1 Baza de Date cu Prospectele (Cold Leads)**
- Import din Excel / CSV cu mapare câmpuri (vezi Modul 8)
- Tabela cu: Nume contact, Companie, Telefon, Email, Industrie, Locație
- Etiquetare automată: "Cold Lead", "Nu contactat", "Contactat – Dezinteresat", "Contactat – Interesat"

**6.2 Workflow pentru Cold Calling**
- Atribuire contacte managerilor (rotație automată)
- Sarcină automată: "Apelați contact X mâine la ora 10"
- Înregistrare apelului (durata, rezultat)
- Dacă interesat → Creare tranzacție în pâlnia vânzări
- Dacă dezinteresat → Marcare tag "Dezinteresat" + follow-up după 3 luni

**6.3 Statistici Cold Calling**
- % contactați, % respunsă pozitivă, % conversie
- Raport zilnic/săptămânal pe manager

**Durată implementare:** 3 zile  
**Cost inclus:** ✓ În pachet

---

### Modul 7: Telefonie IP — Integrare și Configurare

**7.1 Conexiune Telefonie IP**
- Setup: Gateway PBX local (Asterisk) sau Cloud (Twilio/Vonage)
- Număr virtual Moldovan (format +373...)
- Configurare: Redirecționare apeluri către manager desemnat

**7.2 Funcționalități Apeluri în CRM**
- **Click-to-dial:** Apasa pe număr de telefon în CRM → apelul se inițiază automat
- **Caller ID:** Nume client apare pe telefon managerului
- **Înregistrare apeluri:** Toate apelurile inregistrate + stocate în cloud (GDPR compliant)
- **Transcripție automată:** Voice-to-text (opțional, +€50/lună)

**7.3 Redirecționare Inteligentă**
- După manager: Lead primește router la manager responsabil
- După client: Apeluri existente dirigere la manager anterior (continuitate)
- După ora: După 18:00 → voicemail + creare sarcină pentru ziua următoare

**7.4 Apeluri Pierdute — Auto-reminder**
- Dacă manager nu a răspuns: SMS + notificare app "Ai pierdut apel de la [Client]. Contactați urgent"
- Creare automată sarcină: "Callback [Client Name]"
- Raport zilnic: Apeluri pierdute și status contactare

**7.5 Postprocesare Apel**
- După finalizare apel: Popup în CRM pentru noter rezultat (rezumat apel, acțiuni)
- Sugestie etapă următoare (A.I.-powered)

**Durată implementare:** 5 zile (inclusiv testing și training)  
**Costuri suplimentare:** 
- Setup telefonie IP: €50 (inclus în service)
- Minute apeluri: €0.05 per minut (local MDL) — aprox. €50–200/lună depinde de volum
- Transcripție audio: +€50/lună (opțional)

**Cost inclus:** ✓ Configurare în pachet. Minute de apel: factură separată

---

### Modul 8: Import Bază de Date

**8.1 Importul de Contacte și Companii**
- Format acceptat: Excel (.xlsx), CSV, Google Sheets
- Mapare coloane: Contact (Nume, Telefon, Email, Companie, Locație, Note) ↔ CRM
- Validare automată: Email format, Telefon format, Duplicate checking
- Deduplicare: Merge contacte duplicate (opțional cu review manual)

**8.2 Asocieri Automată**
- Dacă contacte aparțin aceleași companii → link automat
- Creare companii lipsă din lista contacte
- Atribuire tag automat (ex: "Imported", "2026-08-24")

**8.3 Mapare Avansată (Custom Fields)**
- Dacă baza veche are câmpuri custom → configurare mapare personalizată
- Transformare valori (ex: Stare "Cald" → Tag "VIP")

**8.4 Raport Import**
- Total importat: 1,500 contacte, 120 companii
- Duplicates detectate și merge-ate
- Erori și avertismente
- Data importării și user care a efectuat

**Durată implementare:** 1–2 zile (depinde de volum și complexitate)  
**Cost inclus:** ✓ În pachet (până la 5,000 contacte). Suplimentar: €1/1000 contacte

---

### Modul 9: Integrare Email — Corporativ și Personal

**9.1 Setup Email Corporate**
- Creare email corporate: sales@prodcom-fit.com, support@prodcom-fit.com
- Hosting: IMAP/SMTP pe serverul TopHost
- Sincronizare: Toate emailurile din inbox CRM (2 sensuri)

**9.2 Email Personal (Optional)**
- Fiecare manager poate conecta email personal (Gmail, Yahoo, Outlook)
- Sincronizare: Emailuri trimise/primite de manager → înregistrate în CRM
- Confidențialitate: Doar emailuri despre tranzacții CRM sunt salvate

**9.3 Notificări și Inbox Smart**
- Emailuri din contacte CRM → auto-forward inbox CRM
- Etiquetare automată per manager
- Căutare în emailuri (full-text search)

**9.4 Template-uri Email**
- Creare template-uri predefinite (Follow-up, Propunere, Refus, etc.)
- Variabile dinamice: {{Nume Client}}, {{Companie}}, {{Valoare Tranzacție}}
- Personalizare pe rol (Manager, Director, Suport)

**Durată implementare:** 2 zile  
**Cost inclus:** ✓ În pachet

---

### Modul 10: Website Lead API — Integrare Site Web

**10.1 Programare API Modul**
- Endpoint: POST /api/leads (REST API securizat cu API Key)
- Format: JSON cu câmpuri (name, email, phone, company, message, source_url)
- Validare: Email valid, Phone format, Nessun spam check

**10.2 Conectare Forme Contact din Website**
- Forma contact standard HTML → Integration JavaScript snippet
- Transmitere date automată la CRM la submit
- Feedback utilizator: "Mulțumim! Vom contacta în 24 ore"

**10.3 Creare Entități Automate**
- Lead venit din website → Creare automată: Contact + Tranzacție + link
- Etiquetare: "Web Lead", data, URL sursa

**10.4 Personalizare per Formă**
- Diferite forme (Pricing Request, Demo Request, Support) → Tranzacții diferite pâlnii
- Routing automat: Lead-uri din forma "Sales" → manager Vânzări

**Durată implementare:** 3 zile  
**Cost inclus:** ✓ În pachet (1 API + 3 forme web). Suplimentar: €30/formă adițională

---

### Modul 11: Website Lead UTM — Analytics și Attribution

**11.1 Capturare UTM Parameters**
- Integrare Google Analytics 4 + UTM tracking
- Parametri capturați: utm_source, utm_medium, utm_campaign, utm_term, utm_content

**11.2 Stocaj în Cartela Client**
- Fiecare contact lead are câmp "Traffic Source" și "Campaign"
- Exemplu: Source: "Facebook" → Campaign: "Summer Sale 2026" → Medium: "CPC"

**11.3 Raport Eficiență Marketing**
- Analytics dashboard: Lead-uri per sursă (FB, Instagram, Google Ads, Organic, Direct)
- Conversie: % lead-uri → contactate → propunere → vânzare
- ROI per campanie: (Revenue per source) / (Cost per source)

**11.4 Export Rapoarte**
- CSV/PDF: Lead-uri per lună, per sursă, cu conversie rates
- Integrare Google Sheets (real-time sync)

**Durată implementare:** 3 zile  
**Cost inclus:** ✓ În pachet

---

### Modul 12: Facebook Messenger + Lead-uri

**12.1 Conectare Business Account Facebook**
- Facebook App setup + autentificare OAuth
- Permisiuni: Citire mesaje, Trimis mesaje, Gestionare lead-uri din postări

**12.2 Capturare Lead-uri din Postări**
- Lead-uri din formele în postări Facebook → auto-import CRM
- Câmpuri: Nume, Email, Telefon, Mesaj, URL postări
- Etiquetare: Tag "Facebook Lead"

**12.3 Sincronizare Messenger Conversații**
- Conversații Messenger din página business → inbox CRM
- Răspuns direct din CRM: Scriu manager → Trimis pe Messenger
- Istoric complet: Toate mesajele la contact CRM

**12.4 Notificări Real-Time**
- Mesaj nou Messenger → Notificare push în CRM app
- Auto-routing: Mesaje direcționate manager responsabil
- Chatbot bot: Răspunsuri automate "Mulțumim. Manager va contacta în 24 ore"

**Durată implementare:** 3 zile  
**Cost inclus:** ✓ În pachet

---

### Modul 13: Instagram Direct + Lead-uri

**13.1 Conectare Business Account Instagram**
- Instagram App setup (via Facebook App)
- Permisiuni: Citire DM, Trimis DM, Accesare lead-uri din postări

**13.2 Capturare Lead-uri**
- Lead-uri din formele în postări (Stickers pe Stories) → auto-import CRM
- Câmpuri: Nume, Telefon (dacă furnizat), Context (URL post, tip sticker)

**13.3 Sincronizare Instagram DM**
- Conversații DM → Inbox CRM asociat contact
- Răspuns direct din CRM → Trimis pe Instagram DM
- Support: Manager susține conversație fără a ieși din CRM

**13.4 Autoresponse și Bot**
- Auto-reply la DM: "Mulțumim pe contactare. Manager va răspunde în orele de lucru"
- Keyword-based: Tipul mesaj ("price", "order", "support") → Routing inteligent

**Durată implementare:** 3 zile  
**Cost inclus:** ✓ În pachet

---

### Modul 14: Viber — Chatbot și Integrare

**14.1 Creare Chatbot Viber**
- Setup: Viber Business Account pentru Prodcom Fit
- Chatbot: Auto-reply la mesaje, menu options (Produse, Preț, Contact, Support)

**14.2 Conectare la CRM**
- Mesaje Viber → Inbox CRM
- Răspund manager direct din CRM
- Creare contact + tranzacție automat din Viber conversation

**14.3 Funcționalități Bot**
- Meniu: "Selecta opțiune: 1-Produse, 2-Preț, 3-Contact sales, 4-Suport"
- Răspunsuri predefinite per opțiune
- Escalare: Dacă complicat → Connect la manager (transfer chat)

**14.4 Notificări și Promovări**
- Send campaign: SMS + Viber message (Message broadcast)
- Template: "Reducere specială! Cumpărați azi 20% rabat. Link: [deeplink]"

**Durată implementare:** 2 zile  
**Cost inclus:** ✓ În pachet

---

### Modul 15: Generator de Documente

**15.1 Creație Template-uri Documente**
- Template-uri: Proformi, Contract, Invoice, Ofertă de vânzare, NDA
- Format: .docx (Microsoft Word) cu plăceholders

**15.2 Variabile Dinamice din CRM**
- Câmpuri CRM interpolate în document:
  - {{client_name}}, {{company_name}}, {{address}}
  - {{transaction_value}}, {{currency}}, {{date}}
  - {{manager_name}}, {{company_signature}}

**15.3 Semnătură Digitală și Știmp**
- Integrare semnătură digitală (e-signature): DocuSign sau local solution
- Știmp digitale automată: Logo companie, data generării
- Reguli de siguritate: Document hash, audit trail

**15.4 Editare și Descărcare**
- După generare: Manager poate edita document (dacă modificări ulterioare)
- Export: PDF (readonly) sau DOCX (editable)
- Salvare: Document stocat în CRM (linked la tranzacție)

**15.5 Template Library**
- Biblioteca de 10 template-uri standard (included)
- Creare template-uri custom: €50/template

**Durată implementare:** 3 zile  
**Cost inclus:** ✓ Generator + 10 template-uri standard

---

### Modul 16: SMS Notificări și Marketing

**16.1 Setup SMS Gateway**
- Provider: Infobip, Vodafone SMS (local MDL), sau Twilio
- API Key configurare în CRM

**16.2 Notificări Tranzacționale (Auto)**
- Aprobarea propunerii: SMS client "Propunerea dvs. a fost aprobată. Link: [URL]"
- Reminder apel: SMS manager "Urmează apel la client [Nume] la 10:00"
- Status update: SMS client "Comanda dvs. a fost expediată. Tracking: [URL]"

**16.3 Template-uri SMS cu Variabile**
- Template: "Bună {{client_name}}, aveți reducere 15% la produsele {{product_category}}. Cod: SAVE15"
- Variabile per contact/tranzacție

**16.4 Campaign SMS Manual**
- Send bulk SMS: Select contact-uri + message template
- Scheduler: Planificată SMS pentru ora anumită
- Limitări: Max 160 caractere (1 SMS) sau 306 caractere (3 SMS)

**16.5 Analytics SMS**
- Delivered vs Failed (per contact)
- Click-through (dacă link în SMS)
- Conversie: SMS → Apel, SMS → Website visit

**16.6 Compliance GDPR**
- Opt-in/Opt-out list management
- Audit trail: Cine, când, ce SMS trimis

**Durată implementare:** 2 zile  
**Costuri suplimentare:** SMS-uri factură separate (~€0.05 per SMS, min. €30/lună)

**Cost inclus:** ✓ Setup și template-uri. SMS-uri: cost variabil

---

### Modul 17: Dashboard și Analytics Configurabile

**17.1 Dashboard Admin/Director**
- **Widget-uri principale:**
  - Lead-uri noi (zilă/săptămână/lună) — indicator numeric
  - Sursă lead-uri (pie chart): % din FB, Instagram, Website, Cold Calling, Email
  - Vânzări totale (bar chart): Valoare vânzări pe manager, pe săptămână
  - Dinamică lead-uri: Trend line (creștere/scădere)
  - Dinamică vânzări: Trend line trend

**17.2 Dashboard Manager Vânzări**
- **Pâlnii:** Vizualizare tranzacții după etapă (Lead, Interes, Propunere, Negociere, Contract, Vânzare)
- **Sarcini:** Listing sarcini cu dată scadență și prioritate
- **Apeluri pierdute:** Reminders pentru contactare
- **Statistici personale:** % contactate, % conversie, valoare medie deal

**17.3 Widget-uri Real-Time Configurabile**
- Drag-drop să reordoneze widget-uri
- Filtre: Dată, pâlnie, manager, tag, valoare min/max
- Export: Snapshot imagine, PDF, CSV

**17.4 Rapoarte Parametrice**
- Raport Vânzări (Period, Manager, Pâlnie, Status)
- Raport Lead-uri (Source, Date Range, Conversion %)
- Raport Apeluri (Manager, Duration, Outcome)
- Raport Documente Generate

**17.5 KPI Tracking**
- Plan vs Actual:
  - Plan vânzări lunar: €50,000 MDL (target)
  - Actual: €34,500 MDL (68% achievement)
  - Target trimestrial, anual
- Trend indicator: ↑ +15% vs luna precedentă

**17.6 Exporturi Rapoarte**
- Format: PDF, Excel, CSV
- Programare: Raport auto-email CEO zilnic/săptămânal

**Durată implementare:** 4 zile  
**Cost inclus:** ✓ În pachet

---

### Modul 18: Sales Bot — Calificarea Lead-urilor

**18.1 Bot Workflow**
- **Inițiere:** Client scrie pe chat web / Messenger / Viber
- **Greeting:** Chatbot zice "Bună! 👋 Sunt assistant Prodcom Fit. Cum te pot ajuta?"
- **Opciuni prezentate:**
  1. "Vreau să cunosc produsele dvs."
  2. "Am o întrebare despre preț"
  3. "Vreau o demonstrație"
  4. "Suport pentru comandă existentă"

**18.2 Calificare Lead (A.I.-Powered)**
- **Branch 1 — Produse:**
  - "Ce categorie de produse interesează? (1) Electronice, (2) Îmbrăcăminte, (3) Accesorii"
  - După selecție → Afișare produse / prețuri
  - Întrebare: "Vreau mai mult detalii? (DA/NU)"

- **Branch 2 — Preț:**
  - "Pentru ce categorie? ..."
  - "Vreau ofertă / prețurile curente"
  - Bot trimite fișier PDF pricelist
  - "Aveți alte întrebări?"

- **Branch 3 — Demo:**
  - "Doresc o demonstrație live? Selecta ora: [schedule link]"
  - Bot crează sarcină manager: "Demo scheduled cu [Contact] la [Time]"

- **Branch 4 — Suport:**
  - "Număr comandă sau descriere problemă:"
  - Transfer la manager suport (escalare)

**18.3 Ieșire Bot**
- După calificarea: Lead score (0–100)
  - Score 80+: "Hot lead" → Atribuire imediată top manager
  - Score 50–79: "Warm lead" → Atribuire manager standard
  - Score <50: "Cold lead" → Cold calling pâlnie

- Auto-creare tranzacție CRM cu: Contacte, Source ("Chatbot"), Lead Score, Notă din conversație

**18.4 Integrare Multi-Channel**
- Viber Bot, Facebook Messenger Bot, Website Chat Bot — același conversație flow
- Cross-platform: Mesaj inceput pe Facebook → Finalizat pe Viber (context preserved)

**Durată implementare:** 5 zile  
**Cost inclus:** ✓ În pachet

---

### Modul 19: Voice AI — Transcripție și Insight-uri Automate

**19.1 Integrare Voice AI**
- Integrare: Google Speech-to-Text / OpenAI Whisper / Deepgram
- Toate apelurile înregistrate (Modul 7) → Auto-transcripție

**19.2 Funcționalități Voice AI**
- **Transcripție automată:** Apel 30 min → Transcript text (timp ~1–2 min post-apel)
- **Rezumat auto:** Sistem extrage: Subiecte discutate, Obiecții cliente, Promisiuni manager, Acțiuni següent
- **Sentiment analysis:** Tone client (pozitiv/neutru/negativ)
- **Keyword detection:** Cuvinte cheie ("preț", "contract", "concurent", "urgent")

**19.3 Sync Automat în CRM**
- Post-apel: Transcript + Summary + Sentiment → CRM Transaction Note
- Alert dacă sentiment negativ: Notificare manager + manager superior
- Keyword "urgent" detectat → Escalare automată

**19.4 Training și Coaching**
- Manager vs Expected (Best Practice) speech: Compară transcript
- Raport: Manager-ul a spus [X], ideal ar fi [Y]
- Coaching insights: "Ascultă top performer [Manager Name] cum a gestionat obiecția 'preț prea înalt'"

**19.5 Conformitate și Audit**
- Transcript + Aprov legale: Cuvinte-cheie conform (GDPR compliance)
- Audit trail: Data apel, participanți, transcript, summary, versiune Voice AI

**Durată implementare:** 5 zile  
**Costuri suplimentare:** Voice AI subscription ~€100–200/lună (depinde de volum apeluri)

**Cost inclus:** ✓ Integrare în pachet. AI subscription: factură separată

---

### Modul 20: Instruire Personal

**20.1 Training Managers/Sales**
- **Durata:** 2 zile (2 sesiuni a 4h)
- **Conținut:**
  1. Noțiuni generale: Terminologie CRM, interfață, navigare
  2. Pâlnia de vânzări: Lead → Deal → Close, drag-drop, filtre
  3. Automatizări: Înțelege triggeruri, sarcini automate
  4. Lucrul cu tranzacții: Edita câmpuri, creare sarcini, telefonie, email
  5. Lucrul cu sarcini: Planificare zilei, reminder-uri
  6. Colaborare: Mentiuni (@manager), comentarii, partajare info pe aceeași tranzacție

- **Format:** Live session + Prezentare + Q&A
- **Materiale:** Slide-uri, Cheat sheets (print-friendly), Video recording

**20.2 Training Administratori**
- **Durata:** 1 zi (2 sesiuni a 2h)
- **Conținut:**
  1. Setări general: Utilizatori, roluri, permisiuni
  2. Analitică: Dashboard interpretation, KPI-uri
  3. Statistică și Rapoarte: Filtre, export, programare automate
  4. Conversie și eficiență: Calcul conversion rate, ROI per sursă
  5. Editare câmpuri: Adăuga custom fields, obligativitate, validare
  6. Audit și compliance: Cine a făcut ce, audit trail

- **Format:** Interactive workshop + hands-on exercises
- **Materiale:** Admin manual (PDF), Template rapoarte, Compliance checklist

**20.3 Post-Training Support**
- 30 zile incluse: Răspuns la întrebări (Slack, email, video call)
- Session: Onboarding appraoval pentru fiecare user

**Durată implementare:** 2–3 zile (timing post-deployment)  
**Cost inclus:** ✓ În pachet

---

### Modul 21: Video Ghiduri și Tutorial-uri

**21.1 Video Ghid — Modul Manager**
- **Capitole:**
  1. **Introducere (5 min):** Ce este CRM, beneficii, interfață general
  2. **Pâlnia vânzări (10 min):** Creare lead, progres prin etape, conversie
  3. **Automatizări (8 min):** De ce sunt utile, exemple, cum funcționează
  4. **Lucrul cu tranzacții (12 min):** Edita informații, adăuga contacte, sarcini
  5. **Lucrul cu sarcini (8 min):** Creare, prioritate, reminder-uri, completare
  6. **Colaborare (7 min):** Menționări, comentarii, partajare

- **Bonus: Scenarii de vânzări detaliați (4 scenarii x 8 min = 32 min total):**
  - Scenario 1: Lead din Facebook → Calificare → Propunere → Vânzare
  - Scenario 2: Apel rece → Follow-up → Contract semnat
  - Scenario 3: Lead dezinteresat → Re-engage după 30 zile → Vânzare
  - Scenario 4: Obiecție preț → Negociere → Compromis → Vânzare

- **Format:** Screen recording, voiceover ușor (RO), subtitle, high-quality (1080p)
- **Platformă:** YouTube (private link) + embedding în CRM help section

**21.2 Video Ghid — Modul Administrator**
- **Capitole:**
  1. **Roluri și permisiuni (10 min):** Creare user, asignare rol, restricții acces
  2. **Analitică dashboard (10 min):** Widget-uri, filtre, interpretare numere
  3. **Rapoarte și statistică (12 min):** Tip rapoarte, cum se citeşte, export
  4. **Conversie și ROI (10 min):** Calcul, interpretation, optimizare
  5. **Câmpuri prestabilite (8 min):** Modificare, validare, obligativitate

- **Bonus: Complex scenarios (3 x 10 min):**
  - Setup nou CRM: Users → Setări → Pâlnii → Automatizări
  - Analiza lead-uri: Source, conversie, cost per lead
  - Raport vânzări CEO: Plan vs actual, trend, forecast

- **Format:** Screen recording, voiceover, subtitle, 1080p
- **Durata total:** ~2 ore material

**21.3 Delivery și Hosting**
- Toate video-uri hosted în YouTube (unlisted link)
- Subtitles: Automat (YouTube) + manual verificat
- Update: După fiecare update CRM, video-uri se updatyează (included 1 an)

**Durată implementare:** 5 zile (scripting, filming, editing)  
**Cost inclus:** ✓ În pachet (20 video-uri total)

---

### Modul 22: Support 60 Zile Post-Implementare

**22.1 Perioada de Suport: 60 Zile**
- Perioada de sprijin: Începe de la semnarea Actului de Predare-Primire
- Durata: 60 zile calendaristice
- Ore: 8 AM – 6 PM, luni–vineri (support zilelor lucrătoare)

**22.2 Inclus în Suport:**
- **Consultații ilimitare:** Întrebări despre utilizarea sistemului, best practices, configurație
- **Modificări configurație:** Adăugare câmpuri, schimbare layout, new pâlnii, reguli automate — **FĂRĂ cost**
- **Bug fixes:** Orice probleme sau erori identificate — fix prioritar
- **Performance optimization:** Tuning bază date, optimizare query-uri dacă lent
- **Mesaje/chat:** Response 4–6 ore pe working day
- **Video call support:** 2 ore/săptămână included (pentru complex issues, training refresh)

**22.3 Exclusii din Suport Standard:**
- Lucru dezvoltare complet noi (ex: interfață nouă design) → factură separată
- Integrări cu sisteme externe (non-standard) → €80/h
- Setup telefonie IP (dacă nu in setup initial) → €50/h

**22.4 Post-Suport: Servicii la Comandă**
- După 60 zile: Modificări configurație = €25/oră (minimum €50 per comandă)
- Lucru complex (custom coding): €80/h
- Emergency support (după 6 PM): +100% tarif (ex: €50/h → €100/h)

**22.5 Extended Support (Optional)**
- Post 60 zile, client poate upgrade la: Extended Support 6 luni = €200 (include 20h consultații, fix bugs, optimizare)
- Multi-annual: Support 1 an = €350 (include 40h, priority queue)

**22.6 SLA (Service Level Agreement)**
- **Critical (System Down):** Response <4h, resolution <24h
- **High (Feature broken, Data at risk):** Response <8h, resolution <3 days
- **Medium (Minor bug, Slow performance):** Response <24h, resolution <7 days
- **Low (Documentation request, Enhancement idea):** Response <48h

**Cost inclus:** ✓ 60 zile incluse în pachet

---

## 3. Structura Prețurilor și Condiții Comerciale

### 3.1 Model de Plată Lunar

| Element | Valoare | Perioadă | Note |
|---------|---------|----------|------|
| **Abonament Lunar Dezvoltare** | €100 | Lunar (recurent) | Servicii de dezvoltare prin AI, updates, minor features, 8x5 support |
| **Servicii Opționale la Comandă** | €40 | Per comandă (variabil) | Feature noi, integrări nestandard, consulturi externe (dacă solicit client) |
| **Taxă Conexiune Inițială** | €300 | Unică (la semnare contract) | Setup inițial, deployment, training, transferul datelor |
| **Costuri Apeluri Telefonice** | ~€50–200/lună | Lunar (variabil) | Factură separată, depinde de volum apeluri (€0.05/min local) |
| **SMS Notificări** | ~€30–100/lună | Lunar (variabil) | Factură separată, depinde de volum (€0.05/SMS) |
| **Voice AI (Optional)** | €100–200/lună | Lunar (opțional) | Transcripție, rezumat, coaching — dacă activat |
| **Cloud OCI Backup (Optional)** | €100–150/lună | Lunar (opțional) | Dacă doresc backup geo-distribuit în cloud |

### 3.2 Exemplu Cost Lunar (Scenario Tipic)

```
Abonament Dezvoltare:          €100
Apeluri telefonice (100 min):    €50
SMS (100 SMS):                   €30
Suport inclus:               ✓ (în €100)
────────────────────────────
TOTAL LUNAR:                   €180
                          (≈610 MDL la curs 3.4)

ANUAL (12 luni):            €2,160
                          (≈7,344 MDL)
```

### 3.3 Plani de Abonament

| Plan | Preț/Lună | Inclus | Ideal Pentru |
|------|-----------|--------|---|
| **Starter** | €100 | Dezvoltare, suport 8x5, 1 manager, pâlnie 1 | Startup, mic business, test |
| **Professional** | €150 | Starter + 5 manageri, pâlnii 3, API site web | PME, vânzări 5–10 persoane |
| **Enterprise** | €250 | Professional + 20 manageri, pâlnii nelimit, Voice AI, priorități support, dedicated account manager | Corp mari, mai multe departamente, complex workflows |

### 3.4 Condiții Contract și Plată

**Perioada Contractuală:**
- Minim 2 ani de la semnarea contractului
- După primele 2 luni (periode de evaluare/testing) → Contract effectiv 24 luni

**Testare Inițială (Primele 2 Luni):**
- Minim 2 săptămâni: Deployment și testing (verificare + rapoarte pozitivi pe fiecare cerință)
- Client primește: Demo environment (acces complet) + staging server
- După 2 săptămâni: Go-live în producție (dacă testerle OK)
- Milestone-uri: Zilnic check-in, întrebări rezolvate instant

**Plată Abonament:**
- Frecvență: Lunar (invoice la 1-a zilei lunii)
- Metoda: Transfer bancar (EUR) / Card (EUR/MDL)
- Conturi: Cont IBAN moldovean sau EUR internațional (la alegere)
- Scadență factură: 15 zile

**Plată Taxă Conexiune (€300):**
- Datorată: La semnarea contractului (înainte de deployment)
- **Nerefundabilă dacă:** Client renunță după 30 zile de la semnare
- **Refundabilă parțial (50%) dacă:** Renunță în primele 15 zile și sistemul nu a fost folosit

**Anulare Contract:**
- După 2 ani: Pot denuncia cu notificare 30 zile
- Datele: Export complet gratuit în CSV/JSON (propriul client)
- Migrare: Suport advisory gratuit (până 20 ore) pentru mișcare la alt CRM

---

## 4. Servicii Incluse vs. Non-Incluse

### Inclus în Pachet (€100/lună + €300 conexiune)

✓ Toate 22 module configurate  
✓ Setup inițial și deployment (2 săptămâni)  
✓ Transfer date din vechi sistem (import bază)  
✓ Training staff (2 zile for managers, 1 zi for admin)  
✓ Video tutorial-uri (20+ video-uri)  
✓ Telefonie IP setup (doar hardware la client; software gratuit)  
✓ Email corporate setup  
✓ Facebook/Instagram/Viber integration  
✓ SMS gateway setup (comunicare doar, apeluri factură separată)  
✓ Document generator + 10 template-uri standard  
✓ Dashboard și rapoarte configurabile  
✓ Sales Bot calificare lead-uri  
✓ Backup zilnic (local TopHost)  
✓ Support 60 zile post-implementare  
✓ Minor updates și bug fixes (inclusă în €100)  

### Non-Inclus (Cost Suplimentar)

✗ **Voice AI Subscription:** €100–200/lună (optiuni, dacă doresc transcripție/coaching)  
✗ **Cloud OCI Backup:** €100–150/lună (dacă doresc geo-backup pe cloud)  
✗ **Apeluri telefonice:** €0.05/minut (factură separată per apel)  
✗ **SMS-uri:** €0.05/SMS (factură separată)  
✗ **Minute Viber Bot:** €0.02/minută (comunicare viber)  
✗ **Integrări custom non-amoCRM:** €80/h (ex: integr. 1C, sisteme legacy)  
✗ **Servicii la comandă (post-60 zile suport):** €25/h (modificări config, consulturi)  
✗ **Suport extended (post 60 zile):** €200–350 (6 luni – 1 an)  
✗ **1C Accounting Integration:** €150–300 unică (custom coding, dacă se dorește)  

---

## 5. Opțional — Integrare 1C Accounting

### 5.1 Descriere Integrare 1C

Prodcom Fit folosește 1C:Enterprise (accounting software) pentru facturare și contabilitate. CRM poate:
- **Auto-sync:** Tranzacție CRM → Creare document 1C (proformă, factură, bon livrare)
- **Bidirectional:** Documente factură din 1C → Import în CRM (pentru raportare)
- **Sincronizare articole:** Catalog produse 1C → Pret în CRM propositions
- **Stock sync:** Disponibilitate produse din 1C → Alert în CRM dacă stock zero

### 5.2 Opțiuni Implementare

| Opțiune | Cost | Durată | Descriere |
|---------|------|--------|-----------|
| **A) API Custom** | €300 (unică) | 5 zile | Middleware custom care conectează CRM ↔ 1C via API/REST; bi-directional sync |
| **B) Plug-in Standard** | €150 (unică) | 2 zile | Plug-in preexistent (dacă versiunea 1C suportată); doar export documents |
| **C) Manual Workflow** | €0 | N/A | User exportă manual din 1C → Import în CRM (nu se recomandă, slow) |

### 5.3 Recomandare
**Pentru Prodcom Fit:** Recomandă **Opțiunea A** (Custom API) pentru:
- Sync automat (real-time)
- Reducere manual entry
- Stoc actualizat live
- Costo: €300 (unică) + inclus în €100/lună

---

## 6. Timeline Implementare

### Faza 1: Pre-Deployment (Săptămâna 1)

| Zi | Activitate | Responsabil | Deliverable |
|----|-----------|-------------|------------|
| Luni | Contract semnat, transfer €300 | Client | Invoice, Account Access |
| Marți | Creare conturi staff, export date vechi | Client | CSV export, user list |
| Miercuri | Setup TopHost (serverele, SSL cert) | Furnizor | Server access, DNS |
| Joi | Import date, validare | Furnizor | Import report, data quality check |
| Vineri | Configurare module 1–6 (Settings, Tasks, Fields, Automation, Funnels, Cold DB) | Furnizor | Demo account ready |

**Milestone:** Client testează în staging, raportează bugs/issues. Feedback implementat următoarea zi.

### Faza 2: Implementare Integrări (Săptămâni 2–3)

| Zi | Activitate | Responsabil |
|----|-----------|------------|
| Luni | Telefonie IP setup (Asterisk config) | Furnizor |
| Marți | Email + Facebook/Instagram integration | Furnizor |
| Miercuri | Viber Bot + SMS gateway setup | Furnizor |
| Joi | Website API + UTM setup | Furnizor |
| Vineri | Document generator + Voice AI activation | Furnizor |

**Faza 2 Finală:** Client pe producție (live data, real calls).

### Faza 3: Training și Finalizare (Săptămâna 4)

| Zi | Activitate | Durata |
|----|-----------|--------|
| Luni–Marți | Training managers (pâlnii, automatizări, apeluri, sarcini) | 8h |
| Miercuri | Training admin (dashboard, rapoarte, setări) | 4h |
| Joi | Go-live support (manager on-call) | 8h |
| Vineri | Post-deployment audit, turnover documentation | 4h |

**Finalizare:** Semnare Act Predare-Primire (începe suportul 60 zile).

### Timeline Rezumat

```
Săptămâna 1:   Setup inițial + data import
Săptămâna 2–3: Integrări + configurare module
Săptămâna 4:   Training + go-live
Ziua 30+:      Production support 60 zile (luni–vineri 8–18)
```

---

## 7. Termeni Și Condiții

### 7.1 Garanții și Responsabilități

**Furnizor garantează:**
- Sistem disponibil 99.5% (uptime) pe durata contractului
- Data backup zilnic cu retention 30 zile
- Suport 60 zile inclus; response <4h pe urgent
- Conformitate GDPR și date security standard industry

**Client responsabil de:**
- Licență 1C (dacă are)
- Implementare procese interne (workflow-urile sunt sarcina clientului sa definească)
- Instrucțiuni staff (furnizor face training, dar client asigură adoption)
- Pagina de plată (taxa conexiune €300 la semnare)

### 7.2 Limitări de Responsabilitate

- Furnizor NU răspunde pentru daunele indirecte (pierdere profit, business interruption)
- Maxim răspundere: 3 luni de abonament (€300 pentru plan €100/lună)
- Dată backup: 30 zile; pentru date mai vechi, client solicită archive (cost recover: €50)

### 7.3 Terminare Anticipată

- **De către Client:** 30 zile notificare după expirarea anului 1; dacă termină anul 1 → €300 penalitate
- **De către Furnizor:** Non-plată 2 luni → suspend acces; 3 luni → cancelă contract

### 7.4 Confidențialitate

- Ambele părți: Datele clientului (contacte, tranzacții, pricelist) sunt confidențiale
- Furnizor: Poate folosi cazul de caz în portfolio (dacă aprobă client)

### 7.5 Legea Aplicabilă

- Contract guvernat de legea Republicii Moldova
- Dispute: Arbitrajul Camerei de Comerț Chișinău

---

## 8. Resurse și Contacte

### 8.1 Echipa Implementare

| Rol | Persoană | Contact |
|-----|---------|---------|
| **Project Manager** | Pavel Tuhari | +373 (0) 799 123 456 / pavel@una.md |
| **Technical Lead (Development)** | [Inginer CRM] | tech@una.md |
| **Support Lead** | [Support Manager] | support@una.md |
| **Training Specialist** | [Trainer] | training@una.md |

### 8.2 Documentație Furnizată

- ✓ Manualul utilizatorului (PDF, 50+ pagini)
- ✓ Administrator guide (PDF, 30+ pagini)
- ✓ Video tutorial-uri (20 video-uri, 3 ore total)
- ✓ Quick start guide (1 pagina cheat sheet)
- ✓ API documentation (dacă integrări custom)

### 8.3 SLA și Suport

| Nivel Suport | Response Time | Rezoluție Esperată | Preț |
|--------------|---------------|--------------------|------|
| **Standard (8x5)** | <4h urgent, <8h high, <24h medium | <24h urgent, <7 zile high | Inclus |
| **Extended (24/7)** | <2h urgent, <4h high | <4h urgent, <24h high | +€50/lună |
| **Dedicated Manager** | <1h urgent | <2h urgent, <8h high | +€100/lună |

---

## 9. Anexe și Scenarii de Cost

### 9.1 Scenario 1: PME Mic (Startup)

**Profil:** 5 salariați, 50 lead-uri/lună, vânzări €5,000/lună

| Serviciu | Cost | Total Anual |
|----------|------|------------|
| Abonament Dev (€100/lună) | €1,200 | €1,200 |
| Apeluri telefonice (50 apeluri/lună × €0.05) | €25–50/lună | €300–600 |
| SMS (20 SMS/lună) | €1/lună | €12 |
| Conexiune inițială (unică) | €300 | €300 |
| **TOTAL ANY 1** | | **€1,812–2,112** |
| **TOTAL ANY 2+** | | **€1,512–1,812** (fără conexiune) |

### 9.2 Scenario 2: PME Medium (Established)

**Profil:** 15 salariați, 200 lead-uri/lună, vânzări €50,000/lună, 3 pâlnii

| Serviciu | Cost | Total Anual |
|----------|------|------------|
| Abonament Develop (€150/lună — Professional) | €1,800 | €1,800 |
| Apeluri telefonice (300 apeluri/lună) | €150/lună | €1,800 |
| SMS (100 SMS/lună) | €5/lună | €60 |
| Voice AI (€100/lună, opțional) | €100/lună | €1,200 |
| Conexiune + integrare 1C | €300 + €300 | €600 |
| **TOTAL ANY 1** | | **€5,460** |
| **TOTAL ANY 2+** | | **€4,860** (fără conexiune, 1C) |

### 9.3 Scenario 3: Corporație Mare (Multi-departament)

**Profil:** 50+ salariați, 1000 lead-uri/lună, vânzări €200,000+/lună, 5+ pâlnii, suport 24/7

| Serviciu | Cost | Total Anual |
|----------|------|------------|
| Abonament Develop (€250/lună — Enterprise) | €3,000 | €3,000 |
| Apeluri telefonice (2000 apeluri/lună) | €1,000/lună | €12,000 |
| SMS (500 SMS/lună) | €25/lună | €300 |
| Voice AI + transcripție (€150/lună) | €150/lună | €1,800 |
| Extended support 24/7 (+€50/lună) | €50/lună | €600 |
| Cloud OCI backup (€120/lună, opțional) | €120/lună | €1,440 |
| Conexiune + integrare 1C + custom integr. | €600 | €600 |
| **TOTAL ANY 1** | | **€19,740** |
| **TOTAL ANY 2+** | | **€19,140** (fără conexiune, integr) |

---

## 10. Criterii Decizie și Recomandări

### Pentru Prodcom Fit SRL: Recomandă Plan Professional (€150/lună)

**Rațiune:**
1. **Volum:** 15–20 salariați vânzări + suport (cadru PME medium)
2. **Complexitate:** Pâlnii multiple (Web, SMM, Telefonie, Cold Calling)
3. **Integrare:** 1C accounting (custom API €300)
4. **ROI:** Estimat savings: 10h/săptămână (administrative overhead) → €400–500/lună valoare recunoscută

**Calcul ROI:**
- Investiție Y1: €5,460 (inclus conexiune, 1C)
- Valoare salvată: 10h × €50/h × 50 săptămâni = €25,000
- **ROI: 4.6x (venit/cost)**

### Next Steps:

1. **Semnare contract:** 2–3 zile
2. **Plată €300:** Transfer bancar
3. **Deployment:** 4 săptămâni (de la semnare)
4. **Go-live:** Ziua 30 (producție)
5. **Support:** 60 zile post-go-live

---

## Anexă — Odată cu Oferta

- ✓ Contract CRM Standart (clar termeni)
- ✓ Scrisoare confirmă start proiect (ER-ul păstrează)
- ✓ Module checklist (22 puncte confirmate)
- ✓ Video demo: https://youtu.be/[CRM-Demo-Link] (exemplu similar CRM)

---

**Oferta valabilă:** 30 zile de la data emiterii (24 august 2026)  
**Pentru acceptare:** Răspund la pavel@una.md sau +373 (0) 799 123 456  
**Semnătură furnizor:** Pavel Tuhari, UNA.md Solutions

---

*Document confidențial — Dedicat Prodcom Fit SRL. Reproducție interzisă fără permisiune.*

