// =====================================================================
// RDZEN SYMULACJI LINII (czysta logika, bez React / three-addons).
// Importuje TYLKO rdzen `three` (THREE.Vector3), wiec dziala rowniez w
// Node — dzieki temu harmonogram da sie testowac regresyjnie poza przegladarka
// (patrz test/simulation.test.mjs). main.jsx importuje stad wszystkie symbole.
// =====================================================================
import * as THREE from 'three';

// Domyslny czas pracy kazdego etapu. Zmiana tej jednej wartosci ustawia czas
// wszystkich etapow startowych oraz nowych etapow dodawanych w interfejsie.
export const DEFAULT_STAGE_SECONDS = 10;
export const DEFAULT_WORKER_EFFECT = {
  mode: 'percent',
  value: 15,
};
export const MIN_EFFECTIVE_STAGE_SECONDS = 0.1;

export const clampNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
};

export const clampPercent = (value) => Math.min(95, Math.max(0, clampNumber(value, 0)));

export const getEffectiveStageDuration = (baseDuration, workerCount, workerEffect) => {
  const safeBase = Math.max(clampNumber(baseDuration, DEFAULT_STAGE_SECONDS), MIN_EFFECTIVE_STAGE_SECONDS);
  const workers = Math.max(1, Math.round(Number(workerCount)) || 1);
  const extraWorkers = Math.max(0, workers - 1);
  const effectValue = clampNumber(workerEffect?.value, DEFAULT_WORKER_EFFECT.value);

  if (extraWorkers === 0 || effectValue <= 0) return safeBase;

  if (workerEffect?.mode === 'seconds') {
    return Math.max(MIN_EFFECTIVE_STAGE_SECONDS, safeBase - extraWorkers * effectValue);
  }

  const ratio = 1 - clampPercent(effectValue) / 100;
  return Math.max(MIN_EFFECTIVE_STAGE_SECONDS, safeBase * Math.pow(ratio, extraWorkers));
};

// Predkosc tasmy i progi czasow przejazdu/wejscia. Sa to czyste wartosci
// uzywane zarowno przez harmonogram, jak i przez animacje 3D (main.jsx).
export const CONVEYOR_UNITS_PER_SECOND = 1.42;
export const MIN_TRAVEL_SECONDS = 3.2;
export const ENTRY_TRAVEL_SECONDS = 2;
export const COMPLETED_DISPLAY_SECONDS = 5;
export const ASSEMBLY_LENGTH = 4.8;
// Wspolna skala calego paczkomatu (patrz main.jsx MODEL_RENDER_SCALE).
export const MODEL_RENDER_SCALE = 1.06;

// =====================================================================
// === STROJENIE NA ZYWO (Vite HMR) ===================================
// Zmien ktorakolwiek z tych liczb i ZAPISZ - Vite przeladuje scene od
// reki, bez nagrywania. Tu sa wszystkie pozycje, ktore dotad strzelalem
// na slepo. Ustaw je u siebie patrzac na render.
// UWAGA: wartosci czytane w petli renderu 3D wymagaja PELNEGO reloadu strony.
// ---------------------------------------------------------------------
export const TUNE = {
  // DROBNA korekta X zamkow [modul 0, modul 1]. Zamki sa AUTOMATYCZNIE stawiane
  // na zmierzonej pozycji WIEKSZEGO koryta kazdej polowy - ta wartosc to tylko
  // ewentualny nudge (np. zeby zamki wystawaly z powierzchni). 0 = na korycie.
  lockX: [0, 0],
  // Wysokosc dachu liczona od szczytu kolumny. Zwieksz = wyzej (gdy wnika),
  // zmniejsz = nizej (gdy lewituje).
  roofYOffset: -5.2,
  // Wysokosc daszka - ma byc lekko POD dachem (czyli mniej niz roofYOffset).
  canopyYOffset: -5.3,
  // PELNY obrot dachu/daszka [rotX, rotY, rotZ] w radianach. Model ma juz
  // gotowy skos - rotY = Math.PI obraca go na wlasciwa strone (okap na przod).
  // Gdyby skos byl po zlej stronie, daj rotY: 0. Obrot robiony w miejscu.
  roofRot: [Math.PI / 2, Math.PI, 0],
  canopyRot: [Math.PI / 2, Math.PI, 0],
  // PRZESUNIECIE dachu/daszka [x, y, z]. Obrot tylko obraca w miejscu - TYM
  // przesuwasz je nad drzwi (zielona strefa na zdjeciu). z = przod/tyl (nad
  // skrytki), x = lewo/prawo, y = gora/dol (dodatkowo do roof/canopyYOffset).
  roofOffset: [0, 0, 0.16],
  // Daszek domyslnie wysuniety na PRZEDNIA krawedz (z=0.7), zeby nie chowal sie
  // pod dachem. Gdyby trafil na tyl - zmien z na ujemne (np. -0.7).
  canopyOffset: [0, 0.1, 0.9],
  // Docelowa wysokosc (Y) sciany tylniej. Ujemne = nizej (na DOLE / z TYLU).
  // Sciana jest automatycznie sprowadzana w dol na ta wysokosc i wjezdza od dolu.
  backWallY: -0.76,
  // O ile gleboko pod spodem startuje sciana tylnia (montaz "od dolu").
  backWallDrop: 1.0,
  // Obrot sciany tylniej (radiany) - byla "do gory nogami", wiec domyslnie PI
  // (180 stopni). Gdyby trzeba bylo innej osi, daj znac.
  backWallRotX: Math.PI,
  // === Sekwencja: jedna czesc przed druga (#4 - OSOBNE OBIEKTY) ===
  // Druga polowa to TEN SAM paczkomat OPOZNIONY o tyle SEKUND - jedzie ta sama
  // trasa wlasna sciezka, wiec stoi na prawdziwej, wczesniejszej stacji (a nie
  // sztucznie przesunieta). Lider czeka na podstawie az dojedzie i sie zlacza.
  // Wieksze = druga polowa dalej z tylu. MUSI byc < ~7s (postoj lidera na
  // koncu), inaczej lider zniknie przed dolaczeniem.
  halfDelaySeconds: 4,
  partLagStages: 1,
  // O ile druga polowa jest cofnieta NA TASMIE (zeby jechala ZA pierwsza, a nie
  // obok). ~-17 = jedna pelna stacja w tyle; im bardziej ujemne, tym dalej za
  // pierwsza. Zanika przy laczeniu na podstawie. Jesli druga polowa wyjdzie z
  // PRZODU zamiast z tylu - ZMIEN ZNAK (np. 18). 0 = bez przesuniecia.
  partTrailSpacing: -18,
  // Gdy pierwsza polowa wchodzi w final, druga PODJEZDZA do bufora MIEDZY
  // etapem 3 a 4 i tam czeka (zamiast blokowac stacje etapu 3). To wartosc tego
  // bufora - mniej ujemna niz partTrailSpacing (np. polowa: -9).
  partTrailBuffer: -9,
  // Rozstaw stacji = DLUGOSC ROLOTOKU i odstepy miedzy czesciami. Domyslnie
  // bylo 7.6; zwieksz, gdy czesci na siebie nachodza (np. 12, 14, 16).
  stationSpacing: 20,
  // Dodatkowy bezpieczny luz ponad dlugosc polowy paczkomatu. Harmonogram
  // przelicza go na czas potrzebny do fizycznego zwolnienia stacji.
  partSafetyGap: 0.6,
  // Odstep miedzy KOLEJNYMI paczkomatami (w cyklach stacji). Po naprawie zajetosci
  // stacji (ogon) zwykle 0 wystarcza. Zwieksz, gdy paczkomaty nadal za blisko.
  launchGapStages: 0,
  // === Ostatni etap (stawianie pionowe) ===
  // Odstep X miedzy dwiema polowkami. DODATNIE = rozsuwa, UJEMNE = scala je
  // razem. Daj ujemne, gdy w srodku jest szpara / sciany sie rozjezdzaja.
  halfGapX: 0,
  // Pionowe dociagniecie stojacych kolumn (ujemne = nizej, gdy lewituja).
  columnSettleY: 0,
  // === KOREKTA POZYCJI FINALNEJ (czesci na podstawie) — strojenie milimetrowe ===
  // Dziala dopiero gdy polowy stoja na podstawie. Male wartosci, np. -0.02.
  finalNudgeX: 0.01,  // bok (X): + na zewnatrz, - do srodka
  finalNudgeZ: -0.08,  // wzdluz podstawy (Z): + do przodu, - do tylu
  finalNudgeY: 0.06,  // gora/dol (Y)
  // Przeswit drugiej polowy podczas dojazdu nad podstawe. Najpierw konczy ona
  // ruch w bok, a dopiero potem lagodnie opada na docelowa wysokosc. Zapobiega
  // to przenikaniu kolumny przez geometrie podstawy w trakcie laczenia.
  secondHalfApproachLift: 0.32,
  // Wysokosc CALEGO stojacego paczkomatu (podstawa + kolumny) wzgledem linii.
  // Ujemne opuszcza go, zeby PODSTAWA siadla na tasmociagu, a nie lewitowala.
  standingY: -0.4,
  // Wysokosc paczkomatu podczas montazu poziomego (etapy lezace). Lekko podniesione,
  // zeby plecy nie wpadaly w rolki. Wczesniej na stale 0.34.
  horizontalLift: 0.5,
  // Wysokosc koryt lezacych PRZED obrotem do pionu: wejscie, etap 0 i dojazd
  // do etapu 1. Ma byc na rolkach bez lewitacji, ale bez wpadania w rolotok.
  preTurnHorizontalLift: 0.36,
  // Obrot CALEJ czesci wokol dlugiej osi (radiany). Math.PI = czesc staje
  // prawidlowo (nie do gory nogami). Daj 0, gdyby przegielo w druga strone.
  partsRotY: Math.PI,
  // === POLKI (GLB polka.glb) ===
  shelfScale: 1,            // skala polki (gdy za duza/mala)
  shelfRotX: 0,   // obrot polki, by lezala plasko w poprzek kolumny
  shelfOffset: [0, 0.045, 0],   // drobne przesuniecie polki [x, y, z]
  // === DRZWI (GLB - 4 rozmiary) ===
  doorType: 'l',            // ktory rozmiar: 'xl' | 'l' | 's' | 'xs'
  doorScale: 0.95,             // skala drzwi
  doorRotX: Math.PI,         // 180° = do góry nogami              // obrot drzwi wokol X (gdy zle ustawione)
  doorRotY: 0,              // obrot drzwi wokol Y
  doorOffset: [0, 0.27, 0.2],    // drobne przesuniecie drzwi [x, y, z]
  // Szary odstep miedzy skrytkami (grubosc paska), zeby drzwi nie zlewaly sie
  // w jeden bialy prostokat. 0 = brak. Zwieksz, jesli ma byc wyrazniejszy.
  cellGap: 0.03,
  // Szerokosc separatora (X). Zmniejsz, gdy wystaje poza sciane boczna.
  cellGapWidth: 0.98,
  // Przesuniecie szarego separatora skrytek [x, y, z] - gdy wypada za wysoko/
  // za nisko albo nie na granicy drzwiczek.
  cellGapOffset: [0, -0.054, 0],
  // === SIATKA SKRYTEK (drzwi + polki) ===
  // Poczatek (Z) pierwszego rzedu skrytek i odstep miedzy rzedami. Zwieksz
  // odstep / przesun start, gdy skrytki nie wypelniaja kolumny (szpara u gory).
  // UWAGA KIERUNKU: strona +Z to DOL stojacej kolumny (ta wchodzi w podstawe),
  // strona -Z to GORA. 11 skrytek z zamkami wypelnia GORNE 4.4 ramy
  // (rowZ: -2.2..1.8; gora rowno z krawedzia -2.4), a dolne 0.4 (rowZ 1.8..2.4)
  // zajmuje plaska DOLNA polka (baseShelf) BEZ zamka i drzwi - dzieki temu dol
  // kolumny jest plaski, rowny z krawedzia i czysto siada na podstawie.
  cellRowStart: -2.2,
  cellRowSpacing: 0.4,
  // Przesuniecie (Z) plaskiej dolnej polki wzgledem jej domyslnej pozycji
  // (jeden rzad PONIZEJ ostatniej skrytki, przy dolnej krawedzi). + = nizej
  // (blizej podstawy), - = wyzej. Reguluj, gdy nie jest idealnie rowno z dolem.
  baseShelfNudgeZ: 0,
  // === KAMERA (OrbitControls) — katy i zakres zoomu ===
  camera: {
    minDistance: 5,                 // jak blisko mozna dojechac (zoom in)
    maxDistance: 110,               // jak daleko mozna oddalic (zoom out)
    minPolarAngle: 0.08,            // najwyzsze ujecie (0 = pion z gory)
    maxPolarAngle: Math.PI * 0.49,  // najnizsze ujecie (~plasko z boku); wieksze = nizej
    moveSpeed: 14,                  // predkosc przesuwania klawiszami WASD (jednostki/s)
  },
  // === OBROT KORYT DO PIONU (etap 2) — strojenie wygladu ===
  // portion: jaka czesc etapu trwa obrot (mniej = szybciej).
  // arcLift: chwilowe uniesienie w trakcie obrotu, by koryta nie szly przez rolki (np. 0.3).
  // pose0/pose1: pozycja KAZDEGO z dwoch koryt podczas lezenia. Zmniejsz offsetX,
  //   jesli jada za bardzo w bok / "zamieniaja sie"; rotationZ pose1 = 180 (obrot).
  troughTurn: {
    portion: 0.42,
    liftBefore: 0.24,
    settleAfter: 0.2,
    standLift: 0.82,
    arcLift: 0.42,  // unosi koryta nad rolki podczas naturalnego ustawiania
    posOffset0: [0, 0, 0], // przesuniecie koryta modulu 0 [x=bok, y=gora/dol, z=wzdluz]
    posOffset1: [0, 0, 0], // przesuniecie koryta modulu 1 [x, y, z]
    pose0: { rotationX: 0, rotationY: 0, rotationZ: 0, offsetX: 1.04, offsetY: 0.7, offsetZ: 0 },
    pose1: { rotationX: 0, rotationY: 0, rotationZ: 180, offsetX: 1.04, offsetY: -1.64, offsetZ: 0 },
    // Niezalezna, UTRWALONA korekta OSOBNO dla duzego i malego koryta (rot w stopniach, pos w metrach).
    // Dziala zawsze, tez w pionie — pozwala obracac/przesuwac kazdy typ koryta osobno.
    large: { rot: [0, 0, 0], pos: [0, 0, 0] }, // duze (srodkowe) koryto
    small: { rot: [0, 0, 0], pos: [0, 0, 0] }, // male koryto
  },
  // === PODSTAWA ===
  // Obrot i drobny offset modelu podstawy. Trafia tez do pomiaru wysokosci, wiec
  // zmiana tu naprawia jednoczesnie render i osadzenie na palecie.
  // Skladowa Z = obrot W POZIOMIE (wokol pionu swiata, po bazowym rotX 90):
  // PI = przerzucenie przodu/tylu podstawy o 180 stopni.
  baseRot: [Math.PI / 2, 0, Math.PI],
  baseOffset: [0, 0, 0],
  // === SCIANY BOCZNE ===
  // Obrot POJEDYNCZEJ sciany [rotX, rotY, rotZ] w radianach. Klucz "modul-faza"
  // ('0-first' = lewa sciana modulu 0, '0-second' = prawa, itd.). Domyslnie
  // wszystkie 0. Ustaw tej zle obroconej np. rotZ: Math.PI (profil) albo
  // rotX: Math.PI. Obrot jest robiony W MIEJSCU (z korekta pozycji).
  wallRot: {
    '0-first': [Math.PI, 0, Math.PI],
    '0-second': [0, 0, 0],
    '1-first': [0, 0, 0],
    '1-second': [0, 0, 0],
  },
  // Dosuniecie POJEDYNCZEJ sciany [x, y, z], gdy po obroceniu nie przylega.
  // Klucz "modul-faza" (jak wallRot). x = lewo/prawo, z = wzdluz, y = gora/dol.
  wallOffset: {
    '0-first': [0.08, 0, 0],
    '0-second': [0, 0, 0],
    '1-first': [0, 0, 0],
    '1-second': [0, 0, 0],
  },
  // === BUFOR NA ROLOTOKU (wizualny odcinek przelotowy) ===
  // Wydluza tasme miedzy etapami, tworzac pusty odcinek bufora obok Strefy
  // napraw, przez ktory elementy po prostu przejezdzaja. NIE zmienia logiki
  // skladania - przesuwa tylko geometrie stacji (i stref) za buforem.
  bufferSegment: {
    enabled: true,
    afterStage: 1,    // bufor po tym etapie (1 = Montaz pionow), przed nastepnym
    extraLength: 9,   // dodatkowa dlugosc rolotoku (swiat) = dlugosc bufora
    planPx: 99999,    // wylaczone: px->swiat liniowo wszedzie (edytor jest WYSIWYG)
    colorInset: 2.5,  // o ile (swiat) skrocic kolorowanie rolek z KAZDEJ strony, zeby
                      // zaczynalo sie za krawedzia obszaru montazowego, nie na srodku.
  },
  // === ZAGESZCZENIE WCZESNYCH ETAPOW ===
  // Skraca odstep miedzy poczatkowymi etapami. 'untilStage' zostaje na miejscu,
  // a wczesniejsze etapy dosuwaja sie do niego odstepem 'spacing'. Reszta linii
  // (bufor, pozniejsze stacje, strefy) bez zmian.
  tightEarly: {
    untilStage: 1,  // etapy <= tego sa zageszczone (1 = etapy 0,1 blizej siebie)
    spacing: 11,    // odstep miedzy wczesnymi etapami (pelny stationSpacing = 20)
  },
  // === ETAP 0 STATYCZNY (podmontaz koryt NA STOLE, poza rolotokiem) ===
  // Wg planu hali podmontaz koryt to statyczne stanowisko - rolotok zaczyna sie
  // dopiero od montazu pionow (etap 1). Stol stoi w miejscu stacji etapu 0.
  // Koryto POJAWIA SIE na stole (bez tasmy wejsciowej), sklada sie W MIEJSCU,
  // a po podmontazu znika ze stolu i pojawia sie na poczatku skroconego
  // rolotoku, skad normalnie dojezdza do etapu 1. Harmonogram/czasy bez zmian -
  // "przejazd 0->1" to teraz czas przeniesienia na linie + dojazd.
  staticFirstStage: {
    enabled: true,
    // Wymiary stolu warsztatowego (swiat). topY = wysokosc blatu, domyslnie
    // rowna wysokosci rolek rolotoku, zeby koryto lezalo na tej samej wysokosci.
    table: { width: 3.4, depth: 6.0, topY: 1.85 },
    // Ile rolotoku (swiat) jest PRZED stacja etapu 1 - odcinek dojazdowy.
    // Rolotok zaczyna sie w [pozycja etapu 1] - conveyorLeadIn.
    conveyorLeadIn: 7,
    // O ile (swiat) W GLAB rolotoku od jego poczatku pojawia sie czesc po
    // zdjeciu ze stolu (zeby nie wystawala przed pierwsza rolke).
    appearInset: 2.8,
    // Czesc czasu przejazdu 0->1 spedzana jeszcze NA STOLE (zdejmowanie),
    // zanim czesc pojawi sie na rolotoku. 0.35 = 35% czasu przejazdu.
    transferPortion: 0.35,
    // Wysokosc, z jakiej koryto "opada" na stol przy pojawianiu sie (wjazd).
    dropInHeight: 0.5,
  },
  // Precyzyjne przesuniecie POJEDYNCZEJ stacji wzdluz linii (swiat, +z = w strone
  // finalnego). Indeks = etap. Nie zmienia czasow ani bufora, tylko pozycje stacji
  // (strefa montazowa + pracownicy). Tu: Montaz drzwi (E2) odsuniety od strefy Drzwi.
  stationNudge: [0, 0, 6, 0],
  // === ETAP 3: STOL UCHYLNY / WYWROTNICA (stawianie do pionu) ===
  // Wg planu hali ("Stol do zmiany orientacji pionow") czesc zjezdza z rolotoku
  // na stol uchylny dopchniety do konca tasmy. Stawianie do pionu = obrot
  // CALEGO STOLU o 90 stopni wokol zawiasu przy podlodze (od strony palety),
  // przez co czesc idealnie wpada do podstawy stojacej na palecie za stolem.
  // Dla drugiej polowy paleta przesuwa sie LEKKO w bok (drugie gniazdo
  // podstawy trafia pod stol), a po wlozeniu obu wraca na os linii.
  // Harmonogram/czasy bez zmian - to czysto wizualna mechanika etapu 3.
  tiltTable: {
    enabled: true,
    // Podzial czasu etapu 3 (frakcje 0-1):
    settlePortion: 0.15,  // lezenie na stole przed obrotem (i okno przesuwu palety)
    tiltPortion: 0.55,    // obrot stolu 0 -> 90 stopni (wlozenie w podstawe)
    returnPortion: 0.25,  // powrot PUSTEGO stolu do poziomu (po zwolnieniu czesci)
    // O ile (swiat) rolotok konczy sie PRZED stacja etapu 3 - robi miejsce na
    // stol (czesc zsuwa sie z ostatnich rolek prosto na blat).
    conveyorCut: 3.2,
    // Wyglad stolu uchylnego.
    table: {
      width: 3.4,        // szerokosc blatu w poprzek linii
      thickness: 0.16,   // grubosc blatu
      extraLength: 0.5,  // zapas dlugosci blatu poza obrys lezacej czesci
    },
    // Reczna korekta pozycji zawiasu [y, z] (swiat) - tylko wyglad stolu,
    // sciezka czesci liczona jest niezaleznie (zawsze trafia w podstawe).
    hingeNudge: [0, 0],
  },
  // === ETAP OFFLINE (wykonczenie POZA rolotokiem: nitowanie + dach) ===
  // Ostatni etap nie jest stacja na rolotoku, tylko N rownoleglych, identycznych
  // stanowisk obok konca tasmy. Paleta z calym (sparowanym) paczkomatem zjezdza
  // na PIERWSZE WOLNE stanowisko, tam jest wykanczana, po czym odjezdza.
  offline: {
    enabled: true,
    stationCount: 2,        // liczba rownoleglych stanowisk wykonczeniowych (serwerow)
    palletTravel: 6,        // czas (s) dojazdu palety: koniec rolotoku -> stanowisko
    // Czas (s) PRZEZBROJENIA stanowiska = ile trwa zjazd GOTOWEJ palety, zanim
    // wjedzie nastepna. Serwer jest zajety do konca tego czasu, dzieki czemu nowa
    // paleta nie najezdza na poprzednia (jej animacja odjazdu zdazy sie skonczyc).
    changeover: 4,
    // Pozycje stanowisk w swiecie {x, z} (y=0 = podloga). Trzymane ZA koncem
    // rolotoku i rozsuniete na boki (pole manewru). Te same wspolrzedne edytuje
    // edytor_stref.html. Domyslnie koniec rolotoku jest ~z=39, stad z=54.
    stations: [
      { x: -8, z: 54 },
      { x: 8, z: 54 },
    ],
    // Placeholder palety (europaleta z belek). Latwy do podmiany na GLB.
    pallet: { width: 2.6, depth: 3.2, height: 0.32, color: '#9a6b3f' },
    // --- strojenie wizualne (wszystko czytane w petli renderu -> pelny reload) ---
    // Wysokosc (Y, swiat) stojacego paczkomatu na palecie. Reguluj, gdy podstawa
    // lewituje nad paleta lub w nia wnika. ~ wysokosc palety + drobny offset.
    modelY: 0.42,
    // Automatyczne centrowanie ustawia srodek widocznego paczkomatu na srodku
    // palety. Ten offset sluzy tylko do drobnego, recznego dostrojenia [x,y,z].
    modelOffset: [0, 0, 0],
    // Wysokosc luku podczas opuszczania polowek z rolotoku na palete w etapie 3.
    landingLift: 0.72,
    // Dystans (swiat), o jaki paleta odjezdza ze stanowiska po wykonczeniu.
    leaveDistance: 9,
    // Paleta stojaca na koncu rolotoku (miejsce wlozenia w podstawe, etap 3).
    showEndPallet: true,
    // O ile (swiat) paleta na koncu rolotoku jest ZA ostatnia stacja, wzdluz linii.
    // Ostatnia stacja jest POD podniesiona tasma — paleta musi stac DALEJ, na
    // ziemi za koncem rolotoku, zeby spuszczac na nia paczkomaty. Zwieksz, gdy
    // paleta wchodzi pod tasme; zmniejsz, gdy odjechala za daleko.
    endPalletGap: 5,
  },
  // === STREFY HALI (sektory wg planu od przelozonego) ===
  // Koloruje i opisuje obszary robocze wokol linii. Pozniej w wybrane strefy
  // wstawimy modele pracownikow - kazda strefa ma gotowy pusty 'sectorSlot'.
  sectors: {
    show: true,        // wlacz / wylacz wszystkie strefy
    opacity: 0.22,     // przezroczystosc kolorowego wypelnienia (0-1)
    width: 3.6,        // szerokosc strefy w poprzek linii (X)
    depth: 3.0,        // glebokosc strefy wzdluz linii (Z)
    outward: 1.1,      // dodatkowe odsuniecie strefy na zewnatrz od operatora
    // --- pracownicy przy stanowiskach linii glownej (liczba sterowana w panelu UI) ---
    workersPerStationDefault: 1,        // domyslna liczba dla nowych stacji
    workerSpacing: 1.15,                // odstep miedzy pracownikami na tej samej stronie
    labelHeight: 1.55, // wysokosc unoszacej etykiety nad podloga
    // --- powierzchnia hali ---
    floorWidth: 46,    // szerokosc podlogi hali w poprzek linii (X)
    floorDepthPad: 86, // zapas dlugosci podlogi wzdluz linii (Z) - powiekszony, zeby
                        // zmiescic odsuniety bufor podstaw (patrz bufferPx nizej)
    floorCenterX: -6,  // przesuniecie srodka podlogi (plan ma wiecej stref na dole)
    // --- mapowanie PLANU hali na swiat (strefy peryferyjne) ---
    // Kazdy sektor ma w danych pozycje z planu (px,py). Te liczby przeliczaja
    // piksele planu na metry sceny. planCX/planCY = srodek planu (os = linia).
    planCX: 515,
    planCY: 180,
    planZScale: 0.07,   // wzdluz linii: wieksze = strefy bardziej rozsuniete
    planXScale: 0.07,   // w poprzek = wzdluz (jednolita skala -> ksztalty jak w planie)
    planGap: 1.5,       // staly odstep stref od linii montazowej (cofa je od stanowisk)
    // --- bufor podstaw (siatka miejsc na palety) ---
    // bufferPx odsuniety z 1400 na 1530 - przy 1400 bufor nachodzil na
    // Stanowisko 2 (etap offline), patrz TUNE.offline.stations. Podloga
    // (floorDepthPad wyzej) powiekszona, zeby bufor nadal miescil sie w calosci.
    bufferPx: 1530,     // pozycja bufora w planie (px) - za koniec rolotoku, poza Blendy/Dachy
    bufferPy: 85,       // pozycja bufora w planie (py)
    bufferCols: 4,      // liczba miejsc wzdluz
    bufferRows: 2,      // liczba miejsc w poprzek
    bufferCell: 3.8,    // rozmiar jednego miejsca na palete
  },
};
// =====================================================================

// Normalizacja argumentu "stages": przyjmujemy TABLICE etapow (preferowane -
// pozwala wykryc etap offline po ikonie) albo sama LICZBE etapow (legacy;
// wtedy zakladamy, ze ostatni etap MOZE byc offline, jak dotychczas).
const stageInfo = (stagesOrCount) => {
  if (Array.isArray(stagesOrCount)) {
    return {
      count: stagesOrCount.length,
      lastIsOffline: stagesOrCount[stagesOrCount.length - 1]?.icon === 'offline',
    };
  }
  return { count: Number(stagesOrCount) || 0, lastIsOffline: true };
};

// Czy ostatni etap jest etapem OFFLINE (poza rolotokiem). Sterowane IKONA
// ostatniego etapu ('offline') - usuniecie etapu offline z listy automatycznie
// wylacza cala mechanike (harmonogram, stanowiska, dojazd palety), a dodanie
// etapu z ikona 'Wykonczenie poza linia' na koncu wlacza ja z powrotem.
// Wymaga tez TUNE.offline.enabled i co najmniej 2 etapow.
export const isOfflineEnabled = (stagesOrCount) => {
  const { count, lastIsOffline } = stageInfo(stagesOrCount);
  return Boolean(TUNE.offline?.enabled) && lastIsOffline && count >= 2;
};

// Liczba rownoleglych serwerow offline (>=1).
export const getOfflineServerCount = () =>
  Math.max(1, Math.round(TUNE.offline?.stationCount ?? 1));

// Indeks etapu offline (ostatni) albo -1, gdy offline wylaczony.
export const getOfflineStageIndex = (stagesOrCount) =>
  isOfflineEnabled(stagesOrCount) ? stageInfo(stagesOrCount).count - 1 : -1;

// Indeks OSTATNIEJ stacji NA ROLOTOKU. Gdy offline wlaczony, jest to etap przed
// offline (tu para lead+trail laczy sie na podstawie palety). Gdy offline
// wylaczony, jest to po prostu ostatni etap (stare zachowanie).
export const getConveyorFinalIndex = (stagesOrCount) =>
  isOfflineEnabled(stagesOrCount)
    ? stageInfo(stagesOrCount).count - 2
    : stageInfo(stagesOrCount).count - 1;

export const buildLinePoints = (stagesOrCount) => {
  const count = stageInfo(stagesOrCount).count;
  // Rozstaw stacji = dlugosc rolotoku. Wiekszy = dluzsza tasma i wieksze
  // odstepy miedzy czesciami (zeby nie nachodzily). Strojone przez TUNE.
  // UWAGA: etap offline (ostatni, gdy wlaczony) NIE jest stacja rolotoku, wiec
  // nie dostaje punktu na linii — punkty obejmuja tylko stacje rolotoku.
  const conveyorCount = isOfflineEnabled(stagesOrCount) ? Math.max(count - 1, 1) : count;
  const n = Math.max(conveyorCount, 1);
  const spacing = TUNE.stationSpacing ?? 7.6;
  const startZ = -((n - 1) * spacing) / 2;
  // Bufor: dodatkowa dlugosc rolotoku po etapie 'afterStage'. Czas/logika
  // sa niezmienione - to tylko geometria.
  const buf = TUNE.bufferSegment ?? {};
  const bufExtra = (buf.enabled ?? false) ? (buf.extraLength ?? 0) : 0;
  const bufAfter = buf.afterStage ?? -1;
  // Pozycja "bazowa" (rownomierna) etapu i.
  const base = (i) => startZ + i * spacing + (i > bufAfter ? bufExtra : 0);
  // Zageszczenie wczesnych etapow: 'untilStage' (anchor) zostaje na miejscu,
  // a wczesniejsze etapy dosuwaja sie do niego mniejszym odstepem 'spacing'.
  const tight = TUNE.tightEarly ?? {};
  const anchor = Math.min(tight.untilStage ?? -1, n - 1);
  const tightSpacing = tight.spacing ?? spacing;

  const nudge = TUNE.stationNudge ?? [];
  return Array.from({ length: n }, (_, i) => {
    const z = (i >= anchor ? base(i) : base(anchor) - (anchor - i) * tightSpacing) + (nudge[i] ?? 0);
    return new THREE.Vector3(0, 0.55, z);
  });
};

export const getTravelDurations = (stagesOrCount) => {
  const points = buildLinePoints(stagesOrCount);

  return points.slice(0, -1).map((point, index) => {
    const distance = point.distanceTo(points[index + 1]);
    return Math.max(MIN_TRAVEL_SECONDS, distance / CONVEYOR_UNITS_PER_SECOND);
  });
};

// Domyslny czas dojazdu miedzy etapami = 2 s (mozna zmienic w UI / Tasmociag).
export const DEFAULT_TRAVEL_SECONDS = 2;
// Domyslne czasy przejazdu kolejnych przejazdow ROLOTOKU: E0->E1, E1->E2, E2->E3.
// (Dojazd palety na etap offline jest osobny: TUNE.offline.palletTravel.)
export const DEFAULT_TRAVEL_TIMES = [3, 7, 3];
export const getDefaultTravelTimes = (stagesOrCount) =>
  getTravelDurations(stagesOrCount).map((_, index) => DEFAULT_TRAVEL_TIMES[index] ?? DEFAULT_TRAVEL_SECONDS);

export const normalizeTravelTimes = (travelTimes, stagesOrCount) => {
  const defaults = getDefaultTravelTimes(stagesOrCount);

  return defaults.map((defaultTime, index) => Math.max(0.1, clampNumber(travelTimes[index], defaultTime)));
};

export const buildProductionSchedule = (
  stages,
  count,
  travelTimes = [],
  measuredPartLength = ASSEMBLY_LENGTH * MODEL_RENDER_SCALE,
) => {
  const stageCount = stages.length;
  const unitCount = Math.max(1, count);
  const travelDurations = normalizeTravelTimes(travelTimes, stages);

  // --- Konfiguracja etapu OFFLINE (wykonczenie poza rolotokiem) ---
  const offlineEnabled = isOfflineEnabled(stages);
  const offlineStageIndex = getOfflineStageIndex(stages);
  const offlineServerCount = offlineEnabled ? getOfflineServerCount() : 0;
  const palletTravel = offlineEnabled ? Math.max(TUNE.offline?.palletTravel ?? 0, 0) : 0;
  // Przezbrojenie stanowiska offline = czas zjazdu gotowej palety zanim wjedzie
  // nastepna (serwer zajety do offlineEnd + changeover). Zapobiega nakladaniu sie
  // palet na stanowisku w trakcie animacji odjazdu.
  const offlineChangeover = offlineEnabled ? Math.max(TUNE.offline?.changeover ?? 0, 0) : 0;
  // Ostatnia stacja ROLOTOKU = tu para lead+trail laczy sie na podstawie palety.
  const conveyorFinalIndex = getConveyorFinalIndex(stages);

  if (stageCount === 0) {
    return {
      units: [],
      leadUnits: [],
      trailUnits: [],
      totalTime: 0.1,
      launchInterval: 0.1,
      soloCycleTime: 0.1,
      travelDurations,
      pairHeadway: 0,
      finalStageIndex: -1,
      conveyorFinalIndex: -1,
      offlineStageIndex: -1,
      offlineServerCount: 0,
      offlineTakt: 0,
      partMinimumGap: 0,
    };
  }

  // Kazda polowa jest osobnym nosnikiem produkcyjnym. Stacje i odcinki miedzy
  // nimi sa wspolnymi zasobami, wiec w danej chwili moze z nich korzystac tylko
  // jedna polowa. Ostatnia stacja ROLOTOKU jest wyjatkiem: wpuszcza sparowany
  // ogon po zakonczeniu podnoszenia lidera, aby obie czesci mogly sie zlaczyc.
  const stationFreeAt = Array(stageCount).fill(0);
  const segmentFreeAt = Array(Math.max(stageCount - 1, 0)).fill(0);
  // N rownoleglych serwerow offline; kazdy zwalnia sie niezaleznie.
  const offlineFreeAt = Array(Math.max(offlineServerCount, 0)).fill(0);
  let entryFreeAt = 0;
  let finalStationFreeAt = 0;
  const leadUnits = [];
  const trailUnits = [];

  const stageCycle = Math.max(stages[0]?.duration ?? 0.1, 0.1)
    + (travelDurations[0] ?? MIN_TRAVEL_SECONDS);
  const lagFromStages = Math.max(TUNE.partLagStages ?? 0, 0) * stageCycle;
  const lagFromDistance = (
    Math.abs(TUNE.partTrailSpacing ?? 0)
    / Math.max(TUNE.stationSpacing ?? 7.6, 0.1)
  ) * stageCycle;
  const pairHeadway = Math.max(
    TUNE.halfDelaySeconds ?? 0,
    lagFromStages,
    lagFromDistance,
    0.1,
  );
  const productHeadway = Math.max(
    pairHeadway,
    Math.max(TUNE.launchGapStages ?? 0, 0) * stageCycle,
  );
  // Indeks ostatniej stacji na ktorej polowa fizycznie sie zatrzymuje na rolotoku.
  const finalStageIndex = conveyorFinalIndex;
  // Wszystkie modele GLB sa normalizowane do ASSEMBLY_LENGTH, a nastepnie
  // renderowane w skali MODEL_RENDER_SCALE. To daje rzeczywista dlugosc
  // nosnika na linii; dodajemy do niej regulowany margines bezpieczenstwa.
  const partMinimumGap = Math.max(measuredPartLength, 0.1)
    + Math.max(TUNE.partSafetyGap ?? 0, 0);
  const stationSpacing = Math.max(TUNE.stationSpacing ?? 7.6, partMinimumGap + 0.01);
  // Rzeczywiste odleglosci miedzy kolejnymi stacjami NA LINII (nie nominalny
  // TUNE.stationSpacing!) - roznia sie od niego przez zageszczenie wczesnych
  // etapow (tightEarly) i bufor (bufferSegment). Uzywane do policzenia, kiedy
  // odjezdzajaca czesc FIZYCZNIE oddala sie od stacji o partMinimumGap - inaczej
  // (np. przy skroconym tightEarly) stacja "zwalnia sie" na papierze zanim
  // czesc naprawde zjedzie, i kolejna wjezdza prosto w nia (nakladanie sie).
  const linePoints = buildLinePoints(stages);
  const segmentDistances = linePoints.slice(0, -1).map(
    (point, index) => point.distanceTo(linePoints[index + 1]),
  );
  const getClearanceDuration = (travelDuration, stageIndex) => {
    const distance = Math.max(segmentDistances[stageIndex] ?? stationSpacing, partMinimumGap + 0.01);
    const distanceRatio = Math.min(Math.max(partMinimumGap / distance, 0), 0.98);
    // Odwrotnosc easing: 0.5 - cos(progress * PI) / 2.
    const progress = Math.acos(1 - 2 * distanceRatio) / Math.PI;
    return travelDuration * progress;
  };
  const finalBufferDelay = (
    Math.abs(TUNE.partTrailBuffer ?? 0) / stationSpacing
  ) * (travelDurations[Math.max(finalStageIndex - 1, 0)] ?? MIN_TRAVEL_SECONDS);

  const scheduleHalf = ({ number, role, desiredStart, finalEarliest }) => {
    const segments = [];
    // Nie wpuszczamy kolejnej polowy na odcinek wejsciowy, dopoki poprzednia
    // NIE ZDAZYLA JUZ FIZYCZNIE oddalic sie od stacji 0 (stationFreeAt[0]).
    // UWAGA: entry NIE zaczyna sie wczesniej "o ENTRY_TRAVEL_SECONDS" - taka
    // wersja pozwalala nowej czesci zaczac dojazd, zanim poprzednia naprawde
    // zwolnila miejsce, i obie animacje (dojazd + odjazd) nakladaly sie w
    // czasie, przejezdzajac przez siebie na styku stacji 0/1 (widoczne
    // "wjezdzanie" nowego koryta w stare). Start dopiero PO stationFreeAt[0]
    // gwarantuje pelny odstep przez caly czas trwania obu animacji.
    const entryStart = Math.max(
      desiredStart,
      entryFreeAt,
      stationFreeAt[0] ?? 0,
      0,
    );
    let arrivalAtStage = entryStart + ENTRY_TRAVEL_SECONDS;
    entryFreeAt = arrivalAtStage;

    segments.push({
      type: 'entry',
      resource: 'entry',
      start: entryStart,
      end: arrivalAtStage,
      duration: ENTRY_TRAVEL_SECONDS,
    });

    let finishTime = arrivalAtStage;
    // Petla obejmuje tylko stacje ROLOTOKU (0..conveyorFinalIndex). Etap offline
    // jest planowany osobno dla calej sparowanej jednostki (ponizej).
    for (let stageIndex = 0; stageIndex <= finalStageIndex; stageIndex += 1) {
      const duration = Math.max(stages[stageIndex]?.duration ?? 0, 0.1);
      const isFinalStage = stageIndex === finalStageIndex;
      const stationAvailableAt = isFinalStage
        ? finalEarliest
        : stationFreeAt[stageIndex] ?? 0;
      const assemblyStart = Math.max(arrivalAtStage, stationAvailableAt);
      const assemblyEnd = assemblyStart + duration;
      const hasNextStage = stageIndex < finalStageIndex;

      if (!hasNextStage) {
        segments.push({
          type: 'stage',
          resource: `station:${stageIndex}`,
          stageIndex,
          start: assemblyStart,
          assemblyEnd,
          end: assemblyEnd,
          duration,
        });
        finishTime = assemblyEnd;
        break;
      }

      const travelDuration = travelDurations[stageIndex] ?? MIN_TRAVEL_SECONDS;
      const approachesFinalStage = stageIndex + 1 === finalStageIndex;
      const destinationDepartureGate = approachesFinalStage
        // Dojazd do finalu zaczyna sie dopiero po zwolnieniu stanowiska przez
        // poprzedni produkt albo po zakonczeniu podnoszenia sparowanego lidera.
        ? finalEarliest
        // Na zwyklej stacji rowniez nie wjezdzamy w strefe dojazdowa, dopoki
        // poprzednia polowa nie odsunie sie o pelna bezpieczna odleglosc.
        : stationFreeAt[stageIndex + 1] ?? 0;
      const travelStart = Math.max(
        assemblyEnd,
        segmentFreeAt[stageIndex] ?? 0,
        destinationDepartureGate,
      );
      const travelEnd = travelStart + travelDuration;

      segments.push({
        type: 'stage',
        resource: `station:${stageIndex}`,
        stageIndex,
        start: assemblyStart,
        assemblyEnd,
        end: travelStart,
        duration,
      });
      segments.push({
        type: 'travel',
        resource: `segment:${stageIndex}`,
        from: stageIndex,
        to: stageIndex + 1,
        start: travelStart,
        end: travelEnd,
        duration: travelDuration,
      });

      // Stacja jest wolna dopiero, gdy srodek wyjezdzajacej polowy oddali sie o
      // jej pelna dlugosc + margines. Zapobiega zetknieciu na granicy stacji.
      stationFreeAt[stageIndex] = travelStart + getClearanceDuration(travelDuration, stageIndex);
      segmentFreeAt[stageIndex] = travelEnd;
      arrivalAtStage = travelEnd;
      finishTime = travelEnd;
    }

    return {
      number,
      role,
      key: `${number}`,
      startTime: segments[0]?.start ?? desiredStart,
      finishTime,
      segments,
    };
  };

  let desiredLeadStart = 0;
  for (let unitIndex = 0; unitIndex < unitCount; unitIndex += 1) {
    const number = unitIndex + 1;
    const lead = scheduleHalf({
      number,
      role: 'lead',
      desiredStart: desiredLeadStart,
      finalEarliest: finalStationFreeAt,
    });
    const leadFinal = lead.segments.find(
      (segment) => segment.type === 'stage' && segment.stageIndex === finalStageIndex,
    );
    const trail = scheduleHalf({
      number,
      role: 'trail',
      desiredStart: lead.startTime + pairHeadway,
      // Ogon moze wjechac na final dopiero, gdy lider zakonczyl podnoszenie.
      // partTrailBuffer jest odlegloscia bufora przeliczana na czas dojazdu.
      finalEarliest: Math.max(
        finalStationFreeAt,
        (leadFinal?.assemblyEnd ?? 0) + finalBufferDelay,
      ),
    });
    const trailFinal = trail.segments.find(
      (segment) => segment.type === 'stage' && segment.stageIndex === finalStageIndex,
    );

    // --- Para laczy sie na ostatniej stacji ROLOTOKU (wlozenie w podstawe) ---
    // Wlozenie obu polowek w podstawe konczy sie, gdy obie skoncza montaz na
    // stacji finalnej rolotoku. To moment, w ktorym sparowana paleta jest gotowa.
    const insertionDone = Math.max(
      leadFinal?.assemblyEnd ?? lead.finishTime,
      trailFinal?.assemblyEnd ?? trail.finishTime,
    );

    if (offlineEnabled) {
      // Para zjezdza paleta na PIERWSZE WOLNE stanowisko offline (min z N serwerow).
      let serverIndex = 0;
      for (let s = 1; s < offlineFreeAt.length; s += 1) {
        if (offlineFreeAt[s] < offlineFreeAt[serverIndex]) serverIndex = s;
      }
      const offlineDuration = Math.max(stages[offlineStageIndex]?.duration ?? 0, 0.1);
      const serverFreeAt = offlineFreeAt[serverIndex] ?? 0;
      // BACK-PRESSURE: paczkomat NIE rusza z konca rolotoku, dopoki najwczesniej
      // wolne stanowisko offline nie bedzie gotowe go przyjac w chwili dojazdu.
      // Praca zaczyna sie max(gotowy + dojazd, serwer wolny). Paleta CZEKA na
      // etapie 3 (blokujac stacje) az do chwili wyjazdu — dzieki temu, gdy oba
      // stanowiska sa zajete, kolejny paczkomat czeka, a nie najezdza na zajete.
      const offlineStart = Math.max(insertionDone + palletTravel, serverFreeAt);
      const palletArrive = offlineStart;
      const palletDepart = offlineStart - palletTravel; // >= insertionDone (czeka na E3)
      const offlineEnd = offlineStart + offlineDuration;
      // Serwer offline zajety od startu pracy az do KONCA PRZEZBROJENIA (zjazdu
      // gotowej palety). Dopiero wtedy moze wjechac nastepna — bez nakladania sie.
      // palletTravel to latencja dojazdu, nie zajetosc serwera.
      offlineFreeAt[serverIndex] = offlineEnd + offlineChangeover;

      const pairFinish = offlineEnd + offlineChangeover;

      // Segment dojazdu palety (lead+trail jada razem) + praca na stanowisku.
      // Dodawany do OBU polowek, bo na palecie stoi caly, sparowany paczkomat.
      [
        { unit: lead, finalSeg: leadFinal },
        { unit: trail, finalSeg: trailFinal },
      ].forEach(({ unit, finalSeg }) => {
        // Stacja rolotoku zwalnia sie, gdy paleta rusza do offline.
        if (finalSeg) finalSeg.end = palletDepart;
        unit.segments.push({
          type: 'palletTravel',
          resource: null,
          from: finalStageIndex,
          serverIndex,
          start: palletDepart,
          end: palletArrive,
          duration: Math.max(palletArrive - palletDepart, 0.0001),
        });
        // Serwer offline trzyma rezerwacje TYLKO na czas pracy [start, koniec].
        unit.segments.push({
          type: 'offline',
          resource: `offline:${serverIndex}`,
          stageIndex: offlineStageIndex,
          serverIndex,
          start: offlineStart,
          assemblyEnd: offlineEnd,
          end: offlineEnd,
          duration: offlineDuration,
        });
        // Zjazd/prezentacja gotowego paczkomatu (paleta odjezdza ze stanowiska).
        // Trwa dokladnie tyle co przezbrojenie, wiec nastepna paleta wjezdza
        // dopiero gdy ta zniknie. resource=null — para (lead+trail) jedzie razem.
        unit.segments.push({
          type: 'offlineDone',
          resource: null,
          stageIndex: offlineStageIndex,
          serverIndex,
          start: offlineEnd,
          end: pairFinish,
          duration: Math.max(offlineChangeover, 0.0001),
        });
        unit.finishTime = pairFinish;
      });

      // Ostatnia stacja ROLOTOKU jest wolna dla nastepnej pary, gdy paleta ruszy.
      finalStationFreeAt = palletDepart;
      stationFreeAt[finalStageIndex] = palletDepart;
    } else {
      // Stare zachowanie: ostatni etap to stacja rolotoku, na ktorej para sie
      // laczy i prezentuje gotowy paczkomat przez COMPLETED_DISPLAY_SECONDS.
      const pairFinish = insertionDone + COMPLETED_DISPLAY_SECONDS;
      if (leadFinal) leadFinal.end = pairFinish;
      if (trailFinal) trailFinal.end = pairFinish;
      lead.finishTime = pairFinish;
      trail.finishTime = pairFinish;
      finalStationFreeAt = pairFinish;
      stationFreeAt[finalStageIndex] = pairFinish;
    }

    leadUnits.push(lead);
    trailUnits.push(trail);
    desiredLeadStart = trail.startTime + productHeadway;
  }

  const firstStarts = leadUnits.map((unit) => unit.startTime);
  const startGaps = [];
  for (let i = 1; i < firstStarts.length; i += 1) {
    startGaps.push(firstStarts[i] - firstStarts[i - 1]);
  }
  // Takt USTALONY rolotoku: odstep startow w STANIE USTALONYM (po rozbiegu pustej
  // linii). Bierzemy OGON odstepow (druga polowa) i USREDNIAMY go: przy back-
  // pressure od etapu offline pierwszy zablokowany start daje chwilowy przeskok
  // wiekszy niz takt graniczny, a przy N rownoleglych stanowiskach kolejne starty
  // przeplataja sie wokol taktu — srednia ogona daje stabilna wartosc graniczna.
  // Dla malej liczby sztuk (brak ustalenia) uzywamy wszystkich odstepow.
  let steadyTakt = Math.max(stages[0]?.duration ?? 0, 0.1);
  if (startGaps.length) {
    const tail = startGaps.length >= 4
      ? startGaps.slice(Math.ceil(startGaps.length / 2))
      : startGaps;
    const avgTail = tail.reduce((sum, gap) => sum + gap, 0) / tail.length;
    steadyTakt = Math.max(steadyTakt, avgTail);
  }
  // Takt OFFLINE: N rownoleglych stanowisk daje przepustowosc N / cykl_stanowiska.
  // Cykl stanowiska = czas pracy + przezbrojenie (zjazd palety). Efektywny odstep
  // miedzy ukonczeniami = (czas_etapu_offline + przezbrojenie) / N.
  const offlineTakt = offlineEnabled
    ? (Math.max(stages[offlineStageIndex]?.duration ?? 0, 0.1) + offlineChangeover)
      / Math.max(offlineServerCount, 1)
    : 0;
  // Takt linii = max(takt rolotoku, takt offline). To realne ograniczenie tempa.
  const launchInterval = Math.max(steadyTakt, offlineTakt, 0.1);

  // Cykl jednej sztuki: suma czasow etapow + przejazdy rolotoku + wejscie +
  // (dla offline) dojazd palety + prezentacja gotowego paczkomatu.
  const soloCycleTime =
    stages.reduce((sum, stage) => sum + Math.max(stage.duration, 0.1), 0)
    + travelDurations.reduce((sum, duration) => sum + duration, 0)
    + ENTRY_TRAVEL_SECONDS
    + palletTravel
    + COMPLETED_DISPLAY_SECONDS;

  return {
    // `units` pozostaje aliasem liderow dla istniejacych metryk/UI.
    units: leadUnits,
    leadUnits,
    trailUnits,
    totalTime: Math.max(leadUnits[leadUnits.length - 1]?.finishTime ?? soloCycleTime, 0.1),
    launchInterval: Math.max(launchInterval, 0.1),
    soloCycleTime: Math.max(soloCycleTime, 0.1),
    travelDurations,
    pairHeadway,
    // `finalStageIndex` pozostaje OSTATNIA STACJA ROLOTOKU (gdzie laczy sie para)
    // dla zgodnosci z dotychczasowymi metrykami i kodem 3D.
    finalStageIndex,
    conveyorFinalIndex,
    offlineStageIndex,
    offlineServerCount,
    offlineTakt,
    palletTravel,
    partMinimumGap,
  };
};

export const validateScheduleReservations = (schedule) => {
  const reservations = [];
  const carriers = [
    ...(schedule.leadUnits ?? []),
    ...(schedule.trailUnits ?? []),
  ];

  carriers.forEach((carrier) => {
    carrier.segments.forEach((segment) => {
      if (!segment.resource || segment.end <= segment.start) return;
      reservations.push({
        resource: segment.resource,
        start: segment.start,
        end: segment.end,
        number: carrier.number,
        role: carrier.role,
      });
    });
  });

  const conflicts = [];
  for (let index = 0; index < reservations.length; index += 1) {
    const current = reservations[index];
    for (let otherIndex = index + 1; otherIndex < reservations.length; otherIndex += 1) {
      const other = reservations[otherIndex];
      if (current.resource !== other.resource) continue;
      const overlap = Math.min(current.end, other.end) - Math.max(current.start, other.start);
      if (overlap <= 0.0001) continue;

      // Para (lead+trail) o tym samym numerze wspoldzieli ostatnia stacje rolotoku
      // (laczenie na podstawie) ORAZ stanowisko offline (jada na nim razem na palecie).
      const sharesPairedStation =
        (current.resource === `station:${schedule.finalStageIndex}`
          || (current.resource ?? '').startsWith('offline:'))
        && current.number === other.number
        && current.role !== other.role;
      if (sharesPairedStation) continue;

      conflicts.push({
        resource: current.resource,
        first: `${current.number}:${current.role}`,
        second: `${other.number}:${other.role}`,
        overlap,
      });
    }
  }

  return conflicts;
};
