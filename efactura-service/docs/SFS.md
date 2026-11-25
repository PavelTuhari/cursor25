# Интеграция с SIA «e-Factura» — что установлено о контракте

Всё ниже получено из двух источников и проверено, где это было возможно:

* **живой WSDL продакшена** — `https://efactura-api.sfs.md/Service.svc?singleWsdl`
  (плюс схемы `?xsd=xsd0`, `?xsd=xsd2`), доступен без авторизации;
* **«Ghidul de integrare Complet Automatizat»** — руководство CTIF (I.P. «Centrul
  de Tehnologii Informaționale în Finanțe»), 44 страницы, описывает семантику
  методов и модель подписи.

Тестовый endpoint из гайда 2020 года (`https://api-test.fisc.md/Service.svc`)
больше не резолвится — за доступом к песочнице нужно обращаться в CTIF,
call-центр **022 822222**.

## Транспорт

| | |
|---|---|
| Endpoint | `https://efactura-api.sfs.md/Service.svc` |
| Протокол | SOAP 1.1, WCF `BasicHttpBinding_IService` |
| Namespace операций | `http://tempuri.org/` |
| Namespace моделей | `http://schemas.datacontract.org/2004/07/AX.EFactura.Model.ApiModel` |
| SOAPAction | `http://tempuri.org/IService/<Operation>` |
| Аутентификация | `TransportWithMessageCredential`: TLS + WS-Security `UsernameToken` с `PasswordText` |

Пароль защищён **только** транспортом, поэтому сервис отказывается работать по
`http` с любым адресом, кроме localhost (проверка в `src/config/validate.ts`).

Учётные данные — это **API-пользователь**, а не логин директора. Создаётся в
кабинете e-Factura: Настройки → Утилизаторы компании → «Înregistrează un
utilizator API».

## Порядок элементов

WCF сериализует DataContract так: сначала члены базового типа, потом
собственные, каждая группа — по алфавиту. Тело с другим порядком отклоняется.
Порядок для каждого типа зафиксирован в `FIELD_ORDER` (`src/sfs/types.ts`) и
покрыт тестами.

Пример — `SeriaNumberRequest` расширяет `BaseRequest`:

```xml
<request>
  <RequestId/>     <!-- из BaseRequest -->
  <Count/>         <!-- дальше свои, по алфавиту -->
  <InvoiceType/>
  <Seria/>
  <StartNumber/>
</request>
```

Массив строк идёт в namespace `http://schemas.microsoft.com/2003/10/Serialization/Arrays`
(`<a:string>`), массив структур — в namespace моделей.

## Операции

19 операций в живом WSDL. Гайд 2020 года описывает 14; шесть остальных
(`GetBankAccountInfo`, `CheckInvoicesStatus`, `GetInvoicesContentForPrint`,
`GetArchivedInvoices`, `PostInvoicesWithAttachment`, `Test`) появились позже и в
гайде отсутствуют — их семантика выведена из сигнатур.

| Операция | Назначение |
|---|---|
| `Test` | проба связи и учётных данных |
| `GetTaxpayersInfo` | название, адрес, код НДС, участие в e-Factura по IDNO/IDNP |
| `GetBankAccountInfo` | проверка банковского счёта контрагента |
| `GetSeriaAndNumbers` | резервирование серий и номеров |
| `PostInvoices` / `PostInvoicesWithAttachment` | загрузка пачки `<Documents>` |
| `CheckInvoicesStatus` | текущий статус по серии и номеру |
| `GetInvoicesBySeriaNumber` | XML фактуры |
| `GetInvoicesForSigning` | содержимое к подписанию для заданного `Order` |
| `GetInvoicesContentForPrint` | печатная форма, обычно PDF (base64) |
| `GetInvoicesQRcodes` | PNG QR-кода и ссылка на фактуру |
| `GetAcceptedInvoices` / `GetRejectedInvoices` / `GetArchivedInvoices` | входящие по состоянию |
| `PostAcceptedInvoices` / `PostRejectedInvoices` / `PostCanceledInvoices` | решения покупателя и отзыв поставщиком |
| `SearchInvoices` | поиск по статусу, IDNO, датам, `APIeInvoiceId` |
| `GetLogs` | журнал вызовов на стороне SFS |

## Коды

**Статус ответа** (`Status` в любом ответе): `1` принят к исполнению,
`2` выполнен, `3` ошибка. Сервис поднимает `3` как исключение, чтобы вызывающий
код не мог его пропустить.

**Статус фактуры** (`InvoiceStatus`):

| Код | Значение |
|---|---|
| 0 | черновик |
| 1 | подписана поставщиком |
| 2 | отклонена покупателем |
| 3 | принята покупателем |
| 5 | отозвана поставщиком |
| 7 | отправлена покупателю |
| 8 | подписана покупателем |
| 10 | доставлена (подписано получение товара/услуги) |

Терминальными сервис считает 3, 8 и 10 → состояние `confirmed`; 2 и 5 →
`canceled`.

**Ошибки `PostInvoices`** приходят в `ErrorMessage`: `1 - XML incorect`,
`2 - eroarea în timpul procesării`. Первую сервис считает неустранимой и не
тратит на неё повторы — отклонённый XML будет отклонён снова.

## Структура фактуры

```xml
<Documents>
  <Document>
    <SupplierInfo>
      <Seria>EAA</Seria>
      <Number>000005424</Number>
      <DeliveryDate>2026-08-24T09:00:00.000Z</DeliveryDate>
      <Supplier IDNO="..." TaxpayerType="1" Title="..." Address="...">
        <BankAccount Account="..." BranchTitle="..." BranchCode="..." />
      </Supplier>
      <Buyer IDNO="..." TaxpayerType="1" Title="..." Address="..." />
      <Transporter ... />            <!-- необязательно -->
      <DelegateName>...</DelegateName>
      <DelegateDate>...</DelegateDate>
      <Total>270.94</Total>
      <TotalTVA>30.24</TotalTVA>
      <Merchandises>
        <Row Code="" Name="" UnitOfMeasure="" Quantity=""
             UnitPriceWithoutTVA="" TotalPriceWithoutTVA=""
             TVA="" TotalTVA="" TotalPrice="" />
      </Merchandises>
      <IsFarma>false</IsFarma>
      <CreationMotiv>4</CreationMotiv>
    </SupplierInfo>
    <Signatures>...</Signatures>     <!-- если подписано -->
  </Document>
</Documents>
```

Расхождение в самом гайде: в разделе 4.12 `IsFarma` и `CreationMotiv` показаны
рядом с `SupplierInfo`, в разделе 5 — **внутри** него. Сервис следует разделу 5,
потому что именно эта форма хешируется и подписывается.

## Подпись

Модель из раздела 5 гайда: над документом считается хеш, он кладётся в
`<hash Id="_uuid">`, и на этот элемент по `Id` вешается enveloped-подпись
XMLDSig. Каждая следующая подпись добавляется новым `<SignatureContent>`, не
трогая предыдущие.

Алгоритмы в примерах: exclusive C14N, `rsa-sha1`, `sha1`, `PrefixList="#default
samlp saml ds xs xsi"`. Сервис поддерживает и `sha256` — на случай, когда SFS
уйдёт с sha1.

**Открытый вопрос.** Гайд не указывает, какие байты идут в `<hash>`. Реализация
берёт exclusive-C14N форму `<SupplierInfo>`; это изолировано в `hashInput()` в
`src/sign/xmldsig.ts`. Подтвердить на тестовой среде до продакшена: неверный хеш
`PostInvoices` примет, а проверка подписи отклонит позже — это гораздо более
дорогое место для обнаружения ошибки.

Для больших объёмов (свыше ~10 000 фактур в месяц) CTIF рекомендует сервис
автоматической подписи **PKI-Server** от STISC (поддержка 022 820911) — режим
`signing.mode: pkiserver`. Формат обмена STISC не публикует, поэтому весь
контакт с ним сведён в одну функцию `requestSignature()` в
`src/sign/pkiServer.ts`.

## Источники

* [Ghid de integrare Complet Automatizat (CTIF, PDF)](https://ctif.gov.md/sites/default/files/inline-files/Ghid%20integrare%20Complet-Automatizat.pdf)
* [Ghid de integrare Semi Automatizat (SFS, PDF)](https://efactura.sfs.md/Help/Ghid_integrare_Semi_Automatizata.pdf)
* [Интеграция учётных систем с новой версией e-Factura (CTIF)](https://www.ctif.gov.md/ro/integrarea-sistemelor-de-contabilitate-ale-agentilor-economici-cu-noua-versiune-sistemului-e)
* [Кабинет e-Factura](https://efactura.sfs.md/) · [портал электронных услуг](https://servicii.fisc.md/)
* WSDL продакшена: `https://efactura-api.sfs.md/Service.svc?singleWsdl`
