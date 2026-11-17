# Starts Elara: builds the React UI if needed, then serves everything
# from the FastAPI backend at http://localhost:8000
#
#   .\start.ps1          -> production mode (one server, port 8000)
#   .\start.ps1 -Dev     -> development mode (hot reload: UI on 5173, API on 8000)

param([switch]$Dev)

$root = $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path (Join-Path $root "frontend\node_modules"))) {
    Write-Host "Installing frontend packages..." -ForegroundColor Cyan
    Push-Location (Join-Path $root "frontend"); npm install; Pop-Location
}

if ($Dev) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; & '$python' -m uvicorn backend.server:app --reload --port 8000"
    Set-Location (Join-Path $root "frontend")
    npm run dev
}
else {
    Push-Location (Join-Path $root "frontend"); npm run build; Pop-Location
    Write-Host "`nElara is online at http://localhost:8000`n" -ForegroundColor Yellow
    Set-Location $root
    & $python -m uvicorn backend.server:app --port 8000
}
