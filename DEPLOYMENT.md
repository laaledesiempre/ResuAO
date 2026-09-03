# Despliegue en producción

Resu se distribuye como **una sola imagen Docker all-in-one**: cliente estático +
API + game server (proceso unificado) sobre SQLite. No requiere servicios
externos.

## Inicio rápido

```bash
docker build -t resu .
docker run -p 3001:3001 -v resu-data:/data resu
```

Abrir `http://localhost:3001` y loguearse con **`admin` / `admin`**. El primer
login exige cambiar la contraseña (no se puede saltar).

Con un directorio del host en vez de un volumen named (útil para kubernetes
`hostPath` o backups por `rsync`):

```bash
docker run -p 3001:3001 -v /srv/resu:/data resu
```

El directorio puede estar **vacío**: la base de datos, el esquema y los
directorios se crean solos al arrancar.

## Persistencia: todo bajo `/data`

Todo el estado variable de la instancia vive en un único directorio:

```
/data/
├── resu.sqlite      # base de datos (se crea y migra sola)
└── uploads/          # imágenes subidas desde el panel admin (logo, fondos, etc.)
```

Montar `/data` alcanza para persistencia, backups y migraciones entre hosts.
`DATA_DIR` es configurable si se quiere otra ruta dentro del contenedor.

## Variables de entorno

### De la imagen (valores por defecto razonables)

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3001` | Puerto HTTP único expuesto (API + cliente + WS vía API). |
| `GAME_PORT` | `7666` | Puerto interno del game server (loopback, no hace falta exponerlo). |
| `DB_BACKEND` | `sqlite` | `sqlite` (default) o `postgres`. |
| `DATA_DIR` | `/data` | Raíz de persistencia (DB + uploads). |
| `API_BASE_URL` | `http://127.0.0.1:3001` | Cómo el game server alcanza la API (loopback interno). |

### Del operador

| Variable | Default | Descripción |
|---|---|---|
| `TOKEN_AUTH` | generado efímero por arranque | Secreto compartido API ↔ game server. Al no setearse, el entrypoint genera uno random por boot y loguea un warning (válido porque ambos procesos viven en el mismo contenedor). Setearlo si se separan los componentes. |
| `SEED_ADMIN_NAME` | `admin` | Nombre de la cuenta admin semilla. |
| `SEED_ADMIN_PASSWORD` | `admin` | Contraseña inicial de la semilla (cambio obligatorio en el primer login). |
| `SQLITE_PATH` | `$DATA_DIR/resu.sqlite` | Override puntual del archivo de DB. |
| `UPLOADS_DIR` | `$DATA_DIR/uploads` | Override puntual del directorio de uploads. |
| `CORS_ORIGIN` | — | Origen permitido si el cliente se sirve desde otro dominio. En la imagen all-in-one no hace falta. |
| `SITE_URL` | — | URL pública de la instancia (se usa en mails). |
| `SES_REGION` / `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY` / `SES_FROM_EMAIL` / `SES_FROM_NAME` | — | Envío de mails vía AWS SES (recuperación de contraseña). Sin SES, el registro no requiere email real (se genera un placeholder único). |
| `DATABASE_URL` | — | Requerida solo si `DB_BACKEND=postgres`. |
| `GAME_DATA_ADMIN_EMAIL` / `GAME_DATA_ADMIN_ACCOUNT_ID` / `GAME_DATA_ADMIN_PROXY_TOKEN` | — | Acceso de administración de datos de juego (herramientas internas). |

## Cuenta admin semilla

Al arrancar, si **no existe ninguna cuenta con `is_admin`**, se crea la semilla
(`SEED_ADMIN_NAME` / `SEED_ADMIN_PASSWORD`, default `admin`/`admin`) con el flag
`must_change_password`. Es idempotente: si ya hay algún admin no hace nada, y no
se duplica entre reinicios.

El cambio de contraseña obligatorio lo fuerza el cliente: tras loguearse, la
única pantalla disponible es el formulario de cambio hasta completarlo
(`POST /api/auth/change-password`).

Desde el panel de admin (ícono de administración logueado con una cuenta
`is_admin`) se puede configurar en caliente, sin reiniciar:

- **Instancia**: nombre, mensajes del servidor (bienvenida del chat in-game,
  una línea por mensaje), mensaje del login.
- **Branding**: colores, logo, imagen de fondo, fuentes custom. Las imágenes
  pueden subirse como archivo (van a `/data/uploads/`) o referenciarse por URL.
- **Registro**: habilitar/deshabilitar creación de cuentas, campos requeridos
  (el email puede hacerse opcional).
- **Cuentas**: habilitar/deshabilitar, banear, promover admins.

El cliente refleja estos cambios en cada carga (`GET /api/site-config`).

## docker-compose (opcional)

La imagen no necesita compose, pero un ejemplo mínimo:

```yaml
services:
  resu:
    image: resu:latest
    build: .
    ports:
      - "3001:3001"
    volumes:
      - resu-data:/data
    environment:
      TOKEN_AUTH: "cambiar-por-un-secreto-largo"
      SEED_ADMIN_PASSWORD: "algo-mejor-que-admin"
    restart: unless-stopped

volumes:
  resu-data:
```

## Kubernetes (hostPath)

```yaml
volumeMounts:
  - name: data
    mountPath: /data
volumes:
  - name: data
    hostPath:
      path: /srv/resu
      type: DirectoryOrCreate
```

Con un `PersistentVolumeClaim` es igual: montar el claim en `/data`.

## TLS / reverse proxy

El contenedor bindea HTTP plano en `:3001`. Para producción pública, poner
delante un reverse proxy con TLS (nginx, Caddy, Traefik) que forwardee a
`3001`. No hace falta exponer `GAME_PORT`.

## Postgres en vez de SQLite

Para instancias grandes se puede usar Postgres externo:

```bash
docker run -p 3001:3001 -v resu-data:/data \
  -e DB_BACKEND=postgres \
  -e DATABASE_URL=postgresql://user:pass@host:5432/resu \
  resu
```

El esquema (`api/schema.sql`) se aplica solo al arrancar vía las migraciones
del entrypoint. En este modo `/data` solo persiste los uploads.

## Flags del entrypoint unificado (desarrollo / self-host sin Docker)

El proceso unificado (`api/src/unified.ts`, script `npm run unified` en `api/`)
acepta flags que pisan a las variables de entorno:

```bash
npm run unified -- --port 3003 --game-port 7667   # puertos custom
npm run unified -- --db /ruta/resu.sqlite        # setea SQLITE_PATH
npm run unified -- --serve                        # sirve client/dist (SPA) en el puerto de la API
npm run unified -- --help
```

Para el flujo de desarrollo local (API + game server + cliente por
separado, Postgres local, hot reload) ver el [README](README.md).

## Actualizar la instancia

```bash
git pull
docker build -t resu .
docker stop resu && docker rm resu
docker run -p 3001:3001 -v resu-data:/data resu
```

Los datos sobreviven en el volumen; las migraciones de esquema se aplican al
arrancar. Backup recomendado antes de actualizar: copiar `/data/resu.sqlite`
(con el contenedor detenido, o `sqlite3 .backup`) y `/data/uploads/`.
