# Zdrowie w Twoim Mieście — React + Node.js + SQLite

Realizacja etapu II, punktów 2.1–2.4. React (Vite) jest frontendem, Express backendem JS, a SQLite lokalną bazą danych.

## Uruchomienie

Wymagany Node.js 22+ i npm. W folderze projektu:

```powershell
npm install
npm run install:all
npm run dev
```

## Testy
Uruchom z katalogu głównego projektu poleceniem `npm test`. Testy obejmują REST API, walidację i obsługę błędów, normalizację danych, cache integracji oraz utworzenie bazy i danych demonstracyjnych od zera.

## Baza
Plik `server/data/zwtm.db` powstaje lokalnie. Migracje SQL są w `server/migrations`, skrypt `npm run migrate` prowadzi ewidencję zastosowanych migracji. Tabele: users, facilities, services, favorites, saved_searches, alerts, gus_units, local_statistics, api_cache. Klucze obce są włączone. Dane demonstracyjne są fikcyjne.

SQLite wybrano jako lokalną, plikową bazę danych, aby projekt można było uruchomić bez osobnej usługi bazy. Główne relacje: `services.facility_id` wskazuje placówkę, ulubione łączą użytkowników z placówkami, zapisane wyszukiwania należą do użytkowników, a alerty odwołują się do zapisanych wyszukiwań i użytkowników. Klucze unikalne zapobiegają duplikowaniu placówek dla tego samego źródła i identyfikatora oraz powtarzaniu tej samej specjalności w obrębie jednej placówki. Klucze obce są włączone, a usunięcie placówki usuwa powiązane usługi i ulubione.

Migracje można bezpiecznie uruchamiać wielokrotnie. Każda zastosowana migracja jest zapisywana w `schema_migrations`; `npm run seed` najpierw uruchamia migracje, a potem dodaje idempotentne dane demonstracyjne. Aby sprawdzić odtworzenie bazy od zera, użyj nowej ścieżki `DB_PATH` i uruchom migracje oraz seed na tej ścieżce.

## Integracje
- `GET /api/nfz/queues?province=14&benefit=PORADNIA%20KARDIOLOGICZNA&limit=10` → publiczne API NFZ
- `GET /api/gus/units?name=Poznań` → publiczne API BDL GUS
- `POST /api/nfz/import` → pobranie, normalizacja i zapis danych NFZ do placówek i usług SQLite; ciało JSON przyjmuje parametry `province`, `benefit`, `case`, `limit` i `page`
- `POST /api/gus/import` → pobranie, normalizacja i zapis jednostek BDL GUS do tabeli `gus_units`; ciało JSON przyjmuje pole `name`
- `GET /api/facilities?city=Poznań` → lokalna baza SQLite
- `GET /api/facilities/:id` → pojedyncza placówka
- `POST /api/facilities` → utworzenie placówki
- `PUT /api/facilities/:id` → pełna aktualizacja placówki
- `PATCH /api/facilities/:id` → częściowa aktualizacja placówki
- `DELETE /api/facilities/:id` → usunięcie placówki
- `GET /api/health` → stan serwera

Odpowiedzi sukcesu używają pola `data`. Błędy mają format `{ "error": { "code": "...", "message": "..." } }`. Tworzenie i pełna aktualizacja placówki wymagają pól `source`, `external_id`, `name` i `type`; pola `city`, `street`, `postal_code`, `phone`, `latitude` i `longitude` są opcjonalne. `PUT` zastępuje całą placówkę, a pominięte pola opcjonalne ustawia na `null`; `PATCH` zmienia tylko podane pola.

### Przetwarzanie danych z API
Moduł `server/src/data-processing.js` normalizuje wyniki NFZ i GUS przed zwróceniem ich klientowi. Dla NFZ oczyszcza tekst, sprawdza rekordy i współrzędne, normalizuje datę oraz oznacza liczbę odrzuconych rekordów. Niepoprawne współrzędne i brakujące wartości opcjonalne są zamieniane na `null`; rekord NFZ bez poprawnej struktury lub nazwy placówki jest pomijany. Wyniki GUS są sprawdzane pod kątem listy jednostek, identyfikatora i nazwy. Odpowiedź API zawiera podsumowanie `normalization.accepted` i `normalization.rejected`.

`GET /api/nfz/queues` i `GET /api/gus/units` nie zapisują danych w bazie. Zapis jest jawny przez endpointy importu; znormalizowane jednostki GUS oraz placówki i usługi NFZ są zapisywane transakcyjnie. Dane placówek są łączone po źródle i stabilnym identyfikatorze NFZ (lub znormalizowanej nazwie i adresie), jednostki GUS po identyfikatorze BDL, a usługi po placówce i specjalności. Ponowny import aktualizuje istniejące rekordy zamiast tworzyć duplikaty. `local_statistics.gus_unit_id` ma klucz obcy do `gus_units.id`; migracja zachowuje starsze identyfikatory, tworząc dla nich wpisy zastępcze do czasu pobrania aktualnych nazw z GUS.

Integracje mają timeout 8 s, sprawdzają status HTTP i format JSON oraz zwracają błędy w jednolitym formacie backendu. Surowe odpowiedzi są przechowywane wyłącznie jako cache techniczny SQLite przez 15 minut; do tabel domenowych trafiają dane po normalizacji. Równoległe identyczne żądania współdzielą to samo pobranie. Używane publiczne źródła to API kolejek NFZ oraz API jednostek terytorialnych BDL GUS; dostęp do nich wymaga internetu.

## Uwagi
Dane demonstracyjne są fikcyjne. Testy nie wysyłają rzeczywistych żądań do NFZ ani GUS — komunikację, cache i przetwarzanie testują na kontrolowanych odpowiedziach.
