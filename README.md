# Linia_Produkcyjna_Paczkomat

Wizualizacja 3D linii produkcyjnej paczkomatu (Vite + React + three.js).

Dokumentacja dla inżynierów: **`public/dokumentacja.html`** — dostępna pod
adresem aplikacji, np.
https://linia-produkcyjna-paczkomat.vercel.app/dokumentacja.html
(w aplikacji: przycisk „?” przy kontrolkach zoomu).

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # dist/
npm test
```

## Strefy hali (edycja layoutu bez zmian w kodzie)

Źródłem prawdy dla stref peryferyjnych (podmontaże, komponenty, magazyny,
naprawa, kąciki czystości) jest plik **`public/config/strefy.json`**.
Aplikacja wczytuje go przy starcie — **nie trzeba niczego wklejać do kodu
ani przebudowywać aplikacji**.

### Jak zmienić layout

1. Otwórz wizualizację i kliknij przycisk ✏️ (linijka/ołówek) przy kontrolkach
   zoomu — otworzy się **edytor stref** (`/edytor_stref.html`, np.
   https://linia-produkcyjna-paczkomat.vercel.app/edytor_stref.html).
   Edytor sam wczytuje aktualne strefy.
2. Przeciągaj / dodawaj / usuwaj strefy; każdej strefie można nadać własny
   kolor (pole „Kolor”, przycisk „↺ typ” wraca do koloru typu). Przy włączonym
   „podglądzie na żywo” wizualizacja 3D w drugiej karcie aktualizuje się
   w trakcie edycji.
3. Kliknij **„💾 Zapisz do aplikacji”** — strefy zapisują się w przeglądarce
   (localStorage) i wizualizacja używa ich od razu oraz po każdym kolejnym
   otwarciu na tym komputerze.
4. Żeby zmiany trafiły do **wszystkich** (inne komputery, nowe wdrożenie),
   kliknij **„⤓ strefy.json”** i podmień pobranym plikiem
   `public/config/strefy.json` (w wersji zbudowanej: `dist/config/strefy.json`).

Priorytet danych w aplikacji: nowszy z pary (zapis edytora w localStorage,
`config/strefy.json`); gdy żadnego nie ma — wbudowany fallback w `src/main.jsx`.
Przycisk „↺ Z pliku” w edytorze odrzuca zapis lokalny i wraca do pliku JSON.

> Edytor musi być otwarty przez adres aplikacji (http), nie z dysku (file://),
> żeby mógł czytać JSON i komunikować się z wizualizacją.
