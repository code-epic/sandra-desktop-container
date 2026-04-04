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

    // 3. Crear Tablas
    init_tables(&conn)?;

    // 4. Seed Data
    seed_db(&conn)?;

    Ok(conn)
}

pub fn init_tables(conn: &Connection) -> Result<(), String> {
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

    // 3a. Crear Connections SI NO EXISTE (Con schema actualizado)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            ip_address TEXT NOT NULL,
            port INTEGER NOT NULL,
            username TEXT,
            password TEXT,
            wss_host TEXT,
            wss_port INTEGER,
            is_connected BOOLEAN DEFAULT 0,
            last_connected DATETIME,
            jwt TEXT,
            hash CHAR(32)
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Migración silenciosa: Intentar añadir columna details si no existe
    let _ = conn.execute("ALTER TABLE app_logs ADD COLUMN details TEXT", []);
    // Migración silenciosa: Añadir columna source si no existe
    let _ = conn.execute("ALTER TABLE app_logs ADD COLUMN source TEXT", []);

    // Migración silenciosa: Añadir soporte para WSS Custom (Para DBs antiguas)
    let _ = conn.execute("ALTER TABLE connections ADD COLUMN wss_host TEXT", []);
    let _ = conn.execute("ALTER TABLE connections ADD COLUMN wss_port INTEGER", []);
    let _ = conn.execute("ALTER TABLE connections ADD COLUMN jwt TEXT", []);
    let _ = conn.execute("ALTER TABLE connections ADD COLUMN hash CHAR(32)", []);

    // Migración silenciosa: Estado de conexión activo (Para DBs antiguas)
    let _ = conn.execute(
        "ALTER TABLE connections ADD COLUMN is_connected BOOLEAN DEFAULT 0",
        [],
    );

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
    let _ = conn.execute(
        "ALTER TABLE desktop_apps ADD COLUMN is_proxy_required BOOLEAN DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE desktop_apps ADD COLUMN is_external_browser BOOLEAN DEFAULT 0",
        [],
    );

    // Tabla Historial de Documentos Seguros
    conn.execute(
        "CREATE TABLE IF NOT EXISTS document_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_size TEXT,
            remote_code TEXT,
            source TEXT DEFAULT 'GLOBAL',
            file_hash TEXT,
            group_name TEXT,
            opened_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    let _ = conn.execute("ALTER TABLE document_history ADD COLUMN file_size TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE document_history ADD COLUMN remote_code TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE document_history ADD COLUMN source TEXT DEFAULT 'GLOBAL'",
        [],
    );
    let _ = conn.execute("ALTER TABLE document_history ADD COLUMN file_hash TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE document_history ADD COLUMN group_name TEXT",
        [],
    );

    // Security Mailbox Table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS security_mailbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sid TEXT,
            content TEXT,
            author TEXT,
            status TEXT DEFAULT 'Pending', -- Pending, Read, Approved, Rejected
            tracking_info TEXT,
            responsible TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_read BOOLEAN DEFAULT 0
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Migración silenciosa: Añadir campo direction (inbox/outbox)
    let _ = conn.execute(
        "ALTER TABLE security_mailbox ADD COLUMN direction TEXT DEFAULT 'inbox'",
        [],
    );

    // Índice para búsquedas rápidas por SID (Tracking)
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_security_mailbox_sid ON security_mailbox(sid)",
        [],
    );

    // Tabla de Metadatos de Sincronización
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sync_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Security Config Table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS security_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            password_format_regex TEXT,
            reporting_level TEXT,
            audit_level TEXT,
            cache_enabled BOOLEAN DEFAULT 1
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Security Proxy Routes Table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS security_proxy_routes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_path TEXT NOT NULL UNIQUE,
            target_database TEXT,
            code TEXT,
            description TEXT,
            is_active BOOLEAN DEFAULT 1
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Sembrar valores por defecto para la identidad del equipo si no existen
    let _ = conn.execute(
        "INSERT OR IGNORE INTO config (key, value) VALUES ('setup_done', '0')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO config (key, value) VALUES ('machine_name', '')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO config (key, value) VALUES ('machine_description', '')",
        [],
    );
    conn.execute(
        "CREATE TABLE IF NOT EXISTS high_security (
            auth_id TEXT PRIMARY KEY,
            key TEXT NOT NULL,
            user TEXT,
            tiempo DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS authorization_tickets (
            auth_id TEXT PRIMARY KEY,
            payload TEXT,
            content TEXT,
            status TEXT DEFAULT 'pendiente', -- pendiente, en proceso, procesado, notificado
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Chat History Table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            sender TEXT NOT NULL, -- 'user' | 'sandra'
            sender_name TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            session_id TEXT -- Para agrupar conversaciones
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn seed_db(conn: &Connection) -> Result<(), String> {
    // Seed Data (if empty)
    let count: i32 = conn
        .query_row("SELECT COUNT(*) FROM desktop_apps", [], |row| row.get(0))
        .unwrap_or(0);

    if count == 0 {
        conn.execute_batch("
            INSERT INTO desktop_apps (app_id, name, icon, external_url, is_installed) VALUES
                ('sandra-consola', 'Consola Sandra', 'fas fa-laptop-code', 'https://code-epic.com/consola/', 1);
        ").map_err(|e| e.to_string())?;
    }
    Ok(())
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
