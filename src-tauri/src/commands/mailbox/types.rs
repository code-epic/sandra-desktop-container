use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct MailboxMessage {
    pub id: i64,
    pub sid: Option<String>,
    pub content: Option<String>,
    pub author: Option<String>,
    pub status: Option<String>,
    pub tracking_info: Option<String>,
    pub responsible: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub is_read: bool,
    pub direction: Option<String>,
    pub attachments: Option<Vec<Attachment>>,
    pub user_login: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Attachment {
    pub name: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatHistoryItem {
    pub id: Option<i32>,
    pub text: String,
    pub sender: String,
    pub sender_name: Option<String>,
    pub timestamp: String,
    pub session_id: Option<String>,
    pub user_login: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncResponseItem {
    pub guid: String,
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct IngestReport {
    pub total: usize,
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}
