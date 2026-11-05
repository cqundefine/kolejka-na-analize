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

Dane są w named volume `kolejka-data` (`/app/data`), więc przetrwają restart i przebudowę obrazu. Host i port w kontenerze ustawiają zmienne `KOLEJKA_HOST` / `KOLEJKA_PORT` (nadpisują `config.json`). Kontener działa jako użytkownik `node`, z read-only rootfs i bez capabilities.

Uwaga: za portem opublikowanym przez Dockera adres klienta to adres bramki Dockera. Przy `server.trustProxy: false` rate limit jest więc wspólny dla wszystkich. Jeśli stawiasz przed kontenerem reverse proxy, ustaw `trustProxy: true` w `config.json`.

## Zasady kolejki

- Imię i nazwisko są wymagane: co najmniej dwa wyrazy, tylko litery, a wewnątrz wyrazu także `'`, `’` i `-`. Długość po normalizacji: 3–64 znaki.
- Strona najpierw pyta o imię i nazwisko, potem pokazuje panel z przyciskiem „Zapisz się”.
- Jedna osoba może zapisać się raz na `queue.joinCooldownMs` (domyślnie 60 s). Limit jest na osobę, nie na adres IP, bo za Dockerem wszyscy mają ten sam IP.
- Osoba może zapisać się ponownie, także gdy jest już w kolejce. Każde zgłoszenie to nowy wpis z aktualną liczbą zapisów tej osoby.
- Kolejność: najpierw liczba zapisów w chwili zgłoszenia (rosnąco), potem czas zgłoszenia. Nowa osoba z mniejszą liczbą zapisów wskakuje przed wszystkich, którzy mają ich więcej.
- Istniejące wpisy osoby się nie przesuwają, gdy ta sama osoba zapisze się ponownie.

## Panel admina

Panel jest pod `/admin`. Ustaw hasło przed pierwszym użyciem:

```bash
npm run admin:passwd      # min. 12 znaków, pytanie dwukrotnie, bez echa na TTY
```

Panel pozwala dodać osobę (także ponownie tę samą – admin może dopisać kogoś kilka razy), usunąć wybraną pozycję, zakończyć zadanie przyciskiem „Następny” i zmienić hasło. Zmiana hasła unieważnia wszystkie sesje. Lista w panelu odświeża się sama co 5 s, także gdy ktoś inny się zapisze.

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

- Walidacja imion: regex `\p{L}[\p{L}'’-]*` dla każdego wyrazu, minimum dwa wyrazy; znaki sterujące, cyfry i znaczniki HTML są odrzucane.
- Zapytania SQL wyłącznie sparametryzowane.
- Hasło admina: scrypt (`settings.admin_password_hash`), nie w `config.json`.
- Tylko `application/json`, limit rozmiaru body (`maxBodyBytes`), timeouty żądań.
- Rate limit na zapis (`rateLimit`).
- Statyczne pliki tylko z zamkniętej listy – brak dostępu do plików po ścieżce.
- Nagłówki: CSP, `X-Frame-Options: DENY`, `nosniff`, `no-store`.
- Frontend renderuje dane przez `textContent`.
- Panel admina: sesja w ciasteczku, rate limit logowania, ochrona przed CSRF przez `SameSite=Strict` i JSON-only API. Wszystkie dane z API są wstawiane przez `textContent`.
- Reset z panelu wymaga sesji admina i potwierdzenia (`confirm: "RESET"` w API oraz okno `confirm()` w przeglądarce).
