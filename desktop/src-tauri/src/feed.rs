//! The account's live feed (docs/api.md, "The live feed"), followed with the app's session for its notifications
//! (ADR 138). The server decides what rings and says it as `notification`, and its end as `notification_closed`: the
//! app follows no rule of its own about what rings.

use serde::Deserialize;
use std::io::{BufRead, BufReader};
use std::time::{Duration, SystemTime};
use tauri::Url;
use ureq::tls::{RootCerts, TlsConfig};

/// A notification as the server says it, the same as its push.
#[derive(Deserialize, Debug, PartialEq, Clone)]
pub struct Notice {
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub target: String,
    pub tag: String,
}

#[derive(Debug, PartialEq)]
pub enum Said {
    Notification(Notice),
    Closed(String),
}

/// What an event of the feed says to the app; nothing for every other event.
pub fn said(kind: &str, data: &str) -> Option<Said> {
    match kind {
        "notification" => serde_json::from_str::<Notice>(data).ok().filter(|n| !n.tag.is_empty() && !n.target.is_empty()).map(Said::Notification),
        "notification_closed" => {
            #[derive(Deserialize)]
            struct Closed {
                tag: String,
            }
            serde_json::from_str::<Closed>(data).ok().map(|c| c.tag).filter(|t| !t.is_empty()).map(Said::Closed)
        }
        _ => None,
    }
}

/// Server-Sent Events, a line at a time: an event once its blank line arrives, as `(id, type, data)`.
#[derive(Default)]
pub struct Lines {
    id: Option<String>,
    kind: String,
    data: Vec<String>,
}

impl Lines {
    pub fn line(&mut self, line: &str) -> Option<(Option<String>, String, String)> {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            let kind = std::mem::take(&mut self.kind);
            let data = std::mem::take(&mut self.data).join("\n");
            let id = self.id.take();
            return if kind.is_empty() && data.is_empty() { None } else { Some((id, if kind.is_empty() { "message".into() } else { kind }, data)) };
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = line.split_once(':').map(|(f, v)| (f, v.strip_prefix(' ').unwrap_or(v))).unwrap_or((line, ""));
        match field {
            "event" => self.kind = value.to_string(),
            "data" => self.data.push(value.to_string()),
            "id" => self.id = Some(value.to_string()),
            _ => {}
        }
        None
    }
}

/// The name and value of the session's `Set-Cookie`, for a `Cookie` header.
pub fn cookie_of(set_cookie: &str) -> &str {
    set_cookie.split(';').next().unwrap_or_default().trim()
}

/// A connection that ended this recently goes on where it stopped (`since`). Any later one starts from now, so what
/// rang while the computer slept or was offline doesn't ring late. Wall-clock time: on the Mac `Instant` stands still
/// while the computer sleeps.
const RESUME: Duration = Duration::from_secs(15);

pub fn resume_from(last: Option<&(String, SystemTime)>, now: SystemTime) -> Option<String> {
    let (id, ended) = last?;
    (now.duration_since(*ended).unwrap_or(Duration::MAX) < RESUME).then(|| id.clone())
}

pub enum Ended {
    /// `401`: the session is over. The page in the window finds out too, and goes to `/sign-in`.
    SignedOut,
    /// Lost, or the server stopped it; `heard` whether anything came first.
    Lost { heard: bool },
}

// A ping comes every 20 seconds: a read that waits longer than this is a connection that is gone, as it is after sleep.
fn client() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        .timeout_per_read(Some(Duration::from_secs(50)))
        .tls_config(TlsConfig::builder().root_certs(RootCerts::PlatformVerifier).build())
        .build()
        .into()
}

/// One connection to the feed, until it ends or `alive` says the session it is for has ended.
pub fn stream(address: &Url, cookie: &str, since: Option<&str>, last: &mut Option<String>, alive: &dyn Fn() -> bool, on: &dyn Fn(Said)) -> Ended {
    let mut url = address.join("/api/events").expect("a path");
    if let Some(since) = since {
        url.query_pairs_mut().append_pair("since", since);
    }
    let Ok(mut answer) = client().get(url.as_str()).header("Cookie", cookie).header("Accept", "text/event-stream").call() else {
        return Ended::Lost { heard: false };
    };
    if answer.status() == 401 {
        return Ended::SignedOut;
    }
    if answer.status() != 200 {
        return Ended::Lost { heard: false };
    }
    let mut lines = Lines::default();
    let mut heard = false;
    for line in BufReader::new(answer.body_mut().as_reader()).lines() {
        let Ok(line) = line else { break };
        if !alive() {
            break;
        }
        heard = true;
        let Some((id, kind, data)) = lines.line(&line) else { continue };
        if id.is_some() {
            *last = id;
        }
        if let Some(said) = said(&kind, &data) {
            on(said);
        }
    }
    Ended::Lost { heard }
}

/// Follows the feed on a thread of its own while `alive`, connecting again after a loss: at once when the connection
/// had worked, and otherwise later each time, up to a minute.
pub fn follow(address: Url, cookie: String, alive: impl Fn() -> bool + Send + 'static, on: impl Fn(Said) + Send + 'static) {
    std::thread::spawn(move || {
        let mut last: Option<(String, SystemTime)> = None;
        let mut wait = Duration::from_secs(1);
        while alive() {
            let since = resume_from(last.as_ref(), SystemTime::now());
            let mut id = since.clone();
            match stream(&address, &cookie, since.as_deref(), &mut id, &alive, &on) {
                Ended::SignedOut => return,
                Ended::Lost { heard } => wait = if heard { Duration::from_secs(1) } else { (wait * 2).min(Duration::from_secs(60)) },
            }
            last = id.map(|id| (id, SystemTime::now()));
            std::thread::sleep(wait);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    fn events(text: &str) -> Vec<(Option<String>, String, String)> {
        let mut lines = Lines::default();
        text.split('\n').filter_map(|l| lines.line(l)).collect()
    }

    #[test]
    fn the_feed_is_read_as_its_events_and_a_ping_is_nothing() {
        let got = events("retry: 5000\n\nevent: hello\ndata: {\"a\":1}\n\n: ping\n\nid: k1.2\r\nevent: notification\r\ndata: {}\r\n\r\ndata: one\ndata: two\n\n");
        assert_eq!(
            got,
            vec![
                (None, "hello".into(), "{\"a\":1}".into()),
                (Some("k1.2".into()), "notification".into(), "{}".into()),
                (None, "message".into(), "one\ntwo".into()),
            ]
        );
    }

    #[test]
    fn only_the_servers_notifications_and_their_ends_ring() {
        let n = said("notification", r#"{"title":"Scout","body":"Two flats found.","target":"bot:b1","tag":"bot:b1","at":"2026-11-02T10:00:00Z"}"#);
        assert_eq!(n, Some(Said::Notification(Notice { title: "Scout".into(), body: "Two flats found.".into(), target: "bot:b1".into(), tag: "bot:b1".into() })));
        assert_eq!(said("notification_closed", r#"{"tag":"job:b1/j1"}"#), Some(Said::Closed("job:b1/j1".into())));
        // The events it was made from ring nothing here: the server already said whether they do.
        for kind in ["run_finished", "chief_reply", "approvals", "asks", "room_notice", "claude", "unread", "hello"] {
            assert_eq!(said(kind, r#"{"new":true,"title":"x","target":"bot:b1","tag":"bot:b1"}"#), None, "{kind}");
        }
        assert_eq!(said("notification", r#"{"title":"x","target":"","tag":"t"}"#), None);
        assert_eq!(said("notification", "not json"), None);
        assert_eq!(said("notification_closed", r#"{"tag":""}"#), None);
    }

    #[test]
    fn the_cookie_header_is_the_sessions_name_and_value() {
        assert_eq!(cookie_of("botdot_session=s3; Path=/; HttpOnly; Secure"), "botdot_session=s3");
        assert_eq!(cookie_of("botdot_session=s3"), "botdot_session=s3");
    }

    #[test]
    fn a_short_loss_goes_on_where_it_stopped_and_a_long_one_starts_from_now() {
        let ended = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let last = ("k1.9".to_string(), ended);
        assert_eq!(resume_from(Some(&last), ended + Duration::from_secs(2)), Some("k1.9".into()));
        assert_eq!(resume_from(Some(&last), ended + Duration::from_secs(3600)), None, "after sleep: nothing old rings");
        assert_eq!(resume_from(Some(&last), ended - Duration::from_secs(5)), None, "a clock set back");
        assert_eq!(resume_from(None, ended), None);
    }

    // A front door that answers one request with `answer`, and what it was asked.
    fn door(answer: &'static str) -> (Url, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
        let asked = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut seen = Vec::new();
            let mut chunk = [0u8; 4096];
            while !String::from_utf8_lossy(&seen).contains("\r\n\r\n") {
                let n = socket.read(&mut chunk).unwrap();
                seen.extend_from_slice(&chunk[..n]);
            }
            socket.write_all(answer.as_bytes()).unwrap();
            String::from_utf8_lossy(&seen).into_owned()
        });
        (address, asked)
    }

    #[test]
    fn the_feed_is_asked_with_the_session_and_says_what_rings() {
        let (address, asked) = door("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\nevent: hello\ndata: {}\n\nid: k1.4\nevent: run_finished\ndata: {\"new\":true}\n\nid: k1.5\nevent: notification\ndata: {\"title\":\"Scout\",\"body\":\"Hi\",\"target\":\"bot:b1\",\"tag\":\"bot:b1\"}\n\nid: k1.6\nevent: notification_closed\ndata: {\"tag\":\"bot:b1\"}\n\n");
        let heard = Arc::new(Mutex::new(Vec::new()));
        let keep = heard.clone();
        let mut last = None;
        let ended = stream(&address, "botdot_session=s3", Some("k1.3"), &mut last, &|| true, &move |s| keep.lock().unwrap().push(s));
        assert!(matches!(ended, Ended::Lost { heard: true }));
        assert_eq!(last.as_deref(), Some("k1.6"));
        let heard = heard.lock().unwrap();
        assert_eq!(heard.len(), 2);
        assert!(matches!(&heard[0], Said::Notification(n) if n.target == "bot:b1"));
        assert_eq!(heard[1], Said::Closed("bot:b1".into()));
        let asked = asked.join().unwrap().to_lowercase();
        assert!(asked.starts_with("get /api/events?since=k1.3 "), "{asked}");
        assert!(asked.contains("cookie: botdot_session=s3"));
    }

    #[test]
    fn a_session_that_is_over_stops_the_feed() {
        let (address, asked) = door("HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
        assert!(matches!(stream(&address, "c=1", None, &mut None, &|| true, &|_| {}), Ended::SignedOut));
        assert!(asked.join().unwrap().starts_with("GET /api/events HTTP"));
    }
}
