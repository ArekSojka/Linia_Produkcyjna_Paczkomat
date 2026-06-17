$NodeDir = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$Pnpm = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs"
$env:Path = "$NodeDir;$env:Path"
& "$NodeDir\node.exe" $Pnpm run build
