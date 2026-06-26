// Test regresji RDZENIA SYMULACJI (harmonogram linii) — uruchamiany w Node.
// Uruchom:  node test/simulation.test.mjs
// Sprawdza niezmienniki: brak nakladania zasobow (tez serwerow offline),
// czasy montazu == durations, czasy przejazdu == travelTimes, monotonicznosc,
// metryki skonczone, oraz rownoleglosc etapu offline (takt ≈ czas/N).
import {
  buildProductionSchedule,
  validateScheduleReservations,
  getDefaultTravelTimes,
  TUNE,
} from '../src/simulation.js';

let failures = 0;
let checks = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ok = (cond, msg) => {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.error('  ✗ ' + msg);
  }
};

const makeStages = (durations) =>
  durations.map((d, i) => ({ id: `s${i}`, name: `Etap ${i}`, duration: d, icon: i === durations.length - 1 ? 'offline' : 'box' }));

// Zbiera wszystkie segmenty z rezerwacja zasobu (lead + trail).
const reservations = (schedule) => {
  const out = [];
  [...schedule.leadUnits, ...schedule.trailUnits].forEach((u) => {
    u.segments.forEach((s) => {
      if (s.resource && s.end > s.start) out.push({ ...s, number: u.number, role: u.role });
    });
  });
  return out;
};

function runScenario(name, durations, count, fn) {
  const stages = makeStages(durations);
  const travel = getDefaultTravelTimes(stages.length);
  const schedule = buildProductionSchedule(stages, count, travel);
  console.log(`\n[${name}] etapy=${durations.join(',')} szt=${count}`);

  // --- 1. Brak nakladania rezerwacji (oficjalny walidator) ---
  const conflicts = validateScheduleReservations(schedule);
  ok(conflicts.length === 0, `brak konfliktow rezerwacji (znaleziono ${conflicts.length}: ${JSON.stringify(conflicts.slice(0,2))})`);

  // --- 2. Brak nakladania na KAZDYM serwerze offline z osobna ---
  const byResource = {};
  reservations(schedule).forEach((r) => {
    (byResource[r.resource] ??= []).push(r);
  });
  Object.entries(byResource).forEach(([res, list]) => {
    if (!res.startsWith('offline:')) return;
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i += 1) {
      // Lead+trail tej SAMEJ sztuki dziela serwer (jeden paczkomat na palecie) —
      // to celowe wspoldzielenie, nie konflikt. Sprawdzamy tylko ROZNE sztuki.
      if (list[i].number === list[i - 1].number) continue;
      ok(list[i].start >= list[i - 1].end - 1e-6,
        `serwer ${res}: sztuka ${list[i].number} startuje ${list[i].start.toFixed(2)} przed zwolnieniem przez sztuke ${list[i-1].number} (${list[i-1].end.toFixed(2)})`);
      // 2b. PRZEZBROJENIE: nastepna paleta nie wjezdza, dopoki poprzednia nie
      // zjedzie (offlineEnd + changeover). Dzieki temu nie najezdzaja na siebie.
      const changeover = TUNE.offline.changeover ?? 0;
      ok(list[i].start >= list[i - 1].end + changeover - 1e-6,
        `serwer ${res}: sztuka ${list[i].number} wjezdza ${list[i].start.toFixed(2)} przed zjazdem poprzedniej (koniec ${list[i-1].end.toFixed(2)} + przezbrojenie ${changeover})`);
    }
  });

  // --- 3. Czasy montazu == durations; 4. czasy przejazdu == travel; 5. monotonicznosc ---
  schedule.leadUnits.forEach((u) => {
    let prevEnd = -Infinity;
    u.segments.forEach((s) => {
      ok(s.end >= s.start - 1e-9, `segment ${s.type} ma end<start`);
      ok(s.start >= prevEnd - 1e-6, `monotonicznosc naruszona w ${s.type} (start ${s.start} < prevEnd ${prevEnd})`);
      prevEnd = s.end;
      if (s.type === 'stage' || s.type === 'offline') {
        ok(approx(s.assemblyEnd - s.start, s.duration, 1e-6),
          `czas montazu ${s.type}@${s.stageIndex}: ${(s.assemblyEnd - s.start).toFixed(3)} != ${s.duration}`);
      }
      if (s.type === 'travel') {
        ok(approx(s.end - s.start, s.duration, 1e-6),
          `czas przejazdu seg${s.from}: ${(s.end - s.start).toFixed(3)} != ${s.duration}`);
      }
    });
  });

  // --- 6. Metryki skonczone i dodatnie ---
  ['totalTime', 'launchInterval', 'soloCycleTime'].forEach((k) => {
    ok(Number.isFinite(schedule[k]) && schedule[k] > 0, `metryka ${k} skonczona i dodatnia (jest ${schedule[k]})`);
  });

  if (fn) fn(schedule);
  return schedule;
}

console.log('=== TEST REGRESJI SYMULACJI ===');

// Scenariusz A: standardowy (5 etapow, offline ostatni), wiele sztuk.
runScenario('A: standard 5 etapow', [10, 10, 10, 10, 10], 6, (schedule) => {
  ok(schedule.offlineStageIndex === 4, `offlineStageIndex == 4 (jest ${schedule.offlineStageIndex})`);
  ok(schedule.offlineServerCount === TUNE.offline.stationCount,
    `offlineServerCount == ${TUNE.offline.stationCount} (jest ${schedule.offlineServerCount})`);
  ok(schedule.conveyorFinalIndex === 3, `conveyorFinalIndex == 3 (jest ${schedule.conveyorFinalIndex})`);
  // Kazda sztuka ma segment offline w lead i w trail (caly paczkomat na palecie).
  const leadOffline = schedule.leadUnits.every((u) => u.segments.some((s) => s.type === 'offline'));
  ok(leadOffline, 'kazdy lider ma segment offline');
});

// Scenariusz B: etap offline jest WASKIM GARDLEM (dlugi), N=2 -> takt ≈ czas/2.
// Czas offline musi byc na tyle duzy, by offlineTakt = czas/N przewyzszal takt
// rolotoku — wtedy serwery pracuja bez przerwy i ukonczenia padaja co czas/N.
const OFF = 80;
runScenario('B: offline bottleneck, N=2', [5, 5, 5, 5, OFF], 20, (schedule) => {
  const N = schedule.offlineServerCount;
  // Cykl stanowiska = czas pracy + przezbrojenie (zjazd palety). Takt = cykl / N.
  const CYCLE = OFF + (TUNE.offline.changeover ?? 0);
  ok(N === 2, `N == 2 (jest ${N})`);
  ok(approx(schedule.offlineTakt, CYCLE / N, 1e-6), `offlineTakt == ${CYCLE / N} (jest ${schedule.offlineTakt})`);
  // W stanie ustalonym odstep miedzy kolejnymi ukonczeniami offline ≈ cykl/N.
  const ends = schedule.leadUnits
    .map((u) => u.segments.find((s) => s.type === 'offline'))
    .filter(Boolean)
    .map((s) => s.assemblyEnd)
    .sort((a, b) => a - b);
  const gaps = ends.slice(1).map((e, i) => e - ends[i]);
  // W stanie ustalonym 2 serwery daja odstepy ukonczen przeplatane Δ i (S-Δ),
  // ktore usredniaja sie DOKLADNIE do cykl/N po PARZYSTEJ liczbie odstepow.
  const steady = gaps.slice(-8); // 8 = parzyste, ogon (po rozbiegu)
  const avg = steady.reduce((a, b) => a + b, 0) / steady.length;
  ok(Math.abs(avg - CYCLE / N) < 0.6, `ustalony takt offline ≈ ${CYCLE / N}s (zmierzono ${avg.toFixed(2)}s, odstepy=${steady.map((g) => g.toFixed(1)).join(',')})`);
  // Takt linii sledzi takt offline (offline jest waskim gardlem): nie szybszy niz
  // offline pozwala i bliski jemu (back-pressure utrzymuje rolotok przy ~czas/N).
  ok(schedule.launchInterval >= schedule.offlineTakt - 1e-6,
    `launchInterval (${schedule.launchInterval.toFixed(2)}) >= offlineTakt (${schedule.offlineTakt})`);
  ok(schedule.launchInterval <= schedule.offlineTakt * 1.1,
    `launchInterval (${schedule.launchInterval.toFixed(2)}) ~ offlineTakt (${schedule.offlineTakt}) w granicach 10%`);
});

// Scenariusz C: jedna sztuka (rozbieg) — soloCycleTime zawiera dojazd palety.
runScenario('C: jedna sztuka', [10, 10, 10, 10, 10], 1, (schedule) => {
  ok(schedule.palletTravel === TUNE.offline.palletTravel,
    `palletTravel == ${TUNE.offline.palletTravel} (jest ${schedule.palletTravel})`);
});

console.log(`\n=== WYNIK: ${checks - failures}/${checks} OK, ${failures} bledow ===`);
process.exit(failures === 0 ? 0 : 1);
