use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
pub struct ExternalProxyState {
    pub last_app_id: Option<String>,
    pub targets: HashMap<String, String>,
}

pub static PROXY_STATE: Mutex<Option<ExternalProxyState>> = Mutex::new(None);
