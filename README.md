# Kolejka do zadań

Prosta kolejka zapisów do zadań. Node.js (≥ 22) + SQLite (`better-sqlite3`), bez frameworka.

## Uruchomienie

```bash
npm install
npm test          # testy jednostkowe
npm start         # serwer na 127.0.0.1:5432 (ustawienia w config.json)
```

Na VPS serwer nasłuchuje tylko na `127.0.0.1` – wystaw go przez reverse proxy (np. nginx z TLS). Jeśli proxy jest przed aplikacją, ustaw `server.trustProxy: true`, żeby rate limit działał per klient, a nie per proxy.

## Docker

```bash
docker compose up -d --build                              # serwer na 127.0.0.1:5432
docker compose exec -it kolejka npm run admin:passwd      # ustawia hasło do panelu admina
docker compose exec kolejka npm run next                  # kończy zadanie
docker compose exec kolejka npm run reset -- --yes        # nowa kolejka (kopia w volume)
```

Bez Dockera grupy: `podman compose` / `podman build -t kolejka .` działają tak samo.

Przed pierwszym `docker compose up` utwórz `whitelist.yaml` (patrz niżej). Jeśli go nie ma, Docker utworzy na jego miejscu katalog i kontener nie wystartuje z sensowną listą.

Dane są w named volume `kolejka-data` (`/app/data`), więc przetrwają restart i przebudowę obrazu. Host i port w kontenerze ustawiają zmienne `KOLEJKA_HOST` / `KOLEJKA_PORT` (nadpisują `config.json`). Kontener działa jako użytkownik `node`, z read-only rootfs i bez capabilities.

Uwaga: za portem opublikowanym przez Dockera adres klienta to adres bramki Dockera. Przy `server.trustProxy: false` rate limit jest więc wspólny dla wszystkich. Jeśli stawiasz przed kontenerem reverse proxy, ustaw `trustProxy: true` w `config.json`.

## Zasady kolejki

- Na listę uprawnionych mogą wejść tylko osoby z pliku `whitelist.yaml` (ścieżka: `whitelist.file` w `config.json`). Utwórz go z `whitelist.example.yaml`: jedna osoba w wierszu, zaczynając od `- `. Dopasowanie nie zależy od wielkości liter ani od nadmiarowych spacji.
- Plik jest sprawdzany przy starcie, który kończy się błędem, gdy plik nie istnieje, nie jest listą albo ma błędne wpisy (np. znaczniki HTML). Później zmiany wczytują się same przy następnym zapisie. Błędna edycja zostawia poprzednią poprawną listę i zapisuje błąd w logach.
- Usunięcie osoby z pliku blokuje jej kolejne zapisy, ale nie usuwa jej z kolejki.
- Pusta lista (`[]`) oznacza, że nikt się nie zapisze.
- W Dockerze plik jest montowany jako `/app/whitelist.yaml` w trybie tylko do odczytu. Jeśli edytor zastąpi plik nowym (częste w vim), zrób `docker compose restart kolejka`, bo bind mount trzyma stary plik.
- Strona najpierw pyta o imię i nazwisko, potem pokazuje panel z przyciskiem „Zapisz się”.
- Jedna osoba może zapisać się raz na czas ustawiony w panelu admina (domyślnie `queue.joinCooldownMs` z `config.json`, czyli 60 s). Limit jest na osobę, nie na adres IP, bo za Dockerem wszyscy mają ten sam IP.
- Osoba może zapisać się ponownie, także gdy jest już w kolejce. Każde zgłoszenie to nowy wpis z aktualną liczbą zapisów tej osoby.
- Kolejność: najpierw liczba zapisów w chwili zgłoszenia (rosnąco), potem czas zgłoszenia. Nowa osoba z mniejszą liczbą zapisów wskakuje przed wszystkich, którzy mają ich więcej.
- Istniejące wpisy osoby się nie przesuwają, gdy ta sama osoba zapisze się ponownie.

## Panel admina

Panel jest pod `/admin`. Ustaw hasło przed pierwszym użyciem:

```bash
npm run admin:passwd      # min. 12 znaków, pytanie dwukrotnie, bez echa na TTY
```

Panel pozwala dodać osobę do kolejki (także ponownie tę samą – admin może dopisać kogoś kilka razy), usunąć wybraną pozycję, usunąć wszystkie zapisy danej osoby (przycisk „Usuń wszystkie zapisy”: czyści jej wpisy w kolejce i zeruje licznik zapisów, historia zostaje), zakończyć zadanie przyciskiem „Następny”, zmienić hasło i ustawić czas między zapisami. Zmiana hasła unieważnia wszystkie sesje. Lista w panelu odświeża się sama co 5 s, także gdy ktoś inny się zapisze.

Czas między zapisami (pole „Co ile sekund można się ponownie zapisać”, 0 = bez limitu, max 3600 s) zapisuje się w tabeli `settings` i działa od razu, bez restartu. Dopóki nie zmienisz go w panelu, obowiązuje `queue.joinCooldownMs` z `config.json` (domyślnie 60 s). Limit dotyczy zapisów publicznych; dodawanie przez admina go omija.

Sekcja „Lista uprawnionych” w panelu została usunięta – whitelistę edytujesz w `whitelist.yaml`. Admin może dodać do kolejki tylko osoby z tego pliku. Reset kolejki nie rusza pliku.

„Następny” usuwa pierwszą osobę z kolejki i zapisuje ją w historii (imię i liczba zapisów z chwili dołączenia). Historia jest widoczna pod kolejką w panelu (ostatnie 200 wpisów). Reset kolejki czyści też historię.

Przycisk „Resetuj wszystko” (czerwony) robi to samo co `npm run reset -- --yes`: zapisuje kopię zapasową i czyści kolejkę, historię oraz listę osób (zgodnie z `reset.clearParticipants`). Hasło administratora zostaje.

- Sesja to ciasteczko `HttpOnly`, `SameSite=Strict`, ważne `admin.sessionMinutes` (domyślnie 8 h). Sesje są w pamięci, więc restart serwera wylogowuje admina.
- `admin.cookieSecure: true` (domyślnie) wymaga HTTPS. Na lokalnym HTTP ustaw `false`, inaczej przeglądarka nie zapisze ciasteczka.
- Logowanie i zmiana hasła mają rate limit (`admin.loginRateLimit`, domyślnie 5 prób na 15 min na IP). Próby wspólnie wyczerpują ten sam limit.

## Zarządzanie

```bash
npm run next                 # kończy zadanie: usuwa osobę z początku kolejki
npm run reset -- --yes       # czyści kolejkę i zaczyna nową (z kopią zapasową)
```

Opcje resetu są w sekcji `reset` w `config.json`:
- `backup` – czy zrobić kopię bazy przed resetem (katalog `backupDir`),
- `clearParticipants` – `true` usuwa wszystkie osoby, `false` tylko zeruje liczniki zapisów.

Reset można uruchomić przy działającym serwerze. Reset nie rusza hasła administratora (tabela `settings`), więc hasło zostaje po resecie.

## Bezpieczeństwo

- Walidacja imion: sanityzacja, nie wzorzec. Sprawdzane są typ, długość (`name.maxLength`), znaki sterujące i `<`/`>`. Dopuszczenie osoby decyduje whitelista z `whitelist.yaml`.
- Zapytania SQL wyłącznie sparametryzowane.
- Hasło admina: scrypt (`settings.admin_password_hash`), nie w `config.json`.
- Tylko `application/json`, limit rozmiaru body (`maxBodyBytes`), timeouty żądań.
- Rate limit na zapis (`rateLimit`).
- Statyczne pliki tylko z zamkniętej listy – brak dostępu do plików po ścieżce.
- Nagłówki: CSP, `X-Frame-Options: DENY`, `nosniff`, `no-store`.
- Frontend renderuje dane przez `textContent`.
- Panel admina: sesja w ciasteczku, rate limit logowania, ochrona przed CSRF przez `SameSite=Strict` i JSON-only API. Wszystkie dane z API są wstawiane przez `textContent`.
- Reset z panelu wymaga sesji admina i potwierdzenia (`confirm: "RESET"` w API oraz okno `confirm()` w przeglądarce).
