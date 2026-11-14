//! The front door's browser hand-off (docs/api.md): the secret, the page, and the code that comes back.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD as BASE64, Engine};
use sha2::{Digest, Sha256};
use tauri::Url;
use ureq::tls::{RootCerts, TlsConfig};

/// The app the front door makes the session for (docs/api.md).
const APP: &str = "desktop";

/// Forgotten once its code has brought a session.
#[derive(Clone)]
pub struct Secret {
    pub verifier: String,
}

impl Secret {
    pub fn new() -> Self {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).expect("the system's random numbers");
        Self { verifier: BASE64.encode(bytes) }
    }

    fn challenge(&self) -> String {
        BASE64.encode(Sha256::digest(self.verifier.as_bytes()))
    }

    pub fn page(&self, address: &Url) -> Url {
        self.on(address.join("/sign-in").expect("a path"))
    }

    /// A page of the hand-off: the sign-in, or the sign-up that makes a local botdot's one account (ADR 136).
    pub fn on(&self, mut page: Url) -> Url {
        page.query_pairs_mut().append_pair("app", APP).append_pair("handoff", &self.challenge());
        page
    }
}

/// The code of `botdot://signed-in?code=…`.
pub fn code_of(link: &Url) -> Option<String> {
    if link.scheme() != "botdot" || link.host_str() != Some("signed-in") {
        return None;
    }
    link.query_pairs().find(|(k, _)| k == "code").map(|(_, v)| v.into_owned()).filter(|c| !c.is_empty())
}

// The system's certificates: a front door with its own certificate authority (BOT_DOT_TLS=internal) is trusted as the
// window trusts it.
fn client() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(std::time::Duration::from_secs(15)))
        .tls_config(TlsConfig::builder().root_certs(RootCerts::PlatformVerifier).build())
        .build()
        .into()
}

/// Whether a front door answers at this address.
pub fn reachable(address: &Url) -> bool {
    let page = address.join("/sign-in").expect("a path");
    client().get(page.as_str()).call().is_ok_and(|answer| answer.status() == 200)
}

/// The session's `Set-Cookie`, for the code and the secret that belongs to it.
pub fn take_session(address: &Url, code: &str, secret: &Secret) -> Option<String> {
    let url = address.join("/sign-in/handoff").expect("a path");
    let answer = client()
        .post(url.as_str())
        .header("X-Bot-Dot", "1")
        .content_type("application/json")
        .send(serde_json::json!({ "code": code, "verifier": secret.verifier }).to_string())
        .ok()?;
    if answer.status() != 200 {
        return None;
    }
    answer.headers().get("set-cookie")?.to_str().ok().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    // A front door that answers one request, and what it was asked.
    fn door(answer: &'static str) -> (Url, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
        let asked = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut seen = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let n = socket.read(&mut chunk).unwrap();
                seen.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&seen);
                if let Some((head, body)) = text.split_once("\r\n\r\n") {
                    let length = head.lines().find_map(|l| l.to_lowercase().strip_prefix("content-length: ")?.parse::<usize>().ok()).unwrap_or(0);
                    if body.len() >= length {
                        break;
                    }
                }
            }
            socket.write_all(answer.as_bytes()).unwrap();
            String::from_utf8_lossy(&seen).into_owned()
        });
        (address, asked)
    }

    #[test]
    fn the_page_carries_the_secrets_hash_and_never_the_secret() {
        let secret = Secret::new();
        assert_eq!(secret.verifier.len(), 43);
        let page = secret.page(&Url::parse("https://botdot.example.com").unwrap());
        assert_eq!(page.path(), "/sign-in");
        let asked: Vec<_> = page.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        assert_eq!(asked[0], ("app".to_string(), "desktop".to_string()));
        assert_eq!(asked[1].0, "handoff");
        assert_eq!(asked[1].1.len(), 43);
        assert!(!page.as_str().contains(&secret.verifier));
    }

    #[test]
    fn the_challenge_is_the_base64url_sha256_the_front_door_checks() {
        let secret = Secret { verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into() };
        assert_eq!(secret.challenge(), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn only_the_signed_in_link_gives_a_code() {
        let code = |text: &str| code_of(&Url::parse(text).unwrap());
        assert_eq!(code("botdot://signed-in?code=abc"), Some("abc".into()));
        assert_eq!(code("botdot://signed-in?code="), None);
        assert_eq!(code("botdot://signed-in"), None);
        assert_eq!(code("botdot://other?code=abc"), None);
        assert_eq!(code("https://signed-in/?code=abc"), None);
    }

    #[test]
    fn a_code_and_its_secret_bring_the_sessions_cookie() {
        let (address, asked) = door("HTTP/1.1 200 OK\r\nSet-Cookie: botdot_session=s3; Path=/; HttpOnly\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
        let cookie = take_session(&address, "the-code", &Secret { verifier: "the-secret".into() });
        assert_eq!(cookie.as_deref(), Some("botdot_session=s3; Path=/; HttpOnly"));
        let asked = asked.join().unwrap().to_lowercase();
        assert!(asked.starts_with("post /sign-in/handoff "));
        assert!(asked.contains("x-bot-dot: 1"));
        assert!(asked.contains(r#""code":"the-code""#) && asked.contains(r#""verifier":"the-secret""#));
    }

    #[test]
    fn a_refused_hand_off_brings_nothing() {
        let (address, asked) = door("HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
        assert_eq!(take_session(&address, "c", &Secret::new()), None);
        asked.join().unwrap();
    }

    #[test]
    fn an_address_with_no_front_door_is_not_reachable() {
        let (address, asked) = door("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        assert!(!reachable(&address));
        asked.join().unwrap();
        let (address, asked) = door("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        assert!(reachable(&address));
        asked.join().unwrap();
    }
}
