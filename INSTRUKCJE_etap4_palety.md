# Brief dla Claude Code — łączenie/wykończenie POZA rolotokiem (palety + 2 równoległe stanowiska)

## Kontekst
- Cała aplikacja jest w jednym pliku: **`src/main.jsx`** (~4750 linii, React + Three.js). Osobne narzędzie: **`edytor_stref.html`** (czysty HTML/JS, edytor rozmieszczenia stref hali).
- Aplikacja służy **inżynierom do mierzenia czasów** — symulacja musi pozostać poprawna (czasy, takt, wąskie gardło, przepustowość, eksport PDF).
- W `src/main.jsx` jest duży obiekt **`TUNE`** (strojenie). UWAGA: wartości czytane w pętli renderu 3D wymagają **pełnego reloadu** strony — Vite HMR nie podmienia ich w działającej pętli.

## Mapa obecnego kodu (warto znać przed zmianą)
- **Etapy**: `const baseStages` — obecnie 4: `0` „podmontaż koryt" (icon `locks`), `1` „montaż pionów" (`shelves`), `2` „montaż drzwi" (`lockers`), `3` „połączenie na podstawie, dachy" (`finalize`).
- **Symulacja**: `buildProductionSchedule(stages, count, travelTimes, measuredPartLength)`.
  - Każdy paczkomat = **dwie połowy**: `lead` i `trail` (osobne nośniki na linii).
  - Zasoby współdzielone (jedna połowa naraz): `stationFreeAt[]` (stacje), `segmentFreeAt[]` (odcinki), `entryFreeAt` (wjazd).
  - **Ostatnia stacja `finalStageIndex`** łączy parę: `lead` i `trail` schodzą się tam i kończą wspólnie (`pairFinish`), znikają po `COMPLETED_DISPLAY_SECONDS`.
  - Zwraca `leadUnits`/`trailUnits` z `segments` (entry/stage/travel, start/end) oraz metryki: `soloCycleTime`, `launchInterval` (takt = **max odstęp startów**), `totalTime`.
- **Metryki/UI**: komponent `Metrics` (panel), `renderTimesReportHtml` (PDF), `buildBottleneckRows`, `stageUtilization` (wykorzystanie = czas etapu / max etapu), `throughputPerHour/Shift`. Bottleneck podświetlany w 3D (mainline zone na czerwono — najdłuższy etap).
- **3D**: pętla renderu woła `placeHalf(model, unit, ...)` → `updateTwoPartLockerModel(...)`.
  - Wysokość modelu: `model.position.y = MODEL_LINE_Y + conveyorLift`, gdzie `conveyorLift` → `TUNE.standingY` w pionie na finale, `TUNE.horizontalLift` na etapach poziomych.
  - Rolotok/rolki budowane w `rebuildStatic`. Strefy stacji przy `routePoints` (etykiety z `MAINLINE_SECTORS`). Podstawa/dach/daszek montowane na finale (`parts.base`, `parts.roof`, `parts.canopy`...).
- **Geometria linii**: `buildLinePoints(stageCount)` → pozycje stacji (świat, oś z). Parametry: `TUNE.stationSpacing`, `TUNE.bufferSegment` (bufor po etapie), `TUNE.tightEarly`, `TUNE.stationNudge` (przesunięcie pojedynczej stacji). Mapowanie plan↔świat dla stref: `px = z/0.07 + 515` (planZScale 0.07, planCX 515).
- **Test regresji symulacji** (zalecany): wyciągnij `buildProductionSchedule` (esbuild bundle, alias `three/addons/*` → zaślepka, `three` core prawdziwy) i sprawdzaj niezmienniki: brak nakładania zasobów, czasy montażu == `durations`, czasy przejazdu == `travelTimes`, monotoniczność, metryki skończone.

## Co zmieniamy (zatwierdzone wymagania)
1. Etapy 0–2 — bez zmian (na rolotoku).
2. **Etap 3 = tylko WŁOŻENIE do podstawy.** Na końcu rolotoku stoi **paleta na ziemi** (na poziomie podłogi, NIE na rolkach), na niej podstawa. Z rolotoku obie połowy są **wstępnie wkładane** w podstawę na palecie. BEZ nitowania/dachu na rolotoku.
3. **Etap 4 = wykończenie POZA rolotokiem.** Paleta zjeżdża z końca rolotoku do **jednego z 2 równoległych, IDENTYCZNYCH stanowisk** (wybiera **pierwsze wolne**). Tam: nitowanie/skręcanie + dach + daszek + reszta. Stanowiska stoją **trochę dalej od rolotoku** (pole manewru).
4. Po wykończeniu paleta **odjeżdża**, podjeżdża następna. Rolotok **nie jest blokowany** wolnym etapem 4 — 2 stanowiska pracują równolegle.
5. **Łączenie obu połówek** przenosi się z rolotoku na etap 4 (nitowanie). Etap 3 tylko stawia/wkłada obie połowy w podstawę.

Efekt: etap 4 ma **2 równoległe stanowiska** → efektywna przepustowość etapu 4 = 2 / czas_etapu_4. To MUSI być w symulacji (takt, bottleneck, przepustowość, PDF).

## Plan w fazach (po KAŻDEJ: `npx vite build` + test + pełny reload dev)

### Faza 0 — konfiguracja etapów
- `baseStages`: zostaw 0–2; etap 3 = „Etap 3: włożenie w podstawę" (postawienie obu połówek na palecie, BEZ dachu); dodaj **„Etap 4: nitowanie + dach (poza linią)"** z nową ikoną (np. `offline`).
- Dodaj `TUNE.offline = { enabled: true, stationCount: 2, palletTravel: <sek>, stations: [<pozycje świata>], pallet: {<rozmiar/kolor>} }`.
- Zaktualizuj wszystko zależne od liczby etapów: `DEFAULT_TRAVEL_TIMES`, `bufferSegment.afterStage`, `tightEarly.untilStage`, `MAINLINE_SECTORS`.

### Faza 1 — SYMULACJA (najtrudniejsze, rób ostrożnie + testy)
- Etap 4 to **stacja OFFLINE z N równoległymi serwerami** (N = `stationCount`). Zamiast pojedynczego `stationFreeAt[final]` trzymaj **tablicę `offlineFreeAt[N]`**; przyjeżdżający paczkomat trafia na **najwcześniej wolny** serwer (`min`), czas zwolnienia = start + czas_etapu_4 (+ ewentualny dojazd palety).
- **Pairing**: para (lead+trail) spotyka się na **etapie 3** (włożenie do podstawy). Etap 4 to praca nad **całym, sparowanym** paczkomatem = jedno zadanie zajmujące jeden serwer offline. Przenieś logikę łączenia z dotychczasowego `finalStageIndex` na koniec etapu 3.
- **Poprawność**: żaden serwer offline nie obsługuje 2 palet naraz; takt linii = max(takt rolotoku, takt_offline = czas_etapu_4 / N). Zaktualizuj `launchInterval`, `soloCycleTime` (+ czas etapu 4 + dojazd), `totalTime`.
- **Metryki**: wykorzystanie etapu 4 względem **N serwerów** (obciążenie ≈ czas_etapu_4 / (takt × N)). Bottleneck: porównuj „czas / efektywna_liczba_serwerów" (etap z 2 stanowiskami ma 2× przepustowość). PDF + panel: oznacz etap 4 jako „×N równolegle".
- **Regresja/testy**: po zmianie test niezmienników (brak nakładania na KAŻDYM serwerze; durations/travel OK; metryki skończone). Dodaj test: przy 2 stanowiskach i wystarczającej liczbie sztuk takt etapu 4 ≈ czas_etapu_4 / 2.

### Faza 2 — etapy 0–3 bez dachu
- Z montażu na rolotoku **usuń dach/daszek/nitowanie**; etap 3 ma tylko postawić obie połowy na podstawie palety. Dach/daszek/nitowanie → etap 4.

### Faza 3 — ANIMACJA 3D (paleta + 2 stanowiska)
- **Paleta**: prosta geometria placeholder (płaska platforma/europaleta z belek; `BoxGeometry`). Łatwa do podmiany na GLB później (użytkownik wgra model). Parametry w `TUNE.offline.pallet`.
- **Paleta na ziemi na końcu rolotoku** (y≈poziom podłogi, nie na rolkach).
- **Etap 3**: obie połowy opadają/wkładane na podstawę na palecie na końcu rolotoku.
- **Ruch palety**: po etapie 3 paleta z paczkomatem jedzie do **wolnego** z 2 stanowisk (`TUNE.offline.stations[]`, trochę dalej od rolotoku). Animuj przejazd zsynchronizowany z harmonogramem (mode/segment etapu 4).
- **Na stanowisku**: montaż dachu/daszka + efekt nitowania (na razie: pojawienie się dachu/daszka). Po zakończeniu paleta odjeżdża, zwalnia stanowisko, podjeżdża następna.

### Faza 4 — EDYTOR `edytor_stref.html`
- Dodaj 2 stanowiska offline + paletę/ścieżkę jako element odniesienia (jak obecne stacje E0–E3), w układzie planu (`px = z/0.07 + 515`). Zaktualizuj etykiety.

## Weryfikacja po każdej fazie
- `npx vite build` musi przejść; repro renderu w Node (jsdom + zaślepka three) → brak białej strony.
- Test niezmienników symulacji + nowe testy równoległości.
- Wizualnie: **pełny reload** `npm run dev` (HMR nie podmienia pętli 3D).

## Założenia do potwierdzenia z użytkownikiem (jeśli niejasne)
- 2 stanowiska offline, identyczne, paleta na pierwsze wolne — **potwierdzone**.
- Łączenie obu połówek na etapie 4 (nitowanie); etap 3 tylko wkłada — potwierdzić w kodzie.
- **Liczba palet w obiegu**: czy ograniczona (np. 3–4) czy „zawsze wolna"? Domyślnie: palet wystarczająco, ograniczeniem są 2 stanowiska.
- **Czas dojazdu palety** rolotok→stanowisko: liczyć w takcie? Domyślnie dodaj mały, konfigurowalny `TUNE.offline.palletTravel`.

## Zasada pracy
Rób MAŁYMI krokami, po każdym `vite build` + test + pełny reload. Najpierw Faza 0 i 1 (z testami symulacji), bo są najbardziej ryzykowne; animacja (Faza 3) na końcu.
