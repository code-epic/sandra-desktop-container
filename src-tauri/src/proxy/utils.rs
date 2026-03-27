use tauri::http::{header::CONTENT_TYPE, Response};

pub fn create_response(status: u16, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, content_type)
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
        .unwrap()
}

pub fn create_error_response(status: u16, msg: &str) -> Response<Vec<u8>> {
    create_response(status, "text/plain", msg.to_string().into_bytes())
}
