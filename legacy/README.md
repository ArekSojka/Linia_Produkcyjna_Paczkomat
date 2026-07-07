# legacy/ — stare / nieużywane pliki

Rzeczy odstawione tutaj **nie są używane przez działającą aplikację** ani przez
build (Vercel). Trzymamy je na wypadek, gdyby się przydały jako źródło albo
odniesienie. Można je bezpiecznie usunąć w całości, jeśli okażą się zbędne.

| Pozycja | Co to jest | Dlaczego tutaj |
|---|---|---|
| `main.jsx.bak-23.06` | Kopia zapasowa `src/main.jsx` z 23.06 | Backup sprzed refaktorów; kod żyje w `src/main.jsx` |
| `elementy/` | Surowe modele GLB z eksportu (nazwy PL) | Aplikacja ładuje przetworzone modele z `public/models/components/`, nie te |
| `scripts/` | `start-dev` / `build` (.cmd/.ps1) | Wskazują na ścieżki innego komputera (`C:\Users\Admin\…codex-runtime`) i pnpm; zastąpione skryptami npm w `package.json` |
| `pnpm-lock.yaml` | Lockfile pnpm | Projekt przeszedł na npm (`npm ci` + `package-lock.json`) |

## Jak uruchamiać projekt (aktualnie)

```
npm install      # lub: npm ci
npm run dev      # serwer deweloperski
npm run build    # produkcja -> dist/ (Vercel robi to sam)
npm test         # testy regresji symulacji
```
