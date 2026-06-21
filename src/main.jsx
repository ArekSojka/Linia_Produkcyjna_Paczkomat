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
  CheckCircle2,
  Clock3,
  DoorOpen,
  Frame,
  Grid3X3,
  House,
  LockKeyhole,
  Pause,
  Plus,
  Play,
  RotateCcw,
  Settings2,
  TimerReset,
  Trash2,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import './styles.css';

const baseStages = [
  {
    id: crypto.randomUUID(),
    name: '2 koryta i 22 zamki',
    duration: 2,
    color: '#2563eb',
    icon: 'locks',
  },
  {
    id: crypto.randomUUID(),
    name: 'Sciany boczne i polki',
    duration: 2,
    color: '#0891b2',
    icon: 'shelves',
  },
  {
    id: crypto.randomUUID(),
    name: '22 skrytki',
    duration: 2,
    color: '#16a34a',
    icon: 'lockers',
  },
  {
    id: crypto.randomUUID(),
    name: 'Polaczenie, plecy i dachy',
    duration: 2,
    color: '#7c3aed',
    icon: 'finalize',
  },
];

const iconOptions = [
  { value: 'locks', label: 'Koryto i zamki' },
  { value: 'shelves', label: 'Piony i polki' },
  { value: 'back', label: 'Plecy' },
  { value: 'frame', label: 'Rama' },
  { value: 'door', label: 'Drzwi' },
  { value: 'roof', label: 'Dach' },
  { value: 'lockers', label: 'Skrytki' },
  { value: 'finalize', label: 'Polaczenie, plecy i dachy' },
  { value: 'electronics', label: 'Elektronika' },
  { value: 'test', label: 'Test' },
  { value: 'box', label: 'Montaz' },
];

const stageIcons = {
  locks: LockKeyhole,
  shelves: Box,
  back: Box,
  frame: Frame,
  door: DoorOpen,
  roof: House,
  lockers: Grid3X3,
  finalize: House,
  electronics: Zap,
  test: CheckCircle2,
  box: Box,
};

const clampNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
};

const formatTime = (seconds) => {
  if (seconds < 60) return `${seconds.toFixed(1).replace('.0', '')} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} min ${rest} s`;
};

const CONVEYOR_WIDTH = 6.2;
const CONVEYOR_RAIL_OFFSET = CONVEYOR_WIDTH / 2 - 0.35;
const ROLLER_LENGTH = CONVEYOR_WIDTH - 0.85;
const CONVEYOR_ELEVATION = 1.3;
const MODEL_LINE_Y = CONVEYOR_ELEVATION + 1.04;
const STATION_SIDE_DISTANCE = CONVEYOR_WIDTH / 2 + 1.25;
const ROLLER_COLOR = '#e2e8f0';
const CONVEYOR_UNITS_PER_SECOND = 1.42;
const MIN_TRAVEL_SECONDS = 3.2;
const ENTRY_TRAVEL_SECONDS = 2;
const ENTRY_CONVEYOR_LENGTH = 5.8;
const COMPLETED_DISPLAY_SECONDS = 5;
// === JEDNO zrodlo prawdy dla liczby skrytek na polowe paczkomatu ===
// Zakres docelowy 10 / 11 / 12. Ta liczba musi sie zgadzac z modelem
// polek + drzwi (polkiorazdrzwi.glb). Zmiana tylko tej jednej wartosci
// automatycznie skaluje zamki, polki i skrytki - zawsze w relacji 1:1:1.
const CELLS_PER_HALF = 11;
const LOCKS_PER_MODULE = CELLS_PER_HALF;
const MODULE_COUNT = 2;
const LOCK_COUNT = LOCKS_PER_MODULE * MODULE_COUNT;
const LOCKER_COUNT = LOCK_COUNT;
const SHELF_COUNT = LOCKS_PER_MODULE;

// =====================================================================
// === STROJENIE NA ZYWO (Vite HMR) ===================================
// Zmien ktorakolwiek z tych liczb i ZAPISZ - Vite przeladuje scene od
// reki, bez nagrywania. Tu sa wszystkie pozycje, ktore dotad strzelalem
// na slepo. Ustaw je u siebie patrzac na render.
// ---------------------------------------------------------------------
const TUNE = {
  // DROBNA korekta X zamkow [modul 0, modul 1]. Zamki sa AUTOMATYCZNIE stawiane
  // na zmierzonej pozycji WIEKSZEGO koryta kazdej polowy - ta wartosc to tylko
  // ewentualny nudge (np. zeby zamki wystawaly z powierzchni). 0 = na korycie.
  lockX: [0, 0],
  // Wysokosc dachu liczona od szczytu kolumny. Zwieksz = wyzej (gdy wnika),
  // zmniejsz = nizej (gdy lewituje).
  roofYOffset: -0.08,
  // Wysokosc daszka - ma byc lekko POD dachem (czyli mniej niz roofYOffset).
  canopyYOffset: -0.16,
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
  backWallY: -0.8,
  // O ile gleboko pod spodem startuje sciana tylnia (montaz "od dolu").
  backWallDrop: 2.2,
  // Obrot sciany tylniej (radiany) - byla "do gory nogami", wiec domyslnie PI
  // (180 stopni). Gdyby trzeba bylo innej osi, daj znac.
  backWallRotX: Math.PI,
  // === Ostatni etap (stawianie pionowe) ===
  // Odstep X miedzy dwiema polowkami. DODATNIE = rozsuwa, UJEMNE = scala je
  // razem. Daj ujemne, gdy w srodku jest szpara / sciany sie rozjezdzaja.
  halfGapX: 0,
  // Pionowe dociagniecie stojacych kolumn (ujemne = nizej, gdy lewituja).
  columnSettleY: 0,
  // Wysokosc CALEGO stojacego paczkomatu (podstawa + kolumny) wzgledem linii.
  // Ujemne opuszcza go, zeby PODSTAWA siadla na tasmociagu, a nie lewitowala.
  standingY: -0.4,
  // Obrot CALEJ czesci wokol dlugiej osi (radiany). Math.PI = czesc staje
  // prawidlowo (nie do gory nogami). Daj 0, gdyby przegielo w druga strone.
  partsRotY: Math.PI,
  // === POLKI (GLB polka.glb) ===
  shelfScale: 1,            // skala polki (gdy za duza/mala)
  shelfRotX: 0,   // obrot polki, by lezala plasko w poprzek kolumny
  shelfOffset: [0, 0, 0],   // drobne przesuniecie polki [x, y, z]
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
  cellRowStart: -2,
  cellRowSpacing: 0.4,
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
};
// =====================================================================
const ASSEMBLY_LENGTH = 4.8;
const ASSEMBLY_HALF_LENGTH = ASSEMBLY_LENGTH / 2;
const ASSEMBLY_ITEM_SPACING = 0.4;
// Model finalnego, gotowego produktu - uzywany w momencie "scalenia" animacji.
// Wskazuje na model optymalny (paczkomatopytmalny.glb skopiowany do /models).
const CAD_MODEL_URL = '/models/paczkomat-optimal.glb';
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
const CAD_MODEL_HEIGHT = 3.45;
const CONVEYOR_SURFACE_Y = CONVEYOR_ELEVATION + 0.55;

const buildLinePoints = (count) => {
  const spacing = 7.6;
  const startZ = -((Math.max(count, 1) - 1) * spacing) / 2;

  return Array.from({ length: count }, (_, index) => (
    new THREE.Vector3(0, 0.55, startZ + index * spacing)
  ));
};

const easeOut = (value) => 1 - Math.pow(1 - value, 3);

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

const getTravelDurations = (stageCount) => {
  const points = buildLinePoints(stageCount);

  return points.slice(0, -1).map((point, index) => {
    const distance = point.distanceTo(points[index + 1]);
    return Math.max(MIN_TRAVEL_SECONDS, distance / CONVEYOR_UNITS_PER_SECOND);
  });
};

// Domyslny czas dojazdu miedzy etapami = 2 s (mozna zmienic w UI / Tasmociag).
const DEFAULT_TRAVEL_SECONDS = 2;
const getDefaultTravelTimes = (stageCount) =>
  getTravelDurations(stageCount).map(() => DEFAULT_TRAVEL_SECONDS);

const normalizeTravelTimes = (travelTimes, stageCount) => {
  const defaults = getDefaultTravelTimes(stageCount);

  return defaults.map((defaultTime, index) => Math.max(0.1, clampNumber(travelTimes[index], defaultTime)));
};

const buildProductionSchedule = (stages, count, travelTimes = []) => {
  const stageCount = stages.length;
  const unitCount = Math.max(1, count);
  const travelDurations = normalizeTravelTimes(travelTimes, stageCount);
  const stationFreeAt = Array(stageCount).fill(0);
  const units = [];

  for (let unitIndex = 0; unitIndex < unitCount; unitIndex += 1) {
    const segments = [];
    const entryStart = Math.max(stationFreeAt[0] ?? 0, 0);
    let arrivalAtStage = entryStart + ENTRY_TRAVEL_SECONDS;
    let finishTime = arrivalAtStage;

    segments.push({
      type: 'entry',
      start: entryStart,
      end: arrivalAtStage,
      duration: ENTRY_TRAVEL_SECONDS,
    });

    for (let stageIndex = 0; stageIndex < stageCount; stageIndex += 1) {
      const duration = Math.max(stages[stageIndex]?.duration ?? 0, 0.1);
      const assemblyStart = Math.max(arrivalAtStage, stationFreeAt[stageIndex] ?? 0);
      const assemblyEnd = assemblyStart + duration;
      const hasNextStage = stageIndex < stageCount - 1;
      const waitEnd = hasNextStage
        ? Math.max(assemblyEnd, stationFreeAt[stageIndex + 1] ?? 0)
        : assemblyEnd + COMPLETED_DISPLAY_SECONDS;

      segments.push({
        type: 'stage',
        stageIndex,
        start: assemblyStart,
        assemblyEnd,
        end: waitEnd,
        duration,
      });

      if (hasNextStage) {
        const travelDuration = travelDurations[stageIndex] ?? MIN_TRAVEL_SECONDS;
        const travelStart = waitEnd;
        const travelEnd = travelStart + travelDuration;

        segments.push({
          type: 'travel',
          from: stageIndex,
          to: stageIndex + 1,
          start: travelStart,
          end: travelEnd,
          duration: travelDuration,
        });

        stationFreeAt[stageIndex] = travelStart;
        arrivalAtStage = travelEnd;
        finishTime = travelEnd;
      } else {
        stationFreeAt[stageIndex] = waitEnd;
        finishTime = waitEnd;
      }
    }

    units.push({
      number: unitIndex + 1,
      startTime: segments[0]?.start ?? 0,
      finishTime,
      segments,
    });
  }

  const firstStarts = units.map((unit) => unit.startTime);
  const averageLaunchInterval =
    firstStarts.length > 1
      ? (firstStarts[firstStarts.length - 1] - firstStarts[0]) / (firstStarts.length - 1)
      : Math.max(stages[0]?.duration ?? 0, 0.1);
  const soloCycleTime =
    stages.reduce((sum, stage) => sum + Math.max(stage.duration, 0.1), 0)
    + travelDurations.reduce((sum, duration) => sum + duration, 0)
    + ENTRY_TRAVEL_SECONDS
    + COMPLETED_DISPLAY_SECONDS;

  return {
    units,
    totalTime: Math.max(units[units.length - 1]?.finishTime ?? soloCycleTime, 0.1),
    launchInterval: Math.max(averageLaunchInterval, 0.1),
    soloCycleTime: Math.max(soloCycleTime, 0.1),
    travelDurations,
  };
};

const getVisibleUnitsFromSchedule = (schedule, elapsed, stageCount) => {
  const visible = [];

  schedule.units.forEach((scheduledUnit) => {
    if (elapsed < scheduledUnit.startTime || elapsed > scheduledUnit.finishTime) return;

    const segment = scheduledUnit.segments.find(
      (candidate) => elapsed >= candidate.start && elapsed <= candidate.end,
    );

    if (!segment) return;

    if (segment.type === 'entry') {
      visible.push({
        key: `${scheduledUnit.number}`,
        number: scheduledUnit.number,
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
      elapsed,
      currentIndex: segment.stageIndex,
      progress: assemblyProgress,
      assemblyProgress,
      mode: isBlocked ? 'waiting' : isCompletedDisplay ? 'completed' : 'assembly',
      travelProgress: 0,
      isBlocked,
    });
  });

  return visible.sort((a, b) => b.elapsed - a.elapsed);
};

const getUnitPose = (unit, points) => {
  if (!points.length) return { position: new THREE.Vector3(), angle: 0, atStop: true };

  if (unit.mode === 'entry') {
    const end = points[0];
    const direction = getRouteTangent(points, 0);
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
    const start = points[Math.min(unit.travelFrom, points.length - 1)];
    const end = points[Math.min(unit.travelTo, points.length - 1)];
    const travelProgress = Math.max(0, Math.min((unit.travelProgress ?? 0) / 100, 1));
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

function LockerUnit({ stages, currentIndex, currentStage, progress }) {
  const hasFrame = currentIndex >= 0;
  const hasDoors = currentIndex >= 1;
  const hasLockers = currentIndex >= 2;
  const hasElectronics = currentIndex >= 3;
  const isTesting = currentIndex >= 4;

  return (
    <motion.div className="locker-unit" layout>
      <motion.div
        className="locker-frame"
        initial={false}
        animate={{
          opacity: hasFrame ? 1 : 0.45,
          borderColor: hasFrame ? stages[0]?.color ?? '#2563eb' : '#9ca3af',
        }}
        transition={{ duration: 0.25 }}
      >
        <div className="locker-top" />
        <div className="locker-body">
          <motion.div
            className="door-panel left-door"
            initial={false}
            animate={{
              opacity: hasDoors ? 1 : 0,
              rotateY: currentStage?.icon === 'door' ? [34, 0, 8, 0] : 0,
            }}
            transition={{
              duration: Math.max(currentStage?.duration ?? 1, 1),
              repeat: currentStage?.icon === 'door' ? Infinity : 0,
            }}
          />
          <motion.div
            className="door-panel right-door"
            initial={false}
            animate={{
              opacity: hasDoors ? 1 : 0,
              rotateY: currentStage?.icon === 'door' ? [-34, 0, -8, 0] : 0,
            }}
            transition={{
              duration: Math.max(currentStage?.duration ?? 1, 1),
              repeat: currentStage?.icon === 'door' ? Infinity : 0,
            }}
          />
          <div className="locker-grid">
            {Array.from({ length: 12 }).map((_, index) => (
              <motion.span
                key={index}
                className="locker-cell"
                initial={false}
                animate={{
                  opacity: hasLockers ? 1 : 0,
                  scale: hasLockers ? 1 : 0.6,
                }}
                transition={{ delay: hasLockers ? index * 0.035 : 0, duration: 0.25 }}
              />
            ))}
          </div>
          <motion.div
            className="electronics-panel"
            initial={false}
            animate={{
              opacity: hasElectronics ? 1 : 0,
              x: hasElectronics ? 0 : 18,
              boxShadow:
                currentStage?.icon === 'electronics'
                  ? ['0 0 0 rgba(220,38,38,0)', '0 0 22px rgba(220,38,38,0.42)', '0 0 0 rgba(220,38,38,0)']
                  : '0 0 0 rgba(220,38,38,0)',
            }}
            transition={{
              duration: currentStage?.icon === 'electronics' ? 1.2 : 0.25,
              repeat: currentStage?.icon === 'electronics' ? Infinity : 0,
            }}
          >
            <span />
            <span />
            <span />
          </motion.div>
          <motion.div
            className="quality-scan"
            initial={false}
            animate={{
              opacity: isTesting ? 1 : 0,
              y: isTesting ? ['-12%', '96%'] : '-12%',
            }}
            transition={{
              duration: Math.max((currentStage?.duration ?? 2) / 2, 1),
              repeat: isTesting ? Infinity : 0,
              ease: 'linear',
            }}
          />
        </div>
      </motion.div>
      <div className="assembly-progress">
        <motion.span style={{ width: `${progress}%`, backgroundColor: currentStage?.color ?? '#64748b' }} />
      </div>
    </motion.div>
  );
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
              Czas [s]
              <input
                type="number"
                min="0"
                step="0.5"
                value={stage.duration}
                onChange={(event) => updateStage(stage.id, { duration: event.target.value })}
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

function TravelTimeEditor({ stages, travelTimes, updateTravelTime }) {
  if (stages.length < 2) return null;

  return (
    <div className="travel-editor">
      <div className="mini-heading">
        <span>Tasmociag</span>
        <strong>Czas przejazdu miedzy etapami</strong>
      </div>
      {stages.slice(0, -1).map((stage, index) => {
        const nextStage = stages[index + 1];

        return (
          <label className="travel-row" key={`${stage.id}-${nextStage.id}`}>
            <span>
              {stage.name || `Etap ${index + 1}`} do {nextStage.name || `Etap ${index + 2}`}
            </span>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={travelTimes[index] ?? 1}
              onChange={(event) => updateTravelTime(index, event.target.value)}
            />
          </label>
        );
      })}
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

      <TravelTimeEditor stages={stages} travelTimes={travelTimes} updateTravelTime={updateTravelTime} />

      <div className="time-breakdown">
        {stages.map((stage) => (
          <div key={stage.id} className="breakdown-row">
            <span style={{ backgroundColor: stage.color }} />
            <p>{stage.name || 'Bez nazwy'}</p>
            <strong>{formatTime(clampNumber(stage.duration))}</strong>
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

function createLockerModel() {
  const group = new THREE.Group();
  group.scale.setScalar(0.76);

  const horizontalAssembly = new THREE.Group();
  horizontalAssembly.name = 'horizontalAssemblyLiftPivot';
  horizontalAssembly.position.z = -ASSEMBLY_HALF_LENGTH;
  const horizontalContent = new THREE.Group();
  horizontalContent.position.z = ASSEMBLY_HALF_LENGTH;
  horizontalAssembly.add(horizontalContent);
  group.add(horizontalAssembly);

  const mountingTrough = new THREE.Group();
  mountingTrough.name = 'horizontalLockTroughAssembly';
  mountingTrough.position.y = -0.47;
  mountingTrough.rotation.x = -Math.PI / 2;
  horizontalContent.add(mountingTrough);

  const mountingTroughParts = [];
  const troughSheet = makeBox(0.92, ASSEMBLY_LENGTH - 0.2, 0.1, '#cbd5e1', 'lockTrough');
  troughSheet.position.set(0, 0, 0.48);
  mountingTroughParts.push(troughSheet);
  mountingTrough.add(troughSheet);

  [-0.5, 0.5].forEach((x) => {
    const lip = makeBox(0.12, ASSEMBLY_LENGTH - 0.12, 0.38, '#94a3b8', 'lockTroughLip');
    lip.position.set(x, 0, 0.34);
    mountingTroughParts.push(lip);
    mountingTrough.add(lip);
  });

  const lockHoles = [];
  const locks = [];
  for (let index = 0; index < LOCK_COUNT; index += 1) {
    const y = -2 + index * ASSEMBLY_ITEM_SPACING;
    const hole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, 0.025, 20),
      makeMaterial('#334155', 0.7, 0.16),
    );
    hole.rotation.x = Math.PI / 2;
    hole.position.set(0, y, 0.545);
    lockHoles.push(hole);
    mountingTrough.add(hole);

    const lock = new THREE.Group();
    lock.name = `lock-${index + 1}`;
    lock.position.set(0, y, 0.62);

    const housing = makeBox(0.46, 0.15, 0.16, '#172033', 'lockHousing');
    lock.add(housing);

    const cylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.2, 18),
      makeMaterial('#facc15', 0.3, 0.68),
    );
    cylinder.rotation.x = Math.PI / 2;
    cylinder.position.z = 0.1;
    cylinder.castShadow = true;
    lock.add(cylinder);

    const bolt = makeBox(0.18, 0.045, 0.055, '#e2e8f0', 'lockBolt');
    bolt.position.set(0.28, 0, 0);
    lock.add(bolt);

    lock.userData.meshes = [housing, cylinder, bolt];
    locks.push(lock);
    mountingTrough.add(lock);
  }

  const sideWalls = [];
  const backWalls = [];
  [-2.1, 2.1].forEach((x, index) => {
    const wall = makeBox(0.22, 1.12, ASSEMBLY_LENGTH, '#111318', 'horizontalSideWall');
    wall.position.set(x, 0, 0);
    wall.userData.targetX = x;
    wall.userData.targetY = 0;
    wall.userData.order = index;
    sideWalls.push(wall);
    horizontalContent.add(wall);
  });

  const shelves = [];
  for (let index = 0; index < SHELF_COUNT; index += 1) {
    const shelf = makeBox(4.02, 1.02, 0.1, '#dbe4ec', 'horizontalShelf');
    shelf.position.set(0, 0, -2 + index * ASSEMBLY_ITEM_SPACING);
    shelf.userData.targetY = 0;
    shelves.push(shelf);
    horizontalContent.add(shelf);
  }

  const horizontalBack = makeBox(4.18, 0.1, ASSEMBLY_LENGTH - 0.08, '#15181d', 'horizontalBackPanel');
  horizontalBack.position.set(0, -0.56, 0);
  horizontalBack.userData.targetY = -0.56;
  horizontalContent.add(horizontalBack);

  const horizontalCells = [];
  for (let index = 0; index < LOCKER_COUNT; index += 1) {
    const row = Math.floor(index / 2);
    const direction = index % 2 === 0 ? -1 : 1;
    const z = -2 + row * ASSEMBLY_ITEM_SPACING;
    const cell = new THREE.Group();
    cell.name = `horizontalCell-${index + 1}`;
    cell.position.set(direction * 1.04, 0.56, z);
    cell.userData.targetX = direction * 1.04;
    cell.userData.targetY = 0.56;
    cell.userData.meshes = [];

    [
      [1.94, 0.05, 0.03, 0, 0, -0.17],
      [1.94, 0.05, 0.03, 0, 0, 0.17],
      [0.035, 0.05, 0.34, -0.97, 0, 0],
      [0.035, 0.05, 0.34, 0.97, 0, 0],
    ].forEach(([width, height, depth, x, y, localZ]) => {
      const edge = makeBox(width, height, depth, '#475569', 'horizontalCellEdge');
      edge.position.set(x, y, localZ);
      cell.userData.meshes.push(edge);
      cell.add(edge);
    });

    const doorFace = makeBox(1.86, 0.075, 0.29, '#f8fafc', 'horizontalLockerDoor');
    doorFace.position.y = 0.025;
    cell.userData.meshes.push(doorFace);
    cell.add(doorFace);

    horizontalCells.push(cell);
    horizontalContent.add(cell);
  }

  const centerLockerTrim = makeBox(0.18, 0.1, 4.34, '#475569', 'centerLockerTrim');
  centerLockerTrim.position.set(0, 0.61, 0);
  centerLockerTrim.userData.targetY = 0.61;
  horizontalContent.add(centerLockerTrim);

  const liftingBase = makeBox(4.72, 0.34, 1.34, '#0d1014', 'liftingBase');
  liftingBase.position.set(0, -0.12, -ASSEMBLY_HALF_LENGTH);
  liftingBase.userData.targetZ = -ASSEMBLY_HALF_LENGTH;
  group.add(liftingBase);

  const liftingBaseFront = makeBox(4.48, 0.3, 0.14, '#090b0e', 'liftingBaseFront');
  liftingBaseFront.position.set(0, 0.09, -ASSEMBLY_HALF_LENGTH - 0.6);
  liftingBaseFront.userData.targetZ = -ASSEMBLY_HALF_LENGTH - 0.6;
  group.add(liftingBaseFront);

  const liftingRoof = makeBox(4.58, 0.22, 0.58, '#111827', 'liftingRoof');
  liftingRoof.position.set(0, 0.56, ASSEMBLY_HALF_LENGTH + 0.08);
  liftingRoof.userData.targetY = 0.56;
  liftingRoof.userData.targetZ = ASSEMBLY_HALF_LENGTH + 0.08;
  horizontalContent.add(liftingRoof);

  const liftingRoofPanel = makeBox(4.66, 1.34, 0.16, '#273746', 'liftingRoofPanel');
  liftingRoofPanel.position.set(0, -0.04, ASSEMBLY_HALF_LENGTH + 0.02);
  liftingRoofPanel.userData.targetY = -0.04;
  liftingRoofPanel.userData.targetZ = ASSEMBLY_HALF_LENGTH + 0.02;
  horizontalContent.add(liftingRoofPanel);

  const frameBeams = [];
  const makeBeam = (width, height, depth, x, y, z) => {
    const beam = makeBox(width, height, depth, '#111827', 'frameBeam');
    beam.position.set(x, y, z);
    frameBeams.push(beam);
    group.add(beam);
    return beam;
  };

  makeBeam(4.08, 0.18, 0.2, 0, 0.12, 0.58);
  makeBeam(4.08, 0.2, 0.2, 0, 2.92, 0.58);
  makeBeam(0.2, 2.95, 0.2, -2.04, 1.52, 0.58);
  makeBeam(0.2, 2.95, 0.2, 2.04, 1.52, 0.58);
  makeBeam(0.11, 2.78, 0.16, -1.02, 1.5, 0.62);
  makeBeam(0.11, 2.78, 0.16, 0, 1.5, 0.62);
  makeBeam(0.11, 2.78, 0.16, 1.02, 1.5, 0.62);

  const body = makeBox(4.5, 2.72, 0.82, '#f8fafc', 'bodyPanel');
  body.position.set(0, 1.48, 0.2);
  group.add(body);

  const side = makeBox(0.18, 2.82, 0.88, '#ffffff', 'sidePanel');
  side.position.set(2.38, 1.48, 0.08);
  group.add(side);

  const back = makeBox(4.8, 2.96, 0.1, '#e5e7eb', 'backPanel');
  back.position.set(0, 1.48, -0.39);
  group.add(back);

  const base = makeBox(4.9, 0.28, 1.02, '#0f2930', 'base');
  base.position.set(0, 0.05, 0.06);
  group.add(base);

  const cap = makeBox(4.96, 0.28, 1.04, '#030712', 'cap');
  cap.position.set(0, 3.08, 0.06);
  group.add(cap);

  const topModules = [];
  for (let index = 0; index < 8; index += 1) {
    const module = makeBox(0.48, 0.18, 0.12, '#020617', 'topModule');
    module.position.set(-2.06 + index * 0.49, 3.24, 0.6);
    topModules.push(module);
    group.add(module);
  }

  const feet = [];
  [-2.09, -0.69, 0.69, 2.09].forEach((x) => {
    const leg = makeBox(0.08, 0.26, 0.08, '#111827', 'leg');
    leg.position.set(x, -0.16, 0.18);
    feet.push(leg);
    group.add(leg);

    const foot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.17, 0.05, 18),
      makeMaterial('#020617', 0.46, 0.35),
    );
    foot.position.set(x, -0.31, 0.18);
    foot.castShadow = true;
    feet.push(foot);
    group.add(foot);
  });

  const doorPanels = [];
  for (let col = 0; col < 8; col += 1) {
    const panel = makeBox(0.43, 2.35, 0.055, '#ffffff', 'doorPanel');
    panel.position.set(-1.69 + col * 0.48, 1.56, 0.64);
    doorPanels.push(panel);
    group.add(panel);
  }

  const cells = [];
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const width = col === 0 || col === 7 ? 0.43 : 0.41;
      const cell = makeBox(width, 0.265, 0.05, '#f9fafb', 'lockerCell');
      cell.position.set(-1.69 + col * 0.48, 0.48 + row * 0.32, 0.7);
      cells.push(cell);
      group.add(cell);
    }
  }

  const panel = makeBox(0.48, 0.92, 0.16, '#050505', 'electronicsPanel');
  panel.position.set(0, 1.64, 0.8);
  group.add(panel);

  const screen = makeBox(0.29, 0.31, 0.04, '#1f2937', 'panelLight');
  screen.position.set(0, 1.72, 0.9);
  screen.rotation.x = -0.16;
  group.add(screen);

  const panelIndicators = [];
  [-0.14, 0, 0.14].forEach((x, index) => {
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 14, 10),
      new THREE.MeshStandardMaterial({
        color: index === 1 ? '#facc15' : '#38bdf8',
        emissive: index === 1 ? '#facc15' : '#38bdf8',
        emissiveIntensity: 0,
        roughness: 0.28,
        metalness: 0.08,
      }),
    );
    led.position.set(x, 1.3, 0.91);
    led.castShadow = true;
    panelIndicators.push(led);
    group.add(led);
  });

  const brandLabel = makeTextPlane(1.38, 0.42, (ctx, canvas) => {
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(108, 96, 46, 0.38 * Math.PI, 1.64 * Math.PI);
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#facc15';
    ctx.stroke();
    ctx.fillStyle = '#27272a';
    ctx.font = 'bold 68px Arial';
    ctx.fillText('PostBox', 155, 105);
    ctx.font = 'bold 24px Arial';
    ctx.fillText('out of the box', 190, 140);
  });
  brandLabel.position.set(1.06, 2.48, 0.735);
  group.add(brandLabel);

  const bottomLabel = makeTextPlane(1.58, 0.36, (ctx) => {
    ctx.fillStyle = '#3f3f46';
    ctx.font = 'bold 62px Arial';
    ctx.fillText('Paczkomat', 26, 102);
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 82px Arial';
    ctx.fillText('24h', 350, 110);
  });
  bottomLabel.position.set(0.95, 0.56, 0.735);
  group.add(bottomLabel);

  const scan = makeBox(3.58, 0.05, 0.05, '#8b5cf6', 'qualityScan');
  scan.position.set(0, 1.2, 0.86);
  group.add(scan);

  const warningLight = new THREE.Group();
  warningLight.name = 'blockingWarning';
  warningLight.position.set(0, 3.62, 0.72);

  const warningPost = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.42, 14),
    makeMaterial('#334155', 0.45, 0.28),
  );
  warningPost.position.y = -0.18;
  warningPost.castShadow = true;
  warningLight.add(warningPost);

  const warningBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 24, 18),
    new THREE.MeshStandardMaterial({
      color: '#dc2626',
      emissive: '#dc2626',
      emissiveIntensity: 1.8,
      roughness: 0.35,
      metalness: 0.08,
    }),
  );
  warningBulb.castShadow = true;
  warningLight.add(warningBulb);

  const warningGlow = new THREE.PointLight('#ef4444', 1.8, 2.8);
  warningGlow.position.y = 0.1;
  warningLight.add(warningGlow);
  warningLight.visible = false;
  group.add(warningLight);

  group.userData.parts = {
    horizontalAssembly,
    mountingTrough,
    mountingTroughParts,
    lockHoles,
    locks,
    sideWalls,
    shelves,
    horizontalBack,
    horizontalCells,
    centerLockerTrim,
    liftingBase,
    liftingBaseFront,
    liftingRoof,
    liftingRoofPanel,
    body,
    cap,
    side,
    back,
    base,
    feet,
    topModules,
    doorPanels,
    cells,
    panel,
    panelLight: screen,
    panelIndicators,
    labels: [brandLabel, bottomLabel],
    frameBeams,
    scan,
    warningLight,
    warningBulb,
    warningGlow,
  };

  return group;
}

function setPartVisible(mesh, visible) {
  mesh.visible = visible;
  if (mesh.material) {
    mesh.material.transparent = true;
    mesh.material.opacity = visible ? 1 : 0;
  }
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

function updateLockerModel(group, unit, stage, time, stages) {
  const parts = group.userData.parts;
  const stageProgress = unit.assemblyProgress ?? unit.progress;
  const normalizedProgress = Math.max(0, Math.min(stageProgress / 100, 1));
  const easedProgress = easeOut(normalizedProgress);
  const isAssemblyActive = unit.mode === 'assembly';

  const getBuildForIcon = (icon, fallbackIcon = null) => {
    let targetIndex = stages.findIndex((candidate) => candidate.icon === icon);

    if (targetIndex === -1 && fallbackIcon) {
      targetIndex = stages.findIndex((candidate) => candidate.icon === fallbackIcon);
    }

    if (targetIndex === -1) return 0;
    if (unit.currentIndex > targetIndex) return 1;
    if (unit.currentIndex < targetIndex) return 0;
    return easedProgress;
  };

  const isIconActive = (icon) => stage?.icon === icon && isAssemblyActive;

  const lockStageIndex = stages.findIndex((candidate) => candidate.icon === 'locks');
  const structureStageIndex = stages.findIndex((candidate) => candidate.icon === 'shelves');
  const backStageIndex = stages.findIndex((candidate) => candidate.icon === 'back');
  const lockerStageIndex = stages.findIndex((candidate) => candidate.icon === 'lockers');
  const finalizeStageIndex = stages.findIndex((candidate) => candidate.icon === 'finalize');
  const frameStageIndex = stages.findIndex((candidate) => candidate.icon === 'frame');
  const lockBuild = lockStageIndex === -1
    ? 0
    : unit.currentIndex > lockStageIndex
      ? 1
      : unit.currentIndex === lockStageIndex
        ? normalizedProgress
        : 0;
  const structureBuild = structureStageIndex === -1
    ? 0
    : unit.currentIndex > structureStageIndex
      ? 1
      : unit.currentIndex === structureStageIndex
        ? normalizedProgress
        : 0;
  const backBuild = backStageIndex === -1
    ? 0
    : unit.currentIndex > backStageIndex
      ? 1
      : unit.currentIndex === backStageIndex
        ? normalizedProgress
        : 0;
  const lockerHorizontalBuild = lockerStageIndex === -1
    ? 0
    : unit.currentIndex > lockerStageIndex
      ? 1
      : unit.currentIndex === lockerStageIndex
        ? normalizedProgress
        : 0;
  const finalizeBuild = finalizeStageIndex === -1
    ? 0
    : unit.currentIndex > finalizeStageIndex
      ? 1
      : unit.currentIndex === finalizeStageIndex
        ? normalizedProgress
        : 0;
  const horizontalAssemblyEndIndex = Math.max(
    lockStageIndex,
    structureStageIndex,
    backStageIndex,
    lockerStageIndex,
    finalizeStageIndex,
  );
  const usesHorizontalAssembly = lockStageIndex >= 0 && horizontalAssemblyEndIndex >= lockStageIndex;
  const horizontalAssemblyVisible = usesHorizontalAssembly
    && unit.currentIndex >= lockStageIndex;
  setPartVisible(parts.horizontalAssembly, horizontalAssemblyVisible);
  const verticalAssemblyVisible = !usesHorizontalAssembly;
  const frameBuild = verticalAssemblyVisible
    ? frameStageIndex >= 0
      ? getBuildForIcon('frame')
      : horizontalAssemblyEndIndex >= 0 && unit.currentIndex > horizontalAssemblyEndIndex
        ? 1
        : 0
    : 0;
  const doorBuild = getBuildForIcon('door');
  const roofStageIndex = stages.findIndex((candidate) => candidate.icon === 'roof');
  const roofBuild = roofStageIndex >= 0 ? getBuildForIcon('roof') : frameBuild;
  const lockerBuild = getBuildForIcon('lockers');
  const electronicsBuild = getBuildForIcon('electronics');
  const testBuild = getBuildForIcon('test');

  parts.mountingTroughParts.forEach((part) => setPartOpacity(part, horizontalAssemblyVisible ? 1 : 0));
  parts.lockHoles.forEach((hole) => setPartOpacity(hole, horizontalAssemblyVisible ? 1 : 0));
  parts.locks.forEach((lock, index) => {
    const rawLockProgress = horizontalAssemblyVisible
      ? Math.max(0, Math.min(lockBuild * LOCK_COUNT - index, 1))
      : 0;
    const lockProgress = easeOut(rawLockProgress);
    const shouldLocksBeVisible = unit.currentIndex === lockStageIndex && rawLockProgress > 0.01;
    lock.visible = shouldLocksBeVisible;
    lock.position.z = 0.62 + (1 - lockProgress) * 0.9;
    lock.position.x = Math.sin((1 - lockProgress) * Math.PI) * 0.2;
    lock.rotation.z = (1 - lockProgress) * 0.42;
    lock.scale.setScalar(0.72 + lockProgress * 0.28);

    lock.userData.meshes.forEach((mesh) => {
      setPartOpacity(mesh, lockProgress);
      mesh.material.emissive = new THREE.Color('#facc15');
      mesh.material.emissiveIntensity =
        isIconActive('locks') && rawLockProgress > 0 && rawLockProgress < 1
          ? 0.35 + Math.sin(time * 8) * 0.12
          : 0;
    });
  });

  const structureActive = structureStageIndex >= 0 && unit.currentIndex === structureStageIndex;
  const structureCompleted = structureStageIndex >= 0 && unit.currentIndex > structureStageIndex;
  parts.sideWalls.forEach((wall, index) => {
    const rawWallProgress = horizontalAssemblyVisible
      ? structureCompleted
        ? 1
        : structureActive
          ? Math.max(0, Math.min((structureBuild / 0.3) * 2 - index, 1))
          : 0
      : 0;
    const wallProgress = easeOut(rawWallProgress);
    setPartOpacity(wall, wallProgress);
    wall.position.x = wall.userData.targetX * (1 + (1 - wallProgress) * 0.7);
    wall.position.y = wall.userData.targetY + (1 - wallProgress) * 0.34;
    wall.rotation.z = (1 - wallProgress) * (index === 0 ? -0.16 : 0.16);
  });

  parts.shelves.forEach((shelf, index) => {
    const shelfTimeline = Math.max(0, (structureBuild - 0.3) / 0.7) * SHELF_COUNT;
    const rawShelfProgress = horizontalAssemblyVisible
      ? structureCompleted
        ? 1
        : structureActive
          ? Math.max(0, Math.min(shelfTimeline - index, 1))
          : 0
      : 0;
    const shelfProgress = easeOut(rawShelfProgress);
    setPartOpacity(shelf, shelfProgress);
    shelf.position.y = shelf.userData.targetY + (1 - shelfProgress) * 0.78;
    shelf.scale.x = 0.72 + shelfProgress * 0.28;
    shelf.material.emissive = new THREE.Color('#22d3ee');
    shelf.material.emissiveIntensity =
      rawShelfProgress > 0 && rawShelfProgress < 1
        ? 0.22 + Math.sin(time * 7) * 0.08
        : 0;
  });

  const horizontalBackProgress = horizontalAssemblyVisible ? easeOut(backBuild) : 0;
  setPartOpacity(parts.horizontalBack, horizontalBackProgress > 0 ? 1 : 0);
  parts.horizontalBack.position.y = parts.horizontalBack.userData.targetY + (1 - horizontalBackProgress) * 1.2; // Animate from higher Y
  parts.horizontalBack.rotation.x = (1 - horizontalBackProgress) * Math.PI / 2; // Rotate around X to simulate falling
  parts.horizontalBack.rotation.z = (1 - horizontalBackProgress) * 0.08;

  parts.horizontalCells.forEach((cell, index) => {
    const cellBuild = Math.min(lockerHorizontalBuild / 0.6, 1);
    const rawCellProgress = horizontalAssemblyVisible
      ? Math.max(0, Math.min(cellBuild * LOCKER_COUNT - index, 1))
      : 0;
    const cellProgress = easeOut(rawCellProgress);
    cell.visible = cellProgress > 0.01;
    cell.position.x = cell.userData.targetX + (1 - cellProgress) * Math.sign(cell.userData.targetX) * 1.5;
    cell.position.y = cell.userData.targetY + (1 - cellProgress) * 0.52;
    cell.scale.setScalar(0.82 + cellProgress * 0.18);
    cell.userData.meshes.forEach((mesh) => setPartOpacity(mesh, cellProgress));
  });

  const centerTrimProgress = horizontalAssemblyVisible
    ? easeOut(Math.max(0, Math.min(lockerHorizontalBuild * 4, 1)))
    : 0;
  setPartOpacity(parts.centerLockerTrim, centerTrimProgress);
  parts.centerLockerTrim.position.y = parts.centerLockerTrim.userData.targetY
    + (1 - centerTrimProgress) * 0.48;

  const finalizeActive = finalizeStageIndex >= 0 && unit.currentIndex === finalizeStageIndex;
  const finalizeCompleted = finalizeStageIndex >= 0 && unit.currentIndex > finalizeStageIndex;
  const liftProgress = finalizeCompleted
    ? 1
    : finalizeActive
      ? easeOut(Math.max(0, Math.min((finalizeBuild - 0.12) / 0.58, 1)))
      : 0;
  parts.horizontalAssembly.rotation.x = -Math.PI * 0.5 * liftProgress;
  const liftingBaseProgress = finalizeCompleted
    ? 1
    : finalizeActive
      ? easeOut(Math.max(0, Math.min((finalizeBuild - 0.04) / 0.28, 1)))
      : 0;
  setPartOpacity(parts.liftingBase, liftingBaseProgress);
  parts.liftingBase.position.z = parts.liftingBase.userData.targetZ
    - (1 - liftingBaseProgress) * 0.85;
  setPartOpacity(parts.liftingBaseFront, liftingBaseProgress);
  parts.liftingBaseFront.position.z = parts.liftingBaseFront.userData.targetZ
    - (1 - liftingBaseProgress) * 0.85;
  const liftingRoofProgress = finalizeCompleted
    ? 1
    : finalizeActive
      ? easeOut(Math.max(0, Math.min((finalizeBuild - 0.72) / 0.28, 1)))
      : 0;
  setPartOpacity(parts.liftingRoof, liftingRoofProgress);
  parts.liftingRoof.position.y = parts.liftingRoof.userData.targetY;
  parts.liftingRoof.position.z = parts.liftingRoof.userData.targetZ
    + (1 - liftingRoofProgress) * 0.9;
  setPartOpacity(parts.liftingRoofPanel, liftingRoofProgress);
  parts.liftingRoofPanel.position.y = parts.liftingRoofPanel.userData.targetY;
  parts.liftingRoofPanel.position.z = parts.liftingRoofPanel.userData.targetZ
    + (1 - liftingRoofProgress) * 0.9;

  parts.frameBeams.forEach((beam, index) => {
    const beamProgress = Math.max(0, Math.min(frameBuild * parts.frameBeams.length - index, 1));
    setPartOpacity(beam, frameBuild > 0 ? 0.18 + beamProgress * 0.82 : 0);
  });
  setPartOpacity(parts.base, Math.min(1, frameBuild * 1.35));
  setPartOpacity(parts.cap, verticalAssemblyVisible ? Math.min(1, roofBuild * 1.2) : 0);
  parts.topModules.forEach((module, index) => {
    const moduleProgress = verticalAssemblyVisible
      ? Math.max(0, Math.min(roofBuild * parts.topModules.length - index, 1))
      : 0;
    setPartOpacity(module, moduleProgress);
    module.position.y = 3.24 + (1 - moduleProgress) * 0.34;
  });
  parts.feet.forEach((foot) => setPartOpacity(foot, Math.min(1, frameBuild * 1.5)));

  const verticalDoorBuild = verticalAssemblyVisible ? Math.max(doorBuild, lockerBuild) : 0;
  const verticalLockerBuild = verticalAssemblyVisible ? lockerBuild : 0;
  setPartOpacity(parts.body, verticalDoorBuild);
  setPartOpacity(parts.back, verticalDoorBuild);
  setPartOpacity(parts.side, verticalDoorBuild);
  parts.doorPanels.forEach((panel, index) => {
    const doorProgress = Math.max(0, Math.min(verticalDoorBuild * parts.doorPanels.length - index * 0.72, 1));
    setPartOpacity(panel, doorProgress);
    panel.position.z = 0.64 + (1 - doorProgress) * 0.38;
    panel.rotation.y =
      isIconActive('door')
        ? Math.sin(doorProgress * Math.PI) * (index % 2 === 0 ? 0.18 : -0.18)
        : 0;
  });

  parts.cells.forEach((cell, index) => {
    const cellProgress = Math.max(0, Math.min(verticalLockerBuild * parts.cells.length - index * 0.58, 1));
    setPartOpacity(cell, cellProgress);
    cell.position.z = 0.7 + (1 - cellProgress) * 0.18;
  });
  setPartOpacity(parts.panel, electronicsBuild);
  setPartOpacity(parts.panelLight, electronicsBuild);
  parts.panelIndicators.forEach((indicator, index) => {
    const indicatorProgress = Math.max(0, Math.min(electronicsBuild * 3 - index * 0.55, 1));
    setPartOpacity(indicator, indicatorProgress);
    indicator.material.emissiveIntensity =
      isIconActive('electronics')
        ? indicatorProgress * (0.65 + Math.sin(time * 7 + index) * 0.35)
        : indicatorProgress * 0.25;
  });
  parts.labels.forEach((label, index) => {
    const labelProgress = Math.max(0, Math.min(verticalLockerBuild * 2 - index * 0.5, 1));
    setPartOpacity(label, labelProgress);
  });
  setPartVisible(parts.scan, testBuild > 0);
  parts.warningLight.visible = Boolean(unit.isBlocked);
  if (unit.isBlocked) {
    const alarmPulse = 1 + Math.sin(time * 9) * 0.18;
    parts.warningBulb.scale.setScalar(alarmPulse);
    parts.warningBulb.material.emissiveIntensity = 1.7 + Math.sin(time * 10) * 0.55;
    parts.warningGlow.intensity = 1.7 + Math.sin(time * 10) * 0.65;
  } else {
    parts.warningBulb.scale.setScalar(1);
    parts.warningBulb.material.emissiveIntensity = 0;
    parts.warningGlow.intensity = 0;
  }

  if (isIconActive('door')) {
    parts.doorPanels.forEach((panel, index) => {
      const snap = Math.sin(normalizedProgress * Math.PI * 3 + index * 0.45) * 0.012 * (1 - normalizedProgress);
      panel.scale.y = 1 + snap;
    });
  } else {
    parts.doorPanels.forEach((panel) => {
      panel.scale.y = 1;
    });
  }

  if (isIconActive('frame')) {
    const pulse = 1 + Math.sin(time * 3.2) * 0.018 * (1 - normalizedProgress * 0.55);
    parts.frameBeams.forEach((beam) => beam.scale.set(pulse, 1, pulse));
    parts.frameBeams.forEach((beam, index) => {
      beam.material.emissive = new THREE.Color(index % 2 ? '#facc15' : '#38bdf8');
      beam.material.emissiveIntensity = 0.16 + Math.sin(time * 3 + index) * 0.06;
    });
  } else {
    parts.frameBeams.forEach((beam) => {
      beam.scale.set(1, 1, 1);
      beam.material.emissive = new THREE.Color('#000000');
      beam.material.emissiveIntensity = 0;
    });
  }

  if (isIconActive('finalize')) {
    const roofPulse = 1 + Math.sin(time * 3.8) * 0.018 * (1 - normalizedProgress * 0.4);
    parts.cap.scale.set(1, roofPulse, 1);
    parts.cap.position.y = 3.08 + (1 - finalizeBuild) * 0.42;
    parts.cap.material.emissive = new THREE.Color('#38bdf8');
    parts.cap.material.emissiveIntensity = 0.18 + Math.sin(time * 4.2) * 0.08;
  } else {
    parts.cap.scale.set(1, 1, 1);
    parts.cap.position.y = 3.08;
    parts.cap.material.emissive = new THREE.Color('#000000');
    parts.cap.material.emissiveIntensity = 0;
  }

  if (isIconActive('lockers')) {
    parts.cells.forEach((cell, index) => {
      const target = normalizedProgress * parts.cells.length;
      const scale = index < target ? 1 + Math.sin(time * 2.6 + index) * 0.03 : 0.76;
      cell.scale.setScalar(scale);
    });
  } else {
    parts.cells.forEach((cell) => cell.scale.setScalar(1));
  }

  if (isIconActive('electronics')) {
    const pulse = 0.65 + Math.sin(time * 3.4) * 0.35;
    parts.panelLight.material.emissive = new THREE.Color('#38bdf8');
    parts.panelLight.material.emissiveIntensity = pulse;
    parts.panel.position.z = 0.8 + (1 - electronicsBuild) * 0.36;
  } else {
    parts.panelLight.material.emissive = new THREE.Color('#000000');
    parts.panelLight.material.emissiveIntensity = electronicsBuild > 0.99 ? 0.2 : 0;
    parts.panel.position.z = 0.8;
  }

  if (testBuild > 0) {
    const scanProgress = stage?.icon === 'test' ? normalizedProgress : 1;
    parts.scan.position.y = 0.42 + scanProgress * 2.32;
    parts.scan.material.emissive = new THREE.Color('#8b5cf6');
    parts.scan.material.emissiveIntensity = isAssemblyActive ? 0.9 : 0.35;
  }
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
  const troughParts = [];
  const lockRails = [];
  const locks = [];
  const sideWalls = [];
  const backWalls = [];
  const shelves = [];
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
        const troughModel = applyGlbMaterial(cloneGlbComponent(template), 'trough');
        troughModel.name = `glbTrough-${moduleIndex + 1}-${componentIndex + 1}`;
        troughModel.position.x = -moduleCenterX;
        troughModelGroup.add(troughModel);
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

    for (let row = 0; row < LOCKS_PER_MODULE; row += 1) {
      const rowZ = -2 + row * ASSEMBLY_ITEM_SPACING;
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
      troughAssembly.add(lock);
    }

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
  }

  const base = stageOneTemplates?.base
    ? applyGlbMaterial(cloneGlbComponent(stageOneTemplates.base), 'base')
    : makeBox(4.58, 0.36, 1.38, '#24282d', 'joinedBase');
  base.name = stageOneTemplates?.base ? 'glbJoinedBase' : 'joinedBase';
  if (stageOneTemplates?.base) {
    // Podstawa byla "do gory nogami" (PI/2) i zwinieta w punkcie (0, y, 0).
    // Odwracamy o 180 stopni (-PI/2) i stawiamy POD kolumna (Z = miejsce,
    // gdzie staja polowki), zamiast z boku tasmy.
    base.rotation.x = -Math.PI / 2;
    base.position.set(0, stageOneTemplates.standingOffsetY, ASSEMBLY_HALF_LENGTH);
    base.userData.targetZ = ASSEMBLY_HALF_LENGTH;
  } else {
    base.position.set(0, -0.13, -ASSEMBLY_HALF_LENGTH);
  }
  base.userData.targetY = stageOneTemplates?.base ? stageOneTemplates.standingOffsetY : -0.13;
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
    troughParts,
    lockRails,
    locks,
    sideWalls,
    backWalls,
    shelves,
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

function updateTwoPartLockerModel(group, unit, stage, time, stages) {
  const parts = group.userData.parts;
  const stageProgress = unit.assemblyProgress ?? unit.progress ?? 0;
  const normalizedProgress = THREE.MathUtils.clamp(stageProgress / 100, 0, 1);
  const stageIndex = (icon) => stages.findIndex((candidate) => candidate.icon === icon);
  const buildFor = (icon) => {
    const index = stageIndex(icon);
    if (index < 0 || unit.currentIndex < index) return 0;
    if (unit.currentIndex > index) return 1;
    return normalizedProgress;
  };
  const smooth = (value) => easeOut(THREE.MathUtils.clamp(value, 0, 1));
  const locksBuild = unit.mode === 'entry' ? 0.12 : buildFor('locks');
  const structureBuild = buildFor('shelves');
  const lockersBuild = buildFor('lockers');
  const finalizeIndex = stageIndex('finalize');
  const finalizeCompleted = finalizeIndex >= 0 && unit.currentIndex > finalizeIndex;
  const finalizeBuild = finalizeCompleted ? 1 : buildFor('finalize');

  const trayProgress = smooth(locksBuild / 0.12);
  const troughVisibility = 1 - smooth(lockersBuild);
  parts.troughParts.forEach((part, index) => {
    const progress = smooth(trayProgress * parts.troughParts.length - index * 0.32);
    setPartOpacity(part, progress * troughVisibility);
    part.scale.z = 0.72 + progress * 0.28;
  });
  const lockRailVisibility = 1 - smooth(lockersBuild);
  parts.lockRails.forEach((rail) => {
    setPartOpacity(rail, smooth((locksBuild - 0.05) / 0.15) * lockRailVisibility);
  });

  const lockTimeline = Math.max(0, (locksBuild - 0.14) / 0.86) * LOCK_COUNT;
  parts.locks.forEach((lock, index) => {
    const rawProgress = THREE.MathUtils.clamp(lockTimeline - index, 0, 1);
    const progress = smooth(rawProgress);
    const matchingLockerProgress = smooth(
      THREE.MathUtils.clamp(lockersBuild * LOCKER_COUNT - index, 0, 1),
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

  const troughTurnProgress = smooth(structureBuild / 0.2);
  parts.troughAssemblies.forEach((assembly) => {
    assembly.rotation.z = group.userData.usesStageOneGlb
      ? 0
      : -Math.PI * 0.5 * (1 - troughTurnProgress);
    assembly.position.y = group.userData.usesStageOneGlb
      ? 0
      : THREE.MathUtils.lerp(-0.5, 0, troughTurnProgress);
  });

  const animateWall = (wall, progress) => {
    setPartOpacity(wall, progress);
    wall.position.x = wall.userData.targetX + wall.userData.entryDirection * (1 - progress) * 0.32;
    wall.position.y = wall.userData.targetY + (1 - progress) * 1.15;
    wall.rotation.z = (wall.userData.baseRotZ ?? 0)
      + wall.userData.entryDirection * (1 - progress) * 0.12;
  };

  const firstWalls = parts.sideWalls.filter((wall) => wall.userData.phase === 'first');
  const firstWallTimeline = Math.max(0, Math.min((structureBuild - 0.2) / 0.16, 1)) * firstWalls.length;
  firstWalls.forEach((wall, index) => {
    const progress = smooth(THREE.MathUtils.clamp(firstWallTimeline - index, 0, 1));
    animateWall(wall, progress);
  });

  const shelfTimeline = Math.max(0, (structureBuild - 0.36) / 0.46) * parts.shelves.length;
  parts.shelves.forEach((shelf, index) => {
    const rawProgress = THREE.MathUtils.clamp(shelfTimeline - index, 0, 1);
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

  const backWallTimeline = Math.max(0, (structureBuild - 0.7) / 0.16) * parts.backWalls.length;
  parts.backWalls.forEach((backWall, index) => {
    const rawProgress = THREE.MathUtils.clamp(backWallTimeline - index, 0, 1);
    const progress = smooth(rawProgress);
    setPartOpacity(backWall, progress);
    // Sciana tylnia wjezdza WYRAZNIE OD DOLU (zeby skrytki montowac od gory) i
    // konczy na swojej pozycji z tylu. Moze przenikac przez inne czesci -
    // wazne, ze startuje gleboko pod spodem i podnosi sie na miejsce.
    backWall.position.y = backWall.userData.targetY - (1 - progress) * TUNE.backWallDrop;
    backWall.rotation.x = TUNE.backWallRotX; // utrzymaj obrot (nie zerowac!)
  });

  const secondWalls = parts.sideWalls.filter((wall) => wall.userData.phase === 'second');
  const secondWallTimeline = Math.max(0, Math.min((structureBuild - 0.82) / 0.18, 1)) * secondWalls.length;
  secondWalls.forEach((wall, index) => {
    const progress = smooth(THREE.MathUtils.clamp(secondWallTimeline - index, 0, 1));
    animateWall(wall, progress);
  });

  const lockerTimeline = lockersBuild * LOCKER_COUNT;
  parts.lockerCells.forEach((cell, index) => {
    const rawProgress = THREE.MathUtils.clamp(lockerTimeline - index, 0, 1);
    const progress = smooth(rawProgress);
    cell.visible = progress > 0.01;
    cell.position.x = (1 - progress) * cell.userData.entryX;
    cell.position.y = cell.userData.targetY + (1 - progress) * 0.72;
    cell.rotation.z = (1 - progress) * Math.sign(cell.userData.entryX) * 0.14;
    cell.scale.setScalar(0.8 + progress * 0.2);
    cell.userData.meshes.forEach((mesh) => setPartOpacity(mesh, progress));
  });

  const baseProgress = smooth(finalizeBuild / 0.16);
  [parts.base, parts.baseFront].forEach((part) => {
    setPartOpacity(part, baseProgress);
    part.position.y = part.userData.targetY - (1 - baseProgress) * 0.48;
  });

  // Sekwencja koncowa "jedna za druga": pierwsza polowa wstaje pionowo na
  // podstawe i ZOSTAJE (wyrazny postoj), dopiero potem druga polowa nadjezdza
  // i dolacza obok. Pozycje docelowe (finalX/finalZ) pozostaja nietkniete -
  // wynikaja z jednej ramy CAD, wiec polowy skladaja sie idealnie w calosc.
  parts.moduleRoots.forEach((root) => {
    const isFirstModule = root.userData.moduleIndex === 0;
    // 1. polowa: szybkie podniesienie i ustawienie, potem dlugi postoj.
    // 2. polowa: startuje znacznie pozniej (czas oczekiwania widoczny w scenie).
    const liftProgress = isFirstModule
      ? smooth((finalizeBuild - 0.08) / 0.22)
      : smooth((finalizeBuild - 0.52) / 0.22);
    const joinProgress = isFirstModule
      ? smooth((finalizeBuild - 0.20) / 0.11)
      : smooth((finalizeBuild - 0.64) / 0.11);
    // Dodatkowy odstep miedzy polowkami (TUNE.halfGapX) - przeciw nachodzeniu.
    const gap = (TUNE.halfGapX ?? 0) * (isFirstModule ? 0.5 : -0.5);
    // Pionowe dociagniecie stojacych kolumn (TUNE.columnSettleY) - gdy lewituja.
    const settle = (TUNE.columnSettleY ?? 0) * joinProgress;
    root.rotation.x = Math.PI * 0.5 * liftProgress;
    root.position.x = THREE.MathUtils.lerp(root.userData.startX, root.userData.finalX, joinProgress) + gap;
    root.position.y = settle;
    root.position.z = THREE.MathUtils.lerp(root.userData.travelZ, root.userData.finalZ, joinProgress);
  });

  const centerProgress = smooth((finalizeBuild - 0.78) / 0.08);
  setPartOpacity(parts.centerJoin, centerProgress);
  parts.centerJoin.position.y = parts.centerJoin.userData.targetY + (1 - centerProgress) * 0.65;

  const backProgress = smooth((finalizeBuild - 0.8) / 0.08);
  setPartOpacity(parts.backPanel, backProgress);
  parts.backPanel.position.y = parts.backPanel.userData.targetY;
  parts.backPanel.position.z = parts.backPanel.userData.targetZ + (1 - backProgress) * 1.15;
  parts.backPanel.rotation.y = (1 - backProgress) * 0.08;

  parts.roofs.forEach((roof, index) => {
    const progress = smooth((finalizeBuild - (0.84 + index * 0.025)) / 0.135);
    setPartOpacity(roof, progress);
    roof.position.y = roof.userData.targetY + (1 - progress) * 0.85;
  });
  parts.roofFascias.forEach((fascia, index) => {
    const progress = smooth((finalizeBuild - (0.86 + index * 0.025)) / 0.115);
    setPartOpacity(fascia, progress);
    fascia.position.y = fascia.userData.targetY + (1 - progress) * 0.7;
  });

  // Lampy ostrzegawcze wylaczone - unosily sie nad linia jako pomaranczowe
  // stozki i wygladaly na blad. Postoj/oczekiwanie pokazujemy sama animacja.
  parts.warningLight.visible = false;
  parts.warningGlow.intensity = 0;
}

function ThreeProductionScene({ stages, visibleUnits }) {
  const mountRef = useRef(null);
  const controlsRef = useRef(null);
  const latestRef = useRef({ stages, visibleUnits });
  const [cadModelStatus, setCadModelStatus] = useState('loading');
  const [stageOneModelStatus, setStageOneModelStatus] = useState('loading');

  latestRef.current = { stages, visibleUnits };

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
    scene.fog = new THREE.Fog('#e7edf2', 42, 96);

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
    controls.minDistance = 7;
    controls.maxDistance = 95;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.target.set(0, 0.8, 0);
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
    const cadLockers = new Map();
    const rollers = [];
    const stationWorkers = [];
    let cadModelTemplate = null;
    let stageOneTemplates = null;
    let disposed = false;
    let lastStageSignature = '';
    let lastFittedStageCount = -1;
    let routePoints = [];
    let routeCenter = new THREE.Vector3(0, 0, 0);

    const rebuildStatic = () => {
      staticGroup.clear();
      rollers.length = 0;
      stationWorkers.length = 0;
      routePoints = buildLinePoints(latestRef.current.stages.length);
      const rollerMaterial = makeMaterial(ROLLER_COLOR, 0.38, 0.58);

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
          controls.minDistance = 7;
          controls.maxDistance = Math.max(95, routeLength * 2.4);
          controls.update();
          controls.saveState();
          lastFittedStageCount = routePoints.length;
        }

        floor.geometry.dispose();
        floor.geometry = new THREE.PlaneGeometry(CONVEYOR_WIDTH + 16, routeLength + 17);
        floor.position.x = center.x;
        floor.position.z = center.z;
      }

      routePoints.forEach((point, index) => {
        const stage = latestRef.current.stages[index];
        const sideOffset = getStationSideOffset(routePoints, index, routeCenter);
        const stationPosition = point.clone().add(sideOffset);
        const targetDirection = point.clone().sub(stationPosition);
        const stationAngle = Math.atan2(targetDirection.x, targetDirection.z);
        const marker = new THREE.Group();
        marker.position.copy(stationPosition);
        marker.position.y = 0.08;
        marker.rotation.y = stationAngle;

        const stageColor = stage?.color ?? '#2563eb';
        const skinColors = ['#d6a47a', '#9a6848', '#e0b48f', '#704832'];
        const worker = new THREE.Group();
        worker.name = `worker-${index + 1}`;
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
        [-0.14, 0.14].forEach((x, legIndex) => {
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

        const skinMaterial = makeMaterial(skinColors[index % skinColors.length], 0.76, 0.01);
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
        toolGroup.visible = index === 0 || index === 2;
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
          index,
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
        stationWorkers.push(worker);
        marker.add(worker);

        staticGroup.add(marker);
      });

      if (routePoints.length) {
        const entryExtension = ENTRY_CONVEYOR_LENGTH + 1.6;
        const exitExtension = 2.8;
        const first = routePoints[0];
        const last = routePoints[routePoints.length - 1];
        const direction = getRouteTangent(routePoints, 0);
        const conveyorStart = first.clone().addScaledVector(direction, -entryExtension);
        const conveyorEnd = last.clone().addScaledVector(direction, exitExtension);
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
        for (let rollerIndex = 0; rollerIndex < rollerCount; rollerIndex += 1) {
          const z = -length / 2 + (rollerIndex / Math.max(rollerCount - 1, 1)) * length;
          const roller = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.18, ROLLER_LENGTH, 30),
            rollerMaterial,
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
      standingBaseProbe.rotation.x = -Math.PI / 2; // zgodnie z odwroceniem podstawy
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
      lockers.forEach((model) => unitGroup.remove(model));
      lockers.clear();
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
        console.info('Podpieto model polek + drzwi z GLB.');
      }).catch(() => {
        // Brak pliku - OK, korzystamy z proceduralnych zaslepek.
      });
    }).catch((error) => {
      console.error('Nie udalo sie zaladowac modeli montazowych GLB.', error);
      if (!disposed) setStageOneModelStatus('error');
    });

    gltfLoader.load(
      CAD_MODEL_URL,
      (gltf) => {
        if (disposed) return;

        const source = gltf.scene;
        source.rotation.x = -Math.PI / 2;
        source.updateMatrixWorld(true);

        const initialBounds = new THREE.Box3().setFromObject(source);
        const initialSize = initialBounds.getSize(new THREE.Vector3());
        const scale = CAD_MODEL_HEIGHT / Math.max(initialSize.y, 0.001);
        source.scale.multiplyScalar(scale);
        source.updateMatrixWorld(true);

        const normalizedBounds = new THREE.Box3().setFromObject(source);
        const normalizedCenter = normalizedBounds.getCenter(new THREE.Vector3());
        source.position.x -= normalizedCenter.x;
        source.position.y -= normalizedBounds.min.y;
        source.position.z -= normalizedCenter.z;
        source.updateMatrixWorld(true);
        source.traverse((object) => {
          if (!object.isMesh) return;
          object.castShadow = true;
          object.receiveShadow = true;
        });

        cadModelTemplate = new THREE.Group();
        cadModelTemplate.name = 'cadLockerTemplate';
        cadModelTemplate.add(source);
        setCadModelStatus('ready');
      },
      undefined,
      (error) => {
        console.error('Nie udalo sie zaladowac modelu CAD paczkomatu.', error);
        if (!disposed) setCadModelStatus('error');
      },
    );

    let frame;
    const clock = new THREE.Clock();

    const render = () => {
      const time = clock.getElapsedTime();
      const signature = latestRef.current.stages.map((stage) => `${stage.id}:${stage.color}:${stage.name}`).join('|');

      if (signature !== lastStageSignature) {
        lastStageSignature = signature;
        rebuildStatic();
      }

      const activeNumbers = new Set();
      latestRef.current.visibleUnits.forEach((unit) => {
        activeNumbers.add(unit.key);
        let model = lockers.get(unit.key);
        if (!model) {
          model = createTwoPartLockerModel(stageOneTemplates);
          lockers.set(unit.key, model);
          unitGroup.add(model);
        }

        const pose = getUnitPose(unit, routePoints);
        const stage = latestRef.current.stages[unit.currentIndex];
        const isHorizontalAssembly = ['locks', 'shelves', 'back', 'door', 'lockers', 'finalize'].includes(stage?.icon);
        // Podniesienie montazu, zeby czesci lezaly NA rolotoku, a nie w nim.
        // Faza pozioma (zamki/sciany/polki/drzwi) byla zatopiona w rolkach.
        // Faza "finalize" (stawianie pionowe) zostaje na poziomie podstawy.
        const isStandingStage = stage?.icon === 'finalize';
        // Faza stojaca: opuszczamy caly paczkomat o TUNE.standingY, zeby podstawa
        // siadla na tasmociagu (a nie lewitowala). Faza pozioma: lekkie uniesienie.
        const conveyorLift = isStandingStage ? TUNE.standingY : 0.34;
        model.visible = true;
        model.position.copy(pose.position);
        model.position.y = isHorizontalAssembly
          ? MODEL_LINE_Y + conveyorLift
          : MODEL_LINE_Y + conveyorLift + Math.sin(time * 2 + unit.number) * 0.018;
        model.rotation.y += Math.atan2(Math.sin(pose.angle - model.rotation.y), Math.cos(pose.angle - model.rotation.y)) * 0.16;
        model.scale.setScalar(unit.number === 1 ? 0.88 : 0.78);
        updateTwoPartLockerModel(model, unit, stage, time, latestRef.current.stages);

        // === Produkt koncowy = zlozony model ===
        // Wczesniej pod koniec ostatniego etapu scena podmieniala zlozony
        // paczkomat na pojedynczy, gladki model CAD (paczkomatopytmalny.glb),
        // ktory jest jedna szara bryla bez detali - wygladalo to gorzej niz
        // sam montaz i ukrywalo laczenie polowek. Zgodnie z zalozeniem
        // "to co sie zlozy ma byc produktem koncowym" - zostawiamy zlozony
        // model widoczny do konca. Podmiana CAD jest wylaczona.
        const cadModel = cadLockers.get(unit.key);
        if (cadModel) cadModel.visible = false;
      });

      lockers.forEach((model, number) => {
        if (!activeNumbers.has(number)) {
          model.visible = false;
        }
      });
      cadLockers.forEach((model, number) => {
        if (!activeNumbers.has(number)) {
          model.visible = false;
        }
      });
      renderer.domElement.dataset.cadInstances = String(cadLockers.size);
      renderer.domElement.dataset.cadVisible = String(
        [...cadLockers.values()].filter((model) => model.visible).length,
      );
      renderer.domElement.dataset.stageOneGlb = stageOneTemplates ? 'ready' : 'loading';
      renderer.domElement.dataset.stageOneGlbUnits = String(
        [...lockers.values()].filter((model) => model.userData.usesStageOneGlb).length,
      );

      rollers.forEach((roller) => {
        roller.rotateY(0.09);
      });

      stationWorkers.forEach((worker) => {
        const active = latestRef.current.visibleUnits.some(
          (unit) =>
            unit.currentIndex === worker.userData.index
            && unit.mode === 'assembly'
            && (unit.assemblyProgress ?? 0) > 0,
        );
        const phase = time * (active ? 3.4 : 1.1) + worker.userData.index * 0.8;
        const workSwing = Math.sin(phase);
        const precisionPulse = Math.sin(phase * 2.4);
        const placementCycle = (1 - Math.cos(phase * 0.72)) * 0.5;
        const action = worker.userData.index % 4;
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

      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
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
        <button type="button" onClick={() => zoomCamera(1.2)} title="Oddal kamere