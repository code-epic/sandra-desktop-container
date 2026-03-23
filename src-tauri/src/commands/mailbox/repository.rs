use rusqlite::{Connection, Result, OptionalExtension};
use super::types::*;

pub struct MailboxRepository<'a> {
    pub conn: &'a Connection,
}

impl<'a> MailboxRepository<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn get_all_messages(&self) -> Result<Vec<MailboxMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, sid, content, author, status, tracking_info, responsible, created_at, updated_at, is_read, direction \
             FROM security_mailbox ORDER BY created_at DESC"
        )?;

        let messages = stmt.query_map([], |row| {
            Ok(MailboxMessage {
                id: row.get(0)?,
                sid: row.get(1)?,
                content: row.get(2)?,
                author: row.get(3)?,
                status: row.get(4)?,
                tracking_info: row.get(5)?,
                responsible: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                is_read: row.get(9)?,
                direction: row.get(10).unwrap_or(Some("inbox".to_string())),
                attachments: {
                    let info: Option<String> = row.get(5)?;
                    if let Some(json_str) = info {
                        serde_json::from_str(&json_str).unwrap_or(None)
                    } else {
                        None
                    }
                },
            })
        })?.collect::<Result<Vec<_>>>()?;

        Ok(messages)
    }

    pub fn message_exists(&self, sid: &str) -> Result<bool> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(1) FROM security_mailbox WHERE sid = ?1",
            [sid],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn insert_message(
        &self,
        sid: Option<String>,
        content: Option<String>,
        author: Option<String>,
        status: &str,
        direction: &str,
        responsible: Option<String>,
        tracking_info: Option<String>,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO security_mailbox (sid, content, author, status, direction, responsible, tracking_info) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (sid, content, author, status, direction, responsible, tracking_info),
        )?;
        Ok(())
    }

    pub fn update_status(&self, id: i64, status: &str, tracking_info: Option<String>) -> Result<()> {
        self.conn.execute(
            "UPDATE security_mailbox SET status = ?1, tracking_info = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
            (status, tracking_info, id),
        )?;
        Ok(())
    }

    pub fn delete_message(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM security_mailbox WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn get_sync_cursor(&self) -> String {
        self.conn.query_row(
            "SELECT value FROM sync_metadata WHERE key = 'last_mailbox_sync'",
            [],
            |row| row.get::<_, String>(0),
        ).unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
    }

    pub fn update_sync_cursor(&self, cursor: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('last_mailbox_sync', ?1)",
            [cursor],
        )?;
        Ok(())
    }

    pub fn get_or_create_device_secret(&self) -> Result<String> {
        let secret: Option<String> = self.conn.query_row(
            "SELECT value FROM sync_metadata WHERE key = 'device_secret'",
            [],
            |row| row.get(0),
        ).optional()?;

        if let Some(s) = secret {
            Ok(s)
        } else {
            use rand::RngCore;
            let mut key = [0u8; 32];
            rand::rng().fill_bytes(&mut key);
            let hex_secret = hex::encode(key);
            
            self.conn.execute(
                "INSERT INTO sync_metadata (key, value) VALUES ('device_secret', ?1)",
                [&hex_secret],
            )?;
            Ok(hex_secret)
        }
    }
}
