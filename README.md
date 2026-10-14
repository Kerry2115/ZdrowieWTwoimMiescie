<<<<<<< HEAD
# Zdrowie w Twoim Mieście — React + Node.js + SQLite

Realizacja etapu II, punktów 2.1 i 2.2. React (Vite) jest frontendem, Express backendem JS, a SQLite lokalną bazą danych.

## Wymagania
Node.js 22+ (zalecane LTS), npm. Nie potrzeba Pythona ani osobnego serwera SQL.

## Uruchomienie w PowerShell
```powershell
cd C:\Users\forte\Desktop\ZWTM
npm install
npm run install:all
cd server
npm run migrate
npm run seed
cd ..
npm run dev
```
Otwórz http://localhost:5173 (API na http://localhost:3001/api/health).

## Testy
`npm test`

## Baza
Plik `server/data/zwtm.db` powstaje lokalnie. Migracje SQL są w `server/migrations`, skrypt `npm run migrate` prowadzi ewidencję zastosowanych migracji. Tabele: users, facilities, services, favorites, saved_searches, alerts, local_statistics, api_cache. Klucze obce są włączone. Dane demonstracyjne są fikcyjne.

## Integracje
- `GET /api/nfz/queues?province=14&benefit=PORADNIA%20KARDIOLOGICZNA&limit=10` → publiczne API NFZ
- `GET /api/gus/units?name=Poznań` → publiczne API BDL GUS
- `GET /api/facilities?city=Poznań` → lokalna baza SQLite
- `GET /api/facilities/:id` → pojedyncza placówka
- `GET /api/health` → stan serwera

Backend ma timeout 8 s, obsługę HTTP/błędów JSON i cache odpowiedzi w SQLite (TTL 15 min). Cache obejmuje identyczne zapytania po URL. Wersja demonstracyjna nie zapisuje automatycznie wyników NFZ/GUS do tabel placówek. CeZ/Rejestr Aptek pozostaje do wdrożenia po potwierdzeniu aktualnego publicznego endpointu.

## Uwagi
Wymaga dostępu do internetu dla NFZ i GUS. Punkt 2.3 (czyszczenie i parsowanie danych) i pełny CRUD z 2.4 nie są objęte tym etapem.

