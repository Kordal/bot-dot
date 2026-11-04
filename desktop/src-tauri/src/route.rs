//! Where a page in the window may go. `door` is the address of the front door it is signed in to.

use tauri::Url;

#[derive(PartialEq, Debug)]
pub enum Window {
    /// The front door's own: it opens in a window of the app, which shares the session.
    OfTheApp,
    Browser,
    Nothing,
}

fn web(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "http")
}

fn same_origin(door: &Url, url: &Url) -> bool {
    door.origin() == url.origin()
}

/// The page goes to `/sign-in` when its session is over (a `401` with `signIn`, a sign-out). Asked of what a whole
/// window shows, never before a page starts: wry's navigation handler can't tell a frame from the window, and a bot's
/// page in a frame must not end the session.
pub fn session_over(door: &Url, shown: &Url) -> bool {
    same_origin(door, shown) && shown.path() == "/sign-in"
}

/// A link that left the front door in the window itself. Asked as `session_over` is, so frames of other sites stay.
/// The app's own screen is on `http://tauri.localhost` on Windows.
pub fn left_door(door: &Url, shown: &Url) -> bool {
    web(shown) && !same_origin(door, shown) && shown.host_str() != Some("tauri.localhost")
}

/// What a link that opens a new window does. `about:blank` is a window too: the page opens one and then gives it an
/// address, and `left_door` closes it if that is another site.
pub fn new_window(door: &Url, to: &Url) -> Window {
    if to.as_str() == "about:blank" || (web(to) && same_origin(door, to)) {
        Window::OfTheApp
    } else if web(to) || to.scheme() == "mailto" {
        Window::Browser
    } else {
        Window::Nothing
    }
}

/// On iOS a page can't open a window of its own: wry has no new windows there. A link that would open one, or
/// `window.open` with an address, goes in this window instead, where `left_door` sends another site to Safari.
/// `window.open('about:blank')` gives `null`, and the page's own code then goes itself. Only the window's own page,
/// not its frames. A desktop opens windows (`new_window`) and needs nothing.
#[cfg(mobile)]
pub const NEW_WINDOWS_IN_PLACE: &str = r#"(() => {
  const go = (to) => {
    try {
      const url = new URL(to, location.href);
      if (url.protocol === 'https:' || url.protocol === 'http:') location.assign(url.href);
    } catch {}
  };
  window.open = (to) => { if (to && String(to) !== 'about:blank') go(String(to)); return null; };
  addEventListener('click', (event) => {
    const link = event.target instanceof Element && event.target.closest('a[target="_blank"]');
    if (!link || !link.href || event.defaultPrevented || link.hasAttribute('download')) return;
    event.preventDefault();
    go(link.href);
  });
})();"#;
#[cfg(desktop)]
pub const NEW_WINDOWS_IN_PLACE: &str = "";

/// Where a notification's target opens on a page loaded for it, as the service worker opens it (`public/sw.js`).
pub fn fragment_of(target: &str) -> String {
    let id_ok = |id: &str| !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
    match target.split_once(':') {
        Some((kind @ ("bot" | "chief" | "group"), id)) if id_ok(id) => format!("{kind}/{id}"),
        Some(("room", id)) if id_ok(id) => format!("rooms/{id}"),
        _ if target == "needs" => "needs".into(),
        _ => "chief".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_target_opens_where_a_push_opens_it() {
        assert_eq!(fragment_of("bot:b1"), "bot/b1");
        assert_eq!(fragment_of("chief:c-2"), "chief/c-2");
        assert_eq!(fragment_of("group:g.1"), "group/g.1");
        assert_eq!(fragment_of("room:r1"), "rooms/r1");
        assert_eq!(fragment_of("needs"), "needs");
        assert_eq!(fragment_of("app"), "chief");
        assert_eq!(fragment_of("bot:a/b"), "chief");
        assert_eq!(fragment_of("bot:"), "chief");
    }

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn the_sign_in_page_of_this_botdot_ends_the_session() {
        let door = url("https://botdot.example.com/");
        assert!(session_over(&door, &url("https://botdot.example.com/sign-in")));
        assert!(session_over(&door, &url("https://botdot.example.com/sign-in#rooms/join=x")));
        assert!(!session_over(&door, &url("https://botdot.example.com/sign-in/options")));
        assert!(!session_over(&door, &url("https://botdot.example.com/")));
        assert!(!session_over(&door, &url("https://other.example.com/sign-in")));
    }

    #[test]
    fn only_the_web_outside_this_front_door_has_left_it() {
        let door = url("http://localhost:3000/");
        assert!(left_door(&door, &url("https://example.com/")));
        assert!(left_door(&door, &url("http://localhost:4000/")));
        assert!(!left_door(&door, &url("http://localhost:3000/chat")));
        assert!(!left_door(&door, &url("tauri://localhost/index.html")));
        assert!(!left_door(&door, &url("about:blank")));
    }

    #[test]
    fn a_new_window_of_this_botdot_stays_and_others_go_to_the_browser() {
        let door = url("https://botdot.example.com/");
        assert_eq!(new_window(&door, &url("https://botdot.example.com/api/files/a.pdf")), Window::OfTheApp);
        assert_eq!(new_window(&door, &url("https://example.com/")), Window::Browser);
        assert_eq!(new_window(&door, &url("mailto:a@example.com")), Window::Browser);
        assert_eq!(new_window(&door, &url("about:blank")), Window::OfTheApp);
        assert_eq!(new_window(&door, &url("file:///etc/passwd")), Window::Nothing);
    }
}
