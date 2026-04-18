# Game Launcher — Instalador .msi

## Inicio rapido

1. Doble clic en `COMPILAR_MSI.bat`
2. Espera 2-5 minutos (descarga Electron la primera vez)
3. El .msi aparece en la carpeta `dist\`

## El instalador .msi incluye

- Seleccion de ruta de instalacion (el usuario elige donde instalar)
- Lista completa de archivos que se copian
- Acceso directo en Escritorio
- Acceso directo en Menu Inicio
- Entrada en Agregar/Quitar programas de Windows
- Desinstalacion limpia

## Deteccion de juegos

### Steam (automatico)
Al abrir la app por primera vez, detecta automaticamente librerias de Steam en:
  C:\Program Files (x86)\Steam\steamapps\common
  D:\SteamLibrary\steamapps\common
  ... y otras rutas comunes en unidades C-G

Puedes anadir librerias manualmente con: Ajustes -> Detectar Steam

### Carpetas personalizadas
Usa "+ Carpeta" en la barra de herramientas.
El escaner filtra automaticamente instaladores, runtimes, anti-cheat y
otros ejecutables que NO son juegos, usando una lista negra + filtro de tamano.

### Ejecutable individual
Usa "+ .exe" para anadir cualquier juego manualmente.

## Estructura del proyecto

  game-launcher-msi/
  ├── COMPILAR_MSI.bat      <- Ejecuta esto para compilar
  ├── build-msi.ps1         <- Script de compilacion (PowerShell)
  ├── package.json          <- Configuracion de electron-builder (target: msi)
  ├── installer/
  │   └── GameLauncher.wxs  <- Definicion WiX del instalador (avanzado)
  └── src/
      ├── main.js           <- Proceso principal Electron + DB + deteccion juegos
      ├── preload.js        <- Bridge IPC seguro
      ├── index.html        <- UI
      ├── css/style.css     <- Estilos (variables CSS faciles de editar)
      ├── js/app.js         <- Logica de interfaz
      └── assets/
          └── icon.ico      <- Icono de la app (reemplaza con el tuyo, 256x256)

## Requisitos

- Windows 10/11 (64-bit)
- Node.js >= 18  ->  https://nodejs.org/

## Anadir icono personalizado

Coloca tu propio icon.ico (256x256) en src\assets\
Para convertir PNG a ICO: https://www.icoconverter.com/

## Personalizar la UI

Edita las variables CSS en src\css\style.css:
  --accent    color principal (cambiable tambien desde dentro de la app)
  --bg        fondo
  --card      tarjetas de juegos
  --font-main tipografia principal
