@echo off
set "NODE_DIR=C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "PNPM=C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs"
set "PATH=%NODE_DIR%;%PATH%"
"%NODE_DIR%\node.exe" "%PNPM%" run build
