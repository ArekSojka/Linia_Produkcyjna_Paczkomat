import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion } from 'framer-motion';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  Activity,
  Box,
  Clock3,
  FileText,
  Grid3X3,
  HelpCircle,
  House,
  LockKeyhole,
  Pause,
  PencilRuler,
  Plus,
  Play,
  RotateCcw,
  Settings2,
  TimerReset,
  Trash2,
  Truck,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import './styles.css';
import {
  DEFAULT_STAGE_SECONDS,
  DEFAULT_WORKER_EFFECT,
  MIN_EFFECTIVE_STAGE_SECONDS,
  clampNumber,
  clampPercent,
  getEffectiveStageDuration,
  CONVEYOR_UNITS_PER_SECOND,
  MIN_TRAVEL_SECONDS,
  ENTRY_TRAVEL_SECONDS,
  COMPLETED_DISPLAY_SECONDS,
  ASSEMBLY_LENGTH,
  MODEL_RENDER_SCALE,
  TUNE,
  isOfflineEnabled,
  getOfflineServerCount,
  getOfflineStageIndex,
  getConveyorFinalIndex,
  buildLinePoints,
  getTravelDurations,
  DEFAULT_TRAVEL_SECONDS,
  DEFAULT_TRAVEL_TIMES,
  getDefaultTravelTimes,
  normalizeTravelTimes,
  buildProductionSchedule,
  validateScheduleReservations,
} from './simulation.js';

const baseStages = [
  {
    id: crypto.randomUUID(),
    name: 'Etap 1: podmontaż koryt',
    duration: DEFAULT_STAGE_SECONDS,
    color: '#2563eb',
    icon: 'locks',
  },
  {
    id: crypto.randomUUID(),
    name: 'Etap 2: montaż pionów',
    duration: DEFAULT_STAGE_SECONDS,
    color: '#0891b2',
    icon: 'shelves',
  },
  {
    id: crypto.randomUUID(),
    name: 'Etap 3: montaż drzwi',
    duration: DEFAULT_STAGE_SECONDS,
    color: '#16a34a',
    icon: 'lockers',
  },
  {
    id: crypto.randomUUID(),
    name: 'Etap 4: włożenie w podstawę, nitowanie + dach',
    duration: DEFAULT_STAGE_SECONDS,
    color: '#7c3aed',
    icon: 'finalize',
  },
];

// Tylko typy uzywane w aktualnym procesie (stare typy z poprzedniego ukladu
// linii, czyli podanie koryt, plecy, rama, drzwi, dach, elektronika i test,
// zostaly usuniete z wyboru; logika animacji rozpoznaje ponizsze wartosci).
const iconOptions = [
  { value: 'locks', label: 'Koryto i zamki' },
  { value: 'shelves', label: 'Piony i polki' },
  { value: 'lockers', label: 'Skrytki' },
  { value: 'finalize', label: 'Polaczenie, plecy i dachy' },
  { value: 'offline', label: 'Wykonczenie poza linia (palety)' },
  { value: 'box', label: 'Montaz' },
];

const stageIcons = {
  locks: LockKeyhole,
  shelves: Box,
  lockers: Grid3X3,
  finalize: House,
  offline: Truck,
  box: Box,
};

// --- Zapamietywanie ustawien (bez bazy danych) ---
// Konfiguracja procesu (etapy, czasy, pracownicy itd.) jest trzymana w
// localStorage przegladarki: kazdy komputer/przegladarka pamieta swoje
// ustawienia miedzy odwiedzinami. Strona statyczna nie rozroznia po IP;
// do wspoldzielenia ustawien miedzy komputerami potrzebny bylby backend.
const UI_CONFIG_KEY = 'paczkomat_ui_config';

const savedUiConfig = (() => {
  try {
    const raw = window.localStorage.getItem(UI_CONFIG_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
})();

// Migracja starych domyslnych nazw (numeracja etapow 0-3 -> 1-4) w zapisach
// z poprzednich wersji aplikacji. Wlasnych nazw uzytkownika nie ruszamy.
const RENAMED_STAGES = {
  'Etap 0: podmontaż koryt': 'Etap 1: podmontaż koryt',
  'Etap 1: montaż pionów': 'Etap 2: montaż pionów',
  'Etap 2: montaż drzwi': 'Etap 3: montaż drzwi',
  'Etap 3: włożenie w podstawę, nitowanie + dach': 'Etap 4: włożenie w podstawę, nitowanie + dach',
};

// Odtwarza zapisane etapy; odrzuca smieci, a nieznane (stare) typy zamienia
// na 'box', zeby lista wyboru zawsze miala zaznaczona opcje.
const restoreStages = (saved) => {
  if (!Array.isArray(saved) || !saved.length) return null;
  const valid = saved
    .filter((stage) => stage && typeof stage === 'object')
    .map((stage) => ({
      id: typeof stage.id === 'string' && stage.id ? stage.id : crypto.randomUUID(),
      name: RENAMED_STAGES[stage.name] ?? String(stage.name ?? 'Etap'),
      duration: clampNumber(stage.duration, DEFAULT_STAGE_SECONDS),
      color: typeof stage.color === 'string' ? stage.color : '#0f766e',
      icon: stageIcons[stage.icon] ? stage.icon : 'box',
    }));
  return valid.length ? valid : null;
};

const restoreNumber = (value, fallback, min = -Infinity) => {
  const parsed = +value;
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
};

const restoreNumberArray = (value, fallback) => (
  Array.isArray(value) && value.length ? value.map((v) => +v) : fallback
);

const formatTime = (seconds) => {
  if (seconds < 60) return `${seconds.toFixed(1).replace('.0', '')} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} min ${rest} s`;
};

const getWorkerImprovementLabel = (baseDuration, effectiveDuration) => {
  const saved = Math.max(0, baseDuration - effectiveDuration);
  if (saved <= 0.0001) return 'bez zmiany';
  const pct = baseDuration > 0 ? Math.round((saved / baseDuration) * 100) : 0;
  return `-${formatTime(saved)} (${pct}%)`;
};

// Liczy realne blokady na podstawie harmonogramu (jednostka w stanie ustalonym).
// Dla kazdego etapu: ile czesc czeka na WEJSCIE (stacja zajeta) i ile jest
// ZABLOKOWANA za etapem (czeka, az zwolni sie dalej), + czas przejazdu.
const buildBottleneckRows = (stages, schedule) => {
  const units = schedule?.leadUnits ?? [];
  const unit = units[units.length - 1];
  const offlineStageIndex = schedule?.offlineStageIndex ?? -1;
  const offlineServerCount = Math.max(schedule?.offlineServerCount ?? 1, 1);
  const rows = stages.map((stage, i) => {
    const duration = Math.max(stage.duration ?? 0, 0);
    // Liczba rownoleglych stanowisk (etap offline = N), oraz EFEKTYWNY czas =
    // czas / liczba stanowisk (na nim opiera sie waskie gardlo i wykorzystanie).
    const servers = i === offlineStageIndex ? offlineServerCount : 1;
    return {
      index: i,
      name: stage.name || `Etap ${i + 1}`,
      baseDuration: Math.max(stage.baseDuration ?? stage.duration ?? 0, 0),
      duration,
      servers,
      effectiveDuration: duration / servers,
      isOffline: i === offlineStageIndex,
      workerCount: stage.workerCount ?? null,
      travelOut: null,
      egressBlock: 0,
    };
  });
  if (unit?.segments) {
    const segs = unit.segments;
    rows.forEach((row) => {
      const sIdx = segs.findIndex((seg) => seg.type === 'stage' && seg.stageIndex === row.index);
      if (sIdx < 0) return;
      const stageSeg = segs[sIdx];
      const travelSeg = segs.find((seg) => seg.type === 'travel' && seg.from === row.index);
      if (travelSeg) {
        row.travelOut = travelSeg.duration ?? null;
        row.egressBlock = Math.max(0, (travelSeg.start ?? 0) - (stageSeg.assemblyEnd ?? 0));
      }
    });
  }
  return rows;
};

const renderTimesReportHtml = ({ rows, cycleTime, launchInterval, totalTime, throughputPerHour, throughputPerShift }) => {
  const esc = (v) => String(v).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const f = formatTime;
  const now = new Date().toLocaleString('pl-PL');
  // Waskie gardlo liczone z EFEKTYWNEGO czasu = czas / liczba stanowisk.
  // Etap offline ma N rownoleglych stanowisk, wiec jego efektywny czas jest N x
  // mniejszy (2 stanowiska = 2x przepustowosc).
  const eff = (r) => (r.effectiveDuration ?? r.duration);
  let bnIdx = -1, maxDur = -1;
  rows.forEach((r) => { if (eff(r) > maxDur) { maxDur = eff(r); bnIdx = r.index; } });
  const bn = rows.find((r) => r.index === bnIdx);
  const blocks = [];
  const bnParallel = bn && bn.servers > 1 ? ` (\u00d7${bn.servers} rownolegle, czas/${bn.servers})` : '';
  blocks.push(`Bottleneck: <span class="bn-tag">Etap ${bnIdx + 1} \u2014 ${esc(bn ? bn.name : "")}</span> (efektywny czas ${f(maxDur)}${bnParallel}) \u2014 tutaj najpierw ustawia sie kolejka.`);
  rows.forEach((r) => {
    if (r.egressBlock > 0.05) blocks.push(`Miedzy Etapem ${r.index + 1} a ${r.index + 2}: czesc zablokowana <b>${f(r.egressBlock)}</b> (czeka, az zwolni sie dalej).`);
  });
  const totalWait = rows.reduce((a, r) => a + r.egressBlock, 0);
  const stageRowsHtml = rows.map((r) => {
    const saved = Math.max(0, r.baseDuration - r.duration);
    const savedLabel = saved > 0.05 ? `${f(saved)} (${r.baseDuration > 0 ? Math.round(saved / r.baseDuration * 100) : 0}%)` : '\u2014';
    const serversLabel = r.servers > 1 ? `\u00d7${r.servers}` : '1';
    const util = maxDur > 0 ? Math.round(Math.min(100, eff(r) / maxDur * 100)) : 0;
    return `<tr${r.index === bnIdx ? ' class="bn"' : ''}><td>${r.index + 1}</td><td>${esc(r.name)}${r.isOffline ? ' <span class="off-tag">poza linia</span>' : ''}</td><td>${serversLabel}</td><td>${r.workerCount ?? '\u2014'}</td><td>${f(r.baseDuration)}</td><td>${f(r.duration)}</td><td>${savedLabel}</td><td>${r.travelOut != null ? f(r.travelOut) : '\u2014'}</td><td>${r.egressBlock > 0.05 ? f(r.egressBlock) : '\u2014'}</td><td>${util}%</td></tr>`;
  }).join('');
  const blocksHtml = blocks.length ? `<ul>${blocks.map((b) => `<li>${b}</li>`).join('')}</ul>` : `<p class="ok">Brak istotnych blokad \u2014 przy obecnych czasach linia jest zbalansowana.</p>`;
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><title>Raport czasow linii \u2014 paczkomat</title>
<style>
  body{font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;margin:32px;}
  h1{font-size:20px;margin:0 0 4px;} .sub{color:#64748b;font-size:13px;margin:0 0 18px;}
  h2{font-size:15px;margin:22px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;}
  .cards{display:flex;gap:12px;margin:12px 0;} .card{flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;}
  .card .l{font-size:12px;color:#64748b;} .card .v{font-size:18px;font-weight:600;}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #e2e8f0;}
  th{background:#f1f5f9;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#475569;}
  tr.bn td{background:#fff7ed;font-weight:600;}
  .bn-tag{display:inline-block;background:#fde68a;color:#92400e;border-radius:4px;padding:2px 8px;font-weight:600;}
  .off-tag{display:inline-block;background:#fce7f3;color:#9d174d;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600;margin-left:4px;}
  ul{margin:8px 0;padding-left:18px;} li{margin:4px 0;font-size:13px;} .ok{color:#15803d;font-weight:600;}
  @media print{body{margin:14px;} .noprint{display:none;}}
</style></head><body>
  <h1>Raport czasow linii produkcyjnej \u2014 paczkomat</h1>
  <p class="sub">Wygenerowano: ${now}</p>
  <div class="cards">
    <div class="card"><div class="l">Cykl jednej sztuki</div><div class="v">${f(cycleTime)}</div></div>
    <div class="card"><div class="l">Nowy start co</div><div class="v">${f(launchInterval)}</div></div>
    <div class="card"><div class="l">Laczny czas ciagly</div><div class="v">${f(totalTime)}</div></div>
    <div class="card"><div class="l">Na godzine</div><div class="v">${Math.round(throughputPerHour)} szt</div></div>
    <div class="card"><div class="l">Na zmiane (8h)</div><div class="v">${Math.round(throughputPerShift)} szt</div></div>
  </div>
  <h2>Etapy i czasy</h2>
  <table><thead><tr><th>#</th><th>Etap</th><th>Stan.</th><th>Prac.</th><th>Czas bazowy</th><th>Czas po obsadzie</th><th>Oszczednosc</th><th>Przejazd do nastepnego</th><th>Blokada za etapem</th><th>Wykorzystanie</th></tr></thead><tbody>${stageRowsHtml}</tbody></table>
  <p class="sub" style="margin-top:4px">Kolumna „Stan." = liczba rownoleglych stanowisk (etap wykonczeniowy poza linia ma ×N: N palet/stanowisk pracuje jednoczesnie, wiec jego efektywny czas i obciazenie sa N-krotnie mniejsze).</p>
  <p class="sub" style="margin-top:4px">Wykorzystanie pokazuje, jak bardzo stanowisko jest obciążone względem najbardziej obciążonego (100%). Stanowisko ze 100% narzuca tempo linii; mniej = ma zapas i czeka. Najlepiej, gdy wszędzie jest blisko 100%, czyli praca jest równo rozłożona.</p>
  <h2>Blokady / oczekiwania</h2>
  ${blocksHtml}
  <p class="sub" style="margin-top:6px">Suma oczekiwan na jedna czesc (stan ustalony): ${f(totalWait)}.</p>
  <p class="noprint" style="margin-top:18px;color:#64748b;font-size:12px;">Aby zapisac jako PDF: w oknie drukowania wybierz \u201eZapisz jako PDF\u201d.</p>
</body></html>`;
};

// Rolotok ma byc tylko lekko szerszy od jednej jadacej polowy paczkomatu.
// Podstawa finalna celowo nie jest tu brana pod uwage, bo bedzie przerabiana
// osobno w kolejnym kroku projektu.
const CONVEYOR_WIDTH = 3.0;
const CONVEYOR_RAIL_OFFSET = CONVEYOR_WIDTH / 2 - 0.35;
const ROLLER_LENGTH = CONVEYOR_WIDTH - 0.85;
const CONVEYOR_ELEVATION = 1.3;
const MODEL_LINE_Y = CONVEYOR_ELEVATION + 1.04;
const STATION_SIDE_DISTANCE = CONVEYOR_WIDTH / 2 + 1.25;
const ROLLER_COLOR = '#e2e8f0';
const ENTRY_CONVEYOR_LENGTH = 5.8;
// Pracownicy pozostaja w scenie i w kodzie, ale sa tymczasowo niewidoczni.
// Zmien na true, aby ponownie ich pokazac.
const SHOW_WORKERS = true;
// === JEDNO zrodlo prawdy dla liczby skrytek na polowe paczkomatu ===
// Zakres docelowy 10 / 11 / 12. Ta liczba musi sie zgadzac z modelem
// polek + drzwi (polkiorazdrzwi.glb). Zmiana tylko tej jednej wartosci
// automatycznie skaluje zamki, polki i skrytki - zawsze w relacji 1:1:1.
const CELLS_PER_HALF = 11;
const LOCKS_PER_MODULE = CELLS_PER_HALF;
const MODULE_COUNT = 2;
const LOCK_COUNT = LOCKS_PER_MODULE * MODULE_COUNT;
const LOCKER_COUNT = LOCK_COUNT;

const ASSEMBLY_HALF_LENGTH = ASSEMBLY_LENGTH / 2;
const ASSEMBLY_ITEM_SPACING = 0.4;
// Druga polowa jest osobnym modelem jadacym ta sama osia co pierwsza. Na
// ostatniej stacji musi najpierw zejsc z tej osi na swoja strone, inaczej
// podczas stawiania przechodzi przez pierwsza kolumne i podstawe.
const SECOND_HALF_SIDE_CLEARANCE = 1.7;
const DEFAULT_TROUGH_LYING_POSE = {
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  offsetX: 1.04,
  offsetY: 0.7,
  offsetZ: 0,
};
const createDefaultTroughLyingPoses = () => Array.from(
  { length: MODULE_COUNT },
  (_, index) => (
    index === 0
      ? { ...DEFAULT_TROUGH_LYING_POSE }
      : {
          ...DEFAULT_TROUGH_LYING_POSE,
          rotationZ: 180,
          offsetY: -1.64,
        }
  ),
);
const LOCK_TROUGH_MODEL_URL = '/models/components/lock-trough.glb';
const CENTER_TROUGH_MODEL_URL = '/models/components/trough-center.glb';
const SMALL_TROUGH_LEFT_MODEL_URL = '/models/components/small-trough-left.glb';
const SMALL_TROUGH_RIGHT_MODEL_URL = '/models/components/small-trough-right.glb';
const LOCK_MODEL_URL = '/models/components/lock.glb';
const SIDE_WALL_LEFT_MODEL_URL = '/models/components/side-wall-left.glb';
const SIDE_WALL_CENTER_MODEL_URL = '/models/components/side-wall-center.glb';
const SIDE_WALL_RIGHT_MODEL_URL = '/models/components/side-wall-right.glb';
const BACK_LEFT_MODEL_URL = '/models/components/back-left.glb';
const BACK_RIGHT_MODEL_URL = '/models/components/back-right.glb';
const ROOF_MODEL_URL = '/models/components/roof.glb';
const CANOPY_MODEL_URL = '/models/components/canopy.glb';
const BASE_MODEL_URL = '/models/components/base.glb';
// Polki + drzwi. Obecny eksport z Blendera (polkiorazdrzwi.glb) jest PUSTY,
// dlatego dopoki tu nie pojawi sie dzialajacy plik z geometria, etap polek i
// drzwi korzysta z proceduralnych zaslepek. Aby uzyc prawdziwego modelu:
// wrzuc dzialajacy plik jako /models/components/shelves-doors.glb - reszta
// kodu wykryje go automatycznie i podmieni zaslepki.
const SHELVES_DOORS_MODEL_URL = '/models/components/shelves-doors.glb';
// Polka oraz 4 rozmiary drzwi (duze/srednie/male/bardzo male) z elementy/.
const SHELF_MODEL_URL = '/models/components/shelf.glb';
const DOOR_XL_MODEL_URL = '/models/components/door-xl.glb';
const DOOR_L_MODEL_URL = '/models/components/door-l.glb';
const DOOR_S_MODEL_URL = '/models/components/door-s.glb';
const DOOR_XS_MODEL_URL = '/models/components/door-xs.glb';
const CONVEYOR_SURFACE_Y = CONVEYOR_ELEVATION + 0.55;

const easeOut = (value) => 1 - Math.pow(1 - value, 3);
// Smoothstep: zerowa predkosc na starcie I koncu. Uzywana dla ruchow, ktore
// startuja z bezruchu (np. stawianie do pionu na etapie 3) - easeOut rusza
// z maksymalna predkoscia od pierwszej klatki, co wyglada jak przeskok.
const easeInOut = (value) => value * value * (3 - 2 * value);

const expandVisibleBounds = (object, bounds) => {
  if (!object?.visible) return bounds;

  if (object.isMesh && object.geometry) {
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (object.geometry.boundingBox) {
      const meshBounds = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
      bounds.union(meshBounds);
    }
  }

  object.children?.forEach((child) => expandVisibleBounds(child, bounds));
  return bounds;
};

const getVisibleWorldBounds = (objects) => {
  const bounds = new THREE.Box3();
  objects.forEach((object) => expandVisibleBounds(object, bounds));
  return bounds.isEmpty() ? null : bounds;
};

const getPalletAnchorBounds = (models) => {
  const baseAnchors = models
    .map((model) => model?.userData?.parts?.base)
    .filter(Boolean);
  return getVisibleWorldBounds(baseAnchors) ?? getVisibleWorldBounds(models);
};

const getPalletLocalAxes = (angle) => ({
  right: new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle)),
  forward: new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)),
});

const centerWorldModelsOnPallet = (models, palletWorldPos, angle, offset = [0, 0, 0]) => {
  const activeModels = models.filter(Boolean);
  if (!activeModels.length || !palletWorldPos) return;
  activeModels.forEach((model) => model.updateMatrixWorld(true));
  const bounds = getPalletAnchorBounds(activeModels);
  if (!bounds) return;

  const center = bounds.getCenter(new THREE.Vector3());
  const { right, forward } = getPalletLocalAxes(angle);
  const target = palletWorldPos.clone()
    .addScaledVector(right, offset[0] ?? 0)
    .addScaledVector(forward, offset[2] ?? 0);
  const delta = target.sub(center);
  delta.y = 0;
  activeModels.forEach((model) => {
    model.position.x += delta.x;
    model.position.z += delta.z;
  });
};

const centerLocalModelsOnPallet = (models, parent, offset = [0, 0, 0]) => {
  const activeModels = models.filter(Boolean);
  if (!activeModels.length || !parent) return;
  parent.updateMatrixWorld(true);
  const bounds = getPalletAnchorBounds(activeModels);
  if (!bounds) return;

  const centerLocal = parent.worldToLocal(bounds.getCenter(new THREE.Vector3()));
  const deltaX = (offset[0] ?? 0) - centerLocal.x;
  const deltaZ = (offset[2] ?? 0) - centerLocal.z;
  activeModels.forEach((model) => {
    model.position.x += deltaX;
    model.position.z += deltaZ;
  });
};

const getTroughStandMotion = (rawProgress) => {
  const cfg = TUNE.troughTurn ?? {};
  const sequenceProgress = easeOut(THREE.MathUtils.clamp(
    rawProgress / Math.max(cfg.portion ?? 0.42, 0.01),
    0,
    1,
  ));
  const liftBefore = THREE.MathUtils.clamp(cfg.liftBefore ?? 0.24, 0.02, 0.72);
  const settleAfter = THREE.MathUtils.clamp(cfg.settleAfter ?? 0.2, 0.02, 0.72);
  const turnSpan = Math.max(0.05, 1 - liftBefore - settleAfter);
  const liftProgress = easeOut(THREE.MathUtils.clamp(sequenceProgress / liftBefore, 0, 1));
  const turnProgress = easeOut(THREE.MathUtils.clamp((sequenceProgress - liftBefore) / turnSpan, 0, 1));
  const settleProgress = easeOut(THREE.MathUtils.clamp(
    (sequenceProgress - (1 - settleAfter)) / settleAfter,
    0,
    1,
  ));
  const standLift = cfg.standLift ?? 0.82;
  const arcLift = cfg.arcLift ?? 0.42;

  return {
    sequenceProgress,
    liftProgress,
    turnProgress,
    settleProgress,
    lyingAmount: 1 - turnProgress,
    clearanceLift:
      standLift * liftProgress * (1 - settleProgress)
      + Math.sin(turnProgress * Math.PI) * arcLift,
  };
};

const getRouteTangent = (points, index) => {
  if (points.length < 2) return new THREE.Vector3(0, 0, 1);
  const previous = points[Math.max(index - 1, 0)];
  const next = points[Math.min(index + 1, points.length - 1)];
  const tangent = next.clone().sub(previous);

  if (tangent.lengthSq() < 0.001) {
    return new THREE.Vector3(0, 0, 1);
  }

  return tangent.normalize();
};

const getStationSideOffset = (points, index, center) => {
  const tangent = getRouteTangent(points, index);
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  const outward = points[index].clone().sub(center);

  if (outward.lengthSq() > 0.001 && side.dot(outward) < 0) {
    side.multiplyScalar(-1);
  }

  return side.multiplyScalar(STATION_SIDE_DISTANCE);
};

const getVisibleUnitsFromSchedule = (schedule, elapsed, stageCount, lane = 'lead') => {
  const visible = [];
  const scheduledUnits = lane === 'trail'
    ? schedule.trailUnits ?? []
    : schedule.leadUnits ?? schedule.units ?? [];

  scheduledUnits.forEach((scheduledUnit) => {
    if (elapsed < scheduledUnit.startTime || elapsed > scheduledUnit.finishTime) return;

    const segment = scheduledUnit.segments.find(
      (candidate) => elapsed >= candidate.start && elapsed <= candidate.end,
    );

    if (!segment) return;

    if (segment.type === 'entry') {
      visible.push({
        key: `${scheduledUnit.number}`,
        number: scheduledUnit.number,
        role: scheduledUnit.role ?? lane,
        elapsed,
        currentIndex: 0,
        progress: 0,
        assemblyProgress: 0,
        mode: 'entry',
        travelProgress: ((elapsed - segment.start) / Math.max(segment.duration, 0.1)) * 100,
        isBlocked: false,
      });
      return;
    }

    if (segment.type === 'travel') {
      visible.push({
        key: `${scheduledUnit.number}`,
        number: scheduledUnit.number,
        role: scheduledUnit.role ?? lane,
        elapsed,
        currentIndex: segment.from,
        progress: 100,
        assemblyProgress: 100,
        mode: 'travel',
        travelFrom: segment.from,
        travelTo: segment.to,
        travelProgress: ((elapsed - segment.start) / Math.max(segment.duration, 0.1)) * 100,
        isBlocked: false,
      });
      return;
    }

    // Etap offline (poza rolotokiem): dojazd palety, praca na stanowisku i
    // prezentacja/odjazd. Renderujemy palete TYLKO z toru 'lead' (caly,
    // sparowany paczkomat jedzie na jednej palecie, bez duplikatu z toru trail).
    if (segment.type === 'palletTravel' || segment.type === 'offline' || segment.type === 'offlineDone') {
      if (lane === 'trail') return;
      const dur = Math.max(segment.duration, 0.1);
      const prog = Math.min(Math.max(((elapsed - segment.start) / dur) * 100, 0), 100);
      visible.push({
        key: `${scheduledUnit.number}`,
        number: scheduledUnit.number,
        role: 'offline',
        elapsed,
        mode: segment.type,
        serverIndex: segment.serverIndex ?? 0,
        currentIndex: segment.stageIndex ?? (stageCount - 1),
        progress: prog,
        assemblyProgress: prog,
        travelProgress: ((elapsed - segment.start) / dur) * 100,
        isBlocked: false,
      });
      return;
    }

    const assemblyProgress = Math.min(
      ((elapsed - segment.start) / Math.max(segment.duration, 0.1)) * 100,
      100,
    );
    const isBlocked =
      segment.stageIndex < stageCount - 1
      && elapsed >= segment.assemblyEnd
      && segment.end > segment.assemblyEnd + 0.05;
    const isCompletedDisplay =
      segment.stageIndex === stageCount - 1
      && elapsed >= segment.assemblyEnd;

    visible.push({
      key: `${scheduledUnit.number}`,
      number: scheduledUnit.number,
      role: scheduledUnit.role ?? lane,
      elapsed,
      currentIndex: segment.stageIndex,
      progress: assemblyProgress,
      assemblyProgress,
      mode: isBlocked ? 'waiting' : isCompletedDisplay ? 'completed' : 'assembly',
      travelProgress: 0,
      isBlocked,
      // Postep OKNA PREZENTACJI gotowego paczkomatu (0-1 miedzy koncem montazu
      // a koncem segmentu). Steruje animacja ODJAZDU palety z gotowa para -
      // zamiast znikac w miejscu, paleta odjezdza wzdluz linii.
      completedProgress: isCompletedDisplay
        ? Math.min(
          (elapsed - segment.assemblyEnd)
            / Math.max(segment.end - segment.assemblyEnd, 0.1),
          1,
        )
        : 0,
    });
  });

  return visible.sort((a, b) => b.elapsed - a.elapsed);
};

const getUnitPose = (unit, points) => {
  if (!points.length) return { position: new THREE.Vector3(), angle: 0, atStop: true };

  // Etap 0 statyczny (podmontaz koryt na stole): koryto NIE jedzie po tasmie
  // wejsciowej ani po stole - pojawia sie na stole, a po podmontazu znika i
  // pojawia sie na poczatku skroconego rolotoku (patrz TUNE.staticFirstStage).
  const sfs = TUNE.staticFirstStage ?? {};
  const staticFirst = (sfs.enabled ?? false) && points.length >= 2;

  if (unit.mode === 'entry') {
    const direction = getRouteTangent(points, 0);
    if (staticFirst) {
      // Koryto pojawia sie od razu NA STOLE (opadanie robi placeHalf w osi Y).
      return {
        position: points[0].clone(),
        angle: Math.atan2(direction.x, direction.z),
        atStop: true,
      };
    }
    const end = points[0];
    const start = end.clone().addScaledVector(direction, -ENTRY_CONVEYOR_LENGTH);
    const travelProgress = Math.max(0, Math.min((unit.travelProgress ?? 0) / 100, 1));
    const eased = 0.5 - Math.cos(travelProgress * Math.PI) / 2;

    return {
      position: start.clone().lerp(end, eased),
      angle: Math.atan2(direction.x, direction.z),
      atStop: travelProgress >= 1,
    };
  }

  if (unit.mode === 'travel') {
    const travelProgress = Math.max(0, Math.min((unit.travelProgress ?? 0) / 100, 1));
    if (staticFirst && unit.travelFrom === 0 && unit.travelTo === 1) {
      // Przeniesienie ze stolu na rolotok: przez transferPortion czasu czesc
      // jeszcze LEZY na stole (zdejmowanie), potem pojawia sie na poczatku
      // rolotoku (leadIn przed etapem 1, cofnieta o appearInset w glab rolek)
      // i normalnie dojezdza do stacji etapu 1.
      const direction = getRouteTangent(points, 1);
      const angle = Math.atan2(direction.x, direction.z);
      const transfer = THREE.MathUtils.clamp(sfs.transferPortion ?? 0.35, 0.02, 0.9);
      if (travelProgress < transfer) {
        return { position: points[0].clone(), angle, atStop: true };
      }
      const rideStart = points[1].clone().addScaledVector(
        direction,
        -Math.max((sfs.conveyorLeadIn ?? 7) - (sfs.appearInset ?? 2.8), 0.5),
      );
      const t = (travelProgress - transfer) / (1 - transfer);
      const eased = t < 1 ? 0.5 - Math.cos(t * Math.PI) / 2 : 1;
      return {
        position: rideStart.lerp(points[1], eased),
        angle,
        atStop: travelProgress >= 1,
      };
    }
    const start = points[Math.min(unit.travelFrom, points.length - 1)];
    const end = points[Math.min(unit.travelTo, points.length - 1)];
    const eased = travelProgress < 1 ? 0.5 - Math.cos(travelProgress * Math.PI) / 2 : 1;
    const position = start.clone().lerp(end, eased);
    const direction = end.clone().sub(start);

    return {
      position,
      angle: direction.lengthSq() > 0.001 ? Math.atan2(direction.x, direction.z) : 0,
      atStop: travelProgress >= 1,
    };
  }

  const currentIndex = Math.min(unit.currentIndex, points.length - 1);
  const current = points[currentIndex];
  const direction = getRouteTangent(points, currentIndex);
  const angle = direction.lengthSq() > 0.001 ? Math.atan2(direction.x, direction.z) : 0;

  return {
    position: current.clone(),
    angle,
    atStop: true,
  };
};

function StageIcon({ icon, className }) {
  const Icon = stageIcons[icon] ?? Box;
  return <Icon className={className} aria-hidden="true" />;
}

function StageEditor({ stages, updateStage, addStage, removeStage, resetStages }) {
  return (
    <section className="panel section-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Etapy</p>
          <h2>Konfiguracja procesu</h2>
        </div>
        <button className="icon-button" type="button" onClick={resetStages} title="Przywroc domyslne etapy">
          <RotateCcw size={18} />
        </button>
      </div>

      <div className="stage-list">
        {stages.map((stage, index) => (
          <div className="stage-form" key={stage.id}>
            <div className="stage-form-number" style={{ backgroundColor: stage.color }}>
              {index + 1}
            </div>
            <label>
              Nazwa
              <input
                value={stage.name}
                onChange={(event) => updateStage(stage.id, { name: event.target.value })}
                placeholder="Nazwa etapu"
              />
            </label>
            <label>
              Czas bazowy
              <MinutesSecondsFields
                totalSeconds={stage.duration}
                onChange={(value) => updateStage(stage.id, { duration: value })}
              />
            </label>
            <label>
              Kolor
              <input
                className="color-input"
                type="color"
                value={stage.color}
                onChange={(event) => updateStage(stage.id, { color: event.target.value })}
              />
            </label>
            <label>
              Typ
              <select value={stage.icon} onChange={(event) => updateStage(stage.id, { icon: event.target.value })}>
                {iconOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="icon-button danger"
              type="button"
              onClick={() => removeStage(stage.id)}
              title="Usun etap"
              disabled={stages.length === 1}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>

      <button className="add-button" type="button" onClick={addStage}>
        <Plus size={18} />
        Dodaj etap
      </button>
    </section>
  );
}

function Stopwatch({ elapsed, running, onToggle, onReset }) {
  return (
    <div className="stopwatch-box">
      <div>
        <span>Stoper rzeczywisty</span>
        <strong>{formatTime(elapsed)}</strong>
      </div>
      <div className="stopwatch-actions">
        <button type="button" onClick={onToggle} title={running ? 'Pauzuj stoper' : 'Start stopera'}>
          {running ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button type="button" onClick={onReset} title="Resetuj stoper">
          <TimerReset size={17} />
        </button>
      </div>
    </div>
  );
}

// Para pol minuty+sekundy dla jednej wartosci czasu (przechowywanej w sekundach
// laczem). Wpisanie w dowolne z pol przelicza sie na laczna liczbe sekund.
function MinutesSecondsFields({ totalSeconds, onChange }) {
  const safeTotal = Math.max(0, Number(totalSeconds) || 0);
  const minutesPart = Math.floor(safeTotal / 60);
  const secondsPart = Math.round((safeTotal - minutesPart * 60) * 10) / 10;

  return (
    <span className="time-inputs">
      <input
        type="number"
        min="0"
        step="1"
        value={minutesPart}
        title="minuty"
        onChange={(event) => {
          const mins = Math.max(0, Number(event.target.value) || 0);
          onChange(mins * 60 + secondsPart);
        }}
      />
      <span className="unit">min</span>
      <input
        type="number"
        min="0"
        step="0.1"
        value={secondsPart}
        title="sekundy"
        onChange={(event) => {
          const secs = Math.max(0, Number(event.target.value) || 0);
          onChange(minutesPart * 60 + secs);
        }}
      />
      <span className="unit">s</span>
    </span>
  );
}

function TravelTimeEditor({
  stages,
  travelTimes,
  updateTravelTime,
  offlinePalletTravel,
  updateOfflinePalletTravel,
}) {
  if (stages.length < 2) return null;

  // Pokazujemy tylko przejazdy ROLOTOKU (miedzy stacjami na tasmie). Dojazd
  // palety na etap offline (poza linia) jest osobny (TUNE.offline.palletTravel).
  const conveyorTravelCount = getConveyorFinalIndex(stages);
  const offline = isOfflineEnabled(stages);

  return (
    <div className="travel-editor">
      <div className="mini-heading">
        <span>Rolotok</span>
        <strong>Czas przejazdu miedzy etapami</strong>
      </div>
      {stages.slice(0, conveyorTravelCount).map((stage, index) => {
        const nextStage = stages[index + 1];

        return (
          <label className="travel-row" key={`${stage.id}-${nextStage.id}`}>
            <span>
              {stage.name || `Etap ${index + 1}`} do {nextStage.name || `Etap ${index + 2}`}
            </span>
            <MinutesSecondsFields
              totalSeconds={travelTimes[index] ?? 1}
              onChange={(value) => updateTravelTime(index, value)}
            />
          </label>
        );
      })}
      {offline && (
        <>
          <label className="travel-row">
            <span>
              Dojazd palety na stanowisko offline (etap {stages.length})
            </span>
            <MinutesSecondsFields
              totalSeconds={offlinePalletTravel ?? 6}
              onChange={updateOfflinePalletTravel}
            />
          </label>
          <div style={{ fontSize: 11, color: 'var(--muted, #94a3b8)', marginTop: -2, lineHeight: 1.4 }}>
            Nie blokuje rolotoku.
          </div>
        </>
      )}
    </div>
  );
}

function WorkersEditor({
  stages,
  workersPerStation,
  updateWorkerCount,
  offlineStationWorkers,
  updateOfflineStationWorkerCount,
  workerEffect,
  updateWorkerEffect,
}) {
  if (!stages.length) return null;

  const offlineStageIdx = getOfflineStageIndex(stages);
  const offlineServerCount = isOfflineEnabled(stages) ? getOfflineServerCount() : 0;

  return (
    <div className="travel-editor">
      <div className="mini-heading">
        <span>Pracownicy</span>
        <strong>Liczba na stanowisko i wplyw na czas</strong>
      </div>
      <div className="worker-effect-grid">
        <label>
          Tryb
          <select
            value={workerEffect.mode}
            onChange={(event) => updateWorkerEffect({ mode: event.target.value })}
          >
            <option value="percent">% szybciej za kazdego dodatkowego</option>
            <option value="seconds">Sekundy mniej za kazdego dodatkowego</option>
          </select>
        </label>
        <label>
          Wartosc
          {workerEffect.mode === 'percent' ? (
            <input
              type="number"
              min="0"
              max={95}
              step={1}
              value={workerEffect.value}
              onChange={(event) => updateWorkerEffect({ value: event.target.value })}
            />
          ) : (
            <MinutesSecondsFields
              totalSeconds={workerEffect.value}
              onChange={(value) => updateWorkerEffect({ value })}
            />
          )}
        </label>
      </div>
      {stages.map((stage, index) => (
        <React.Fragment key={stage.id}>
          <label className="worker-row">
            <span>{stage.name || `Etap ${index + 1}`}</span>
            <input
              type="number"
              min="1"
              step="1"
              value={workersPerStation[index] ?? 1}
              onChange={(event) => updateWorkerCount(index, event.target.value)}
            />
            <strong title={`Bazowo: ${formatTime(stage.baseDuration ?? stage.duration)}`}>
              {formatTime(stage.duration)}
            </strong>
            <small>
              {getWorkerImprovementLabel(stage.baseDuration ?? stage.duration, stage.duration)}
            </small>
          </label>
          {index === offlineStageIdx && offlineServerCount > 0 && (
            <div className="offline-worker-split">
              {Array.from({ length: offlineServerCount }, (_, stationIndex) => (
                <label className="worker-row" key={`offline-station-${stationIndex}`}>
                  <span>↳ Stanowisko {stationIndex + 1}</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={offlineStationWorkers?.[stationIndex] ?? 1}
                    onChange={(event) => updateOfflineStationWorkerCount(stationIndex, event.target.value)}
                  />
                </label>
              ))}
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function Metrics({
  unitCount,
  setUnitCount,
  cycleTime,
  totalTime,
  stages,
  launchInterval,
  travelTimes,
  updateTravelTime,
  offlinePalletTravel,
  updateOfflinePalletTravel,
  workersPerStation,
  updateWorkerCount,
  offlineStationWorkers,
  updateOfflineStationWorkerCount,
  workerEffect,
  updateWorkerEffect,
  throughputPerHour,
  throughputPerShift,
  stageUtilization,
  speedMultiplier,
  setSpeedMultiplier,
  onExportPdf,
  stopwatch,
}) {
  return (
    <section className="panel controls-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Sterowanie</p>
          <h2>Parametry produkcji</h2>
        </div>
        <Settings2 className="heading-icon" />
      </div>

      <label className="count-field">
        Liczba paczkomatow
        <input
          type="number"
          min="1"
          step="1"
          value={unitCount}
          onChange={(event) => setUnitCount(event.target.value)}
        />
      </label>

      <label className="count-field">
        Predkosc symulacji (przyspieszacz)
        <select
          value={speedMultiplier}
          onChange={(event) => setSpeedMultiplier(Number(event.target.value))}
        >
          <option value={1}>1× (czas realny)</option>
          <option value={2}>2×</option>
          <option value={5}>5×</option>
          <option value={10}>10×</option>
          <option value={20}>20×</option>
          <option value={50}>50×</option>
          <option value={100}>100×</option>
        </select>
      </label>

      <Stopwatch
        elapsed={stopwatch.elapsed}
        running={stopwatch.running}
        onToggle={stopwatch.toggle}
        onReset={stopwatch.reset}
      />

      <div className="metric-grid">
        <div>
          <Clock3 size={19} />
          <span>Cykl jednej sztuki</span>
          <strong>{formatTime(cycleTime)}</strong>
        </div>
        <div>
          <Activity size={19} />
          <span>Laczny czas ciagly</span>
          <strong>{formatTime(totalTime)}</strong>
        </div>
        <div>
          <Zap size={19} />
          <span>Nowy start co</span>
          <strong>{formatTime(launchInterval)}</strong>
        </div>
      </div>

      <div className="metric-grid">
        <div>
          <Activity size={19} />
          <span>Na godzine</span>
          <strong>{Math.round(throughputPerHour)} szt</strong>
        </div>
        <div>
          <Activity size={19} />
          <span>Na zmiane (8h)</span>
          <strong>{Math.round(throughputPerShift)} szt</strong>
        </div>
      </div>

      <div style={{ margin: '10px 0' }}>
        <div style={{ fontSize: 12, color: 'var(--muted, #94a3b8)', marginBottom: 2 }}>Wykorzystanie stanowisk</div>
        <div style={{ fontSize: 11, color: 'var(--muted, #94a3b8)', opacity: 0.85, marginBottom: 8, lineHeight: 1.4 }}>
          100% = najbardziej obciążone stanowisko (czerwone). Ono narzuca tempo całej linii. Mniej niż 100% = stanowisko kończy wcześniej i czeka. Najlepiej, gdy wszędzie jest blisko 100% (praca równo rozłożona).
        </div>
        {(stageUtilization ?? []).map((u, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '5px 0', fontSize: 12 }}>
            <span style={{ width: 96, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {u.name}
              {u.servers > 1 && (
                <span style={{ marginLeft: 4, color: '#db2777', fontWeight: 600 }}>×{u.servers}</span>
              )}
            </span>
            <div style={{ flex: 1, background: 'rgba(148,163,184,0.25)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div style={{ width: `${u.pct}%`, height: '100%', background: u.isBottleneck ? '#dc2626' : '#2563eb' }} />
            </div>
            <span style={{ width: 36, textAlign: 'right' }}>{Math.round(u.pct)}%</span>
          </div>
        ))}
      </div>

      <TravelTimeEditor
        stages={stages}
        travelTimes={travelTimes}
        updateTravelTime={updateTravelTime}
        offlinePalletTravel={offlinePalletTravel}
        updateOfflinePalletTravel={updateOfflinePalletTravel}
      />

      <WorkersEditor
        stages={stages}
        workersPerStation={workersPerStation}
        updateWorkerCount={updateWorkerCount}
        offlineStationWorkers={offlineStationWorkers}
        updateOfflineStationWorkerCount={updateOfflineStationWorkerCount}
        workerEffect={workerEffect}
        updateWorkerEffect={updateWorkerEffect}
      />

      <button
        type="button"
        onClick={onExportPdf}
        style={{ marginTop: 14, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
      >
        <FileText size={17} /> Eksportuj czasy do PDF
      </button>

      <div className="time-breakdown">
        {stages.map((stage) => (
          <div key={stage.id} className="breakdown-row">
            <span style={{ backgroundColor: stage.color }} />
            <p>
              {stage.name || 'Bez nazwy'}
              {(stage.baseDuration ?? stage.duration) !== stage.duration
                ? ` (${stage.workerCount ?? 1} prac.)`
                : ''}
            </p>
            <strong title={`Bazowo: ${formatTime(clampNumber(stage.baseDuration ?? stage.duration))}`}>
              {formatTime(clampNumber(stage.duration))}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function makeMaterial(color, roughness = 0.62, metalness = 0.08) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

// === Profesjonalna paleta materialow (stonowane stalowo-szare) ===
// Nadpisuje plaski material CAD (STEP_cccccc, jednolita szarosc) na czesciach
// GLB, zeby calosc wygladala na render inzynierski gotowy dla zarzadu.
const PALETTE = {
  trough: { color: '#aeb7c0', metalness: 0.82, roughness: 0.42 }, // ocynkowana stal koryt
  lock: { color: '#828b96', metalness: 0.9, roughness: 0.34 }, // zamki - ciemniejsza stal
  sideWall: { color: '#3c424a', metalness: 0.55, roughness: 0.5 }, // antracytowe sciany
  backWall: { color: '#31363d', metalness: 0.5, roughness: 0.55 },
  base: { color: '#24282d', metalness: 0.62, roughness: 0.48 }, // grafitowa podstawa
  roof: { color: '#363c44', metalness: 0.55, roughness: 0.5 },
  canopy: { color: '#9aa3ac', metalness: 0.7, roughness: 0.42 }, // jasniejszy daszek
  shelf: { color: '#c2cad2', metalness: 0.45, roughness: 0.5 }, // jasne polki
  door: { color: '#d9dee3', metalness: 0.25, roughness: 0.55 }, // jasne drzwi
  cellEdge: { color: '#454c55', metalness: 0.5, roughness: 0.5 },
};
const ACCENT_COLOR = '#7fa8c9'; // subtelny, chlodny akcent aktywnego etapu

function makePalette(key) {
  const spec = PALETTE[key] ?? PALETTE.trough;
  return new THREE.MeshStandardMaterial({
    color: spec.color,
    metalness: spec.metalness,
    roughness: spec.roughness,
    envMapIntensity: 1.05,
  });
}

// Zamienia material na czesci GLB na ten z palety (kazda siatka dostaje wlasny
// klon, dzieki czemu animacje emisji per-czesc dalej dzialaja).
function applyGlbMaterial(object, key) {
  const material = makePalette(key);
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.material = material.clone();
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return object;
}

function makeBox(width, height, depth, color, name) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    makeMaterial(color),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

function makeBeamBetween(start, end, radius, material, name) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 10),
    material,
  );
  beam.position.copy(start).add(end).multiplyScalar(0.5);
  beam.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  beam.castShadow = true;
  beam.receiveShadow = true;
  beam.name = name;
  return beam;
}

function makeProfileBetween(start, end, width, depth, material, name) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const profile = new THREE.Mesh(
    new THREE.BoxGeometry(width, length, depth),
    material,
  );
  profile.position.copy(start).add(end).multiplyScalar(0.5);
  profile.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  profile.castShadow = true;
  profile.receiveShadow = true;
  profile.name = name;
  return profile;
}

function makeTextPlane(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  draw(ctx, canvas);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  plane.name = 'label';
  return plane;
}

// Pomocniczy zaokraglony prostokat na canvasie etykiety strefy.
function sectorRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Etykiety i czasy stacji linii glownej wg planu hali (indeks 0-3 = etap 1-4).
const MAINLINE_SECTORS = [
  { label: 'Podmontaż koryt', minutes: null },
  { label: 'Montaż pionów', minutes: 15 },
  { label: 'Montaż drzwi', minutes: 12 },
  { label: 'Włożenie w podstawę + nitowanie i dach', minutes: null },
];

// Buduje jedna strefe robocza: plaski kolorowy pad + obrys + unoszaca etykieta
// + pusty 'sectorSlot' (kotwica na przyszle modele pracownikow). Pozycje ustawia
// wywolujacy. Zwraca Group; slot dostepny przez group.userData.sectorSlot.
function createSectorZone({
  label,
  sublabel = '',
  color = '#2563eb',
  width = 3.6,
  depth = 3.0,
  opacity = 0.22,
  labelHeight = 1.55,
}) {
  const group = new THREE.Group();
  group.name = `sector:${label}`;

  // Wypelnienie strefy (plaski, polprzezroczysty pad na podlodze).
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.025;
  fill.renderOrder = 1;
  group.add(fill);

  // Obrys strefy (wyrazna ramka w kolorze sektora).
  const hw = width / 2;
  const hd = depth / 2;
  const border = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-hw, 0, -hd),
      new THREE.Vector3(hw, 0, -hd),
      new THREE.Vector3(hw, 0, hd),
      new THREE.Vector3(-hw, 0, hd),
    ]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.92 }),
  );
  border.position.y = 0.045;
  group.add(border);

  // Unoszaca etykieta z nazwa sektora (dopasowana do glebokosci strefy).
  const labelW = Math.max(1.1, Math.min(2.4, depth * 0.95));
  const labelH = labelW / 2.667;
  const plane = makeTextPlane(labelW, labelH, (ctx, canvas) => {
    const pad = 8;
    sectorRoundRect(ctx, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2, 28);
    ctx.fillStyle = 'rgba(15,23,42,0.84)';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = color;
    sectorRoundRect(ctx, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2, 28);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 60px sans-serif';
    ctx.fillText(label, canvas.width / 2, sublabel ? canvas.height / 2 - 24 : canvas.height / 2);
    if (sublabel) {
      ctx.font = '40px sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(sublabel, canvas.width / 2, canvas.height / 2 + 42);
    }
  });
  // Czytelna z OBU stron: DoubleSide na jednej plaszczyznie pokazywalby od
  // tylu LUSTRZANE odbicie tekstu. Zamiast tego dwie plaszczyzny plecami do
  // siebie, obie FrontSide, obie z ta sama (nieodwrocona) tekstura.
  const labelGroup = new THREE.Group();
  labelGroup.rotation.y = Math.PI / 2; // czolem w poprzek linii (czytelne z domyslnej kamery)
  labelGroup.position.set(0, labelHeight, 0);
  const labelBack = plane.clone();
  labelBack.name = 'labelBack';
  labelBack.rotation.y = Math.PI;
  labelGroup.add(plane, labelBack);
  group.add(labelGroup);

  // Pusty slot na przyszle modele pracownikow (na srodku strefy).
  const slot = new THREE.Group();
  slot.name = 'sectorSlot';
  group.userData.sectorSlot = slot;
  group.add(slot);

  return group;
}

// Kolory stref wg typu sektora.
const SECTOR_COLORS = {
  podmontaz: '#2563eb', // niebieski - stanowiska montazu podzespolow
  komponent: '#d97706', // bursztynowy - podawanie komponentow / blach
  magazyn: '#64748b',   // szary - palety, regaly, bufory
  naprawa: '#dc2626',   // czerwony - strefa napraw
  czystosc: '#16a34a',  // zielony - kaciki czystosci
};

// Strefy peryferyjne odwzorowane wg planu hali. Kazdy sektor ma pozycje z
// rysunku: px = wzdluz linii (lewo->prawo), py = w poprzek (gora->dol),
// pw/ph = rozmiar prostokata w planie (px). Przeliczane na swiat w
// buildPeripheralSectors przez planCX/planCY/planZScale/planXScale.
//
// ZRODLO PRAWDY: public/config/strefy.json (edytowalne w /edytor_stref.html)
// bez przebudowy aplikacji. Ponizsza tablica to tylko awaryjny fallback,
// gdy pliku JSON nie da sie wczytac.
const DEFAULT_PLAN_SECTORS = [
  { label: 'Paleta NOK', type: 'magazyn', px: 58, py: 75, pw: 73, ph: 70 },
  { label: 'Kącik czystości', type: 'czystosc', px: 260, py: 52, pw: 39, ph: 46 },
  { label: 'Półka', type: 'komponent', px: 309, py: 65, pw: 54, ph: 72 },
  { label: 'Ściana', type: 'komponent', px: 373, py: 58, pw: 68, ph: 55 },
  { label: 'Kant', type: 'komponent', px: 440, py: 58, pw: 58, ph: 55 },
  { label: 'PFB drzwi', type: 'komponent', px: 615, py: 63, pw: 58, ph: 72 },
  { label: 'Podmontaż drzwi', type: 'podmontaz', minutes: 12, px: 701, py: 54, pw: 110, ph: 55 },
  { label: 'Drzwi', type: 'komponent', px: 784, py: 101, pw: 51, ph: 74 },
  { label: 'Dachy', type: 'komponent', px: 1048, py: 67, pw: 48, ph: 71 },
  { label: 'Blendy', type: 'komponent', px: 1100, py: 61, pw: 50, ph: 55 },
  { label: 'Blacha koryta', type: 'komponent', px: 58, py: 272, pw: 73, ph: 55 },
  { label: 'Regał elem. złączne', type: 'magazyn', px: 68, py: 400, pw: 93, ph: 140 },
  { label: 'Paleta NOK', type: 'magazyn', px: 192, py: 435, pw: 55, ph: 70 },
  { label: 'Półka', type: 'komponent', px: 326, py: 333, pw: 46, ph: 91 },
  { label: 'Ściana', type: 'komponent', px: 386, py: 321, pw: 65, ph: 65 },
  { label: 'Strefa napraw', type: 'naprawa', px: 534, py: 330, pw: 157, ph: 235 },
  { label: 'Drzwi', type: 'komponent', px: 782, py: 256, pw: 48, ph: 73 },
  { label: 'Kącik czystości', type: 'czystosc', px: 740, py: 273, pw: 32, ph: 38 },
  { label: 'Podmontaż drzwi', type: 'podmontaz', minutes: 12, px: 729, py: 349, pw: 56, ph: 109 },
  { label: 'PFB drzwi', type: 'komponent', px: 745, py: 427, pw: 91, ph: 40 },
  { label: 'Podłoga', type: 'komponent', px: 916, py: 301, pw: 65, ph: 65 },
  { label: 'Sufit', type: 'komponent', px: 985, py: 301, pw: 65, ph: 65 },
  { label: 'Rama', type: 'komponent', px: 857, py: 438, pw: 52, ph: 66 },
  { label: 'Podmontaż podłogi i sufitu', type: 'podmontaz', minutes: 16, px: 940, py: 443, pw: 110, ph: 55 },
  { label: 'Klapa pokrywy', type: 'komponent', px: 1045, py: 368, pw: 88, ph: 46 },
  { label: 'Blacha dolna', type: 'komponent', px: 1031, py: 439, pw: 64, ph: 66 },
  { label: 'Paleta NOK', type: 'magazyn', px: 1190, py: 429, pw: 60, ph: 70 },
  { label: 'Kącik czystości', type: 'czystosc', px: 1243, py: 444, pw: 40, ph: 40 },
];

// --- Automatyczne wczytywanie stref (bez wklejania kodu z edytora) ---
// Priorytet: nowszy z pary (zapis edytora w localStorage, plik strefy.json).
// Edytor nadaje tez zmiany na zywo przez BroadcastChannel, a scena przebudowuje
// sie natychmiast, bez przeladowania strony.
const SECTORS_JSON_URL = '/config/strefy.json';
const SECTORS_STORAGE_KEY = 'paczkomat_plan_sectors';
const SECTORS_CHANNEL_NAME = 'paczkomat-strefy';
let PLAN_SECTORS = DEFAULT_PLAN_SECTORS;

// Waliduje dane z JSON/edytora; zwraca null, gdy format jest nie do uzycia.
const sanitizeSectors = (list) => {
  if (!Array.isArray(list)) return null;
  const out = list
    .filter((s) => s && typeof s === 'object' && Number.isFinite(+s.px) && Number.isFinite(+s.py))
    .map((s) => ({
      label: String(s.label ?? ''),
      type: String(s.type ?? 'komponent'),
      ...(s.minutes != null && Number.isFinite(+s.minutes) ? { minutes: +s.minutes } : {}),
      ...(typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color) ? { color: s.color } : {}),
      px: +s.px,
      py: +s.py,
      pw: Math.max(12, +s.pw || 60),
      ph: Math.max(12, +s.ph || 60),
    }));
  return out.length ? out : null;
};

const readStoredSectors = () => {
  try {
    const raw = window.localStorage.getItem(SECTORS_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const sectors = sanitizeSectors(data.sectors);
    if (!sectors) return null;
    return { savedAt: Date.parse(data.savedAt ?? '') || 0, sectors };
  } catch {
    return null;
  }
};

const loadPlanSectors = async () => {
  const stored = readStoredSectors();
  let fileSectors = null;
  let fileUpdatedAt = 0;
  try {
    const res = await fetch(SECTORS_JSON_URL, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      fileSectors = sanitizeSectors(data.sectors ?? data);
      fileUpdatedAt = Date.parse(data.updatedAt ?? '') || 0;
    }
  } catch {
    // Brak pliku / brak sieci: uzyjemy zapisu edytora albo domyslnych.
  }
  if (stored && stored.savedAt >= fileUpdatedAt) return stored.sectors;
  return fileSectors ?? stored?.sectors ?? DEFAULT_PLAN_SECTORS;
};

// Bufor podstaw na koncu linii - strefa magazynowa z siatka miejsc na palety.
function buildBufferGrid(group, xCenter, zCenter, s) {
  const cols = s.bufferCols ?? 4;
  const rows = s.bufferRows ?? 2;
  const cell = s.bufferCell ?? 3.3;
  const gap = 0.22;
  const stepX = cell + gap;
  const stepZ = cell + gap;
  const totalX = rows * stepX - gap;
  const totalZ = cols * stepZ - gap;
  const zone = createSectorZone({
    label: 'Bufor podstaw',
    color: SECTOR_COLORS.magazyn,
    width: totalX + 1.0,
    depth: totalZ + 1.0,
    opacity: 0.14,
    labelHeight: s.labelHeight ?? 1.55,
  });
  zone.position.set(xCenter, 0.02, zCenter);

  const cellMat = new THREE.LineBasicMaterial({
    color: SECTOR_COLORS.magazyn,
    transparent: true,
    opacity: 0.85,
  });
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cx = -totalX / 2 + r * stepX + cell / 2;
      const cz = -totalZ / 2 + c * stepZ + cell / 2;
      const h = cell / 2;
      const loop = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(cx - h, 0, cz - h),
          new THREE.Vector3(cx + h, 0, cz - h),
          new THREE.Vector3(cx + h, 0, cz + h),
          new THREE.Vector3(cx - h, 0, cz + h),
        ]),
        cellMat,
      );
      loop.position.y = 0.05;
      zone.add(loop);
    }
  }
  group.add(zone);
}

// Rozklada strefy peryferyjne wg pozycji z planu hali (px,py -> swiat).
function buildPeripheralSectors(group, routePoints, s) {
  if (!routePoints.length) return;
  const cx = s.planCX ?? 515;        // px srodka linii w planie
  const cy = s.planCY ?? 180;        // py osi linii w planie
  const zS = s.planZScale ?? 0.0627; // px planu -> swiat WZDLUZ linii
  const xS = s.planXScale ?? 0.075;  // px planu -> swiat W POPRZEK linii
  // py < cy (gora planu) -> +X; py > cy (dol planu) -> -X.
  // planGap = staly odstep od linii na kazda strone (cofa strefy od stanowisk).
  const gap = s.planGap ?? 0;
  // Bufor na rolotoku: strefy planu o px > planPx przesuwaja sie z linia, zeby
  // zostaly przy swoich stacjach za buforem (a nie wpadly w pusty odcinek).
  const buf = TUNE.bufferSegment ?? {};
  const bufExtra = (buf.enabled ?? false) ? (buf.extraLength ?? 0) : 0;
  const bufPlanPx = buf.planPx ?? Infinity;
  const toWorld = (px, py) => {
    const raw = (cy - py) * xS;
    const z = (px - cx) * zS + (px > bufPlanPx ? bufExtra : 0);
    return { x: raw + (raw >= 0 ? gap : -gap), z };
  };

  PLAN_SECTORS.forEach((def) => {
    const { x, z } = toWorld(def.px, def.py);
    const zone = createSectorZone({
      label: def.label,
      sublabel: def.minutes ? `${def.minutes} min` : '',
      // Kolor wlasny strefy (z edytora) ma pierwszenstwo przed kolorem typu.
      color: def.color ?? SECTOR_COLORS[def.type] ?? SECTOR_COLORS.magazyn,
      width: (def.ph ?? 60) * xS,  // w poprzek (X)
      depth: (def.pw ?? 60) * zS,  // wzdluz (Z)
      opacity: s.opacity ?? 0.22,
      labelHeight: s.labelHeight ?? 1.45,
    });
    zone.position.set(x, 0.02, z);
    zone.userData.sectorGroup = def.type;
    group.add(zone);
  });

  // Bufor podstaw - siatka miejsc na palety (pozycja tez z planu).
  const b = toWorld(s.bufferPx ?? 1160, s.bufferPy ?? 85);
  buildBufferGrid(group, b.x, b.z, s);
}

// Buduje jedna sylwetke pracownika (pozycjonowanie i wpis do stationWorkers
// robi wywolujacy). stageColor koloruje helmet/koncowke narzedzia, skinSeed
// urozmaica odcien skory, showTool pokazuje/chowa trzymane narzedzie.
function createWorkerFigure(stageColor, skinSeed, showTool) {
  const skinColors = ['#d6a47a', '#9a6848', '#e0b48f', '#704832'];
  const worker = new THREE.Group();
  worker.visible = SHOW_WORKERS;
  worker.position.y = -0.095;
  worker.scale.setScalar(1.12);

  const hips = new THREE.Mesh(
    new RoundedBoxGeometry(0.46, 0.24, 0.3, 3, 0.055),
    makeMaterial('#1e293b', 0.76, 0.04),
  );
  hips.position.y = 0.78;
  hips.castShadow = true;
  hips.name = 'workerHips';
  worker.add(hips);

  const legs = [];
  [-0.14, 0.14].forEach((x) => {
    const legPivot = new THREE.Group();
    legPivot.position.set(x, 0.72, 0);
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.095, 0.62, 14),
      makeMaterial('#25344a', 0.78, 0.04),
    );
    leg.position.y = -0.29;
    leg.castShadow = true;
    legPivot.add(leg);
    const boot = new THREE.Mesh(
      new RoundedBoxGeometry(0.2, 0.12, 0.34, 3, 0.035),
      makeMaterial('#111827', 0.68, 0.12),
    );
    boot.position.set(0, -0.62, 0.08);
    boot.castShadow = true;
    boot.name = 'workerBoot';
    legPivot.add(boot);
    legs.push(legPivot);
    worker.add(legPivot);
  });

  const torso = new THREE.Mesh(
    new RoundedBoxGeometry(0.58, 0.76, 0.34, 4, 0.095),
    makeMaterial('#334155', 0.72, 0.03),
  );
  torso.position.y = 1.28;
  torso.castShadow = true;
  torso.name = 'workerTorso';
  worker.add(torso);

  const vest = new THREE.Mesh(
    new RoundedBoxGeometry(0.6, 0.58, 0.055, 4, 0.025),
    makeMaterial('#f59e0b', 0.66, 0.03),
  );
  vest.position.set(0, 1.28, 0.195);
  vest.castShadow = true;
  vest.name = 'safetyVest';
  worker.add(vest);
  [-0.15, 0.15].forEach((yOffset) => {
    const reflectiveBand = makeBox(0.62, 0.045, 0.018, '#f8fafc', 'reflectiveBand');
    reflectiveBand.position.set(0, 1.28 + yOffset, 0.228);
    worker.add(reflectiveBand);
  });

  const skinMaterial = makeMaterial(skinColors[skinSeed % skinColors.length], 0.76, 0.01);
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.105, 0.11, 0.16, 18),
    skinMaterial,
  );
  neck.position.y = 1.69;
  neck.castShadow = true;
  worker.add(neck);

  const headPivot = new THREE.Group();
  headPivot.position.y = 1.86;
  worker.add(headPivot);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.205, 20, 16), skinMaterial);
  head.scale.set(0.92, 1.04, 0.9);
  head.castShadow = true;
  headPivot.add(head);

  const faceMaterial = makeMaterial('#172033', 0.82, 0);
  [-0.075, 0.075].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), faceMaterial);
    eye.position.set(x * 0.92, 0.035, 0.182);
    headPivot.add(eye);
  });
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 9), skinMaterial);
  nose.scale.set(0.72, 0.9, 1.15);
  nose.position.set(0, -0.02, 0.198);
  headPivot.add(nose);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.225, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
    makeMaterial(stageColor, 0.38, 0.08),
  );
  helmet.position.y = 0.12;
  helmet.castShadow = true;
  headPivot.add(helmet);
  const helmetBrim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.205, 0.218, 0.045, 24),
    makeMaterial(stageColor, 0.38, 0.08),
  );
  helmetBrim.scale.z = 0.72;
  helmetBrim.position.set(0, 0.09, 0.05);
  helmetBrim.castShadow = true;
  helmetBrim.name = 'helmetBrim';
  headPivot.add(helmetBrim);

  const arms = [];
  [-0.37, 0.37].forEach((x, armIndex) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(x, 1.54, 0);
    shoulder.rotation.z = armIndex === 0 ? -0.12 : 0.12;
    const upperArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.088, 0.08, 0.31, 14),
      makeMaterial('#475569', 0.72, 0.03),
    );
    upperArm.position.y = -0.14;
    upperArm.castShadow = true;
    shoulder.add(upperArm);

    const elbow = new THREE.Group();
    elbow.position.y = -0.29;
    shoulder.add(elbow);
    const elbowJoint = new THREE.Mesh(
      new THREE.SphereGeometry(0.082, 14, 10),
      makeMaterial('#475569', 0.72, 0.03),
    );
    elbowJoint.castShadow = true;
    elbow.add(elbowJoint);
    const forearm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.076, 0.066, 0.31, 14),
      makeMaterial('#334155', 0.74, 0.03),
    );
    forearm.position.y = -0.14;
    forearm.castShadow = true;
    elbow.add(forearm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 10), skinMaterial);
    hand.position.y = -0.31;
    hand.castShadow = true;
    elbow.add(hand);
    arms.push({ shoulder, elbow, hand });
    worker.add(shoulder);
  });

  const toolGroup = new THREE.Group();
  toolGroup.visible = showTool;
  arms[1].elbow.add(toolGroup);
  const tool = new THREE.Mesh(
    new RoundedBoxGeometry(0.12, 0.16, 0.28, 3, 0.025),
    makeMaterial('#1f2937', 0.58, 0.28),
  );
  tool.position.set(0, -0.34, 0.14);
  tool.rotation.x = -0.22;
  tool.castShadow = true;
  tool.name = 'handTool';
  toolGroup.add(tool);
  const toolTip = makeBox(0.055, 0.055, 0.2, stageColor, 'handToolTip');
  toolTip.position.set(0, -0.33, 0.36);
  toolGroup.add(toolTip);

  worker.userData = {
    head: headPivot,
    torso,
    vest,
    leftArm: arms[0],
    rightArm: arms[1],
    legs,
    toolGroup,
    toolTip,
    baseY: worker.position.y,
  };
  return worker;
}

function setPartOpacity(mesh, opacity) {
  mesh.visible = opacity > 0.01;
  const updateMaterial = (material) => {
    material.transparent = opacity < 1;
    material.opacity = opacity;
    material.depthWrite = opacity > 0.82;
  };
  const updateObject = (object) => {
    if (!object.material) return;
    if (Array.isArray(object.material)) object.material.forEach(updateMaterial);
    else updateMaterial(object.material);
  };
  updateObject(mesh);
  if (!mesh.material && mesh.traverse) mesh.traverse(updateObject);
}

function cloneGlbComponent(template) {
  const clone = template.clone(true);
  clone.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone();
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return clone;
}

function createTwoPartLockerModel(stageOneTemplates = null) {
  const group = new THREE.Group();
  group.scale.setScalar(0.74);

  const moduleRoots = [];
  const troughAssemblies = [];
  const troughComponents = [];
  const lockPosePivots = [];
  const troughParts = [];
  const lockRails = [];
  const locks = [];
  const sideWalls = [];
  const backWalls = [];
  const shelves = [];
  const baseShelves = [];
  const lockerCells = [];
  const moduleStartX = 1.48;
  const moduleFinalX = 1.02;

  for (let moduleIndex = 0; moduleIndex < MODULE_COUNT; moduleIndex += 1) {
    const direction = moduleIndex === 0 ? 1 : -1;
    const travelOffset = moduleIndex === 0 ? -2.72 : 2.72;
    const moduleCenterX = stageOneTemplates?.moduleCenterX?.[moduleIndex] ?? 0;
    const startX = stageOneTemplates ? 0 : direction * moduleStartX;
    const finalX = stageOneTemplates ? moduleCenterX : direction * moduleFinalX;
    const root = new THREE.Group();
    root.name = `lockerModulePivot-${moduleIndex + 1}`;
    root.position.set(startX, 0, ASSEMBLY_HALF_LENGTH + travelOffset);
    root.userData.startX = startX;
    root.userData.finalX = finalX;
    root.userData.travelZ = ASSEMBLY_HALF_LENGTH + travelOffset;
    root.userData.finalZ = ASSEMBLY_HALF_LENGTH;
    root.userData.moduleIndex = moduleIndex;

    const content = new THREE.Group();
    content.position.z = -ASSEMBLY_HALF_LENGTH;
    // Obrot CALEJ czesci wokol Y - zamienia konce wzdluz dlugiej osi, wiec po
    // postawieniu pionowym (etap koncowy) czesc stoi prawidlowo, a nie do gory
    // nogami. Cala zawartosc obraca sie spojnie (drzwi nadal patrza na zewnatrz).
    // Gdyby przegielo w druga strone - daj TUNE.partsRotY = 0.
    content.rotation.y = TUNE.partsRotY;
    root.add(content);
    group.add(root);
    moduleRoots.push(root);

    const troughAssembly = new THREE.Group();
    troughAssembly.name = `rotatingTroughAssembly-${moduleIndex + 1}`;
    troughAssembly.userData.moduleIndex = moduleIndex;
    troughAssembly.position.set(stageOneTemplates ? 0 : 0.91, 0, 0);
    troughAssembly.rotation.z = stageOneTemplates ? 0 : -Math.PI / 2;
    content.add(troughAssembly);
    troughAssemblies.push(troughAssembly);

    if (stageOneTemplates?.trough) {
      const troughModelGroup = new THREE.Group();
      troughModelGroup.name = `glbTroughSet-${moduleIndex + 1}`;
      const moduleTroughTemplates = moduleIndex === 0
        ? [stageOneTemplates.centerTrough, stageOneTemplates.smallTroughLeft]
        : [stageOneTemplates.trough, stageOneTemplates.smallTroughRight];
      moduleTroughTemplates.forEach((template, componentIndex) => {
        const componentPivot = new THREE.Group();
        componentPivot.name = `troughComponentPivot-${moduleIndex + 1}-${componentIndex + 1}`;
        componentPivot.userData.componentIndex = componentIndex;
        componentPivot.userData.moduleIndex = moduleIndex;
        componentPivot.userData.targetPosition = new THREE.Vector3();
        const troughModel = applyGlbMaterial(cloneGlbComponent(template), 'trough');
        troughModel.name = `glbTrough-${moduleIndex + 1}-${componentIndex + 1}`;
        troughModel.position.x = -moduleCenterX;
        componentPivot.add(troughModel);
        troughModelGroup.add(componentPivot);
        troughComponents.push(componentPivot);
      });
      troughParts.push(troughModelGroup);
      troughAssembly.add(troughModelGroup);
    } else {
      const troughSpine = makeBox(0.14, 1.08, ASSEMBLY_LENGTH - 0.08, '#94a3b8', `standingTrough-${moduleIndex + 1}`);
      troughSpine.position.set(0, 0, 0);
      troughParts.push(troughSpine);
      troughAssembly.add(troughSpine);

      [-0.49, 0.49].forEach((y, lipIndex) => {
        const lip = makeBox(0.38, 0.1, ASSEMBLY_LENGTH - 0.04, '#cbd5e1', `standingTroughLip-${moduleIndex + 1}-${lipIndex + 1}`);
        lip.position.set(-0.12, y, 0);
        troughParts.push(lip);
        troughAssembly.add(lip);
      });

      const lockRail = makeBox(0.12, 0.72, ASSEMBLY_LENGTH - 0.22, '#1f2937', `lockRail-${moduleIndex + 1}`);
      lockRail.position.set(-0.08, 0, 0);
      lockRails.push(lockRail);
      troughAssembly.add(lockRail);
    }

    // Zamki stawiamy na ZMIERZONEJ pozycji wiekszego koryta (pierwszy element
    // zestawu = ten wiekszy/zamkowy). Mierzymy realne polozenie w scenie, wiec
    // zamki nie laduja "w kosmosie" ani na mniejszej blasze - zawsze na duzym.
    let lockSide = stageOneTemplates ? 0 : -0.2;
    if (stageOneTemplates?.trough) {
      const bigTrough = troughAssembly.getObjectByName(`glbTrough-${moduleIndex + 1}-1`);
      if (bigTrough) {
        group.updateMatrixWorld(true);
        const troughCenter = new THREE.Box3().setFromObject(bigTrough).getCenter(new THREE.Vector3());
        lockSide = troughAssembly.worldToLocal(troughCenter.clone()).x + (TUNE.lockX[moduleIndex] ?? 0);
      } else {
        lockSide = TUNE.lockX[moduleIndex] ?? 0;
      }
    }
    const lockTargetY = stageOneTemplates ? -0.58 : 0;
    const lockPosePivot = new THREE.Group();
    lockPosePivot.name = `lockPosePivot-${moduleIndex + 1}`;
    lockPosePivot.userData.moduleIndex = moduleIndex;
    troughAssembly.add(lockPosePivot);
    lockPosePivots.push(lockPosePivot);

    for (let row = 0; row < LOCKS_PER_MODULE; row += 1) {
      // Ten sam start co siatka skrytek (TUNE.cellRowStart) - zamek rzedu N
      // musi lezec dokladnie tam, gdzie potem wjedzie skrytka N.
      const rowZ = TUNE.cellRowStart + row * ASSEMBLY_ITEM_SPACING;
      const lock = stageOneTemplates?.lock
        ? applyGlbMaterial(cloneGlbComponent(stageOneTemplates.lock), 'lock')
        : new THREE.Group();
      lock.name = stageOneTemplates?.lock
        ? `glbModule-${moduleIndex + 1}-lock-${row + 1}`
        : `module-${moduleIndex + 1}-lock-${row + 1}`;
      lock.position.set(lockSide, 0, rowZ);
      lock.userData.targetX = lockSide;
      lock.userData.entryX = stageOneTemplates ? -direction * 1.42 : -1.15;
      lock.userData.targetY = lockTargetY;
      lock.userData.moduleDirection = direction;

      if (stageOneTemplates?.lock) {
        lock.userData.meshes = [];
        lock.traverse((object) => {
          if (object.isMesh) lock.userData.meshes.push(object);
        });
      } else {
        const housing = makeBox(0.26, 0.12, 0.15, '#111827', 'moduleLockHousing');
        const latch = makeBox(0.13, 0.08, 0.08, '#facc15', 'moduleLockLatch');
        latch.position.set(-0.16, 0.03, 0);
        const pin = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.045, 0.16, 16),
          makeMaterial('#e5e7eb', 0.28, 0.72),
        );
        pin.rotation.x = Math.PI / 2;
        pin.position.y = 0.08;
        pin.castShadow = true;
        lock.add(housing, latch, pin);
        lock.userData.meshes = [housing, latch, pin];
      }
      locks.push(lock);
      lockPosePivot.add(lock);
    }

    // Zmierz automatycznie korekte potrzebna po polozeniu calego zestawu
    // (koryto + zamki) o 90 stopni. Zachowujemy srodek X i dolna krawedz Y,
    // wiec zestaw lezy na rolkach zamiast obracac sie wokol przypadkowego
    // punktu eksportu modelu GLB.
    const troughTargetX = troughAssembly.position.x;
    const troughTargetY = troughAssembly.position.y;
    const measureTroughPose = (rotationZ) => {
      troughAssembly.rotation.z = rotationZ;
      troughAssembly.position.set(troughTargetX, troughTargetY, 0);
      group.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(troughAssembly);
      const worldCenter = bounds.getCenter(new THREE.Vector3());
      const localCenter = content.worldToLocal(worldCenter.clone());
      const localBottom = content.worldToLocal(
        new THREE.Vector3(worldCenter.x, bounds.min.y, worldCenter.z),
      ).y;
      return { centerX: localCenter.x, bottomY: localBottom };
    };
    const uprightTroughPose = measureTroughPose(0);
    const lyingTroughPose = measureTroughPose(-Math.PI / 2);
    troughAssembly.userData.targetX = troughTargetX;
    troughAssembly.userData.targetY = troughTargetY;
    troughAssembly.userData.lyingOffsetX = uprightTroughPose.centerX - lyingTroughPose.centerX;
    troughAssembly.userData.lyingOffsetY = uprightTroughPose.bottomY - lyingTroughPose.bottomY;
    troughAssembly.rotation.z = -Math.PI / 2;
    troughAssembly.position.x = troughTargetX + troughAssembly.userData.lyingOffsetX;
    troughAssembly.position.y = troughTargetY + troughAssembly.userData.lyingOffsetY;
    group.updateMatrixWorld(true);

    const moduleWallTemplates = moduleIndex === 0
      ? { left: stageOneTemplates?.sideWallCenter, right: stageOneTemplates?.sideWallLeft }
      : { left: stageOneTemplates?.sideWallRight, right: stageOneTemplates?.sideWallCenter };
    [
      { x: -0.91, phase: 'first', entryDirection: -1, template: moduleWallTemplates.left },
      { x: 0.91, phase: 'second', entryDirection: 1, template: moduleWallTemplates.right },
    ].forEach(({ x, phase, entryDirection, template }) => {
      const wall = template
        ? applyGlbMaterial(cloneGlbComponent(template), 'sideWall')
        : makeBox(0.22, 1.16, ASSEMBLY_LENGTH, '#3c424a', `moduleWall-${moduleIndex + 1}-${phase}`);
      wall.name = template
        ? `glbModuleWall-${moduleIndex + 1}-${phase}`
        : `moduleWall-${moduleIndex + 1}-${phase}`;
      const targetX = template ? -moduleCenterX : x;
      wall.position.set(targetX, 0, 0);
      content.add(wall);
      // Obrot pojedynczej sciany W MIEJSCU (TUNE.wallRot) - gdy zle obrocona.
      const wallRot = TUNE.wallRot?.[`${moduleIndex}-${phase}`] ?? [0, 0, 0];
      if (template && (wallRot[0] || wallRot[1] || wallRot[2])) {
        group.updateMatrixWorld(true);
        const before = content.worldToLocal(
          new THREE.Box3().setFromObject(wall).getCenter(new THREE.Vector3()),
        );
        wall.rotation.set(wallRot[0], wallRot[1], wallRot[2]);
        group.updateMatrixWorld(true);
        const after = content.worldToLocal(
          new THREE.Box3().setFromObject(wall).getCenter(new THREE.Vector3()),
        );
        wall.position.x += before.x - after.x;
        wall.position.y += before.y - after.y;
        wall.position.z += before.z - after.z;
      }
      // Reczne dosuniecie sciany (TUNE.wallOffset).
      const wallOff = TUNE.wallOffset?.[`${moduleIndex}-${phase}`] ?? [0, 0, 0];
      wall.position.x += wallOff[0];
      wall.position.y += wallOff[1];
      wall.position.z += wallOff[2];
      wall.userData.targetX = wall.position.x;
      wall.userData.targetY = wall.position.y;
      wall.userData.baseRotZ = wallRot[2];
      wall.userData.entryDirection = entryDirection;
      wall.userData.phase = phase;
      wall.userData.moduleIndex = moduleIndex;
      sideWalls.push(wall);
    });

    const backTemplate = moduleIndex === 0
      ? stageOneTemplates?.backLeft
      : stageOneTemplates?.backRight;
    if (backTemplate) {
      const backWall = applyGlbMaterial(cloneGlbComponent(backTemplate), 'backWall');
      backWall.name = `glbBackWall-${moduleIndex + 1}`;
      // Obrot, bo siatka byla "do gory nogami" (patrz TUNE.backWallRotX).
      backWall.rotation.x = TUNE.backWallRotX;
      backWall.position.set(-moduleCenterX, 0, 0);
      content.add(backWall);
      // Sciana tylnia byla montowana na GORZE. Ma byc na DOLE / z TYLU (patrz
      // zdjecie). Mierzymy jej realny srodek i sprowadzamy go na TUNE.backWallY,
      // a animacja podnosi ja tam od dolu (moze przenikac inne czesci).
      group.updateMatrixWorld(true);
      const backCenterY = content.worldToLocal(
        new THREE.Box3().setFromObject(backWall).getCenter(new THREE.Vector3()),
      ).y;
      const backRestY = TUNE.backWallY - (backCenterY - backWall.position.y);
      backWall.position.y = backRestY;
      backWall.userData.targetY = backRestY;
      backWall.userData.moduleDirection = direction;
      backWalls.push(backWall);
    }

    for (let row = 0; row < LOCKS_PER_MODULE; row += 1) {
      // Pozycja rzedu skrytek (drzwi + polki) - strojona przez TUNE.cellRow*,
      // zeby skrytki wypelnily cala kolumne (przeciw szparze u gory/dolu).
      const rowZ = TUNE.cellRowStart + row * TUNE.cellRowSpacing;
      // Polka: prawdziwy model GLB (polka.glb) zamiast pudelka. Obrot/skala/
      // pozycja sterowane przez TUNE.shelf* (strojenie na zywo).
      let shelf;
      if (stageOneTemplates?.shelf) {
        shelf = applyGlbMaterial(cloneGlbComponent(stageOneTemplates.shelf), 'shelf');
        shelf.name = `glbModuleShelf-${moduleIndex + 1}-${row + 1}`;
        shelf.rotation.x = TUNE.shelfRotX;
        shelf.scale.multiplyScalar(TUNE.shelfScale);
      } else {
        shelf = makeBox(1.72, 1.02, 0.1, '#c2cad2', `moduleShelf-${moduleIndex + 1}-${row + 1}`);
      }
      shelf.position.set(
        TUNE.shelfOffset[0],
        TUNE.shelfOffset[1],
        rowZ + TUNE.shelfOffset[2],
      );
      shelf.userData.targetY = TUNE.shelfOffset[1];
      shelf.userData.moduleDirection = direction;
      shelves.push(shelf);
      content.add(shelf);

      const cell = new THREE.Group();
      cell.name = `moduleCell-${moduleIndex + 1}-${row + 1}`;
      cell.position.set(0, 0.59, rowZ);
      cell.userData.targetY = 0.59;
      cell.userData.entryX = direction * 0.65;
      cell.userData.meshes = [];

      // Proceduralna obramowka skrytki - tylko dla zaslepki (pudelkowych drzwi).
      // Przy prawdziwych drzwiach GLB ramka jest zbedna (drzwi maja swoja).
      if (!stageOneTemplates?.doors) {
        [
          [1.72, 0.05, 0.035, 0, 0, -0.17],
          [1.72, 0.05, 0.035, 0, 0, 0.17],
          [0.045, 0.05, 0.34, -0.86, 0, 0],
          [0.045, 0.05, 0.34, 0.86, 0, 0],
        ].forEach(([width, height, depth, x, y, z]) => {
          const edge = makeBox(width, height, depth, '#3f4854', 'moduleCellEdge');
          edge.position.set(x, y, z);
          cell.userData.meshes.push(edge);
          cell.add(edge);
        });
      }

      // Drzwi: prawdziwy model GLB (jeden z 4 rozmiarow wg TUNE.doorType).
      // Obrot/skala/pozycja sterowane przez TUNE.door* (strojenie na zywo).
      let door;
      if (stageOneTemplates?.doors) {
        const doorTemplate = stageOneTemplates.doors[TUNE.doorType] ?? stageOneTemplates.doors.l;
        door = applyGlbMaterial(cloneGlbComponent(doorTemplate), 'door');
        door.name = `glbModuleDoor-${moduleIndex + 1}-${row + 1}`;
        door.rotation.x = TUNE.doorRotX;
        door.rotation.y = TUNE.doorRotY;
        door.scale.multiplyScalar(TUNE.doorScale);
        door.position.set(TUNE.doorOffset[0], 0.025 + TUNE.doorOffset[1], TUNE.doorOffset[2]);
      } else {
        door = makeBox(1.63, 0.075, 0.29, '#d9dee3', 'moduleLockerDoor');
        door.position.y = 0.025;
      }
      cell.userData.meshes.push(door);
      cell.add(door);

      // Szary pasek na granicy skrytek - zeby biale drzwi sie nie zlewaly w
      // jeden prostokat. Lezy tuz nad licem drzwi, na granicy z sasiednia
      // skrytka. Grubosc i widocznosc sterowane przez TUNE.cellGap.
      if (stageOneTemplates?.doors && TUNE.cellGap > 0) {
        const gapStrip = makeBox(TUNE.cellGapWidth, 0.06, TUNE.cellGap, '#565d66', 'cellGapStrip');
        gapStrip.position.set(
          TUNE.doorOffset[0] + TUNE.cellGapOffset[0],
          0.025 + TUNE.doorOffset[1] + 0.06 + TUNE.cellGapOffset[1],
          TUNE.doorOffset[2] + TUNE.cellRowSpacing / 2 + TUNE.cellGapOffset[2],
        );
        cell.userData.meshes.push(gapStrip);
        cell.add(gapStrip);
      }

      lockerCells.push(cell);
      content.add(cell);
    }

    // === PLASKA DOLNA POLKA (baza kolumny) ===
    // Zamiast 12. skrytki z zamkiem (ktora wystawala poza rame) DOL kolumny
    // konczy sie plaska polka - identyczny model jak polki wewnatrz skrytek,
    // tylko o jeden rzad PONIZEJ ostatniej skrytki (przy dolnej krawedzi ramy,
    // po stronie +Z, ktora wchodzi w podstawe). Daje plaski, rowny z dolem
    // spod, na ktorym kolumna czysto siada na podstawie. Bez zamka i drzwi.
    const baseRowZ = TUNE.cellRowStart + LOCKS_PER_MODULE * TUNE.cellRowSpacing
      + (TUNE.baseShelfNudgeZ ?? 0);
    let baseShelf;
    if (stageOneTemplates?.shelf) {
      baseShelf = applyGlbMaterial(cloneGlbComponent(stageOneTemplates.shelf), 'shelf');
      baseShelf.name = `glbBaseShelf-${moduleIndex + 1}`;
      baseShelf.rotation.x = TUNE.shelfRotX;
      baseShelf.scale.multiplyScalar(TUNE.shelfScale);
    } else {
      baseShelf = makeBox(1.72, 1.02, 0.1, '#c2cad2', `baseShelf-${moduleIndex + 1}`);
    }
    baseShelf.position.set(
      TUNE.shelfOffset[0],
      TUNE.shelfOffset[1],
      baseRowZ + TUNE.shelfOffset[2],
    );
    baseShelf.userData.targetY = TUNE.shelfOffset[1];
    baseShelf.userData.moduleDirection = direction;
    baseShelves.push(baseShelf);
    content.add(baseShelf);
  }

  const base = stageOneTemplates?.base
    ? applyGlbMaterial(cloneGlbComponent(stageOneTemplates.base), 'base')
    : makeBox(4.58, 0.36, 1.38, '#24282d', 'joinedBase');
  base.name = stageOneTemplates?.base ? 'glbJoinedBase' : 'joinedBase';
  if (stageOneTemplates?.base) {
    const baseRot = TUNE.baseRot ?? [Math.PI / 2, 0, 0];
    const baseOffset = TUNE.baseOffset ?? [0, 0, 0];
    // Podstawa jest osobnym modelem GLB i trafia na palete; jej orientacja jest
    // w TUNE, zeby szybko poprawic eksport odwrócony z Blendera.
    base.rotation.set(baseRot[0] ?? 0, baseRot[1] ?? 0, baseRot[2] ?? 0);
    base.position.set(
      baseOffset[0] ?? 0,
      stageOneTemplates.standingOffsetY + (baseOffset[1] ?? 0),
      ASSEMBLY_HALF_LENGTH + (baseOffset[2] ?? 0),
    );
    base.userData.targetZ = ASSEMBLY_HALF_LENGTH;
  } else {
    base.position.set(0, -0.13, -ASSEMBLY_HALF_LENGTH);
  }
  base.userData.targetY = stageOneTemplates?.base
    ? stageOneTemplates.standingOffsetY + (TUNE.baseOffset?.[1] ?? 0)
    : -0.13;
  group.add(base);

  const baseFront = stageOneTemplates?.base
    ? new THREE.Group()
    : makeBox(4.34, 0.3, 0.14, '#090b0e', 'joinedBaseFront');
  baseFront.name = 'joinedBaseFront';
  baseFront.position.set(0, stageOneTemplates?.base ? stageOneTemplates.standingOffsetY : 0.09, stageOneTemplates?.base ? 0 : -ASSEMBLY_HALF_LENGTH - 0.62);
  baseFront.userData.targetY = stageOneTemplates?.base ? stageOneTemplates.standingOffsetY : 0.09;
  group.add(baseFront);

  const backPanel = stageOneTemplates?.backLeft && stageOneTemplates?.backRight
    ? new THREE.Group()
    : makeBox(4.12, ASSEMBLY_LENGTH - 0.12, 0.12, '#15181d', 'joinedBackPanel');
  backPanel.name = 'joinedBackPanel';
  backPanel.position.set(0, ASSEMBLY_HALF_LENGTH, -1.83);
  backPanel.userData.targetY = ASSEMBLY_HALF_LENGTH;
  backPanel.userData.targetZ = -1.83;
  group.add(backPanel);

  // Stary profil laczacy (centerJoinProfile) - NIEUZYWANY. Zostaje pusta grupa,
  // zeby reszta kodu (finalize) dzialala bez zmian, ale nic sie nie pokazuje.
  const centerJoin = new THREE.Group();
  centerJoin.position.set(0, ASSEMBLY_HALF_LENGTH, -3.0);
  centerJoin.userData.targetY = ASSEMBLY_HALF_LENGTH;
  centerJoin.userData.targetZ = -3.0;
  group.add(centerJoin);

  const roof = stageOneTemplates?.roof
    ? applyGlbMaterial(cloneGlbComponent(stageOneTemplates.roof), 'roof')
    : makeBox(4.3, 0.18, 1.42, '#363c44', 'singleRoof');
  roof.name = stageOneTemplates?.roof ? 'glbSingleRoof' : 'singleRoof';
  if (stageOneTemplates?.roof) {
    // Dach na GORZE kolumny. Obrot TUNE.roofRot (kolejnosc YXZ: rotY = obrot
    // wokol PIONU, wiec rotY=PI obraca skos na druga strone NIE kladac dachu na
    // sztorc). Po obrocie USTAWIAM srodek dachu dokladnie na szczycie kolumny
    // (X=0, Z=ASSEMBLY_HALF_LENGTH) + TUNE.roofOffset. Wysokosc -> targetY.
    roof.rotation.order = 'YXZ';
    roof.rotation.set(TUNE.roofRot[0], TUNE.roofRot[1], TUNE.roofRot[2]);
    roof.position.set(0, stageOneTemplates.standingOffsetY + ASSEMBLY_LENGTH + TUNE.roofYOffset, ASSEMBLY_HALF_LENGTH);
    group.add(roof);
    group.updateMatrixWorld(true);
    const c = group.worldToLocal(new THREE.Box3().setFromObject(roof).getCenter(new THREE.Vector3()));
    roof.position.x += TUNE.roofOffset[0] - c.x;
    roof.position.z += ASSEMBLY_HALF_LENGTH + TUNE.roofOffset[2] - c.z;
    roof.userData.targetZ = roof.position.z;
  } else {
    roof.position.set(0, ASSEMBLY_LENGTH + 0.08, -ASSEMBLY_HALF_LENGTH);
  }
  roof.userData.targetY = stageOneTemplates?.roof
    ? stageOneTemplates.standingOffsetY + ASSEMBLY_LENGTH + TUNE.roofYOffset + TUNE.roofOffset[1]
    : ASSEMBLY_LENGTH + 0.08;
  group.add(roof);

  const roofFascia = stageOneTemplates?.canopy
    ? applyGlbMaterial(cloneGlbComponent(stageOneTemplates.canopy), 'canopy')
    : makeBox(4.26, 0.48, 0.2, '#9aa3ac', 'singleRoofFascia');
  roofFascia.name = stageOneTemplates?.canopy ? 'glbCanopy' : 'singleRoofFascia';
  if (stageOneTemplates?.canopy) {
    // Daszek POD dachem (okap). Jak dach: obrot YXZ (rotY wokol pionu) i srodek
    // ustawiany na szczycie kolumny + TUNE.canopyOffset. Wysokosc -> targetY.
    roofFascia.rotation.order = 'YXZ';
    roofFascia.rotation.set(TUNE.canopyRot[0], TUNE.canopyRot[1], TUNE.canopyRot[2]);
    roofFascia.position.set(0, stageOneTemplates.standingOffsetY + ASSEMBLY_LENGTH + TUNE.canopyYOffset, ASSEMBLY_HALF_LENGTH);
    group.add(roofFascia);
    group.updateMatrixWorld(true);
    const c = group.worldToLocal(new THREE.Box3().setFromObject(roofFascia).getCenter(new THREE.Vector3()));
    roofFascia.position.x += TUNE.canopyOffset[0] - c.x;
    roofFascia.position.z += ASSEMBLY_HALF_LENGTH + TUNE.canopyOffset[2] - c.z;
    roofFascia.userData.targetZ = roofFascia.position.z;
  } else {
    roofFascia.position.set(0, ASSEMBLY_LENGTH - 0.04, -ASSEMBLY_HALF_LENGTH - 0.62);
  }
  roofFascia.userData.targetY = stageOneTemplates?.canopy
    ? stageOneTemplates.standingOffsetY + ASSEMBLY_LENGTH + TUNE.canopyYOffset + TUNE.canopyOffset[1]
    : ASSEMBLY_LENGTH - 0.04;
  group.add(roofFascia);

  const warningLight = new THREE.Group();
  warningLight.position.set(0, ASSEMBLY_LENGTH + 0.72, -ASSEMBLY_HALF_LENGTH - 0.5);
  const warningPost = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.42, 14),
    makeMaterial('#334155', 0.45, 0.28),
  );
  warningPost.position.y = -0.18;
  const warningBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 24, 18),
    new THREE.MeshStandardMaterial({
      color: '#dc2626',
      emissive: '#dc2626',
      emissiveIntensity: 0,
      roughness: 0.35,
    }),
  );
  const warningGlow = new THREE.PointLight('#ef4444', 0, 2.8);
  warningGlow.position.y = 0.1;
  warningLight.add(warningPost, warningBulb, warningGlow);
  warningLight.visible = false;
  group.add(warningLight);

  group.userData.parts = {
    moduleRoots,
    troughAssemblies,
    troughComponents,
    lockPosePivots,
    troughParts,
    lockRails,
    locks,
    sideWalls,
    backWalls,
    shelves,
    baseShelves,
    lockerCells,
    base,
    baseFront,
    backPanel,
    centerJoin,
    roofs: [roof],
    roofFascias: [roofFascia],
    warningLight,
    warningBulb,
    warningGlow,
  };
  group.userData.usesStageOneGlb = Boolean(stageOneTemplates?.trough && stageOneTemplates?.lock);

  return group;
}

function updateTwoPartLockerModel(
  group,
  leadUnit,
  trailUnit,
  time,
  stages,
  halfMode,
  troughLyingPoses = createDefaultTroughLyingPoses(),
  // Czesci WYKONCZENIOWE (laczenie/nitowanie, plecy, dach, daszek). Domyslnie
  // montuja sie NA PALECIE na etapie 3, zaraz po postawieniu obu polowek
  // (placeHalf przekazuje finishOnPallet). Gdy istnieje etap offline (ostatni
  // etap z ikona 'offline'), wykonczenie odbywa sie poza linia na stanowisku
  // i wlacza je dopiero placeOffline.
  showFinishing = false,
  finalLanding = null,
) {
  const parts = group.userData.parts;
  const stageIndex = (icon) => stages.findIndex((candidate) => candidate.icon === icon);
  const smooth = (value) => easeOut(THREE.MathUtils.clamp(value, 0, 1));
  // Ruchy CALEJ polowy na etapie 3 (pion, ladowanie na palete, dosuwanie)
  // startuja z pelnego bezruchu - musza ruszac z zerowa predkoscia, inaczej
  // pierwsza klatka robi widoczny przeskok.
  const smoothInOut = (value) => easeInOut(THREE.MathUtils.clamp(value, 0, 1));
  const finalizeIndex = stageIndex('finalize');

  // === #4 (osobne obiekty): frakcje montazu liczone NIEZALEZNIE dla kazdej
  // jednostki. Modul 0 = leadUnit (czolo), modul 1 = trailUnit (ogon, czyli ten
  // sam paczkomat sprzed halfDelaySeconds). Brak sztucznej kompresji/przesuniec
  // - separacje daje pozycja obu modeli na tasmie.
  const fractionsForUnit = (u) => {
    if (!u) return {
      trough: 0,
      locks: 0,
      structure: 0,
      lockers: 0,
      finalize: 0,
      entry: false,
    };
    const prog = THREE.MathUtils.clamp((u.assemblyProgress ?? u.progress ?? 0) / 100, 0, 1);
    const t = u.mode === 'entry' ? 0 : u.currentIndex + prog;
    const finalizeCompleted = finalizeIndex >= 0 && u.currentIndex > finalizeIndex;
    const at = (icon) => {
      const idx = stageIndex(icon);
      if (idx < 0) return 0;
      return THREE.MathUtils.clamp(t - idx, 0, 1);
    };
    return {
      // Koryto jest gotowym nosnikiem od samego wejscia na linie. Nie zerujemy
      // jego postepu po zatrzymaniu na etapie 0, bo powodowalo to skok skali
      // 1 -> 0.72 -> 1 (pozorne kurczenie i ponowne rozciaganie).
      trough: 1,
      locks: at('locks'),
      structure: at('shelves'),
      lockers: at('lockers'),
      finalize: finalizeCompleted ? 1 : at('finalize'),
      entry: u.mode === 'entry',
    };
  };
  const lead = fractionsForUnit(leadUnit);
  const trail = fractionsForUnit(trailUnit);
  const modFr = (moduleIndex) => (moduleIndex === 1 ? trail : lead);
  // Modul 1 (druga polowa/trail) ma fizycznie odwrocone koryto wzgledem modulu 0
  // (lustrzane ulozenie), wiec montaz zamkow/polek/skrytek w tej samej kolejnosci
  // co modul 0 szedlby od dolu zamiast od gory. Odwracamy kolejnosc TYLKO dla
  // modulu 1, zeby obie polowy budowaly sie wizualnie w tym samym kierunku.
  const moduleLocalIndex = (moduleIndex, flatIndex) => {
    const raw = flatIndex - moduleIndex * LOCKS_PER_MODULE;
    return moduleIndex === 1 ? LOCKS_PER_MODULE - 1 - raw : raw;
  };
  // Wartosci "wspolne" (podstawa) ida za liderem.
  const locksBuild = lead.locks;
  const structureBuild = lead.structure;
  const lockersBuild = lead.lockers;
  const finalizeBuild = lead.finalize;

  parts.troughParts.forEach((part, index) => {
    const fr = modFr(index);
    const trayProgress = smooth(fr.trough);
    setPartOpacity(part, trayProgress);
    part.scale.z = 0.72 + trayProgress * 0.28;
  });
  parts.lockRails.forEach((rail, index) => {
    const fr = modFr(index);
    setPartOpacity(rail, smooth((fr.locks - 0.05) / 0.15) * (1 - smooth(fr.lockers)));
  });

  parts.locks.forEach((lock, index) => {
    const m = index < LOCKS_PER_MODULE ? 0 : 1;
    const fr = modFr(m);
    const localIndex = moduleLocalIndex(m, index);
    const lockTimeline = Math.max(0, (fr.locks - 0.14) / 0.86) * LOCKS_PER_MODULE;
    const rawProgress = THREE.MathUtils.clamp(lockTimeline - localIndex, 0, 1);
    const progress = smooth(rawProgress);
    const matchingLockerProgress = smooth(
      THREE.MathUtils.clamp(fr.lockers * LOCKS_PER_MODULE - localIndex, 0, 1),
    );
    const visibleProgress = progress * (1 - matchingLockerProgress);
    lock.visible = visibleProgress > 0.01;
    lock.position.x = THREE.MathUtils.lerp(lock.userData.entryX, lock.userData.targetX, progress);
    lock.position.y = lock.userData.targetY + Math.sin(progress * Math.PI) * 0.12;
    lock.rotation.z = (1 - progress) * 0.22;
    lock.scale.setScalar(0.76 + progress * 0.24);
    lock.userData.meshes.forEach((mesh) => {
      setPartOpacity(mesh, visibleProgress);
      mesh.material.emissive = new THREE.Color(ACCENT_COLOR);
      mesh.material.emissiveIntensity = rawProgress > 0 && rawProgress < 1
        ? 0.14 + Math.sin(time * 8 + index) * 0.05
        : 0;
    });
  });

  parts.troughAssemblies.forEach((assembly) => {
    const moduleIndex = assembly.userData.moduleIndex ?? 0;
    const troughMotion = getTroughStandMotion(modFr(moduleIndex).structure);
    // Etap 1: najpierw unosimy koryto nad rolki, dopiero potem obracamy i
    // osadzamy. Dzieki temu model nie przecina rolotoku w trakcie ustawiania.
    const lyingAmount = troughMotion.lyingAmount;
    const troughPosOffset = (moduleIndex === 0 ? TUNE.troughTurn?.posOffset0 : TUNE.troughTurn?.posOffset1) ?? [0, 0, 0];
    assembly.rotation.set(0, 0, -Math.PI * 0.5 * lyingAmount);
    assembly.position.x = THREE.MathUtils.lerp(
      assembly.userData.targetX,
      assembly.userData.targetX + assembly.userData.lyingOffsetX,
      lyingAmount,
    ) + (troughPosOffset[0] ?? 0);
    assembly.position.y = THREE.MathUtils.lerp(
      assembly.userData.targetY,
      assembly.userData.targetY + assembly.userData.lyingOffsetY,
      lyingAmount,
    ) + troughMotion.clearanceLift + (troughPosOffset[1] ?? 0);
    assembly.position.z = 0 + (troughPosOffset[2] ?? 0);
  });

  // Knoby steruja bezposrednio DWOMA fizycznymi modelami koryt, a nie wspolnym
  // pivotem polowy paczkomatu. Odpowiadajace sobie koryta obu polow korzystaja
  // z tego samego zestawu korekt, ale nigdy nie obracaja drugiego typu koryta.
  const applyLyingPose = (object, pose, troughMotion, fixed) => {
    const lyingAmount = troughMotion.lyingAmount;
    const fRot = fixed?.rot ?? [0, 0, 0];
    const fPos = fixed?.pos ?? [0, 0, 0];
    object.rotation.set(
      THREE.MathUtils.degToRad(pose.rotationX) * lyingAmount + THREE.MathUtils.degToRad(fRot[0] ?? 0),
      THREE.MathUtils.degToRad(pose.rotationY) * lyingAmount + THREE.MathUtils.degToRad(fRot[1] ?? 0),
      THREE.MathUtils.degToRad(pose.rotationZ) * lyingAmount + THREE.MathUtils.degToRad(fRot[2] ?? 0),
    );
    object.position.set(
      pose.offsetX * lyingAmount + (fPos[0] ?? 0),
      pose.offsetY * lyingAmount + (fPos[1] ?? 0),
      pose.offsetZ * lyingAmount + (fPos[2] ?? 0),
    );
  };
  parts.troughComponents.forEach((component) => {
    const componentIndex = component.userData.componentIndex ?? 0;
    const moduleIndex = component.userData.moduleIndex ?? 0;
    const troughMotion = getTroughStandMotion(modFr(moduleIndex).structure);
    const pose = (componentIndex === 0 ? TUNE.troughTurn?.pose0 : TUNE.troughTurn?.pose1) ?? troughLyingPoses[componentIndex] ?? DEFAULT_TROUGH_LYING_POSE;
    const troughFixed = componentIndex === 0 ? TUNE.troughTurn?.large : TUNE.troughTurn?.small;
    applyLyingPose(component, pose, troughMotion, troughFixed);
  });
  // Zamki sa montowane na pierwszym (wiekszym) korycie, dlatego przez etapy
  // 0 i 1 dostaja dokladnie ten sam obrot i przesuniecie co Koryto 1.
  const lockTroughPose = TUNE.troughTurn?.pose0 ?? troughLyingPoses[0] ?? DEFAULT_TROUGH_LYING_POSE;
  parts.lockPosePivots.forEach((pivot) => {
    const moduleIndex = pivot.userData.moduleIndex ?? 0;
    const troughMotion = getTroughStandMotion(modFr(moduleIndex).structure);
    applyLyingPose(pivot, lockTroughPose, troughMotion);
  });

  const animateWall = (wall, progress) => {
    setPartOpacity(wall, progress);
    wall.position.x = wall.userData.targetX + wall.userData.entryDirection * (1 - progress) * 0.32;
    wall.position.y = wall.userData.targetY + (1 - progress) * 1.15;
    wall.rotation.z = (wall.userData.baseRotZ ?? 0)
      + wall.userData.entryDirection * (1 - progress) * 0.12;
  };

  parts.sideWalls.filter((wall) => wall.userData.phase === 'first').forEach((wall) => {
    const fr = modFr(wall.userData.moduleIndex ?? 0);
    animateWall(wall, smooth(THREE.MathUtils.clamp((fr.structure - 0.2) / 0.16, 0, 1)));
  });

  parts.shelves.forEach((shelf, index) => {
    const m = index < LOCKS_PER_MODULE ? 0 : 1;
    const fr = modFr(m);
    const localIndex = moduleLocalIndex(m, index);
    const shelfTimeline = Math.max(0, (fr.structure - 0.36) / 0.46) * LOCKS_PER_MODULE;
    const rawProgress = THREE.MathUtils.clamp(shelfTimeline - localIndex, 0, 1);
    const progress = smooth(rawProgress);
    setPartOpacity(shelf, progress);
    shelf.position.y = shelf.userData.targetY + (1 - progress) * 0.95;
    shelf.position.x = (1 - progress) * shelf.userData.moduleDirection * 0.45;
    shelf.rotation.z = (1 - progress) * shelf.userData.moduleDirection * 0.1;
    // Polka GLB to grupa (brak .material) - emisje tylko dla proceduralnej.
    if (shelf.material) {
      shelf.material.emissive = new THREE.Color(ACCENT_COLOR);
      shelf.material.emissiveIntensity = rawProgress > 0 && rawProgress < 1 ? 0.12 : 0;
    }
  });

  // Plaska dolna polka (jedna na modul): pojawia sie razem z konstrukcja, tuz
  // przed skrytkami - tak jak zwykle polki, tylko bez indeksu rzedu (jest u
  // samego dolu). index 0 = modul 0, index 1 = modul 1.
  parts.baseShelves.forEach((shelf, moduleIndex) => {
    const fr = modFr(moduleIndex);
    const progress = smooth(THREE.MathUtils.clamp((fr.structure - 0.3) / 0.4, 0, 1));
    setPartOpacity(shelf, progress);
    shelf.position.y = shelf.userData.targetY + (1 - progress) * 0.95;
    shelf.position.x = (1 - progress) * shelf.userData.moduleDirection * 0.45;
    shelf.rotation.z = (1 - progress) * shelf.userData.moduleDirection * 0.1;
  });

  parts.backWalls.forEach((backWall, index) => {
    const fr = modFr(index);
    const rawProgress = THREE.MathUtils.clamp((fr.structure - 0.7) / 0.16, 0, 1);
    const progress = smooth(rawProgress);
    setPartOpacity(backWall, progress);
    // Sciana tylnia wjezdza WYRAZNIE OD DOLU (zeby skrytki montowac od gory) i
    // konczy na swojej pozycji z tylu. Moze przenikac przez inne czesci -
    // wazne, ze startuje gleboko pod spodem i podnosi sie na miejsce.
    backWall.position.y = backWall.userData.targetY - (1 - progress) * TUNE.backWallDrop;
    backWall.rotation.x = TUNE.backWallRotX; // utrzymaj obrot (nie zerowac!)
  });

  parts.sideWalls.filter((wall) => wall.userData.phase === 'second').forEach((wall) => {
    const fr = modFr(wall.userData.moduleIndex ?? 0);
    animateWall(wall, smooth(THREE.MathUtils.clamp((fr.structure - 0.82) / 0.18, 0, 1)));
  });

  parts.lockerCells.forEach((cell, index) => {
    const m = index < LOCKS_PER_MODULE ? 0 : 1;
    const fr = modFr(m);
    const localIndex = moduleLocalIndex(m, index);
    const rawProgress = THREE.MathUtils.clamp(fr.lockers * LOCKS_PER_MODULE - localIndex, 0, 1);
    const progress = smooth(rawProgress);
    cell.visible = progress > 0.01;
    cell.position.x = (1 - progress) * cell.userData.entryX;
    cell.position.y = cell.userData.targetY + (1 - progress) * 0.72;
    cell.rotation.z = (1 - progress) * Math.sign(cell.userData.entryX) * 0.14;
    cell.scale.setScalar(0.8 + progress * 0.2);
    cell.userData.meshes.forEach((mesh) => setPartOpacity(mesh, progress));
  });

  const baseProgress = smooth(finalizeBuild / 0.16);
  // Cala grupa modelu schodzi z wysokosci poziomej (0.34) do standingY w
  // trakcie pionowania. Podstawa jest jej dzieckiem, wiec bez kompensacji
  // pojawialaby sie wysoko nad rolkami i opadala razem z rodzicem.
  // UWAGA: to samo okno i krzywa co standingLiftProgress w placeHalf.
  const baseParentLiftProgress = smoothInOut((finalizeBuild - 0.1) / 0.35);
  const currentParentLift = THREE.MathUtils.lerp(
    0.34,
    TUNE.standingY,
    baseParentLiftProgress,
  );
  const baseWorldAnchorCompensation = (
    finalLanding?.enabled
      ? 0
      : TUNE.standingY - currentParentLift
  ) / MODEL_RENDER_SCALE;
  [parts.base, parts.baseFront].forEach((part) => {
    setPartOpacity(part, baseProgress);
    // Kompensujemy ruch nadrzednej grupy, dlatego pozycja SWIATOWA podstawy
    // pozostaje stala od pierwszej widocznej klatki animacji.
    part.position.y = part.userData.targetY + baseWorldAnchorCompensation;
  });

  // Sekwencja koncowa "jedna za druga": pierwsza polowa wstaje pionowo na
  // podstawe i ZOSTAJE (wyrazny postoj), dopiero potem druga polowa nadjezdza
  // i dolacza obok. Pozycje docelowe (finalX/finalZ) pozostaja nietkniete -
  // wynikaja z jednej ramy CAD, wiec polowy skladaja sie idealnie w calosc.
  // PRZEBUDOWA: kazdy modul jest WYSRODKOWANY w swoim modelu (na pozycji swojej
  // polowy na tasmie) - bez sztucznego przesuniecia travelOffset. Stoi pionowo
  // wg swojej frakcji finalize. Na podstawie obie polowy sa w tym samym
  // miejscu (oba modele na tej samej pozie), wiec laczą sie wg CAD-X.
  const centeredZ = ASSEMBLY_HALF_LENGTH; // content.z = -ASSEMBLY_HALF_LENGTH => srodek modelu
  parts.moduleRoots.forEach((root) => {
    const isFirstModule = root.userData.moduleIndex === 0;
    const fr = modFr(root.userData.moduleIndex);

    // === STOL UCHYLNY (wywrotnica, TUNE.tiltTable) ===
    // Czesc jedzie SZTYWNO ze stolem: czysty obrot o 90 stopni wokol zawiasu H,
    // wyliczonego tak, by pozycja startowa (lezenie na stole = dokladnie stara
    // pozycja przyjazdu) i koncowa (stanie w podstawie = dokladnie stara pozycja
    // finalna z nudge'ami) byly IDENTYCZNE jak dotad - zmienia sie tylko sciezka.
    // Zawias wychodzi przy podlodze miedzy koncem rolotoku a paleta, jak w
    // prawdziwej wywrotnicy. Obie polowy trafiaja w TO SAMO miejsce w swiecie -
    // dopasowanie gniazda robi przesuw palety (palletShift w placeHalf).
    const tiltCfg = TUNE.tiltTable ?? {};
    if (finalLanding?.enabled && finalLanding.tilt && (tiltCfg.enabled ?? false)) {
      const tiltStart = tiltCfg.settlePortion ?? 0.15;
      const tiltSpan = Math.max(tiltCfg.tiltPortion ?? 0.55, 0.05);
      const tiltProgress = smoothInOut((fr.finalize - tiltStart) / tiltSpan);
      const theta = Math.PI * 0.5 * tiltProgress;
      // Poza startowa S (lezaca) i koncowa F (stojaca) w ukladzie LOKALNYM modelu.
      const sY = finalLanding.offsetY ?? 0;
      const sZ = centeredZ + (finalLanding.offsetZ ?? 0);
      const fY = (TUNE.columnSettleY ?? 0) + (TUNE.finalNudgeY ?? 0);
      const fZ = centeredZ + (TUNE.finalNudgeZ ?? 0);
      // Zawias H: jedyny punkt, wokol ktorego obrot o DOKLADNIE 90 stopni
      // przenosi S na F (rozwiazanie ukladu F-H = R90*(S-H)).
      const hY = (fY - fZ + sZ + sY) / 2;
      const hZ = (fY + fZ + sZ - sY) / 2;
      const relY = sY - hY;
      const relZ = sZ - hZ;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      root.rotation.x = theta;
      root.position.y = hY + relY * cosT - relZ * sinT;
      root.position.z = hZ + relY * sinT + relZ * cosT;
      const tiltGap = (TUNE.halfGapX ?? 0) * (isFirstModule ? 0.5 : -0.5);
      const tiltOutward = Math.sign(root.userData.finalX) || 1;
      root.position.x = THREE.MathUtils.lerp(
        root.userData.startX + (finalLanding.offsetX ?? 0),
        root.userData.finalX + tiltGap + tiltOutward * (TUNE.finalNudgeX ?? 0),
        tiltProgress,
      );
      // Zawias w ukladzie lokalnym -> placeHalf przelicza na swiat dla stolu.
      group.userData.tiltHingeLocal = { y: hY, z: hZ };
      return;
    }

    const liftProgress = smoothInOut((fr.finalize - 0.1) / 0.35);
    const joinProgress = smoothInOut((fr.finalize - 0.5) / 0.25);
    // Druga polowa konczy dojazd w bok przed rozpoczeciem opuszczania. Wczesniej
    // oba ruchy zachodzily jednoczesnie, przez co dol kolumny przecinal podstawe.
    const secondHalfSlideProgress = smoothInOut((fr.finalize - 0.5) / 0.18);
    const secondHalfLandingProgress = smoothInOut((fr.finalize - 0.68) / 0.12);
    const horizontalProgress = isFirstModule ? joinProgress : secondHalfSlideProgress;
    const landingProgress = isFirstModule ? joinProgress : secondHalfLandingProgress;
    const uprightForLanding = smoothInOut((fr.finalize - 0.38) / 0.12);
    const approachLift = isFirstModule
      ? 0
      : (TUNE.secondHalfApproachLift ?? 0.32)
        * uprightForLanding
        * (1 - secondHalfLandingProgress);
    const gap = (TUNE.halfGapX ?? 0) * (isFirstModule ? 0.5 : -0.5);
    const settle = (TUNE.columnSettleY ?? 0) * landingProgress;
    // Strojenie milimetrowe pozycji finalnej na podstawie (TUNE.finalNudge*),
    // wprowadzane dopiero gdy polowa laduje na podstawie (landingProgress).
    const finalNudge = landingProgress;
    const outwardSign = Math.sign(root.userData.finalX) || 1;
    root.rotation.x = Math.PI * 0.5 * liftProgress;
    root.position.x = THREE.MathUtils.lerp(
      root.userData.startX,
      root.userData.finalX,
      horizontalProgress,
    ) + gap + outwardSign * (TUNE.finalNudgeX ?? 0) * finalNudge;
    root.position.y = settle + approachLift + (TUNE.finalNudgeY ?? 0) * finalNudge;
    root.position.z = centeredZ + (TUNE.finalNudgeZ ?? 0) * finalNudge;
    if (finalLanding?.enabled) {
      const landingProgress = smoothInOut((fr.finalize - 0.08) / 0.56);
      const landingRemain = 1 - landingProgress;
      root.position.x += (finalLanding.offsetX ?? 0) * landingRemain;
      root.position.y += (finalLanding.offsetY ?? 0) * landingRemain
        + Math.sin(landingProgress * Math.PI) * (finalLanding.arcLift ?? 0);
      root.position.z += (finalLanding.offsetZ ?? 0) * landingRemain;
    }
  });

  // Laczenie, plecy, dach i daszek pojawiaja sie wzgledem DRUGIEJ (pozniejszej)
  // polowy - czyli dopiero gdy OBIE czesci stoja juz na podstawie.
  const lateFinalize = trail.finalize;
  const centerProgress = smooth((lateFinalize - 0.78) / 0.08);
  setPartOpacity(parts.centerJoin, centerProgress);
  parts.centerJoin.position.y = parts.centerJoin.userData.targetY + (1 - centerProgress) * 0.65;

  const backProgress = smooth((lateFinalize - 0.8) / 0.08);
  setPartOpacity(parts.backPanel, backProgress);
  parts.backPanel.position.y = parts.backPanel.userData.targetY;
  parts.backPanel.position.z = parts.backPanel.userData.targetZ + (1 - backProgress) * 1.15;
  parts.backPanel.rotation.y = (1 - backProgress) * 0.08;

  parts.roofs.forEach((roof, index) => {
    const progress = smooth((lateFinalize - (0.84 + index * 0.025)) / 0.135);
    setPartOpacity(roof, progress);
    roof.position.y = roof.userData.targetY + (1 - progress) * 0.85;
  });
  parts.roofFascias.forEach((fascia, index) => {
    const progress = smooth((lateFinalize - (0.86 + index * 0.025)) / 0.115);
    setPartOpacity(fascia, progress);
    fascia.position.y = fascia.userData.targetY + (1 - progress) * 0.7;
  });

  // Alarm dotyczy tej konkretnej polowy, ktora czeka na zwolnienie stacji lub
  // odcinka. Lampka jedzie razem z nosnikiem i gasnie natychmiast po ruszeniu.
  const alarmUnit = halfMode === 'trail' ? trailUnit : leadUnit;
  const isWaitingForClearance = Boolean(alarmUnit?.isBlocked);
  parts.warningLight.visible = isWaitingForClearance;
  if (isWaitingForClearance) {
    // Pozycja nad poziomym korytem, blisko zewnetrznej strony danej polowy.
    // Oczekiwanie nie wystepuje na finalnym, pionowym etapie.
    parts.warningLight.position.set(
      halfMode === 'trail' ? -0.9 : 0.9,
      0.72,
      -ASSEMBLY_HALF_LENGTH + 0.4,
    );
    const alarmPulse = 1 + Math.sin(time * 9) * 0.16;
    parts.warningBulb.scale.setScalar(alarmPulse);
    parts.warningBulb.material.emissiveIntensity = 1.8 + Math.sin(time * 10) * 0.55;
    parts.warningGlow.intensity = 1.65 + Math.sin(time * 10) * 0.6;
  } else {
    parts.warningBulb.scale.setScalar(1);
    parts.warningBulb.material.emissiveIntensity = 0;
    parts.warningGlow.intensity = 0;
  }

  // === Pokazujemy tylko JEDNA polowe (osobne obiekty na tasmie) ===
  // 'lead' = modul 0 + podstawa (czolo paczkomatu). 'trail' = tylko modul 1.
  // PODSTAWA jest zawsze widoczna z liderem (etap 3 = wlozenie w podstawe).
  // Czesci WYKONCZENIOWE (plecy, laczenie, dach, daszek) tylko gdy showFinishing
  // (stanowisko offline, etap 4); na rolotoku pozostaja ukryte.
  const sharedBase = [parts.base, parts.baseFront];
  const finishingParts = [parts.backPanel, parts.centerJoin];
  if (halfMode === 'trail') {
    parts.moduleRoots[0].visible = false;
    parts.moduleRoots[1].visible = true;
    sharedBase.forEach((p) => { if (p) p.visible = false; });
    finishingParts.forEach((p) => { if (p) p.visible = false; });
    parts.roofs.forEach((r) => { r.visible = false; });
    parts.roofFascias.forEach((f) => { f.visible = false; });
  } else {
    parts.moduleRoots[0].visible = true;
    parts.moduleRoots[1].visible = false;
    sharedBase.forEach((p) => { if (p) p.visible = true; });
    finishingParts.forEach((p) => { if (p) p.visible = showFinishing; });
    parts.roofs.forEach((r) => { r.visible = showFinishing; });
    parts.roofFascias.forEach((f) => { f.visible = showFinishing; });
  }
}

// =====================================================================
// === ETAP 0 STATYCZNY: STOL PODMONTAZU KORYT =========================
// =====================================================================

// Stol warsztatowy podmontazu koryt (etap 0 poza rolotokiem). Blat na
// wysokosci rolek rolotoku (TUNE.staticFirstStage.table.topY), zeby koryto
// lezalo na tej samej wysokosci co pozniej na tasmie. Wysrodkowany w (0,0,0),
// dluga osia wzdluz linii (Z) - pozycje ustawia wywolujacy.
function createWorkTable(cfg = {}) {
  const width = cfg.width ?? 3.4;
  const depth = cfg.depth ?? 6.0;
  const topY = cfg.topY ?? CONVEYOR_SURFACE_Y;
  const group = new THREE.Group();
  group.name = 'staticStageTable';
  // Stalowo-grafitowa kolorystyka jak rama rolotoku - jasny blat zlewal sie
  // z bialym tlem sceny i wygladal jak plastikowa lada zamiast stanowiska.
  const frameMaterial = makeMaterial('#111827', 0.55, 0.38);
  const topMaterial = makeMaterial(cfg.color ?? '#5f6e7e', 0.55, 0.35);
  const topThickness = 0.12;

  const top = new THREE.Mesh(new THREE.BoxGeometry(width, topThickness, depth), topMaterial);
  top.position.y = topY - topThickness / 2;
  top.castShadow = true;
  top.receiveShadow = true;
  top.name = 'tableTop';
  group.add(top);

  // Rama pod blatem (fartuch) usztywniajaca konstrukcje. Obnizona o 0.01,
  // zeby jej gorne lico nie pokrywalo sie z dolnym licem blatu (z-fighting).
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.24, 0.16, depth - 0.24),
    frameMaterial,
  );
  apron.position.y = topY - topThickness - 0.09;
  apron.castShadow = true;
  group.add(apron);

  // 6 nog (naroza + para na srodku dlugosci - stol jest dlugi jak koryto).
  const legHeight = topY - topThickness;
  const legX = width / 2 - 0.18;
  [-depth / 2 + 0.24, 0, depth / 2 - 0.24].forEach((z, rowIndex) => {
    [-legX, legX].forEach((x, sideIndex) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, legHeight, 0.14), frameMaterial);
      leg.position.set(x, legHeight / 2, z);
      leg.castShadow = true;
      leg.name = `tableLeg-${rowIndex + 1}-${sideIndex + 1}`;
      group.add(leg);
    });
  });

  // Dolna polka na narzedzia/komponenty.
  const shelf = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.5, 0.06, depth - 0.6),
    frameMaterial,
  );
  shelf.position.y = 0.35;
  shelf.receiveShadow = true;
  group.add(shelf);

  return group;
}

// =====================================================================
// === ETAP 3: STOL UCHYLNY / WYWROTNICA ===============================
// =====================================================================

// Stol uchylny stawiajacy czesc do pionu (etap 3). Zwraca { group, pivot }:
// group stoi W ZAWIASIE (pozycje/kierunek ustawia wywolujacy), pivot to
// obracana czesc (blat + ramiona + os) - petla renderu krec1 pivot.rotation.x
// od 0 do PI/2 zsynchronizowane z czescia. Uklad lokalny: -z = w strone
// rolotoku (blat lezy za zawiasem), +y = gora. Zawias przy podlodze.
function createTiltTableRig({ width, thickness, slabMinZ, slabTopY, hingeY = 0.4 }) {
  const group = new THREE.Group();
  group.name = 'tiltTableRig';
  // Stalowy blat + grafitowa rama (jak rolotok). Wczesniejszy jasnoszary blat
  // zlewal sie z bialym tlem i czescia - wywrotnica byla nieczytelna.
  const frameMaterial = makeMaterial('#111827', 0.55, 0.38);
  const slabMaterial = makeMaterial('#5f6e7e', 0.55, 0.35);
  const accentMaterial = makeMaterial('#d97706', 0.35, 0.4);

  const pivot = new THREE.Group();
  pivot.name = 'tiltTablePivot';
  group.add(pivot);

  // Os zawiasu (walec w poprzek linii).
  const axle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, width + 0.3, 18),
    frameMaterial,
  );
  axle.rotation.z = Math.PI / 2;
  axle.castShadow = true;
  pivot.add(axle);

  // Blat: od zawiasu wstecz (w strone rolotoku), gorne lico na slabTopY.
  const slabMaxZ = 0.12;
  const slabLength = Math.max(slabMaxZ - slabMinZ, 1);
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(width, thickness, slabLength),
    slabMaterial,
  );
  slab.position.set(0, slabTopY - thickness / 2, (slabMinZ + slabMaxZ) / 2);
  slab.castShadow = true;
  slab.receiveShadow = true;
  slab.name = 'tiltTableSlab';
  pivot.add(slab);

  // Ramiona laczace blat z zawiasem (po obu stronach).
  const armX = width / 2 - 0.16;
  [-armX, armX].forEach((x, index) => {
    pivot.add(makeProfileBetween(
      new THREE.Vector3(x, 0, 0),
      new THREE.Vector3(x, slabTopY - thickness, slabMinZ * 0.35),
      0.14,
      0.12,
      frameMaterial,
      `tiltTableArm-${index + 1}`,
    ));
  });

  // Pas ostrzegawczy na krawedzi blatu od strony rolotoku. WYSTAJE minimalnie
  // poza blat z KAZDEJ strony (szerokosc, grubosc, czolo) - wczesniej jego
  // scianki byly idealnie wspolplaszczyznowe ze sciankami blatu, co dawalo
  // migotanie tekstur (z-fighting) przy kazdym ruchu kamery.
  const edgeStripe = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.04, thickness + 0.04, 0.18),
    accentMaterial,
  );
  edgeStripe.position.set(0, slabTopY - thickness / 2, slabMinZ + 0.07);
  pivot.add(edgeStripe);

  // Statyczny cokol zawiasu (nie obraca sie): wsporniki lozysk od zawiasu
  // do podlogi (hingeY = wysokosc zawiasu nad podloga) + stopy.
  const pedestal = new THREE.Group();
  pedestal.name = 'tiltTablePedestal';
  const bearingHeight = Math.max(hingeY, 0.12);
  [-1, 1].forEach((side, index) => {
    const x = side * (width / 2 + 0.18);
    const bearing = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, bearingHeight, 0.26),
      frameMaterial,
    );
    bearing.name = `tiltTableBearing-${index + 1}`;
    bearing.position.set(x, -bearingHeight / 2, 0);
    bearing.castShadow = true;
    pedestal.add(bearing);

    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.05, 0.44),
      frameMaterial,
    );
    foot.position.set(x, -bearingHeight + 0.025, 0);
    pedestal.add(foot);
  });
  group.add(pedestal);
  group.userData.pedestal = pedestal;

  return { group, pivot, pedestal };
}

// =====================================================================
// === ETAP 4: PALETY + STANOWISKA OFFLINE (poza rolotokiem) ==========
// =====================================================================

// Placeholder europalety z belek (BoxGeometry). Latwy do podmiany na GLB:
// wystarczy zastapic geometrie wczytanym modelem (TUNE.offline.pallet steruje
// rozmiarem/kolorem). Zwraca Group z paleta wysrodkowana w (0,0,0), gornym
// licem na wysokosci `height`, wiec paczkomat stawiamy na `height`.
function createPalletPlaceholder(cfg = {}) {
  const width = cfg.width ?? 2.6;
  const depth = cfg.depth ?? 3.2;
  const height = cfg.height ?? 0.32;
  const color = cfg.color ?? '#9a6b3f';
  const group = new THREE.Group();
  group.name = 'palletPlaceholder';
  const plankMat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 });
  const deckTh = height * 0.28; // grubosc pomostu/ramy (deski)
  // Gorny pomost (lico, na nim stoi paczkomat), dolna rama i 3 wsporniki.
  const topDeck = new THREE.Mesh(new THREE.BoxGeometry(width, deckTh, depth), plankMat);
  topDeck.position.y = height - deckTh / 2;
  topDeck.castShadow = true;
  topDeck.receiveShadow = true;
  group.add(topDeck);
  const bottomDeck = new THREE.Mesh(new THREE.BoxGeometry(width, deckTh, depth), plankMat);
  bottomDeck.position.y = deckTh / 2;
  group.add(bottomDeck);
  const blockH = Math.max(height - 2 * deckTh, 0.06);
  for (const sx of [-1, 0, 1]) {
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.16, blockH, depth),
      plankMat,
    );
    block.position.set(sx * (width / 2 - width * 0.09), height / 2, 0);
    group.add(block);
  }
  group.userData.topY = height; // gorne lico palety (tu stoi podstawa paczkomatu)
  return group;
}

// Pozycje stanowisk offline w swiecie (THREE.Vector3, y=0 = podloga). Brane z
// TUNE.offline.stations (edytowalne w edytor_stref.html). Gdy brakuje wpisu,
// stanowiska sa rozkladane za koncem rolotoku.
function getOfflineStationVectors(routePoints) {
  const count = Math.max(1, Math.round(TUNE.offline?.stationCount ?? 1));
  const configured = TUNE.offline?.stations ?? [];
  const end = routePoints?.length ? routePoints[routePoints.length - 1].clone() : new THREE.Vector3();
  return Array.from({ length: count }, (_, i) => {
    const s = configured[i];
    if (s && Number.isFinite(s.x) && Number.isFinite(s.z)) {
      return new THREE.Vector3(s.x, 0, s.z);
    }
    // Fallback: za koncem rolotoku, rozsuniete na boki.
    const spread = (i - (count - 1) / 2) * 8;
    return new THREE.Vector3(spread, 0, end.z + 14);
  });
}

// Pozycja palety na KONCU rolotoku (na ziemi, ZA ostatnia stacja). Ostatnia
// stacja jest pod podniesiona tasma, wiec paleta stoi dalej wzdluz linii o
// TUNE.offline.endPalletGap; tam spuszczane sa gotowe paczkomaty na palete.
function getEndPalletVector(routePoints) {
  if (!routePoints?.length) return new THREE.Vector3();
  const end = routePoints[routePoints.length - 1];
  const forward = getRouteTangent(routePoints, routePoints.length - 1);
  const gap = TUNE.offline?.endPalletGap ?? 0;
  return new THREE.Vector3(end.x, 0, end.z).addScaledVector(forward, gap);
}

function ThreeProductionScene({
  stages,
  visibleUnits,
  trailUnits,
  scheduleConflictCount = 0,
  workersPerStation = [],
  offlineStationWorkers = [],
  onAssemblyMetrics,
}) {
  const mountRef = useRef(null);
  const controlsRef = useRef(null);
  const latestRef = useRef({
    stages, visibleUnits, trailUnits, scheduleConflictCount, workersPerStation, offlineStationWorkers,
  });
  const [stageOneModelStatus, setStageOneModelStatus] = useState('loading');
  const troughLyingPosesRef = useRef(createDefaultTroughLyingPoses());

  latestRef.current = {
    stages, visibleUnits, trailUnits, scheduleConflictCount, workersPerStation, offlineStationWorkers,
  };

  const zoomCamera = (factor) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const offset = controls.object.position.clone().sub(controls.target);
    const nextDistance = THREE.MathUtils.clamp(
      offset.length() * factor,
      controls.minDistance,
      controls.maxDistance,
    );
    offset.setLength(nextDistance);
    controls.object.position.copy(controls.target).add(offset);
    controls.update();
  };

  useEffect(() => {
    if (!mountRef.current) return undefined;

    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e7edf2');
    scene.fog = new THREE.Fog('#e7edf2', 70, 260);

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 240);
    camera.position.set(0, 16, 24);
    camera.lookAt(0, 0, -0.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Tone mapping + sRGB daja bardziej "fotograficzny", profesjonalny render.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'production-canvas';
    mount.appendChild(renderer.domElement);

    // Mapa otoczenia (PMREM) - daje metalicznym czesciom realistyczne odbicia,
    // co jest kluczowe dla stalowo-szarej, stonowanej estetyki.
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const environmentTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environmentTexture;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.minDistance = TUNE.camera?.minDistance ?? 5;
    controls.maxDistance = TUNE.camera?.maxDistance ?? 110;
    controls.minPolarAngle = TUNE.camera?.minPolarAngle ?? 0.08;
    controls.maxPolarAngle = TUNE.camera?.maxPolarAngle ?? (Math.PI * 0.49);
    controls.target.set(0, 0.8, 0);

    // === WOLNA KAMERA: przesuwanie klawiszami (WASD/strzalki + Q/E gora-dol, Shift=szybciej) ===
    // Mysz dalej obraca (orbita); na telefonie zostaja gesty. Przesuwa kamere i cel razem.
    const moveKeys = new Set();
    const isTypingTarget = (el) => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    const MOVE_CODES = ['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
    const onMoveKeyDown = (event) => {
      if (isTypingTarget(event.target)) return;
      const k = event.key.toLowerCase();
      if (MOVE_CODES.includes(k)) { moveKeys.add(k); event.preventDefault(); }
    };
    const onMoveKeyUp = (event) => { moveKeys.delete(event.key.toLowerCase()); };
    const clearMoveKeys = () => moveKeys.clear();
    window.addEventListener('keydown', onMoveKeyDown);
    window.addEventListener('keyup', onMoveKeyUp);
    window.addEventListener('blur', clearMoveKeys);
    const moveForward = new THREE.Vector3();
    const moveRight = new THREE.Vector3();
    const moveDelta = new THREE.Vector3();
    let lastMoveTime = 0;
    controlsRef.current = controls;

    const ambient = new THREE.HemisphereLight('#ffffff', '#9aa9b8', 1.55);
    scene.add(ambient);

    const key = new THREE.DirectionalLight('#ffffff', 2.5);
    key.position.set(-5, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 60;
    key.shadow.camera.left = -22;
    key.shadow.camera.right = 22;
    key.shadow.camera.top = 22;
    key.shadow.camera.bottom = -22;
    scene.add(key);

    // Chlodne swiatlo konturowe z tylu - oddziela modele od tla, podkresla krawedzie.
    const rim = new THREE.DirectionalLight('#cfe0f2', 1.15);
    rim.position.set(7, 6, -9);
    scene.add(rim);

    const fill = new THREE.PointLight('#e3edf7', 0.8, 34);
    fill.position.set(6, 5, -5);
    scene.add(fill);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 16),
      new THREE.MeshStandardMaterial({ color: '#d4dde6', roughness: 0.78, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.03;
    floor.receiveShadow = true;
    scene.add(floor);

    const staticGroup = new THREE.Group();
    const unitGroup = new THREE.Group();
    scene.add(staticGroup);
    scene.add(unitGroup);

    const lockers = new Map();
    const trailLockers = new Map(); // #4: druga (opozniona) polowa kazdego paczkomatu
    // Etap 4: zespoly palet (paleta + caly paczkomat) na stanowiskach offline.
    // Klucz = unit.key; kazdy wpis = { carrier, pallet, lead, trail }.
    const palletAssemblies = new Map();
    const rollers = [];
    const stationWorkers = [];
    let stageOneTemplates = null;
    let disposed = false;
    let lastStageSignature = '';
    let lastFittedStageCount = -1;
    let routePoints = [];
    let routeCenter = new THREE.Vector3(0, 0, 0);
    // Pozycje stanowisk offline (etap 4): ustawiane w rebuildStatic, czytane w
    // petli renderu przy animacji palet. Pusta tablica = offline wylaczony.
    let offlineStationVecs = [];
    let endPalletStandby = null;
    // === Stol uchylny (wywrotnica, etap 3) ===
    // tiltTableRig = { group, pivot }: group stoi w zawiasie (pozycja+kierunek),
    // pivot to obracana czesc (blat+ramiona). Zbudowany w rebuildStatic z
    // analitycznego zawiasu; placeHalf nadpisuje pozycje dokladnym zawiasem
    // czesci (tiltTableHingeWorld), gdy jakas polowa jest na etapie 3.
    let tiltTableRig = null;
    let tiltTableHingeWorld = null;

    const rebuildStatic = () => {
      staticGroup.clear();
      rollers.length = 0;
      stationWorkers.length = 0;
      endPalletStandby = null;
      tiltTableRig = null;
      routePoints = buildLinePoints(latestRef.current.stages);
      const rollerMaterial = makeMaterial(ROLLER_COLOR, 0.38, 0.58);
      // Rolki w strefie bufora (przelot) - inny, jasnoszary kolor dla wyroznienia.
      const bufferRollerMaterial = makeMaterial('#94a3b8', 0.45, 0.45);

      if (routePoints.length) {
        const routeBounds = new THREE.Box3().setFromPoints(routePoints);
        routeCenter = routeBounds.getCenter(new THREE.Vector3());
        const entryDirection = getRouteTangent(routePoints, 0);
        const entryPoint = routePoints[0].clone().addScaledVector(
          entryDirection,
          -(ENTRY_CONVEYOR_LENGTH + 1.6),
        );
        const sceneBounds = new THREE.Box3().setFromPoints([...routePoints, entryPoint]);
        const size = sceneBounds.getSize(new THREE.Vector3());
        const center = sceneBounds.getCenter(new THREE.Vector3());
        const routeLength = Math.max(size.z, 8);

        if (lastFittedStageCount !== routePoints.length) {
          const cameraDistance = Math.max(14, routeLength * 1.12);
          controls.target.set(center.x, 0.75, center.z);
          camera.position.set(center.x + cameraDistance * 0.72, cameraDistance * 0.55, center.z - cameraDistance * 0.72);
          controls.minDistance = TUNE.camera?.minDistance ?? 5;
          controls.maxDistance = TUNE.camera?.maxDistance ?? Math.max(95, routeLength * 2.4);
          controls.update();
          controls.saveState();
          lastFittedStageCount = routePoints.length;
        }

        floor.geometry.dispose();
        floor.geometry = new THREE.PlaneGeometry(
          TUNE.sectors?.floorWidth ?? (CONVEYOR_WIDTH + 16),
          routeLength + (TUNE.sectors?.floorDepthPad ?? 17),
        );
        floor.position.x = TUNE.sectors?.floorCenterX ?? center.x;
        floor.position.z = center.z;
      }

      routePoints.forEach((point, index) => {
        const stage = latestRef.current.stages[index];
        const sideOffset = getStationSideOffset(routePoints, index, routeCenter);
        const tangent = getRouteTangent(routePoints, index);
        // Ilosc pracownikow przy tej stacji (TUNE.sectors.workersPerStation).
        const workersCfg = latestRef.current.workersPerStation ?? [];
        const workerCountDefault = TUNE.sectors?.workersPerStationDefault ?? 1;
        const rawWorkerCount = workersCfg[index] ?? workerCountDefault;
        const workerCount = Math.max(0, Math.round(Number(rawWorkerCount)) || 0);
        // Rozklad po obu stronach linii proporcjonalnie (polowa na strone),
        // z rozsunieciem wzdluz linii, zeby sie nie nakladali.
        const workerGap = TUNE.sectors?.workerSpacing ?? 1.15;
        const placements = [];
        const leftN = Math.ceil(workerCount / 2);
        const rightN = workerCount - leftN;
        [[leftN, 1], [rightN, -1]].forEach(([n, sign]) => {
          for (let k = 0; k < n; k += 1) {
            placements.push({ sign, along: (k - (n - 1) / 2) * workerGap });
          }
        });

        placements.forEach((placement, workerSlot) => {
        const stationPosition = point.clone()
          .addScaledVector(sideOffset, placement.sign)
          .addScaledVector(tangent, placement.along);
        const targetDirection = point.clone().sub(stationPosition);
        const stationAngle = Math.atan2(targetDirection.x, targetDirection.z);
        const marker = new THREE.Group();
        marker.position.copy(stationPosition);
        marker.position.y = 0.08;
        marker.rotation.y = stationAngle;

        const stageColor = stage?.color ?? '#2563eb';
        const worker = createWorkerFigure(stageColor, index, index === 0 || index === 2);
        worker.name = `worker-${index + 1}-${workerSlot + 1}`;
        worker.userData.index = index;
        worker.userData.seed = workerSlot;
        stationWorkers.push(worker);
        marker.add(worker);

        staticGroup.add(marker);
        });
      });

      // === ETAP 1 STREF: sektory linii glownej ===
      // Kolorowy obrys + etykieta przy kazdej stacji montazowej. Operatorzy juz
      // istnieja; te strefy delimituja obszary i niosa 'sectorSlot' na przyszlosc.
      if ((TUNE.sectors?.show ?? true) && routePoints.length) {
        const s = TUNE.sectors ?? {};
        // Waskie gardlo = stanowisko o najdluzszym EFEKTYWNYM czasie -> czerwone.
        // Etap offline ma N rownoleglych stanowisk, wiec jego czas dzielimy przez N
        // (gdy offline jest waskim gardlem, jego strefe podswietla Faza 3 osobno).
        const bnStages = latestRef.current.stages;
        const bnOffIdx = getOfflineStageIndex(bnStages);
        const bnOffN = Math.max(getOfflineServerCount(), 1);
        let bnIndex = -1, bnMax = -1;
        bnStages.forEach((st, i) => {
          const d = Math.max(st.duration ?? 0, 0) / (i === bnOffIdx ? bnOffN : 1);
          if (d > bnMax) { bnMax = d; bnIndex = i; }
        });
        routePoints.forEach((point, index) => {
          const stage = latestRef.current.stages[index];
          const def = MAINLINE_SECTORS[index] ?? {
            label: stage?.name ?? `Etap ${index + 1}`,
            minutes: null,
          };
          const isBottleneck = index === bnIndex;
          const sideOffset = getStationSideOffset(routePoints, index, routeCenter);
          const outwardDir = sideOffset.clone().normalize();
          const zone = createSectorZone({
            label: def.label,
            sublabel: isBottleneck ? 'BOTTLENECK' : (def.minutes ? `${def.minutes} min` : ''),
            color: isBottleneck ? '#dc2626' : '#7c3aed', // czerwony = waskie gardlo
            width: s.width ?? 3.6,
            depth: s.depth ?? 3.0,
            opacity: s.opacity ?? 0.22,
            labelHeight: s.labelHeight ?? 1.55,
          });
          const zoneCenter = point
            .clone()
            .add(sideOffset)
            .addScaledVector(outwardDir, s.outward ?? 1.1);
          zone.position.set(zoneCenter.x, 0.02, zoneCenter.z);
          zone.userData.sectorGroup = 'mainline';
          zone.userData.stageIndex = index;
          staticGroup.add(zone);
        });

        // === ETAP 2+3 STREF: sektory peryferyjne wg planu hali ===
        // Podmontaze, komponenty, magazyny, naprawa, kaciki, bufor podstaw.
        buildPeripheralSectors(staticGroup, routePoints, TUNE.sectors ?? {});

        // === ETAP OFFLINE (opcjonalny): STANOWISKA + PALETY (poza rolotokiem) ===
        // Aktywne tylko, gdy OSTATNI etap ma ikone 'offline' (patrz simulation.js).
        offlineStationVecs = [];
        const stagesNow = latestRef.current.stages;
        if (isOfflineEnabled(stagesNow)) {
          const off = TUNE.offline ?? {};
          offlineStationVecs = getOfflineStationVectors(routePoints);
          offlineStationVecs.forEach((pos, i) => {
            // Strefa robocza stanowiska (pad + etykieta), jak strefy linii glownej.
            const zone = createSectorZone({
              label: `Stanowisko ${i + 1}`,
              sublabel: 'wykonczenie',
              color: '#db2777',
              width: (off.pallet?.width ?? 2.6) + 2.2,
              depth: (off.pallet?.depth ?? 3.2) + 2.2,
              opacity: TUNE.sectors?.opacity ?? 0.22,
              labelHeight: TUNE.sectors?.labelHeight ?? 1.55,
            });
            zone.position.set(pos.x, 0.02, pos.z);
            staticGroup.add(zone);

            // Pracownicy przy stanowisku wykonczenia. Wczesniej brakowalo ich tu,
            // bo ta petla (offlineStationVecs) jest osobna od glownej petli
            // routePoints, ktora buduje pracownikow tylko dla stacji rolotoku.
            // Liczba - OSOBNE pole na KAZDE stanowisko (offlineStationWorkers[i]),
            // rozlozeni po obu stronach palety tak samo jak na stacjach rolotoku.
            // Czysto wizualne - czas etapu 4 nadal liczy sie z workersPerStation.
            const offlineStageIdx = getOfflineStageIndex(stagesNow);
            const offlineStageColor = stagesNow[offlineStageIdx]?.color ?? '#db2777';
            const offlineStationWorkersCfg = latestRef.current.offlineStationWorkers ?? [];
            const offlineWorkerCount = Math.max(
              0,
              Math.round(Number(offlineStationWorkersCfg[i] ?? 1)) || 0,
            );
            const outward = i % 2 === 0 ? -1 : 1;
            const offlineWorkerGap = TUNE.sectors?.workerSpacing ?? 1.15;
            const offlineLeftN = Math.ceil(offlineWorkerCount / 2);
            const offlineRightN = offlineWorkerCount - offlineLeftN;
            const offlinePlacements = [];
            [[offlineLeftN, outward], [offlineRightN, -outward]].forEach(([n, sign]) => {
              for (let k = 0; k < n; k += 1) {
                offlinePlacements.push({ sign, along: (k - (n - 1) / 2) * offlineWorkerGap });
              }
            });
            offlinePlacements.forEach((placement, workerSlot) => {
              const workerPos = new THREE.Vector3(
                pos.x + placement.sign * ((off.pallet?.width ?? 2.6) / 2 + 1.1),
                0.08,
                pos.z + placement.along,
              );
              const facing = pos.clone().sub(workerPos);
              const worker = createWorkerFigure(offlineStageColor, i * 4 + workerSlot, true);
              worker.name = `offlineWorker-${i + 1}-${workerSlot + 1}`;
              worker.userData.index = offlineStageIdx;
              worker.userData.seed = workerSlot;
              worker.userData.serverIndex = i;
              const workerMarker = new THREE.Group();
              workerMarker.position.copy(workerPos);
              workerMarker.rotation.y = Math.atan2(facing.x, facing.z);
              workerMarker.add(worker);
              stationWorkers.push(worker);
              staticGroup.add(workerMarker);
            });
          });
        }

        // Paleta na koncu rolotoku: na ziemi ZA ostatnia stacja (nie pod
        // tasma), tam spuszczane sa gotowe paczkomaty na palete na etapie 3.
        // NIEZALEZNA od etapu offline: stoi zawsze, gdy ostatnia stacja
        // rolotoku to 'finalize' (nitowanie + dach odbywa sie tez na niej).
        const conveyorFinalStage = stagesNow[getConveyorFinalIndex(stagesNow)];
        if (
          conveyorFinalStage?.icon === 'finalize'
          && routePoints.length > 0
          && (TUNE.offline?.showEndPallet ?? true)
        ) {
          const off = TUNE.offline ?? {};
          const endPallet = createPalletPlaceholder(off.pallet ?? {});
          const endPos = getEndPalletVector(routePoints);
          // Wywrotnica: paleta czeka juz PRZESUNIETA pod gniazdo pierwszej
          // polowy (ten sam shift co placeHalf), zeby nie skakala przy
          // przejeciu przez carrier w chwili przyjazdu czesci na stol.
          if (TUNE.tiltTable?.enabled ?? false) {
            const fwd = getRouteTangent(routePoints, routePoints.length - 1);
            const rightDir = new THREE.Vector3(fwd.z, 0, -fwd.x);
            const firstFinalX = stageOneTemplates?.moduleCenterX?.[0] ?? 1.02;
            endPos.addScaledVector(rightDir, -firstFinalX * MODEL_RENDER_SCALE);
          }
          endPallet.position.set(endPos.x, 0, endPos.z);
          endPalletStandby = endPallet;
          staticGroup.add(endPallet);
        }
      }

      if (routePoints.length) {
        const entryExtension = ENTRY_CONVEYOR_LENGTH + 1.6;
        const exitExtension = 2.8;
        const first = routePoints[0];
        const last = routePoints[routePoints.length - 1];
        const direction = getRouteTangent(routePoints, 0);
        // Etap 0 statyczny: rolotok NIE obejmuje stacji podmontazu koryt -
        // zaczyna sie dopiero conveyorLeadIn przed etapem 1. W miejscu etapu 0
        // stoi stol warsztatowy (podmontaz odbywa sie w miejscu, bez jazdy).
        const sfs = TUNE.staticFirstStage ?? {};
        const staticFirst = (sfs.enabled ?? false) && routePoints.length >= 2;
        const conveyorStart = staticFirst
          ? routePoints[1].clone().addScaledVector(direction, -(sfs.conveyorLeadIn ?? 7))
          : first.clone().addScaledVector(direction, -entryExtension);
        // Wywrotnica (etap 3): rolotok konczy sie PRZED ostatnia stacja -
        // czesc zsuwa sie z ostatnich rolek na stol uchylny. NIEZALEZNA od
        // etapu offline - dziala zawsze, gdy ostatnia stacja rolotoku to
        // 'finalize' (stawianie do pionu + nitowanie i dach na palecie).
        const tiltStages = latestRef.current.stages;
        const tiltCfg = TUNE.tiltTable ?? {};
        const tiltOn = (tiltCfg.enabled ?? false)
          && tiltStages[getConveyorFinalIndex(tiltStages)]?.icon === 'finalize';
        const conveyorEnd = tiltOn
          ? last.clone().addScaledVector(direction, -(tiltCfg.conveyorCut ?? 3.2))
          : last.clone().addScaledVector(direction, exitExtension);

        if (staticFirst) {
          const table = createWorkTable(sfs.table ?? {});
          table.position.set(first.x, 0, first.z);
          table.rotation.y = Math.atan2(direction.x, direction.z);
          staticGroup.add(table);
        }

        if (tiltOn) {
          // === Analityczny zawias wywrotnicy (te same wzory co sciezka czesci
          // w updateTwoPartLockerModel - stol i czesc obracaja sie razem). ===
          const off = TUNE.offline ?? {};
          const modelOffset = off.modelOffset ?? [0, 0, 0];
          const targetWorldY = (off.modelY ?? 0.42) + (modelOffset[1] ?? 0);
          const startWorldY = MODEL_LINE_Y + (TUNE.horizontalLift ?? 0.34);
          const endGround = getEndPalletVector(routePoints);
          // Srodek podstawy w ukladzie lokalnym modelu: zmierzony przy ladowaniu
          // GLB (baseAnchorLocal) albo pozycja konstrukcyjna podstawy.
          const anchorZ = stageOneTemplates?.baseAnchorLocal?.z ?? ASSEMBLY_HALF_LENGTH;
          const landingGroundOnLine = endGround.clone()
            .addScaledVector(direction, (modelOffset[2] ?? 0) - anchorZ * MODEL_RENDER_SCALE);
          const centeredZ = ASSEMBLY_HALF_LENGTH;
          const sY = (startWorldY - targetWorldY) / MODEL_RENDER_SCALE;
          const sZ = centeredZ
            + last.clone().sub(landingGroundOnLine).dot(direction) / MODEL_RENDER_SCALE;
          const fY = (TUNE.columnSettleY ?? 0) + (TUNE.finalNudgeY ?? 0);
          const fZ = centeredZ + (TUNE.finalNudgeZ ?? 0);
          const hY = (fY - fZ + sZ + sY) / 2;
          const hZ = (fY + fZ + sZ - sY) / 2;
          const hingeNudge = tiltCfg.hingeNudge ?? [0, 0];
          const hingeWorld = landingGroundOnLine.clone()
            .addScaledVector(direction, hZ * MODEL_RENDER_SCALE + (hingeNudge[1] ?? 0));
          hingeWorld.x = last.x;
          hingeWorld.y = targetWorldY + hY * MODEL_RENDER_SCALE + (hingeNudge[0] ?? 0);
          // Blat siega od zawiasu wstecz az za lezaca czesc (z zapasem).
          const partHalf = (ASSEMBLY_LENGTH * MODEL_RENDER_SCALE) / 2;
          const stationOffset = last.clone().sub(hingeWorld).dot(direction); // < 0
          const slabMinZ = stationOffset - partHalf - (tiltCfg.table?.extraLength ?? 0.5);
          tiltTableRig = createTiltTableRig({
            width: tiltCfg.table?.width ?? 3.4,
            thickness: tiltCfg.table?.thickness ?? 0.16,
            slabMinZ,
            slabTopY: CONVEYOR_SURFACE_Y - hingeWorld.y,
            hingeY: hingeWorld.y,
          });
          tiltTableRig.group.position.copy(hingeWorld);
          tiltTableRig.group.rotation.y = Math.atan2(direction.x, direction.z);
          staticGroup.add(tiltTableRig.group);
        }
        const length = Math.max(conveyorStart.distanceTo(conveyorEnd), 0.1);
        const midpoint = conveyorStart.clone().add(conveyorEnd).multiplyScalar(0.5);
        const conveyor = new THREE.Group();
        conveyor.position.set(midpoint.x, CONVEYOR_ELEVATION, midpoint.z);

        const frameMaterial = makeMaterial('#111827', 0.5, 0.42);
        const braceMaterial = makeMaterial('#475569', 0.58, 0.3);
        const footMaterial = makeMaterial('#0f172a', 0.62, 0.36);
        const lowerFrameY = -0.82;

        [-ROLLER_LENGTH * 0.32, 0, ROLLER_LENGTH * 0.32].forEach((x, index) => {
          const stringer = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.12, length),
            frameMaterial,
          );
          stringer.position.set(x, 0.15, 0);
          stringer.castShadow = true;
          stringer.receiveShadow = true;
          stringer.name = `rollerStringer-${index + 1}`;
          conveyor.add(stringer);
        });

        const railLeft = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.34, length + 0.16),
          frameMaterial,
        );
        railLeft.position.set(-CONVEYOR_RAIL_OFFSET, 0.27, 0);
        railLeft.castShadow = true;
        railLeft.receiveShadow = true;
        conveyor.add(railLeft);

        const railRight = railLeft.clone();
        railRight.position.x = CONVEYOR_RAIL_OFFSET;
        conveyor.add(railRight);

        [-CONVEYOR_RAIL_OFFSET, CONVEYOR_RAIL_OFFSET].forEach((x, index) => {
          const lowerRail = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 0.1, length - 0.3),
            frameMaterial,
          );
          lowerRail.position.set(x, lowerFrameY, 0);
          lowerRail.castShadow = true;
          lowerRail.name = `lowerSideRail-${index + 1}`;
          conveyor.add(lowerRail);
        });

        const supportCount = Math.max(5, Math.ceil(length / 3.2) + 1);
        const supportPositions = Array.from({ length: supportCount }, (_, index) => (
          -length / 2 + 0.32 + (index / Math.max(supportCount - 1, 1)) * (length - 0.64)
        ));
        const legX = CONVEYOR_RAIL_OFFSET;

        supportPositions.forEach((z, supportIndex) => {
          const topCrossbeam = new THREE.Mesh(
            new THREE.BoxGeometry(ROLLER_LENGTH + 0.54, 0.12, 0.16),
            frameMaterial,
          );
          topCrossbeam.position.set(0, 0.09, z);
          topCrossbeam.castShadow = true;
          topCrossbeam.name = `topCrossbeam-${supportIndex + 1}`;
          conveyor.add(topCrossbeam);

          const lowerCrossbeam = new THREE.Mesh(
            new THREE.BoxGeometry(ROLLER_LENGTH + 0.42, 0.08, 0.1),
            braceMaterial,
          );
          lowerCrossbeam.position.set(0, lowerFrameY, z);
          lowerCrossbeam.castShadow = true;
          lowerCrossbeam.name = `lowerCrossbeam-${supportIndex + 1}`;
          conveyor.add(lowerCrossbeam);

          [-legX, legX].forEach((x, sideIndex) => {
            const leg = new THREE.Mesh(
              new THREE.BoxGeometry(0.13, 1.38, 0.13),
              frameMaterial,
            );
            leg.position.set(x, -0.49, z);
            leg.castShadow = true;
            leg.name = `supportLeg-${supportIndex + 1}-${sideIndex + 1}`;
            conveyor.add(leg);

            const stem = new THREE.Mesh(
              new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12),
              footMaterial,
            );
            stem.position.set(x, -1.2, z);
            stem.castShadow = true;
            conveyor.add(stem);

            const foot = new THREE.Mesh(
              new THREE.CylinderGeometry(0.16, 0.18, 0.055, 18),
              footMaterial,
            );
            foot.position.set(x, -1.27, z);
            foot.castShadow = true;
            conveyor.add(foot);
          });
        });

        const diagonalStartZ = -length / 2;
        const diagonalEndZ = length / 2;
        [-ROLLER_LENGTH * 0.32, 0, ROLLER_LENGTH * 0.32].forEach((x, profileIndex) => {
          conveyor.add(makeProfileBetween(
            new THREE.Vector3(x, 0.06, diagonalStartZ),
            new THREE.Vector3(x, -0.9, diagonalEndZ),
            0.12,
            0.1,
            frameMaterial,
            `longDiagonalProfile-${profileIndex + 1}`,
          ));
        });

        for (let index = 0; index < supportPositions.length - 1; index += 1) {
          const startZ = supportPositions[index];
          const endZ = supportPositions[index + 1];
          const middleZ = (startZ + endZ) / 2;

          [-legX, legX].forEach((x, sideIndex) => {
            conveyor.add(makeBeamBetween(
              new THREE.Vector3(x, 0.17, startZ),
              new THREE.Vector3(x, lowerFrameY, middleZ),
              0.03,
              braceMaterial,
              `sideBraceA-${index + 1}-${sideIndex + 1}`,
            ));
            conveyor.add(makeBeamBetween(
              new THREE.Vector3(x, lowerFrameY, middleZ),
              new THREE.Vector3(x, 0.17, endZ),
              0.03,
              braceMaterial,
              `sideBraceB-${index + 1}-${sideIndex + 1}`,
            ));
          });
        }

        const rollerCount = Math.max(12, Math.floor(length / 0.34));
        // Granice strefy bufora (przelot) we wspolrzednych swiata: odcinek miedzy
        // etapem 'afterStage' a nastepnym. Rolki w tym zakresie kolorujemy inaczej.
        const bufSeg = TUNE.bufferSegment ?? {};
        const bufStage = bufSeg.afterStage ?? -1;
        const bufA = routePoints[bufStage];
        const bufB = routePoints[bufStage + 1];
        const bufInset = bufSeg.colorInset ?? 2.5;
        const bufLo = (bufSeg.enabled && bufA && bufB) ? Math.min(bufA.z, bufB.z) + bufInset : Infinity;
        const bufHi = (bufSeg.enabled && bufA && bufB) ? Math.max(bufA.z, bufB.z) - bufInset : -Infinity;
        for (let rollerIndex = 0; rollerIndex < rollerCount; rollerIndex += 1) {
          const z = -length / 2 + (rollerIndex / Math.max(rollerCount - 1, 1)) * length;
          const frac = (z + length / 2) / length;
          const worldZ = conveyorStart.z + frac * (conveyorEnd.z - conveyorStart.z);
          const isBuffer = worldZ > bufLo && worldZ < bufHi;
          const roller = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.18, ROLLER_LENGTH, 30),
            isBuffer ? bufferRollerMaterial : rollerMaterial,
          );
          roller.rotation.z = Math.PI / 2;
          roller.position.set(0, 0.36, z);
          roller.castShadow = true;
          conveyor.add(roller);
          rollers.push(roller);
        }

        staticGroup.add(conveyor);
      }
    };

    const resize = () => {
      const width = Math.max(mount.clientWidth, 320);
      const height = Math.max(mount.clientHeight, 420);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();
    rebuildStatic();

    // Strefy hali: wczytaj z /config/strefy.json (lub zapisu edytora) i
    // przebudowuj scene na zywo, gdy edytor_stref.html zapisze zmiany.
    const applySectors = (sectors) => {
      if (disposed || !sectors) return;
      PLAN_SECTORS = sectors;
      // Diagnostyka w konsoli: ktore strefy sa aktualnie aktywne.
      window.__PLAN_SECTORS = sectors;
      rebuildStatic();
    };
    loadPlanSectors().then(applySectors);
    const sectorsChannel = typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(SECTORS_CHANNEL_NAME)
      : null;
    if (sectorsChannel) {
      sectorsChannel.onmessage = (event) => applySectors(sanitizeSectors(event.data?.sectors));
    }
    const onSectorsStorage = (event) => {
      if (event.key !== SECTORS_STORAGE_KEY) return;
      applySectors(readStoredSectors()?.sectors ?? DEFAULT_PLAN_SECTORS);
    };
    window.addEventListener('storage', onSectorsStorage);

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    dracoLoader.setDecoderConfig({ type: 'wasm' });
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    const prepareAlignedComponent = (source, scale, center = false) => {
      source.scale.multiplyScalar(scale);
      source.updateMatrixWorld(true);
      if (center) {
        const bounds = new THREE.Box3().setFromObject(source);
        const componentCenter = bounds.getCenter(new THREE.Vector3());
        source.position.sub(componentCenter);
        source.updateMatrixWorld(true);
      }
      source.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
      });
      const template = new THREE.Group();
      template.add(source);
      return template;
    };

    Promise.all([
      gltfLoader.loadAsync(LOCK_TROUGH_MODEL_URL),
      gltfLoader.loadAsync(CENTER_TROUGH_MODEL_URL),
      gltfLoader.loadAsync(SMALL_TROUGH_LEFT_MODEL_URL),
      gltfLoader.loadAsync(SMALL_TROUGH_RIGHT_MODEL_URL),
      gltfLoader.loadAsync(LOCK_MODEL_URL),
      gltfLoader.loadAsync(SIDE_WALL_LEFT_MODEL_URL),
      gltfLoader.loadAsync(SIDE_WALL_CENTER_MODEL_URL),
      gltfLoader.loadAsync(SIDE_WALL_RIGHT_MODEL_URL),
      gltfLoader.loadAsync(BACK_LEFT_MODEL_URL),
      gltfLoader.loadAsync(BACK_RIGHT_MODEL_URL),
      gltfLoader.loadAsync(BASE_MODEL_URL),
      gltfLoader.loadAsync(ROOF_MODEL_URL),
      gltfLoader.loadAsync(CANOPY_MODEL_URL),
      gltfLoader.loadAsync(SHELF_MODEL_URL),
      gltfLoader.loadAsync(DOOR_XL_MODEL_URL),
      gltfLoader.loadAsync(DOOR_L_MODEL_URL),
      gltfLoader.loadAsync(DOOR_S_MODEL_URL),
      gltfLoader.loadAsync(DOOR_XS_MODEL_URL),
    ]).then(([
      troughGltf,
      centerTroughGltf,
      smallTroughLeftGltf,
      smallTroughRightGltf,
      lockGltf,
      sideWallLeftGltf,
      sideWallCenterGltf,
      sideWallRightGltf,
      backLeftGltf,
      backRightGltf,
      baseGltf,
      roofGltf,
      canopyGltf,
      shelfGltf,
      doorXlGltf,
      doorLGltf,
      doorSGltf,
      doorXsGltf,
    ]) => {
      if (disposed) return;
      troughGltf.scene.updateMatrixWorld(true);
      const troughBounds = new THREE.Box3().setFromObject(troughGltf.scene);
      const troughSize = troughBounds.getSize(new THREE.Vector3());
      const sharedScale = ASSEMBLY_LENGTH / Math.max(troughSize.z, 0.001);
      const baseTemplate = prepareAlignedComponent(baseGltf.scene, sharedScale);
      const standingBaseProbe = baseTemplate.clone(true);
      const baseRot = TUNE.baseRot ?? [Math.PI / 2, 0, 0];
      standingBaseProbe.rotation.set(baseRot[0] ?? 0, baseRot[1] ?? 0, baseRot[2] ?? 0);
      standingBaseProbe.updateMatrixWorld(true);
      const standingBaseBounds = new THREE.Box3().setFromObject(standingBaseProbe);
      const standingOffsetY = -0.13 - standingBaseBounds.min.y;
      stageOneTemplates = {
        trough: prepareAlignedComponent(troughGltf.scene, sharedScale),
        centerTrough: prepareAlignedComponent(centerTroughGltf.scene, sharedScale),
        smallTroughLeft: prepareAlignedComponent(smallTroughLeftGltf.scene, sharedScale),
        smallTroughRight: prepareAlignedComponent(smallTroughRightGltf.scene, sharedScale),
        lock: prepareAlignedComponent(lockGltf.scene, sharedScale, true),
        sideWallLeft: prepareAlignedComponent(sideWallLeftGltf.scene, sharedScale),
        sideWallCenter: prepareAlignedComponent(sideWallCenterGltf.scene, sharedScale),
        sideWallRight: prepareAlignedComponent(sideWallRightGltf.scene, sharedScale),
        backLeft: prepareAlignedComponent(backLeftGltf.scene, sharedScale),
        backRight: prepareAlignedComponent(backRightGltf.scene, sharedScale),
        base: baseTemplate,
        roof: prepareAlignedComponent(roofGltf.scene, sharedScale),
        canopy: prepareAlignedComponent(canopyGltf.scene, sharedScale),
        shelf: prepareAlignedComponent(shelfGltf.scene, sharedScale, true),
        doors: {
          xl: prepareAlignedComponent(doorXlGltf.scene, sharedScale, true),
          l: prepareAlignedComponent(doorLGltf.scene, sharedScale, true),
          s: prepareAlignedComponent(doorSGltf.scene, sharedScale, true),
          xs: prepareAlignedComponent(doorXsGltf.scene, sharedScale, true),
        },
        moduleCenterX: [0.24 * sharedScale, -0.243 * sharedScale],
        standingOffsetY,
        sharedScale,
      };
      const measurementModel = createTwoPartLockerModel(stageOneTemplates);
      measurementModel.scale.setScalar(MODEL_RENDER_SCALE);
      measurementModel.updateMatrixWorld(true);
      const measuredPartLength = Math.max(
        ...measurementModel.userData.parts.moduleRoots.map((root) => (
          new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).z
        )),
      );
      if (Number.isFinite(measuredPartLength) && measuredPartLength > 0) {
        onAssemblyMetrics?.({ partLength: measuredPartLength });
      }
      // Srodek podstawy w ukladzie LOKALNYM modelu - uzywany przez analityczny
      // zawias wywrotnicy (rebuildStatic) zanim jakikolwiek model trafi na
      // etap 3. Te same liczby co palletAnchorLocalXZ liczone w placeHalf.
      {
        const anchorBox = new THREE.Box3();
        [measurementModel.userData.parts.base, measurementModel.userData.parts.baseFront]
          .filter(Boolean)
          .forEach((part) => anchorBox.expandByObject(part));
        if (!anchorBox.isEmpty()) {
          const centerLocal = measurementModel.worldToLocal(
            anchorBox.getCenter(new THREE.Vector3()),
          );
          stageOneTemplates.baseAnchorLocal = { x: centerLocal.x, z: centerLocal.z };
        }
      }
      measurementModel.traverse((object) => {
        if (!object.isMesh || !object.material) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      lockers.forEach((model) => unitGroup.remove(model));
      lockers.clear();
      trailLockers.forEach((model) => unitGroup.remove(model));
      trailLockers.clear();
      palletAssemblies.forEach((assembly) => unitGroup.remove(assembly.carrier));
      palletAssemblies.clear();
      setStageOneModelStatus('ready');

      // === Opcjonalny model polek + drzwi (drop-in) ===
      // Gdy pod /models/components/shelves-doors.glb pojawi sie POPRAWNY plik
      // (pojedyncza polka/drzwi, nisko-poligonowy), zostanie automatycznie
      // wykryty, przeskalowany do tej samej ramy co reszta i podpiety zamiast
      // proceduralnych zaslepek. Pusty/brakujacy plik jest bezpiecznie ignorowany.
      gltfLoader.loadAsync(SHELVES_DOORS_MODEL_URL).then((shelvesDoorsGltf) => {
        if (disposed) return;
        let meshCount = 0;
        let vertexCount = 0;
        shelvesDoorsGltf.scene.traverse((object) => {
          if (!object.isMesh) return;
          meshCount += 1;
          vertexCount += object.geometry?.attributes?.position?.count ?? 0;
        });
        if (meshCount === 0) {
          console.info('shelves-doors.glb pusty - uzywam proceduralnych polek i drzwi.');
          return;
        }
        // Zabezpieczenie wydajnosciowe: bardzo ciezki model (np. eksport calej
        // sceny zamiast pojedynczych drzwi) jest odrzucany, zeby nie zabic FPS.
        if (vertexCount > 60000) {
          console.warn(
            `shelves-doors.glb ma ${vertexCount} wierzcholkow - za ciezki dla wizualizacji. `
            + 'Uzywam proceduralnych zaslepek. Wyeksportuj pojedyncze, nisko-poligonowe drzwi/polke.',
          );
          return;
        }
        stageOneTemplates.shelvesDoors = prepareAlignedComponent(
          shelvesDoorsGltf.scene,
          stageOneTemplates.sharedScale,
        );
        lockers.forEach((model) => unitGroup.remove(model));
        lockers.clear();
        trailLockers.forEach((model) => unitGroup.remove(model));
        trailLockers.clear();
        palletAssemblies.forEach((assembly) => unitGroup.remove(assembly.carrier));
        palletAssemblies.clear();
        console.info('Podpieto model polek + drzwi z GLB.');
      }).catch(() => {
        // Brak pliku - OK, korzystamy z proceduralnych zaslepek.
      });
    }).catch((error) => {
      console.error('Nie udalo sie zaladowac modeli montazowych GLB.', error);
      if (!disposed) setStageOneModelStatus('error');
    });

    let frame;
    const clock = new THREE.Clock();

    const render = () => {
      const time = clock.getElapsedTime();
      const signature = latestRef.current.stages.map((stage) => `${stage.id}:${stage.color}:${stage.name}:${stage.duration}`).join('|') + '|W:' + (latestRef.current.workersPerStation ?? []).join(',') + '|OW:' + (latestRef.current.offlineStationWorkers ?? []).join(',');

      if (signature !== lastStageSignature) {
        lastStageSignature = signature;
        rebuildStatic();
      }

      const activeNumbers = new Set();
      const activeTrail = new Set();
      const activePallets = new Set();
      let endPalletBusy = false;
      const stagesNow = latestRef.current.stages;
      const trailMap = new Map();
      (latestRef.current.trailUnits ?? []).forEach((t) => trailMap.set(t.key, t));

      // Ustawia jedna POLOWE: poseUnit decyduje o pozycji na tasmie, leadUnit i
      // trailUnit o montazu obu modulow, halfMode o tym, ktora polowa jest
      // pokazana ('lead' = modul 0 + dach/podstawa, 'trail' = modul 1).
      const placeHalf = (model, poseUnit, leadUnit, trailUnit, halfMode) => {
        const pose = getUnitPose(poseUnit, routePoints);
        const stage = stagesNow[poseUnit.currentIndex];
        const isHorizontalAssembly = ['locks', 'shelves', 'back', 'door', 'lockers', 'finalize'].includes(stage?.icon);
        const isStandingStage = stage?.icon === 'finalize';
        const isApproachingStandingStage = poseUnit.mode === 'travel'
          && stagesNow[poseUnit.travelTo]?.icon === 'finalize';
        const finalizeProgress = isStandingStage
          ? THREE.MathUtils.clamp(
            (poseUnit.assemblyProgress ?? poseUnit.progress ?? 0) / 100,
            0,
            1,
          )
          : 0;
        // Nie przeskakuj od razu z wysokosci poziomej na stojaca. Opuszczanie
        // calego modelu ma ten sam zakres czasu co obrot kolumny do pionu,
        // dzieki czemu poczatek animacji nie zapada sie pod rolki.
        // UWAGA: ta sama krzywa i okno co baseParentLiftProgress + liftProgress
        // w updateTwoPartLockerModel - inaczej podstawa plywa w swiecie.
        const standingLiftProgress = isStandingStage
          ? easeInOut(THREE.MathUtils.clamp((finalizeProgress - 0.1) / 0.35, 0, 1))
          : 0;
        const baseHorizontalLift = TUNE.horizontalLift ?? 0.34;
        const preTurnHorizontalLift = TUNE.preTurnHorizontalLift ?? baseHorizontalLift;
        const structureProgress = stage?.icon === 'shelves'
          ? THREE.MathUtils.clamp((poseUnit.assemblyProgress ?? poseUnit.progress ?? 0) / 100, 0, 1)
          : 0;
        const troughMotion = stage?.icon === 'shelves'
          ? getTroughStandMotion(structureProgress)
          : { turnProgress: 0, clearanceLift: 0 };
        let horizontalLift = (
          poseUnit.mode === 'entry'
          || stage?.icon === 'locks'
          || (poseUnit.mode === 'travel' && stagesNow[poseUnit.travelFrom]?.icon === 'locks')
        )
          ? preTurnHorizontalLift
          : baseHorizontalLift;
        if (stage?.icon === 'shelves') {
          horizontalLift = THREE.MathUtils.lerp(
            preTurnHorizontalLift,
            baseHorizontalLift,
            troughMotion.turnProgress,
          );
        }
        const conveyorLift = isStandingStage
          ? THREE.MathUtils.lerp(horizontalLift, TUNE.standingY, standingLiftProgress)
          : horizontalLift;
        // Ladowanie na palecie to STANDARDOWE zachowanie etapu 3 (finalize) -
        // niezalezne od istnienia etapu offline.
        const usePalletLanding = isStandingStage && routePoints.length > 0;
        // Wykonczenie (nitowanie/plecy/dach/daszek) montuje sie NA PALECIE na
        // etapie 3, zaraz po postawieniu obu polowek - chyba ze istnieje etap
        // offline (wtedy, jak dotad, odbywa sie poza linia na stanowisku).
        const finishOnPallet = usePalletLanding && !isOfflineEnabled(stagesNow);
        let finalLanding = null;
        let palletLandingWorld = null;
        let palletLandingAngle = pose.angle;
        model.visible = true;
        if (usePalletLanding) {
          const off = TUNE.offline ?? {};
          const endGround = getEndPalletVector(routePoints);
          const forward = getRouteTangent(routePoints, routePoints.length - 1);
          const angle = Math.atan2(forward.x, forward.z);
          const right = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
          const startWorldY = MODEL_LINE_Y + horizontalLift;
          const modelOffset = off.modelOffset ?? [0, 0, 0];
          const targetWorldY = (off.modelY ?? 0.42) + (modelOffset[1] ?? 0);
          // Srodek podstawy (anchor centrowania na palecie) w ukladzie LOKALNYM
          // modelu - stala geometria, liczona raz. centerWorldModelsOnPallet
          // dosuwa modele o (paleta - srodek podstawy); gdybysmy liczyli offsety
          // ladowania wzgledem samego endGround, to dosuniecie pojawialoby sie
          // SKOKOWO w klatce przelaczenia travel->etap 3 (widoczny przeskok
          // paczkomatu tuz przed pionowaniem). Dlatego to samo przesuniecie
          // wliczamy analitycznie w pozycje modelu i offsety - centrowanie
          // koncowe dostaje wtedy delte ~0 i niczego nie szarpie.
          let anchorLocal = model.userData.palletAnchorLocalXZ;
          if (!anchorLocal) {
            model.updateMatrixWorld(true);
            const anchorBox = new THREE.Box3();
            [model.userData.parts.base, model.userData.parts.baseFront]
              .filter(Boolean)
              .forEach((part) => anchorBox.expandByObject(part));
            if (anchorBox.isEmpty()) {
              anchorLocal = { x: 0, z: 0 };
            } else {
              const centerLocal = model.worldToLocal(anchorBox.getCenter(new THREE.Vector3()));
              anchorLocal = { x: centerLocal.x, z: centerLocal.z };
            }
            model.userData.palletAnchorLocalXZ = anchorLocal;
          }
          const anchorWorldOffset = new THREE.Vector3(anchorLocal.x, 0, anchorLocal.z)
            .multiplyScalar(MODEL_RENDER_SCALE)
            .applyEuler(new THREE.Euler(0, angle, 0));
          // === PRZESUW PALETY (stol uchylny, TUNE.tiltTable) ===
          // Obie polowy spadaja ze stolu w TO SAMO miejsce (os linii), wiec
          // paleta z podstawa podjezdza W BOK tak, by wlasciwe gniazdo bylo pod
          // stolem: dla 1. polowy stoi na -finalX0, w oknie settle drugiej
          // polowy przesuwa sie na -finalX1, a po wlozeniu OBU wraca plynnie
          // na os linii (odjazd na etap 4 startuje jak dotad, bez skoku).
          const tiltCfg = TUNE.tiltTable ?? {};
          const tiltOn = (tiltCfg.enabled ?? false);
          let palletShift = 0;
          if (tiltOn) {
            const rootsFX = model.userData.parts.moduleRoots.map(
              (r) => r.userData.finalX ?? 0,
            );
            const shiftForLead = -(rootsFX[0] ?? 0) * MODEL_RENDER_SCALE;
            const shiftForTrail = -(rootsFX[1] ?? 0) * MODEL_RENDER_SCALE;
            const tiltStart = tiltCfg.settlePortion ?? 0.15;
            const tiltEnd = tiltStart + (tiltCfg.tiltPortion ?? 0.55);
            const trailAtFinal = trailUnit
              && trailUnit.currentIndex === finalizeIdxNow
              && (trailUnit.mode === 'assembly' || trailUnit.mode === 'completed');
            if (!trailAtFinal) {
              palletShift = shiftForLead;
            } else {
              const trailF = THREE.MathUtils.clamp(
                (trailUnit.assemblyProgress ?? trailUnit.progress ?? 0) / 100,
                0,
                1,
              );
              if (trailF < tiltStart) {
                palletShift = THREE.MathUtils.lerp(
                  shiftForLead,
                  shiftForTrail,
                  easeInOut(trailF / Math.max(tiltStart, 0.01)),
                );
              } else if (trailF < tiltEnd) {
                palletShift = shiftForTrail;
              } else {
                palletShift = THREE.MathUtils.lerp(
                  shiftForTrail,
                  0,
                  easeInOut((trailF - tiltEnd) / Math.max(1 - tiltEnd, 0.01)),
                );
              }
            }
          }
          // === ODJAZD GOTOWEJ PALETY ===
          // Po zlozeniu OBU polowek i chwili prezentacji paleta z gotowym
          // paczkomatem ODJEZDZA wzdluz linii, zamiast znikac w miejscu.
          // Kwadratowa krzywa: rusza powoli (bez szarpniecia), przyspiesza i
          // znika w pelnym ruchu daleko za linia - naturalny wyjazd wozkiem.
          const bothHalvesDone = leadUnit?.mode === 'completed'
            && (!trailUnit || trailUnit.mode === 'completed');
          const departWindow = THREE.MathUtils.clamp(
            (((trailUnit ?? leadUnit)?.completedProgress ?? 0) - 0.4) / 0.6,
            0,
            1,
          );
          const departProgress = bothHalvesDone ? departWindow * departWindow : 0;
          const departOffset = forward.clone().multiplyScalar(
            departProgress * (TUNE.offline?.leaveDistance ?? 9) * 1.7,
          );
          // Ten sam cel co centerWorldModelsOnPallet: srodek palety + reczne
          // strojenie modelOffset (x/z).
          const landingGroundBase = endGround.clone()
            .addScaledVector(right, (modelOffset[0] ?? 0) + palletShift)
            .addScaledVector(forward, modelOffset[2] ?? 0)
            .sub(anchorWorldOffset);
          const landingGround = landingGroundBase.clone().add(departOffset);
          // Offsety ladowania ZAWSZE wzgledem pozycji BAZOWEJ (bez odjazdu):
          // pozycja koncowa czesci jest od nich niezalezna (czesc odjezdza,
          // bo jedzie z model.position = landingGround), a zawias wywrotnicy
          // (tiltHingeLocal) liczy sie z tych offsetow - gdyby rosly podczas
          // odjazdu, stol "zapadalby sie" pod podloge.
          const deltaFromPallet = pose.position.clone().sub(landingGroundBase);
          finalLanding = {
            enabled: true,
            tilt: tiltOn,
            offsetX: deltaFromPallet.dot(right) / MODEL_RENDER_SCALE,
            offsetY: (startWorldY - targetWorldY) / MODEL_RENDER_SCALE,
            offsetZ: deltaFromPallet.dot(forward) / MODEL_RENDER_SCALE,
            arcLift: (off.landingLift ?? 0.72) / MODEL_RENDER_SCALE,
          };
          palletLandingWorld = endGround.clone()
            .addScaledVector(right, palletShift)
            .add(departOffset);
          palletLandingAngle = angle;
          if (halfMode === 'lead') showEndPalletForUnit(poseUnit, palletLandingWorld);
          model.position.set(landingGround.x, targetWorldY, landingGround.z);
          model.rotation.y = angle;
          // Zawias stolu w SWIECIE dla animacji wywrotnicy w petli renderu.
          // (x = os linii - stol NIE przesuwa sie z paleta; y/z niezalezne od
          // przesuwu, bo palletShift dziala tylko wzdluz 'right'.)
          if (tiltOn) {
            const hingeLocal = model.userData.parts?.moduleRoots
              ? model.userData.tiltHingeLocal
              : null;
            if (hingeLocal) {
              tiltTableHingeWorld = new THREE.Vector3(
                pose.position.x,
                targetWorldY + hingeLocal.y * MODEL_RENDER_SCALE,
                landingGroundBase.z + hingeLocal.z * MODEL_RENDER_SCALE,
              );
            }
          }
        } else {
          model.position.copy(pose.position);
          model.position.y = isHorizontalAssembly
            ? MODEL_LINE_Y + conveyorLift
            : MODEL_LINE_Y + conveyorLift + Math.sin(time * 2 + poseUnit.number) * 0.018;
          // Etap 0 statyczny: podczas wjazdu koryto OPADA na stol (zamiast
          // wjezdzac tasma) - jakby pracownik odkladal je na blat.
          if (poseUnit.mode === 'entry' && (TUNE.staticFirstStage?.enabled ?? false)) {
            const dropProgress = easeOut(THREE.MathUtils.clamp(
              (poseUnit.travelProgress ?? 0) / 100,
              0,
              1,
            ));
            model.position.y += (TUNE.staticFirstStage?.dropInHeight ?? 0.5) * (1 - dropProgress);
          }
        }

        // Boczne omijanie drugiej polowy jest potrzebne TYLKO w starym trybie
        // (obie polowy pionuja na tej samej stacji). Z wywrotnica druga polowa
        // jedzie prosto na stol (pierwsza stoi juz dalej, na palecie za zawiasem).
        if (halfMode === 'trail' && !(TUNE.tiltTable?.enabled ?? false)
          && (isApproachingStandingStage || isStandingStage)) {
          let sideClearance;
          if (isApproachingStandingStage) {
            // Zjedz na boczny tor JESZCZE W CZASIE DOJAZDU. Na koncu przejazdu
            // druga polowa jest juz calkowicie poza obrysem pierwszej i podstawy.
            const travelProgress = THREE.MathUtils.clamp(
              (poseUnit.travelProgress ?? 0) / 100,
              0,
              1,
            );
            sideClearance = -SECOND_HALF_SIDE_CLEARANCE * easeInOut(travelProgress);
          } else {
            // Na starcie finalu zachowaj pelny przeswit (bez skoku na srodek).
            // Wsun sie poprzecznie dopiero po zakonczeniu pionowania.
            const moveIn = easeInOut(THREE.MathUtils.clamp((finalizeProgress - 0.5) / 0.3, 0, 1));
            sideClearance = -SECOND_HALF_SIDE_CLEARANCE * (1 - moveIn);
          }
          // Lokalna os X modelu przeliczona na swiat dla dowolnego kierunku linii.
          // Uzywamy KATA MODELU (palletLandingAngle = pose.angle poza paleta, albo
          // kat konca linii, gdy jedziemy na paleta) - inaczej ten przeswit znikal
          // skokowo w momencie przelaczenia na tryb paleta (usePalletLanding),
          // bo model.position bylo juz ustawione bez tej korekty.
          model.position.x += Math.cos(palletLandingAngle) * sideClearance;
          model.position.z -= Math.sin(palletLandingAngle) * sideClearance;
        }

        if (!usePalletLanding) {
          model.rotation.y += Math.atan2(Math.sin(pose.angle - model.rotation.y), Math.cos(pose.angle - model.rotation.y)) * 0.16;
        }
        model.scale.setScalar(MODEL_RENDER_SCALE);
        updateTwoPartLockerModel(
          model,
          leadUnit,
          trailUnit,
          time,
          stagesNow,
          halfMode,
          troughLyingPosesRef.current,
          finishOnPallet,
          finalLanding,
        );

        return {
          palletLanding: usePalletLanding,
          palletWorld: palletLandingWorld,
          angle: palletLandingAngle,
        };
      };

      // === ETAP 4: paleta z calym paczkomatem na stanowisku offline ===
      // Dojazd palety (koniec rolotoku -> wolne stanowisko), praca (pojawia sie
      // dach/daszek/laczenie) i odjazd gotowej palety. Caly, sparowany paczkomat
      // (obie polowy) jedzie na jednej palecie.
      const finalizeIdxNow = stagesNow.findIndex((s) => s?.icon === 'finalize');
      const ensurePalletAssembly = (key, off) => {
        let assembly = palletAssemblies.get(key);
        if (!assembly) {
          const carrier = new THREE.Group();
          carrier.name = `palletCarrier-${key}`;
          const pallet = createPalletPlaceholder(off.pallet ?? {});
          const lead = createTwoPartLockerModel(stageOneTemplates);
          const trail = createTwoPartLockerModel(stageOneTemplates);
          carrier.add(pallet);
          carrier.add(lead);
          carrier.add(trail);
          unitGroup.add(carrier);
          assembly = { carrier, pallet, lead, trail };
          palletAssemblies.set(key, assembly);
        }
        return assembly;
      };

      const setCarrierPose = (assembly, worldPos, angle) => {
        assembly.carrier.visible = true;
        assembly.carrier.position.set(worldPos.x, 0, worldPos.z);
        assembly.carrier.rotation.y = angle;
        assembly.pallet.visible = true;
        assembly.pallet.position.set(0, 0, 0);
        assembly.pallet.rotation.set(0, 0, 0);
      };

      const showEndPalletForUnit = (unit, groundOverride = null) => {
        if (!(TUNE.offline?.showEndPallet ?? true) || !routePoints.length) return;
        const off = TUNE.offline ?? {};
        // groundOverride = pozycja z uwzglednionym przesuwem palety (wywrotnica).
        const endGround = groundOverride ?? getEndPalletVector(routePoints);
        const forward = getRouteTangent(routePoints, routePoints.length - 1);
        const angle = Math.atan2(forward.x, forward.z);
        const assembly = ensurePalletAssembly(unit.key, off);
        activePallets.add(unit.key);
        endPalletBusy = true;
        setCarrierPose(assembly, endGround, angle);
        assembly.lead.visible = false;
        assembly.trail.visible = false;
      };

      const placeOffline = (unit) => {
        const stationVec = offlineStationVecs[unit.serverIndex] ?? offlineStationVecs[0];
        if (!stationVec || !routePoints.length) return;
        const off = TUNE.offline ?? {};
        // Start dojazdu = paleta na koncu rolotoku (na ziemi, ZA ostatnia stacja).
        const endGround = getEndPalletVector(routePoints);
        const forward = getRouteTangent(routePoints, routePoints.length - 1);
        const angle = Math.atan2(forward.x, forward.z);

        let palletPos;
        let finalizeFrac;
        let showFinishing;
        if (unit.mode === 'palletTravel') {
          const t = easeOut(THREE.MathUtils.clamp((unit.travelProgress ?? 0) / 100, 0, 1));
          palletPos = endGround.clone().lerp(stationVec, t);
          finalizeFrac = 0.78; // obie polowy stoja na podstawie, bez wykonczenia
          showFinishing = false;
        } else if (unit.mode === 'offline') {
          palletPos = stationVec.clone();
          // Wykonczenie (dach/daszek/plecy/laczenie) pojawia sie w trakcie pracy.
          finalizeFrac = 0.78 + 0.22 * THREE.MathUtils.clamp((unit.progress ?? 0) / 100, 0, 1);
          showFinishing = finalizeFrac > 0.8;
        } else { // 'offlineDone': gotowa paleta odjezdza ze stanowiska
          const t = easeOut(THREE.MathUtils.clamp((unit.travelProgress ?? 0) / 100, 0, 1));
          palletPos = stationVec.clone().addScaledVector(forward, t * (off.leaveDistance ?? 9));
          finalizeFrac = 1;
          showFinishing = true;
        }

        const assembly = ensurePalletAssembly(unit.key, off);
        activePallets.add(unit.key);
        if (unit.mode === 'palletTravel' && (unit.travelProgress ?? 0) < 35) {
          endPalletBusy = true;
        }

        setCarrierPose(assembly, palletPos, angle);

        const modelOffset = off.modelOffset ?? [0, 0, 0];
        const modelY = (off.modelY ?? 0.42) + (modelOffset[1] ?? 0);
        const fake = {
          currentIndex: finalizeIdxNow,
          assemblyProgress: finalizeFrac * 100,
          progress: finalizeFrac * 100,
          mode: 'assembly',
          number: unit.number,
        };
        [['lead', assembly.lead], ['trail', assembly.trail]].forEach(([mode, model]) => {
          model.visible = true;
          model.position.set(0, modelY, 0);
          model.rotation.set(0, 0, 0);
          model.scale.setScalar(MODEL_RENDER_SCALE);
          updateTwoPartLockerModel(
            model,
            fake,
            fake,
            time,
            stagesNow,
            mode,
            troughLyingPosesRef.current,
            showFinishing,
          );
        });
        centerLocalModelsOnPallet(
          [assembly.lead, assembly.trail],
          assembly.carrier,
          modelOffset,
        );
      };

      latestRef.current.visibleUnits.forEach((unit) => {
        // Jednostki na etapie offline (paleta poza rolotokiem) renderujemy osobno.
        if (unit.mode === 'palletTravel' || unit.mode === 'offline' || unit.mode === 'offlineDone') {
          placeOffline(unit);
          return;
        }
        activeNumbers.add(unit.key);
        const trailUnit = trailMap.get(unit.key) ?? null;

        // CZOLO (modul 0 + dach/podstawa) na biezacej pozycji jednostki.
        let leadModel = lockers.get(unit.key);
        if (!leadModel) {
          leadModel = createTwoPartLockerModel(stageOneTemplates);
          lockers.set(unit.key, leadModel);
          unitGroup.add(leadModel);
        }
        const leadPlacement = placeHalf(leadModel, unit, unit, trailUnit, 'lead');

        // OGON (modul 1) ma osobny harmonogram i osobne rezerwacje zasobow.
        if (trailUnit) {
          activeTrail.add(unit.key);
          let trailModel = trailLockers.get(unit.key);
          if (!trailModel) {
            trailModel = createTwoPartLockerModel(stageOneTemplates);
            trailLockers.set(unit.key, trailModel);
            unitGroup.add(trailModel);
          }
          const trailPlacement = placeHalf(trailModel, trailUnit, unit, trailUnit, 'trail');
          const palletModels = [leadPlacement?.palletLanding ? leadModel : null];
          if (trailPlacement?.palletLanding) palletModels.push(trailModel);
          if (leadPlacement?.palletLanding) {
            centerWorldModelsOnPallet(
              palletModels,
              leadPlacement.palletWorld,
              leadPlacement.angle,
              TUNE.offline?.modelOffset ?? [0, 0, 0],
            );
          }
        } else if (leadPlacement?.palletLanding) {
          centerWorldModelsOnPallet(
            [leadModel],
            leadPlacement.palletWorld,
            leadPlacement.angle,
            TUNE.offline?.modelOffset ?? [0, 0, 0],
          );
        }
      });

      lockers.forEach((model, number) => {
        if (!activeNumbers.has(number)) model.visible = false;
      });
      trailLockers.forEach((model, number) => {
        if (!activeTrail.has(number)) model.visible = false;
      });
      if (endPalletStandby) {
        endPalletStandby.visible = !endPalletBusy;
      }
      palletAssemblies.forEach((assembly, key) => {
        if (!activePallets.has(key)) {
          assembly.carrier.visible = false;
          assembly.pallet.visible = false;
          assembly.lead.visible = false;
          assembly.trail.visible = false;
        }
      });

      // === Animacja wywrotnicy (etap 3): stol obraca sie razem z czescia. ===
      // Kat = max po polowach bedacych na etapie 3: podnoszenie w oknie tilt,
      // powrot pustego stolu w oknie return (czesc stoi juz w podstawie).
      if (tiltTableRig) {
        const tiltCfg = TUNE.tiltTable ?? {};
        const tiltStart = tiltCfg.settlePortion ?? 0.15;
        const tiltSpan = Math.max(tiltCfg.tiltPortion ?? 0.55, 0.05);
        const tiltEnd = tiltStart + tiltSpan;
        const returnSpan = Math.max(tiltCfg.returnPortion ?? 0.25, 0.05);
        const angleFor = (fraction) => {
          if (fraction <= tiltStart) return 0;
          if (fraction < tiltEnd) {
            return Math.PI * 0.5 * easeInOut((fraction - tiltStart) / tiltSpan);
          }
          return Math.PI * 0.5
            * (1 - easeInOut(Math.min((fraction - tiltEnd) / returnSpan, 1)));
        };
        let tableAngle = 0;
        const collectAngle = (unit) => {
          if (!unit || unit.currentIndex !== finalizeIdxNow) return;
          if (unit.mode !== 'assembly' && unit.mode !== 'completed') return;
          const fraction = THREE.MathUtils.clamp(
            (unit.assemblyProgress ?? unit.progress ?? 0) / 100,
            0,
            1,
          );
          tableAngle = Math.max(tableAngle, angleFor(fraction));
        };
        latestRef.current.visibleUnits.forEach(collectAngle);
        (latestRef.current.trailUnits ?? []).forEach(collectAngle);
        tiltTableRig.pivot.rotation.x = tableAngle;
        // Dokladny zawias czesci (z placeHalf) nadpisuje analityczny - stol
        // i czesc obracaja sie wokol identycznego punktu.
        if (tiltTableHingeWorld) {
          tiltTableRig.group.position.copy(tiltTableHingeWorld);
        }
      }
      renderer.domElement.dataset.scheduleConflicts = String(
        latestRef.current.scheduleConflictCount ?? 0,
      );
      renderer.domElement.dataset.stageOneGlb = stageOneTemplates ? 'ready' : 'loading';
      renderer.domElement.dataset.stageOneGlbUnits = String(
        [...lockers.values()].filter((model) => model.userData.usesStageOneGlb).length,
      );

      rollers.forEach((roller) => {
        roller.rotateY(0.09);
      });

      stationWorkers.forEach((worker) => {
        // Pracownicy na stanowiskach offline (etap 4) maja serverIndex - sa
        // "aktywni" gdy NA ICH stanowisku trwa praca (offline), niezaleznie od
        // pozostalych stacji rolotoku, ktore sprawdzaja tylko currentIndex+mode.
        const active = worker.userData.serverIndex !== undefined
          ? latestRef.current.visibleUnits.some(
            (unit) => unit.mode === 'offline' && unit.serverIndex === worker.userData.serverIndex,
          )
          : latestRef.current.visibleUnits.some(
            (unit) =>
              unit.currentIndex === worker.userData.index
              && unit.mode === 'assembly'
              && (unit.assemblyProgress ?? 0) > 0,
          );
        const phase = time * (active ? 3.4 : 1.1) + worker.userData.index * 0.8 + (worker.userData.seed ?? 0) * 1.7;
        const workSwing = Math.sin(phase);
        const precisionPulse = Math.sin(phase * 2.4);
        const placementCycle = (1 - Math.cos(phase * 0.72)) * 0.5;
        const action = (worker.userData.index + (worker.userData.seed ?? 0)) % 4;
        const actionPoses = [
          {
            leftShoulder: -0.86,
            leftElbow: -0.52,
            rightShoulder: -1.02,
            rightElbow: -0.62 + precisionPulse * 0.09,
            torso: -0.07,
            head: 0.04 + workSwing * 0.025,
          },
          {
            leftShoulder: -1.08 - placementCycle * 0.1,
            leftElbow: -0.3 - placementCycle * 0.08,
            rightShoulder: -1.12 - placementCycle * 0.1,
            rightElbow: -0.28 - placementCycle * 0.08,
            torso: -0.095,
            head: workSwing * 0.035,
          },
          {
            leftShoulder: -0.92,
            leftElbow: -0.5,
            rightShoulder: -1.08,
            rightElbow: -0.55 + Math.max(precisionPulse, 0) * 0.11,
            torso: -0.085,
            head: 0.03 + workSwing * 0.025,
          },
          {
            leftShoulder: -1.14 - placementCycle * 0.28,
            leftElbow: -0.3 - placementCycle * 0.18,
            rightShoulder: -1.14 - placementCycle * 0.28,
            rightElbow: -0.3 - placementCycle * 0.18,
            torso: -0.055,
            head: workSwing * 0.025,
          },
        ];
        const idleBreath = Math.sin(phase) * 0.012;
        const pose = active
          ? actionPoses[action]
          : {
              leftShoulder: -0.08 + idleBreath,
              leftElbow: -0.06,
              rightShoulder: -0.1 - idleBreath,
              rightElbow: -0.07,
              torso: 0,
              head: Math.sin(phase * 0.55) * 0.1,
            };
        const smoothing = active ? 0.14 : 0.08;
        const approach = (current, target) => current + (target - current) * smoothing;

        worker.position.y = worker.userData.baseY + Math.sin(time * 1.3 + worker.userData.index) * 0.003;
        worker.rotation.z = Math.sin(phase * 0.45) * (active ? 0.005 : 0.003);
        worker.userData.torso.rotation.x = approach(worker.userData.torso.rotation.x, pose.torso);
        worker.userData.head.rotation.y = approach(worker.userData.head.rotation.y, pose.head);
        worker.userData.leftArm.shoulder.rotation.x = approach(
          worker.userData.leftArm.shoulder.rotation.x,
          pose.leftShoulder,
        );
        worker.userData.leftArm.elbow.rotation.x = approach(
          worker.userData.leftArm.elbow.rotation.x,
          pose.leftElbow,
        );
        worker.userData.rightArm.shoulder.rotation.x = approach(
          worker.userData.rightArm.shoulder.rotation.x,
          pose.rightShoulder,
        );
        worker.userData.rightArm.elbow.rotation.x = approach(
          worker.userData.rightArm.elbow.rotation.x,
          pose.rightElbow,
        );
        worker.userData.toolGroup.rotation.z = active && (action === 0 || action === 2)
          ? precisionPulse * 0.025
          : 0;
        worker.userData.legs[0].rotation.x = approach(worker.userData.legs[0].rotation.x, 0);
        worker.userData.legs[1].rotation.x = approach(worker.userData.legs[1].rotation.x, 0);
        const stageColor = latestRef.current.stages[worker.userData.index]?.color ?? '#2563eb';
        worker.userData.toolTip.material.emissive = new THREE.Color(active ? stageColor : '#000000');
        worker.userData.toolTip.material.emissiveIntensity = active
          ? 0.45 + Math.max(workSwing, 0) * 0.35
          : 0;
        worker.userData.vest.material.emissive = new THREE.Color(active ? '#f59e0b' : '#000000');
        worker.userData.vest.material.emissiveIntensity = active ? 0.12 : 0;
      });

      // Wolna kamera: przesuwanie klawiszami (WASD/strzalki + Q/E gora/dol).
      const moveDt = Math.min(Math.max(time - lastMoveTime, 0), 0.05);
      lastMoveTime = time;
      if (moveKeys.size) {
        camera.getWorldDirection(moveForward);
        moveForward.y = 0;
        if (moveForward.lengthSq() < 1e-6) moveForward.set(0, 0, -1);
        moveForward.normalize();
        moveRight.crossVectors(moveForward, camera.up).normalize();
        moveDelta.set(0, 0, 0);
        if (moveKeys.has('w') || moveKeys.has('arrowup')) moveDelta.add(moveForward);
        if (moveKeys.has('s') || moveKeys.has('arrowdown')) moveDelta.sub(moveForward);
        if (moveKeys.has('d') || moveKeys.has('arrowright')) moveDelta.add(moveRight);
        if (moveKeys.has('a') || moveKeys.has('arrowleft')) moveDelta.sub(moveRight);
        if (moveKeys.has('e')) moveDelta.y += 1;
        if (moveKeys.has('q')) moveDelta.y -= 1;
        if (moveDelta.lengthSq() > 0) {
          const moveSpeed = (TUNE.camera?.moveSpeed ?? 14) * (moveKeys.has('shift') ? 3 : 1);
          moveDelta.normalize().multiplyScalar(moveSpeed * moveDt);
          camera.position.add(moveDelta);
          controls.target.add(moveDelta);
        }
      }
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      sectorsChannel?.close();
      window.removeEventListener('storage', onSectorsStorage);
      window.removeEventListener('keydown', onMoveKeyDown);
      window.removeEventListener('keyup', onMoveKeyUp);
      window.removeEventListener('blur', clearMoveKeys);
      controls.dispose();
      controlsRef.current = null;
      dracoLoader.dispose();
      environmentTexture.dispose();
      pmremGenerator.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="three-scene">
      <div className="zoom-controls" aria-label="Kontrola przyblizenia sceny 3D">
        <button type="button" onClick={() => zoomCamera(1.2)} title="Oddal kamere">
          <ZoomOut size={17} />
        </button>
        <button type="button" onClick={() => zoomCamera(0.82)} title="Przybliz kamere">
          <ZoomIn size={17} />
        </button>
        <button
          type="button"
          onClick={() => controlsRef.current?.reset()}
          title="Resetuj pozycje kamery"
        >
          <RotateCcw size={17} />
        </button>
        <button
          type="button"
          onClick={() => window.open('/edytor_stref.html', '_blank', 'noopener')}
          title="Edytor stref hali (zmiany widac tu na zywo)"
        >
          <PencilRuler size={17} />
        </button>
        <button
          type="button"
          onClick={() => window.open('/dokumentacja.html', '_blank', 'noopener')}
          title="Dokumentacja dla inzynierow"
        >
          <HelpCircle size={17} />
        </button>
      </div>
      <div
        className={`cad-model-status ${stageOneModelStatus}`}
        data-stage-one-model-status={stageOneModelStatus}
      >
        <span />
        {stageOneModelStatus === 'error'
          ? 'Model GLB niedostepny'
          : stageOneModelStatus === 'ready'
            ? 'Modele GLB aktywne'
            : 'Ladowanie modeli GLB'}
      </div>
      <div className="three-scene-mount" ref={mountRef} />
    </div>
  );
}

function ProductionLine({
  stages,
  visibleUnits,
  trailUnits,
  conveyorDuration,
  productionFinished,
  scheduleConflictCount,
  workersPerStation,
  offlineStationWorkers,
  onAssemblyMetrics,
}) {
  const leadUnit = visibleUnits[0] ?? {
    currentIndex: productionFinished ? Math.max(stages.length - 1, 0) : 0,
    progress: productionFinished ? 100 : 0,
    assemblyProgress: productionFinished ? 100 : 0,
    number: 1,
  };
  const currentStage = stages[leadUnit.currentIndex] ?? (productionFinished ? stages[stages.length - 1] : stages[0]);
  const isFinished = productionFinished;
  const isEntryStage = leadUnit.mode === 'entry';
  const displayStageName = isEntryStage ? 'Podanie pustych koryt' : currentStage?.name;
  const displayStageColor = isEntryStage ? '#64748b' : currentStage?.color;
  const installedLockCount = Math.min(
    LOCK_COUNT,
    Math.floor(((leadUnit.assemblyProgress ?? leadUnit.progress ?? 0) / 100) * LOCK_COUNT),
  );
  const installedLockerCount = Math.min(
    LOCKER_COUNT,
    Math.floor(((leadUnit.assemblyProgress ?? leadUnit.progress ?? 0) / 100) * LOCKER_COUNT),
  );
  const statusLabel = isFinished
    ? 'Seria zakonczona'
    : leadUnit.mode === 'completed'
      ? 'Gotowy paczkomat'
    : leadUnit.mode === 'entry'
      ? 'Dojazd na montaz zamkow'
    : leadUnit.isBlocked
    ? 'Czeka na wolny etap'
    : leadUnit.mode === 'travel'
      ? 'Przejazd'
      : 'Aktualny postoj';
  const occupiedStages = new Set(
    visibleUnits
      .filter((unit) => unit.mode !== 'travel' && unit.mode !== 'entry')
      .map((unit) => unit.currentIndex),
  );

  return (
    <section className="visual-area">
      <div className="visual-header">
        <div>
          <p className="eyebrow">Wizualizacja</p>
          <h1>Linia produkcyjna paczkomatu</h1>
        </div>
        <div className="live-pill">
          <span />
          {isFinished ? 'Limit osiagniety' : 'Na zywo'}
        </div>
      </div>

      <div className="conveyor-wrap">
        <div className="stations">
          <motion.div
            className={`station stage-zero ${isEntryStage ? 'active occupied' : ''}`}
            layout
            style={{ '--stage-color': '#64748b' }}
          >
            <div className="station-icon">
              <Box className="station-svg" aria-hidden="true" />
            </div>
            <span>0</span>
            <strong>Podanie koryt</strong>
            <small>{formatTime(ENTRY_TRAVEL_SECONDS)}</small>
          </motion.div>
          {stages.map((stage, index) => (
            <motion.div
              className={`station ${!isEntryStage && index === leadUnit.currentIndex ? 'active' : ''} ${occupiedStages.has(index) ? 'occupied' : ''}`}
              key={stage.id}
              layout
              style={{ '--stage-color': stage.color }}
            >
              <div className="station-icon">
                <StageIcon icon={stage.icon} className="station-svg" />
              </div>
              <span>{index + 1}</span>
              <strong>{stage.name || 'Etap'}</strong>
              <small>{formatTime(clampNumber(stage.duration))}</small>
            </motion.div>
          ))}
        </div>

        <div className="factory-floor scene-layout">
          <ThreeProductionScene
            stages={stages}
            visibleUnits={visibleUnits}
            trailUnits={trailUnits}
            scheduleConflictCount={scheduleConflictCount}
            workersPerStation={workersPerStation}
            offlineStationWorkers={offlineStationWorkers}
            onAssemblyMetrics={onAssemblyMetrics}
          />
        </div>

        <div className="process-readout">
          <div>
            <span style={{ backgroundColor: displayStageColor }} />
            <p>{statusLabel}</p>
            <strong>{displayStageName || 'Etap'}</strong>
          </div>
          <div>
            <p>
              {currentStage?.icon === 'locks'
                ? 'Zamki zamontowane'
                : currentStage?.icon === 'lockers'
                  ? 'Skrytki zamontowane'
                  : 'Postep etapu'}
            </p>
            <strong>
              {currentStage?.icon === 'locks'
                ? `${isFinished ? LOCK_COUNT : installedLockCount}/${LOCK_COUNT}`
                : currentStage?.icon === 'lockers'
                  ? `${isFinished ? LOCKER_COUNT : installedLockerCount}/${LOCKER_COUNT}`
                : isFinished
                  ? '100%'
                  : `${Math.round(leadUnit.assemblyProgress ?? leadUnit.progress)}%`}
            </strong>
          </div>
          <div>
            <p>Paczkomaty na linii</p>
            <strong>{visibleUnits.length}</strong>
          </div>
          <div>
            <p>Pelna petla animacji</p>
            <strong>{formatTime(conveyorDuration)}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

function App() {
  // Stan startowy odtwarzany z localStorage (patrz UI_CONFIG_KEY), dzieki czemu strona
  // pamieta ustawienia uzytkownika miedzy odwiedzinami bez zadnej bazy danych.
  const [unitCount, setUnitCount] = useState(
    () => Math.max(1, Math.floor(restoreNumber(savedUiConfig?.unitCount, 2, 1))),
  );
  const [stages, setStages] = useState(() => restoreStages(savedUiConfig?.stages) ?? baseStages);
  const [elapsed, setElapsed] = useState(0);
  const [speedMultiplier, setSpeedMultiplier] = useState(
    () => restoreNumber(savedUiConfig?.speedMultiplier, 1, 0.01),
  );
  const speedRef = useRef(1);
  speedRef.current = speedMultiplier;
  const [travelTimes, setTravelTimes] = useState(
    () => restoreNumberArray(savedUiConfig?.travelTimes, getDefaultTravelTimes(baseStages)),
  );
  const [offlinePalletTravel, setOfflinePalletTravel] = useState(
    () => restoreNumber(savedUiConfig?.offlinePalletTravel, TUNE.offline?.palletTravel ?? 6, 0),
  );
  const [workersPerStation, setWorkersPerStation] = useState(
    () => restoreNumberArray(savedUiConfig?.workersPerStation, baseStages.map(() => 1)),
  );
  // Liczba pracownikow WIZUALNIE na kazdym z rownoleglych stanowisk offline
  // (etap 4) osobno - Stanowisko 1 i Stanowisko 2 moga miec inna liczbe.
  // Czysto wizualne: czas etapu 4 nadal liczy sie z workersPerStation (jeden
  // wspolny mnoznik dla calego etapu), tu tylko ile sylwetek sie pokazuje.
  const [offlineStationWorkers, setOfflineStationWorkers] = useState(
    () => restoreNumberArray(savedUiConfig?.offlineStationWorkers, [1, 1]),
  );
  const [workerEffect, setWorkerEffect] = useState(() => (
    savedUiConfig?.workerEffect && typeof savedUiConfig.workerEffect === 'object'
      ? {
        mode: savedUiConfig.workerEffect.mode === 'seconds' ? 'seconds' : 'percent',
        value: restoreNumber(savedUiConfig.workerEffect.value, DEFAULT_WORKER_EFFECT.value, 0),
      }
      : DEFAULT_WORKER_EFFECT
  ));
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [stopwatchElapsed, setStopwatchElapsed] = useState(0);
  const [measuredPartLength, setMeasuredPartLength] = useState(
    ASSEMBLY_LENGTH * MODEL_RENDER_SCALE,
  );
  const stopwatchStartRef = useRef(0);
  const stopwatchBaseRef = useRef(0);

  // Auto-zapis konfiguracji do localStorage (odtwarzana przy nastepnym
  // otwarciu strony). Debounce 400 ms, zeby nie zapisywac co klawisz.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(UI_CONFIG_KEY, JSON.stringify({
          savedAt: new Date().toISOString(),
          unitCount,
          stages,
          speedMultiplier,
          travelTimes,
          offlinePalletTravel,
          workersPerStation,
          offlineStationWorkers,
          workerEffect,
        }));
      } catch {
        // np. tryb prywatny / pelny magazyn; dzialamy dalej bez zapisu
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [
    unitCount,
    stages,
    speedMultiplier,
    travelTimes,
    offlinePalletTravel,
    workersPerStation,
    offlineStationWorkers,
    workerEffect,
  ]);

  const normalizedBaseStages = useMemo(
    () =>
      stages.map((stage) => ({
        ...stage,
        duration: clampNumber(stage.duration),
      })),
    [stages],
  );

  const productionCount = Math.max(1, Math.floor(clampNumber(unitCount, 1)));
  const normalizedWorkers = useMemo(
    () => normalizedBaseStages.map((_, i) => {
      const v = Math.round(Number(workersPerStation[i]));
      return Number.isFinite(v) ? Math.max(1, v) : 1;
    }),
    [normalizedBaseStages, workersPerStation],
  );
  const normalizedWorkerEffect = useMemo(
    () => ({
      mode: workerEffect.mode === 'seconds' ? 'seconds' : 'percent',
      value: workerEffect.mode === 'percent'
        ? clampPercent(workerEffect.value)
        : clampNumber(workerEffect.value, 0),
    }),
    [workerEffect],
  );
  const normalizedStages = useMemo(
    () =>
      normalizedBaseStages.map((stage, index) => ({
        ...stage,
        baseDuration: stage.duration,
        workerCount: normalizedWorkers[index],
        duration: getEffectiveStageDuration(
          stage.duration,
          normalizedWorkers[index],
          normalizedWorkerEffect,
        ),
      })),
    [normalizedBaseStages, normalizedWorkerEffect, normalizedWorkers],
  );
  const normalizedTravelTimes = useMemo(
    () => normalizeTravelTimes(travelTimes, normalizedStages),
    [normalizedStages, travelTimes],
  );
  const productionSchedule = useMemo(() => {
    const schedule = buildProductionSchedule(
      normalizedStages,
      productionCount,
      normalizedTravelTimes,
      measuredPartLength,
    );
    schedule.reservationConflicts = validateScheduleReservations(schedule);
    if (schedule.reservationConflicts.length > 0) {
      console.error('Wykryto konflikt rezerwacji harmonogramu.', schedule.reservationConflicts);
    }
    return schedule;
  }, [
    measuredPartLength,
    normalizedStages,
    normalizedTravelTimes,
    productionCount,
    offlinePalletTravel,
  ]);
  const cycleTime = productionSchedule.soloCycleTime;
  const launchInterval = productionSchedule.launchInterval;
  const totalTime = productionSchedule.totalTime;
  const animationCycle = Math.max(totalTime, 1);

  const throughputPerHour = launchInterval > 0 ? 3600 / launchInterval : 0;
  const throughputPerShift = throughputPerHour * 8;
  // Bottleneck i wykorzystanie liczone z EFEKTYWNEGO czasu etapu = czas / liczba
  // rownoleglych serwerow. Etap offline ma N stanowisk, wiec jego efektywny czas
  // (a wiec i obciazenie) jest N-krotnie mniejszy: 2 stanowiska = 2x przepustowosc.
  const offlineStageIndex = productionSchedule.offlineStageIndex ?? -1;
  const offlineServerCount = productionSchedule.offlineServerCount ?? 1;
  const stageServers = (i) => (i === offlineStageIndex ? Math.max(offlineServerCount, 1) : 1);
  const effDuration = (st, i) => Math.max(st.duration, 0) / stageServers(i);
  let kpiBnIdx = -1, kpiBnMax = -1;
  normalizedStages.forEach((st, i) => { const e = effDuration(st, i); if (e > kpiBnMax) { kpiBnMax = e; kpiBnIdx = i; } });
  const stageUtilization = normalizedStages.map((st, i) => ({
    name: st.name || `Etap ${i + 1}`,
    pct: kpiBnMax > 0 ? Math.min(100, (effDuration(st, i) / kpiBnMax) * 100) : 0,
    isBottleneck: i === kpiBnIdx,
    servers: stageServers(i),
  }));

  const handleExportPdf = () => {
    const rows = buildBottleneckRows(normalizedStages, productionSchedule);
    const html = renderTimesReportHtml({ rows, cycleTime, launchInterval, totalTime, throughputPerHour, throughputPerShift });
    const win = window.open('', '_blank');
    if (!win) {
      window.alert('Nie udalo sie otworzyc okna wydruku. Zezwol na wyskakujace okna i sprobuj ponownie.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch (e) {} }, 350);
  };

  React.useEffect(() => {
    let frame;
    const start = performance.now();
    setElapsed(0);

    let last = start;
    let acc = 0;
    const tick = (now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      acc += dt * (speedRef.current || 1);
      const seconds = acc >= animationCycle ? animationCycle + 0.001 : acc;
      setElapsed(seconds);
      if (acc < animationCycle) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animationCycle, normalizedStages.length, productionCount]);

  React.useEffect(() => {
    setTravelTimes((current) => normalizeTravelTimes(current, normalizedStages));
  }, [normalizedStages]);

  React.useEffect(() => {
    if (!stopwatchRunning) return undefined;

    let frame;
    stopwatchStartRef.current = performance.now();

    const tick = (now) => {
      setStopwatchElapsed(stopwatchBaseRef.current + (now - stopwatchStartRef.current) / 1000);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [stopwatchRunning]);

  const visibleUnits = useMemo(
    () => getVisibleUnitsFromSchedule(productionSchedule, elapsed, normalizedStages.length),
    [elapsed, normalizedStages.length, productionSchedule],
  );
  // Druga polowa ma wlasny harmonogram i wlasne rezerwacje zasobow. Nie jest
  // juz stanem lidera sprzed kilku sekund, wiec nie dogania go podczas postoju.
  const trailUnits = useMemo(
    () => getVisibleUnitsFromSchedule(
      productionSchedule,
      elapsed,
      normalizedStages.length,
      'trail',
    ),
    [elapsed, normalizedStages.length, productionSchedule],
  );

  const updateStage = (id, patch) => {
    setStages((current) => current.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage)));
  };

  const updateTravelTime = (index, value) => {
    setTravelTimes((current) => {
      const next = normalizeTravelTimes(current, normalizedStages);
      next[index] = value;
      return next;
    });
  };

  // TUNE jest globalnym obiektem czytanym bezposrednio przez harmonogram
  // (buildProductionSchedule), wiec mutujemy go tak samo jak inne "live tuning"
  // wartosci - stan Reacta sluzy tylko do wymuszenia przeliczenia (useMemo deps).
  const updateOfflinePalletTravel = (value) => {
    const next = Math.max(0.1, clampNumber(value, TUNE.offline?.palletTravel ?? 6));
    if (TUNE.offline) TUNE.offline.palletTravel = next;
    setOfflinePalletTravel(next);
  };

  const updateWorkerCount = (index, value) => {
    setWorkersPerStation((current) => {
      const next = normalizedStages.map((_, i) => current[i] ?? 1);
      const parsed = Math.round(Number(value));
      next[index] = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
      return next;
    });
  };

  const updateOfflineStationWorkerCount = (stationIndex, value) => {
    setOfflineStationWorkers((current) => {
      const size = Math.max(current.length, stationIndex + 1, getOfflineServerCount());
      const next = Array.from({ length: size }, (_, i) => current[i] ?? 1);
      const parsed = Math.round(Number(value));
      next[stationIndex] = Number.isFinite(parsed) ? Math.max(0, parsed) : 1;
      return next;
    });
  };

  const updateWorkerEffect = (patch) => {
    setWorkerEffect((current) => ({
      ...current,
      ...patch,
    }));
  };

  const toggleStopwatch = () => {
    if (stopwatchRunning) {
      stopwatchBaseRef.current = stopwatchElapsed;
      setStopwatchRunning(false);
      return;
    }

    stopwatchBaseRef.current = stopwatchElapsed;
    setStopwatchRunning(true);
  };

  const resetStopwatch = () => {
    stopwatchBaseRef.current = 0;
    stopwatchStartRef.current = performance.now();
    setStopwatchElapsed(0);
  };

  const addStage = () => {
    setStages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: `Etap ${current.length + 1}`,
        duration: DEFAULT_STAGE_SECONDS,
        color: '#0f766e',
        icon: 'box',
      },
    ]);
  };

  const removeStage = (id) => {
    setStages((current) => (current.length === 1 ? current : current.filter((stage) => stage.id !== id)));
  };

  const resetStages = () => {
    setStages(baseStages.map((stage) => ({ ...stage, id: crypto.randomUUID() })));
    setTravelTimes(getDefaultTravelTimes(baseStages));
  };

  const handleAssemblyMetrics = React.useCallback(({ partLength }) => {
    if (!Number.isFinite(partLength) || partLength <= 0) return;
    setMeasuredPartLength((current) => (
      Math.abs(current - partLength) > 0.001 ? partLength : current
    ));
  }, []);

  return (
    <main className="app-shell">
      <Metrics
        unitCount={unitCount}
        setUnitCount={setUnitCount}
        cycleTime={cycleTime}
        totalTime={totalTime}
        stages={normalizedStages}
        launchInterval={launchInterval}
        travelTimes={normalizedTravelTimes}
        updateTravelTime={updateTravelTime}
        offlinePalletTravel={offlinePalletTravel}
        updateOfflinePalletTravel={updateOfflinePalletTravel}
        workersPerStation={workersPerStation}
        updateWorkerCount={updateWorkerCount}
        offlineStationWorkers={offlineStationWorkers}
        updateOfflineStationWorkerCount={updateOfflineStationWorkerCount}
        workerEffect={normalizedWorkerEffect}
        updateWorkerEffect={updateWorkerEffect}
        throughputPerHour={throughputPerHour}
        throughputPerShift={throughputPerShift}
        stageUtilization={stageUtilization}
        speedMultiplier={speedMultiplier}
        setSpeedMultiplier={setSpeedMultiplier}
        onExportPdf={handleExportPdf}
        stopwatch={{
          elapsed: stopwatchElapsed,
          running: stopwatchRunning,
          toggle: toggleStopwatch,
          reset: resetStopwatch,
        }}
      />
      <ProductionLine
        stages={normalizedStages}
        visibleUnits={visibleUnits}
        trailUnits={trailUnits}
        conveyorDuration={animationCycle}
        productionFinished={elapsed >= animationCycle}
        scheduleConflictCount={productionSchedule.reservationConflicts.length}
        workersPerStation={normalizedWorkers}
        offlineStationWorkers={offlineStationWorkers}
        onAssemblyMetrics={handleAssemblyMetrics}
      />
      <StageEditor
        stages={stages}
        updateStage={updateStage}
        addStage={addStage}
        removeStage={removeStage}
        resetStages={resetStages}
      />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
