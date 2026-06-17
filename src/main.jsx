import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion } from 'framer-motion';
import * as THREE from 'three';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  DoorOpen,
  Frame,
  Grid3X3,
  House,
  Pause,
  Plus,
  Play,
  RotateCcw,
  Settings2,
  TimerReset,
  Trash2,
  Zap,
} from 'lucide-react';
import './styles.css';

const baseStages = [
  {
    id: crypto.randomUUID(),
    name: 'Rama',
    duration: 12,
    color: '#2563eb',
    icon: 'frame',
  },
  {
    id: crypto.randomUUID(),
    name: 'Dach',
    duration: 6,
    color: '#0891b2',
    icon: 'roof',
  },
  {
    id: crypto.randomUUID(),
    name: 'Drzwi',
    duration: 10,
    color: '#f59e0b',
    icon: 'door',
  },
  {
    id: crypto.randomUUID(),
    name: 'Skrytki',
    duration: 15,
    color: '#16a34a',
    icon: 'lockers',
  },
  {
    id: crypto.randomUUID(),
    name: 'Elektronika',
    duration: 11,
    color: '#dc2626',
    icon: 'electronics',
  },
  {
    id: crypto.randomUUID(),
    name: 'Test jakosci',
    duration: 8,
    color: '#7c3aed',
    icon: 'test',
  },
];

const iconOptions = [
  { value: 'frame', label: 'Rama' },
  { value: 'door', label: 'Drzwi' },
  { value: 'roof', label: 'Dach' },
  { value: 'lockers', label: 'Skrytki' },
  { value: 'electronics', label: 'Elektronika' },
  { value: 'test', label: 'Test' },
  { value: 'box', label: 'Montaz' },
];

const stageIcons = {
  frame: Frame,
  door: DoorOpen,
  roof: House,
  lockers: Grid3X3,
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

const CONVEYOR_WIDTH = 3.58;
const ROLLER_COLOR = '#e2e8f0';
const CONVEYOR_UNITS_PER_SECOND = 1.42;
const MIN_TRAVEL_SECONDS = 3.2;

const buildSnakePoints = (count) => {
  const columns = Math.min(Math.max(count, 1), 3);
  const rows = Math.ceil(count / columns);
  const spacingX = 7.2;
  const spacingZ = 6.2;
  const startX = -((columns - 1) * spacingX) / 2;
  const startZ = ((rows - 1) * spacingZ) / 2;

  return Array.from({ length: count }).map((_, index) => {
    const row = Math.floor(index / columns);
    const columnInRow = index % columns;
    const column = row % 2 === 0 ? columnInRow : columns - 1 - columnInRow;

    return new THREE.Vector3(startX + column * spacingX, 0.55, startZ - row * spacingZ);
  });
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

  return side.multiplyScalar(2.95);
};

const getTravelDurations = (stageCount) => {
  const points = buildSnakePoints(stageCount);

  return points.slice(0, -1).map((point, index) => {
    const distance = point.distanceTo(points[index + 1]);
    return Math.max(MIN_TRAVEL_SECONDS, distance / CONVEYOR_UNITS_PER_SECOND);
  });
};

const getDefaultTravelTimes = (stageCount) =>
  getTravelDurations(stageCount).map((duration) => Number(duration.toFixed(1)));

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
    let arrivalAtStage = stationFreeAt[0] ?? 0;
    let finishTime = arrivalAtStage;

    for (let stageIndex = 0; stageIndex < stageCount; stageIndex += 1) {
      const duration = Math.max(stages[stageIndex]?.duration ?? 0, 0.1);
      const assemblyStart = Math.max(arrivalAtStage, stationFreeAt[stageIndex] ?? 0);
      const assemblyEnd = assemblyStart + duration;
      const hasNextStage = stageIndex < stageCount - 1;
      const waitEnd = hasNextStage
        ? Math.max(assemblyEnd, stationFreeAt[stageIndex + 1] ?? 0)
        : assemblyEnd;

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
        stationFreeAt[stageIndex] = assemblyEnd;
        finishTime = assemblyEnd;
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
    + travelDurations.reduce((sum, duration) => sum + duration, 0);

  return {
    units,
    totalTime: Math.max(units[units.length - 1]?.finishTime ?? soloCycleTime, 0.1),
    launchInterval: Math.max(averageLaunchInterval, 0.1),
    soloCycleTime: Math.max(soloCycleTime, 0.1),
    travelDurations,
  };
};

const getVisibleUnitsFromSchedule = (schedule, elapsed, animationCycle, stageCount) => {
  const visible = [];
  const batchOffsets = [-1, 0, 1];

  batchOffsets.forEach((batchOffset) => {
    const batchStart = batchOffset * animationCycle;
    const localTime = elapsed - batchStart;

    schedule.units.forEach((scheduledUnit) => {
      if (localTime < scheduledUnit.startTime || localTime > scheduledUnit.finishTime) return;

      const segment = scheduledUnit.segments.find(
        (candidate) => localTime >= candidate.start && localTime <= candidate.end,
      );

      if (!segment) return;

      if (segment.type === 'travel') {
        visible.push({
          key: `${batchOffset}:${scheduledUnit.number}`,
          number: scheduledUnit.number,
          elapsed: localTime,
          currentIndex: segment.from,
          progress: 100,
          assemblyProgress: 100,
          mode: 'travel',
          travelFrom: segment.from,
          travelTo: segment.to,
          travelProgress: ((localTime - segment.start) / Math.max(segment.duration, 0.1)) * 100,
          isBlocked: false,
        });
        return;
      }

      const assemblyProgress = Math.min(
        ((localTime - segment.start) / Math.max(segment.duration, 0.1)) * 100,
        100,
      );
      const isBlocked =
        segment.stageIndex < stageCount - 1
        && localTime >= segment.assemblyEnd
        && segment.end > segment.assemblyEnd + 0.05;

      visible.push({
        key: `${batchOffset}:${scheduledUnit.number}`,
        number: scheduledUnit.number,
        elapsed: localTime,
        currentIndex: segment.stageIndex,
        progress: assemblyProgress,
        assemblyProgress,
        mode: isBlocked ? 'waiting' : 'assembly',
        travelProgress: 0,
        isBlocked,
      });
    });
  });

  return visible.sort((a, b) => b.elapsed - a.elapsed);
};

const getUnitPose = (unit, points) => {
  if (!points.length) return { position: new THREE.Vector3(), angle: 0, atStop: true };

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

  const body = makeBox(3.78, 2.72, 0.82, '#f8fafc', 'bodyPanel');
  body.position.set(0, 1.48, 0.2);
  group.add(body);

  const side = makeBox(0.18, 2.82, 0.88, '#ffffff', 'sidePanel');
  side.position.set(2.04, 1.48, 0.08);
  group.add(side);

  const back = makeBox(4.06, 2.96, 0.1, '#e5e7eb', 'backPanel');
  back.position.set(0, 1.48, -0.39);
  group.add(back);

  const base = makeBox(4.18, 0.28, 1.02, '#0f2930', 'base');
  base.position.set(0, 0.05, 0.06);
  group.add(base);

  const cap = makeBox(4.24, 0.28, 1.04, '#030712', 'cap');
  cap.position.set(0, 3.08, 0.06);
  group.add(cap);

  const topModules = [];
  for (let index = 0; index < 8; index += 1) {
    const module = makeBox(0.48, 0.18, 0.12, '#020617', 'topModule');
    module.position.set(-1.72 + index * 0.49, 3.24, 0.6);
    topModules.push(module);
    group.add(module);
  }

  const feet = [];
  [-1.75, -0.45, 0.45, 1.75].forEach((x) => {
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
  if (mesh.material) {
    mesh.material.transparent = opacity < 1;
    mesh.material.opacity = opacity;
  }
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

  const frameBuild = getBuildForIcon('frame');
  const doorBuild = getBuildForIcon('door');
  const roofBuild = getBuildForIcon('roof', 'frame');
  const lockerBuild = getBuildForIcon('lockers');
  const electronicsBuild = getBuildForIcon('electronics');
  const testBuild = getBuildForIcon('test');

  parts.frameBeams.forEach((beam, index) => {
    const beamProgress = Math.max(0, Math.min(frameBuild * parts.frameBeams.length - index, 1));
    setPartOpacity(beam, frameBuild > 0 ? 0.18 + beamProgress * 0.82 : 0);
  });
  setPartOpacity(parts.base, Math.min(1, frameBuild * 1.35));
  setPartOpacity(parts.cap, Math.min(1, roofBuild * 1.2));
  parts.topModules.forEach((module, index) => {
    const moduleProgress = Math.max(0, Math.min(roofBuild * parts.topModules.length - index, 1));
    setPartOpacity(module, moduleProgress);
    module.position.y = 3.24 + (1 - moduleProgress) * 0.34;
  });
  parts.feet.forEach((foot) => setPartOpacity(foot, Math.min(1, frameBuild * 1.5)));

  setPartOpacity(parts.body, doorBuild);
  setPartOpacity(parts.back, doorBuild);
  setPartOpacity(parts.side, doorBuild);
  parts.doorPanels.forEach((panel, index) => {
    const doorProgress = Math.max(0, Math.min(doorBuild * parts.doorPanels.length - index * 0.72, 1));
    setPartOpacity(panel, doorProgress);
    panel.position.z = 0.64 + (1 - doorProgress) * 0.38;
    panel.rotation.y =
      isIconActive('door')
        ? Math.sin(doorProgress * Math.PI) * (index % 2 === 0 ? 0.18 : -0.18)
        : 0;
  });

  parts.cells.forEach((cell, index) => {
    const cellProgress = Math.max(0, Math.min(lockerBuild * parts.cells.length - index * 0.58, 1));
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
    const labelProgress = Math.max(0, Math.min(lockerBuild * 2 - index * 0.5, 1));
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

  if (isIconActive('roof')) {
    const roofPulse = 1 + Math.sin(time * 3.8) * 0.018 * (1 - normalizedProgress * 0.4);
    parts.cap.scale.set(1, roofPulse, 1);
    parts.cap.position.y = 3.08 + (1 - roofBuild) * 0.42;
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

function ThreeProductionScene({ stages, visibleUnits }) {
  const mountRef = useRef(null);
  const zoomRef = useRef(1);
  const cameraAngleRef = useRef(0);
  const cameraTiltRef = useRef(1);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [cameraAngle, setCameraAngle] = useState(0);
  const [cameraTilt, setCameraTilt] = useState(1);
  const latestRef = useRef({ stages, visibleUnits });

  latestRef.current = { stages, visibleUnits };

  const updateZoom = (nextZoom) => {
    const clamped = Math.max(0.55, Math.min(nextZoom, 2.25));
    zoomRef.current = clamped;
    setZoomLevel(clamped);
  };

  const updateCameraAngle = (nextAngle) => {
    const normalized = ((nextAngle % 360) + 360) % 360;
    cameraAngleRef.current = normalized;
    setCameraAngle(normalized);
  };

  const updateCameraTilt = (nextTilt) => {
    const clamped = Math.max(0.72, Math.min(nextTilt, 1.42));
    cameraTiltRef.current = clamped;
    setCameraTilt(clamped);
  };

  useEffect(() => {
    if (!mountRef.current) return undefined;

    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#eef4f8');

    const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 120);
    camera.position.set(0, 16, 24);
    camera.lookAt(0, 0, -0.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'production-canvas';
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.HemisphereLight('#ffffff', '#8ca0b3', 2.35);
    scene.add(ambient);

    const key = new THREE.DirectionalLight('#ffffff', 2.8);
    key.position.set(-5, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);

    const fill = new THREE.PointLight('#dbeafe', 1.4, 28);
    fill.position.set(6, 5, -5);
    scene.add(fill);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 16),
      new THREE.MeshStandardMaterial({ color: '#dfe7ef', roughness: 0.86 }),
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
    const rollers = [];
    const stationTools = [];
    let lastStageSignature = '';
    let routePoints = [];
    let cameraTarget = new THREE.Vector3(0, 0.5, -0.5);
    let routeCenter = new THREE.Vector3(0, 0, 0);
    let cameraHeight = 10.8;
    let cameraDepth = 13.8;

    const rebuildStatic = () => {
      staticGroup.clear();
      rollers.length = 0;
      stationTools.length = 0;
      routePoints = buildSnakePoints(latestRef.current.stages.length);
      const rollerMaterial = makeMaterial(ROLLER_COLOR, 0.38, 0.58);

      if (routePoints.length) {
        const bounds = new THREE.Box3().setFromPoints(routePoints);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.z, 8);

        routeCenter = center.clone();
        cameraTarget = new THREE.Vector3(center.x, 0.5, center.z);
        cameraHeight = Math.max(18, maxDim * 1.28);
        cameraDepth = Math.max(25, maxDim * 1.75);
        camera.position.set(cameraTarget.x, cameraHeight, cameraTarget.z + cameraDepth);
        camera.lookAt(cameraTarget);

        floor.geometry.dispose();
        floor.geometry = new THREE.PlaneGeometry(maxDim + 14, maxDim + 14);
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

        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(index === 0 ? 0.95 : 0.62, index === 0 ? 1.06 : 0.72, 0.18, 36),
          makeMaterial(stage?.color ?? '#2563eb', 0.54, 0.16),
        );
        base.castShadow = true;
        base.receiveShadow = true;
        marker.add(base);

        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.06, 1.55, 18),
          makeMaterial('#475569', 0.5, 0.28),
        );
        post.position.y = 0.84;
        post.castShadow = true;
        marker.add(post);

        const beacon = new THREE.Mesh(
          new THREE.BoxGeometry(index === 0 ? 1.25 : 0.82, 0.34, 0.16),
          makeMaterial(stage?.color ?? '#2563eb', 0.42, 0.08),
        );
        beacon.position.y = 1.72;
        beacon.castShadow = true;
        marker.add(beacon);

        const arm = new THREE.Group();
        arm.position.set(0, 0.18, 0);

        const column = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 1.45, 0.12),
          makeMaterial('#334155', 0.5, 0.32),
        );
        column.position.y = 0.72;
        column.castShadow = true;
        arm.add(column);

        const boom = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.12, 1.82),
          makeMaterial('#475569', 0.48, 0.3),
        );
        boom.position.set(0, 1.38, 0.82);
        boom.castShadow = true;
        arm.add(boom);

        const head = new THREE.Mesh(
          new THREE.BoxGeometry(index === 0 ? 0.42 : 0.28, index === 0 ? 0.32 : 0.24, index === 0 ? 0.42 : 0.28),
          makeMaterial(stage?.color ?? '#2563eb', 0.36, 0.12),
        );
        head.position.set(0, 1.2, 1.68);
        head.castShadow = true;
        arm.add(head);
        arm.userData = { index, head };
        stationTools.push(arm);
        marker.add(arm);

        staticGroup.add(marker);
      });

      for (let index = 0; index < routePoints.length - 1; index += 1) {
        const start = routePoints[index];
        const end = routePoints[index + 1];
        const direction = end.clone().sub(start);
        const length = direction.length();
        const angle = Math.atan2(direction.x, direction.z);
        const midpoint = start.clone().add(end).multiplyScalar(0.5);

        const segment = new THREE.Group();
        segment.position.set(midpoint.x, 0.18, midpoint.z);
        segment.rotation.y = angle;

        const bed = new THREE.Mesh(
          new THREE.BoxGeometry(CONVEYOR_WIDTH, 0.32, length + 1.28),
          makeMaterial('#64748b', 0.74, 0.28),
        );
        bed.receiveShadow = true;
        bed.castShadow = true;
        segment.add(bed);

        const railLeft = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.58, length + 1.44),
          makeMaterial('#334155', 0.55, 0.34),
        );
        railLeft.position.x = -1.92;
        railLeft.position.y = 0.24;
        segment.add(railLeft);

        const railRight = railLeft.clone();
        railRight.position.x = 1.92;
        segment.add(railRight);

        const rollerCount = Math.max(5, Math.floor(length / 0.34));
        for (let rollerIndex = 0; rollerIndex < rollerCount; rollerIndex += 1) {
          const z = -length / 2 + (rollerIndex / Math.max(rollerCount - 1, 1)) * length;
          const roller = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.18, 3.28, 30),
            rollerMaterial,
          );
          roller.rotation.z = Math.PI / 2;
          roller.position.set(0, 0.36, z);
          roller.castShadow = true;
          segment.add(roller);
          rollers.push(roller);
        }

        staticGroup.add(segment);
      }

      for (let index = 1; index < routePoints.length - 1; index += 1) {
        const previousDirection = routePoints[index].clone().sub(routePoints[index - 1]).normalize();
        const nextDirection = routePoints[index + 1].clone().sub(routePoints[index]).normalize();
        if (Math.abs(previousDirection.dot(nextDirection)) > 0.96) continue;

        const point = routePoints[index];
        const corner = new THREE.Group();
        corner.position.set(point.x, 0.4, point.z);

        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(CONVEYOR_WIDTH + 0.48, 0.34, CONVEYOR_WIDTH + 0.48),
          makeMaterial('#64748b', 0.74, 0.28),
        );
        cap.castShadow = true;
        cap.receiveShadow = true;
        corner.add(cap);

        const railNorth = new THREE.Mesh(
          new THREE.BoxGeometry(CONVEYOR_WIDTH + 0.48, 0.42, 0.18),
          makeMaterial('#334155', 0.55, 0.34),
        );
        railNorth.position.set(0, 0.26, -1.95);
        corner.add(railNorth);

        const railSouth = railNorth.clone();
        railSouth.position.z = 1.95;
        corner.add(railSouth);

        const railWest = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.42, CONVEYOR_WIDTH + 0.48),
          makeMaterial('#334155', 0.55, 0.34),
        );
        railWest.position.set(-1.95, 0.26, 0);
        corner.add(railWest);

        const railEast = railWest.clone();
        railEast.position.x = 1.95;
        corner.add(railEast);

        const previousAngle = Math.atan2(previousDirection.x, previousDirection.z);
        const nextAngle = Math.atan2(nextDirection.x, nextDirection.z);
        [previousAngle, nextAngle].forEach((angle, laneIndex) => {
          const turnLane = new THREE.Group();
          turnLane.rotation.y = angle;
          corner.add(turnLane);

          for (let rollerIndex = 0; rollerIndex < 5; rollerIndex += 1) {
            const z = (laneIndex === 0 ? -1.12 : 0.18) + rollerIndex * 0.24;
            const roller = new THREE.Mesh(
              new THREE.CylinderGeometry(0.14, 0.14, 3.18, 24),
              rollerMaterial,
            );
            roller.rotation.z = Math.PI / 2;
            roller.position.set(0, 0.34, z);
            roller.castShadow = true;
            turnLane.add(roller);
            rollers.push(roller);
          }
        });

        const transferPlate = new THREE.Mesh(
          new THREE.CylinderGeometry(1.05, 1.05, 0.08, 40),
          makeMaterial('#94a3b8', 0.62, 0.2),
        );
        transferPlate.position.y = 0.52;
        transferPlate.castShadow = true;
        transferPlate.receiveShadow = true;
        corner.add(transferPlate);

        staticGroup.add(corner);
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

    const handleWheel = (event) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.12 : 0.12;
      updateZoom(zoomRef.current + delta);
    };

    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });

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
          model = createLockerModel();
          lockers.set(unit.key, model);
          unitGroup.add(model);
        }

        const pose = getUnitPose(unit, routePoints);
        const stage = latestRef.current.stages[unit.currentIndex];
        model.visible = true;
        model.position.copy(pose.position);
        model.position.y = 0.82 + Math.sin(time * 2 + unit.number) * 0.018;
        model.rotation.y += Math.atan2(Math.sin(pose.angle - model.rotation.y), Math.cos(pose.angle - model.rotation.y)) * 0.16;
        model.scale.setScalar(unit.number === 1 ? 0.88 : 0.78);
        updateLockerModel(model, unit, stage, time, latestRef.current.stages);
      });

      lockers.forEach((model, number) => {
        if (!activeNumbers.has(number)) {
          model.visible = false;
        }
      });

      rollers.forEach((roller) => {
        roller.rotateY(0.09);
      });

      stationTools.forEach((tool) => {
        const active = latestRef.current.visibleUnits.some(
          (unit) =>
            unit.currentIndex === tool.userData.index
            && unit.mode === 'assembly'
            && (unit.assemblyProgress ?? 0) > 0,
        );
        const head = tool.userData.head;
        tool.rotation.y = active ? Math.sin(time * 3.2) * 0.18 : 0;
        head.position.y = active ? 1.16 + Math.sin(time * 5.4) * 0.16 : 1.2;
        head.material.emissive = new THREE.Color(active ? latestRef.current.stages[tool.userData.index]?.color ?? '#2563eb' : '#000000');
        head.material.emissiveIntensity = active ? 0.55 : 0;
      });

      const zoom = zoomRef.current;
      const orbitAngle = THREE.MathUtils.degToRad(cameraAngleRef.current);
      const depth = cameraDepth / zoom;
      camera.position.x = cameraTarget.x + Math.sin(orbitAngle) * depth;
      camera.position.y = (cameraHeight * cameraTiltRef.current) / zoom;
      camera.position.z = cameraTarget.z + Math.cos(orbitAngle) * depth;
      camera.lookAt(cameraTarget);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="three-scene">
      <div className="zoom-controls" aria-label="Kontrola przyblizenia sceny 3D">
        <button type="button" onClick={() => updateZoom(zoomRef.current - 0.18)} title="Oddal">
          -
        </button>
        <span>{Math.round(zoomLevel * 100)}%</span>
        <button type="button" onClick={() => updateZoom(zoomRef.current + 0.18)} title="Przybliz">
          +
        </button>
        <button type="button" onClick={() => updateZoom(1)} title="Resetuj przyblizenie">
          1x
        </button>
      </div>
      <div className="camera-controls" aria-label="Kontrola kata kamery">
        <button type="button" onClick={() => updateCameraAngle(cameraAngleRef.current - 22.5)} title="Obroc kamere w lewo">
          <ChevronLeft size={17} />
        </button>
        <span>{Math.round(cameraAngle)} deg</span>
        <button type="button" onClick={() => updateCameraAngle(cameraAngleRef.current + 22.5)} title="Obroc kamere w prawo">
          <ChevronRight size={17} />
        </button>
        <button type="button" onClick={() => updateCameraTilt(cameraTiltRef.current + 0.12)} title="Widok bardziej z gory">
          <ArrowUp size={17} />
        </button>
        <button type="button" onClick={() => updateCameraTilt(cameraTiltRef.current - 0.12)} title="Widok bardziej z boku">
          <ArrowDown size={17} />
        </button>
        <button
          type="button"
          onClick={() => {
            updateCameraAngle(0);
            updateCameraTilt(1);
          }}
          title="Resetuj kat kamery"
        >
          {Math.round(cameraTilt * 100)}%
        </button>
      </div>
      <div className="three-scene-mount" ref={mountRef} />
    </div>
  );
}

function ProductionLine({ stages, visibleUnits, conveyorDuration }) {
  const leadUnit = visibleUnits[0] ?? { currentIndex: 0, progress: 0, number: 1 };
  const currentStage = stages[leadUnit.currentIndex] ?? stages[0];
  const statusLabel = leadUnit.isBlocked
    ? 'Czeka na wolny etap'
    : leadUnit.mode === 'travel'
      ? 'Przejazd'
      : 'Aktualny postoj';
  const occupiedStages = new Set(
    visibleUnits.filter((unit) => unit.mode !== 'travel').map((unit) => unit.currentIndex),
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
          Na zywo
        </div>
      </div>

      <div className="conveyor-wrap">
        <div className="stations">
          {stages.map((stage, index) => (
            <motion.div
              className={`station ${index === leadUnit.currentIndex ? 'active' : ''} ${occupiedStages.has(index) ? 'occupied' : ''}`}
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
          <ThreeProductionScene stages={stages} visibleUnits={visibleUnits} />
        </div>

        <div className="process-readout">
          <div>
            <span style={{ backgroundColor: currentStage?.color }} />
            <p>{statusLabel}</p>
            <strong>{currentStage?.name || 'Etap'}</strong>
          </div>
          <div>
            <p>Postep etapu</p>
            <strong>{Math.round(leadUnit.assemblyProgress ?? leadUnit.progress)}%</strong>
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
  const [unitCount, setUnitCount] = useState(4);
  const [stages, setStages] = useState(baseStages);
  const [elapsed, setElapsed] = useState(0);
  const [travelTimes, setTravelTimes] = useState(() => getDefaultTravelTimes(baseStages.length));
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [stopwatchElapsed, setStopwatchElapsed] = useState(0);
  const stopwatchStartRef = useRef(0);
  const stopwatchBaseRef = useRef(0);

  const normalizedStages = useMemo(
    () =>
      stages.map((stage) => ({
        ...stage,
        duration: clampNumber(stage.duration),
      })),
    [stages],
  );

  const productionCount = Math.max(1, Math.floor(clampNumber(unitCount, 1)));
  const normalizedTravelTimes = useMemo(
    () => normalizeTravelTimes(travelTimes, normalizedStages.length),
    [normalizedStages.length, travelTimes],
  );
  const productionSchedule = useMemo(
    () => buildProductionSchedule(normalizedStages, productionCount, normalizedTravelTimes),
    [normalizedStages, normalizedTravelTimes, productionCount],
  );
  const cycleTime = productionSchedule.soloCycleTime;
  const launchInterval = productionSchedule.launchInterval;
  const totalTime = productionSchedule.totalTime;
  const animationCycle = Math.max(totalTime, 1);

  React.useEffect(() => {
    let frame;
    const start = performance.now();

    const tick = (now) => {
      const seconds = ((now - start) / 1000) % animationCycle;
      setElapsed(seconds);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animationCycle, normalizedStages.length]);

  React.useEffect(() => {
    setTravelTimes((current) => normalizeTravelTimes(current, normalizedStages.length));
  }, [normalizedStages.length]);

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
    () => getVisibleUnitsFromSchedule(productionSchedule, elapsed, animationCycle, normalizedStages.length),
    [animationCycle, elapsed, normalizedStages.length, productionSchedule],
  );

  const updateStage = (id, patch) => {
    setStages((current) => current.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage)));
  };

  const updateTravelTime = (index, value) => {
    setTravelTimes((current) => {
      const next = normalizeTravelTimes(current, normalizedStages.length);
      next[index] = value;
      return next;
    });
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
        duration: 5,
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
    setTravelTimes(getDefaultTravelTimes(baseStages.length));
  };

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
        conveyorDuration={animationCycle}
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
