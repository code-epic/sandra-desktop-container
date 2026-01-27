use rusqlite::{Connection, Result};
use std::fs;
use tauri::AppHandle;
use tauri::Manager;

pub struct DbState(pub std::sync::Mutex<Connection>);

pub fn initialize_db(app: &AppHandle) -> Result<Connection, String> {
    // 1. Obtener la ruta de datos del sistema (Standard de seguridad)
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // Crear la carpeta si no existe
    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

    let db_path = app_dir.join("sdc_secure_core.db");

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    // 2. Configuración de alto rendimiento para SRE (Modo WAL)
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
    ",
    )
    .map_err(|e| e.to_string())?;

    // 3. Crear Tablas de Auditoría e Infraestructura
    conn.execute(
        "CREATE TABLE IF NOT EXISTS system_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            description TEXT,
            metadata TEXT, -- Aquí guardaremos JSON de las IPs o estado de disco
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_id TEXT NOT NULL,       -- ID de la app (ej: 'gdoc')
            log_type TEXT NOT NULL,     -- 'LOG', 'ERROR', 'FETCH'
            message TEXT NOT NULL,      -- El contenido del log o la URL del fetch
            details TEXT,               -- JSON estructurado
            source TEXT,                -- Origen del log (ej: 'Console', 'Network')
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Migración silenciosa: Intentar añadir columna details si no existe
    let _ = conn.execute("ALTER TABLE app_logs ADD COLUMN details TEXT", []);
    // Migración silenciosa: Añadir columna source si no existe
    let _ = conn.execute("ALTER TABLE app_logs ADD COLUMN source TEXT", []);

    // Migración silenciosa: Añadir soporte para WSS Custom
    let _ = conn.execute("ALTER TABLE connections ADD COLUMN wss_host TEXT", []);
    let _ = conn.execute("ALTER TABLE connections ADD COLUMN wss_port INTEGER", []);

    // Migración silenciosa: Estado de conexión activo
    let _ = conn.execute(
        "ALTER TABLE connections ADD COLUMN is_connected BOOLEAN DEFAULT 0",
        [],
    );

    conn.execute(
        "CREATE TABLE IF NOT EXISTS connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            ip_address TEXT NOT NULL,
            port INTEGER NOT NULL,
            username TEXT,
            password TEXT,
            last_connected DATETIME
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS desktop_apps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            icon TEXT,
            repo TEXT,
            external_url TEXT,
            is_installed BOOLEAN DEFAULT 0,
            is_favorite BOOLEAN DEFAULT 0,
            description TEXT,
            username TEXT,
            password TEXT,
            token TEXT
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Migración silenciosa: Nuevos campos para desktop_apps (Descripcion, Auth)
    let _ = conn.execute("ALTER TABLE desktop_apps ADD COLUMN description TEXT", []);
    let _ = conn.execute("ALTER TABLE desktop_apps ADD COLUMN username TEXT", []);
    let _ = conn.execute("ALTER TABLE desktop_apps ADD COLUMN password TEXT", []);
    let _ = conn.execute("ALTER TABLE desktop_apps ADD COLUMN token TEXT", []);

    // Seed Data (if empty)
    let count: i32 = conn
        .query_row("SELECT COUNT(*) FROM desktop_apps", [], |row| row.get(0))
        .unwrap_or(0);

    if count == 0 {
        conn.execute_batch("
            INSERT INTO desktop_apps (app_id, name, icon, repo, is_installed) VALUES 
                ('gdoc', 'Gestión Doc.', 'fas fa-folder-open', 'https://github.com/code-epic/gdoc', 1),
                ('bdv', 'Sicoex', 'fas fa-user-plus', 'https://github.com/code-epic/gdoc.proceedings', 1),
                ('nomina-app', 'Nómina', 'fas fa-file-invoice-dollar', '', 0);

            INSERT INTO desktop_apps (app_id, name, icon, external_url, is_installed) VALUES
                ('google', 'Google', 'fas fa-globe', 'https://google.co.ve', 1),
                ('wikipedia', 'WikiPedia', 'fas fa-laptop-code', 'https://wikipedia.org', 1),
                ('web-panel', 'Panel de Control', 'fas fa-cogs', 'http://localhost:4201', 1),
                ('cmpdivisas', 'Divisas', 'fas fa-file', 'http://localhost:4200/cmpdivisas', 1),
                ('gdoc-local', 'GDoc. Localhost', 'fas fa-folder-open', 'http://localhost:4300', 1);
        ").map_err(|e| e.to_string())?;
    }

    Ok(conn)
}

pub fn recreate_app_logs_table(conn: &rusqlite::Connection) -> Result<(), String> {
    // Elimina la tabla por completo (DROP)
    conn.execute("DROP TABLE IF EXISTS app_logs", [])
        .map_err(|e| e.to_string())?;

    // La recrea con el esquema nuevo
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_id TEXT NOT NULL,
            log_type TEXT NOT NULL,
            message TEXT NOT NULL,
            details TEXT,
            source TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
