use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct NetworkEventPayload {
    pub app_id: String,
    pub log_type: String, // "FETCH", "XHR", etc.
    pub message: String,
    pub details: NetworkEventDetails,
}

#[derive(Serialize, Clone)]
pub struct NetworkEventDetails {
    pub url: String,
    pub method: String,
    pub status: u16,
    pub request_headers: HashMap<String, String>,
    pub response_body: String,
    pub source: String,
}

pub fn emit_network_log(app_handle: &AppHandle, payload: NetworkEventPayload) {
    let _ = app_handle.emit("app:log_network", payload);
}
