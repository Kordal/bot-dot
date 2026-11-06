//! The botdot address a person types.

use tauri::Url;

/// The origin of what was typed: `https` unless it says otherwise, and `http` only on this computer, since a passkey
/// needs a secure page and the session's cookie must not cross a network in the clear (ADR 137). A phone runs no
/// botdot, so on iOS it is `https` only (ADR 151).
pub fn parse(text: &str) -> Option<Url> {
    let text = text.trim();
    let with_scheme = if text.contains("://") { text.to_string() } else { format!("https://{text}") };
    let url = Url::parse(&with_scheme).ok()?;
    let loopback = cfg!(desktop) && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    let allowed = url.scheme() == "https" || (url.scheme() == "http" && loopback);
    if !allowed || !url.has_host() || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    Url::parse(&url.origin().ascii_serialization()).ok()
}

#[cfg(test)]
mod tests {
    use super::parse;

    fn shown(text: &str) -> Option<String> {
        parse(text).map(|u| u.to_string())
    }

    #[test]
    fn a_name_alone_is_https_and_only_the_origin_stays() {
        assert_eq!(shown("  botdot.example.com "), Some("https://botdot.example.com/".into()));
        assert_eq!(shown("https://botdot.example.com/sign-in?x=1"), Some("https://botdot.example.com/".into()));
        assert_eq!(shown("https://botdot.example.com:8443"), Some("https://botdot.example.com:8443/".into()));
    }

    #[test]
    fn http_is_for_this_computer_only() {
        assert_eq!(shown("http://localhost:3000"), Some("http://localhost:3000/".into()));
        assert_eq!(shown("http://127.0.0.1:3000/"), Some("http://127.0.0.1:3000/".into()));
        assert_eq!(shown("http://[::1]:3000"), Some("http://[::1]:3000/".into()));
        assert_eq!(shown("http://botdot.example.com"), None);
    }

    #[test]
    fn what_is_no_address_is_refused() {
        for text in ["", "   ", "ftp://botdot.example.com", "https://me:pw@botdot.example.com", "botdot://signed-in", "not an address"] {
            assert_eq!(shown(text), None, "{text}");
        }
    }
}
