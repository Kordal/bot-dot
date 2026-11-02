//! Where a page in the window may go. `home` is the signed-in botdot's address.

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

fn same_site(home: &Url, url: &Url) -> bool {
    home.origin() == url.origin()
}

/// The page goes to `/sign-in` when its session is over (a `401` with `signIn`, a sign-out), and only then: the
/// front door sends a signed-in browser there no other way.
pub fn session_over(home: &Url, to: &Url) -> bool {
    same_site(home, to) && to.path() == "/sign-in"
}

/// A link that left the front door in the window itself. Frames of other sites are no reason: this looks at what
/// the whole window shows, which is why it is asked when a page has started and not before it (wry's navigation
/// handler can't tell a frame from the window).
pub fn left_home(home: &Url, shown: &Url) -> bool {
    web(shown) && !same_site(home, shown)
}

/// What a link that opens a new window does. Nothing for `about:blank`: the page falls back to its own window,
/// where `left_home` sends the link to the browser.
pub fn new_window(home: &Url, to: &Url) -> Window {
    if web(to) && same_site(home, to) {
        Window::OfTheApp
    } else if web(to) || to.scheme() == "mailto" {
        Window::Browser
    } else {
        Window::Nothing
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn the_sign_in_page_of_this_botdot_ends_the_session() {
        let home = url("https://botdot.example.com/");
        assert!(session_over(&home, &url("https://botdot.example.com/sign-in")));
        assert!(session_over(&home, &url("https://botdot.example.com/sign-in#rooms/join=x")));
        assert!(!session_over(&home, &url("https://botdot.example.com/sign-in/options")));
        assert!(!session_over(&home, &url("https://botdot.example.com/")));
        assert!(!session_over(&home, &url("https://other.example.com/sign-in")));
    }

    #[test]
    fn only_the_web_outside_this_botdot_has_left_it() {
        let home = url("http://localhost:3000/");
        assert!(left_home(&home, &url("https://example.com/")));
        assert!(left_home(&home, &url("http://localhost:4000/")));
        assert!(!left_home(&home, &url("http://localhost:3000/chat")));
        assert!(!left_home(&home, &url("tauri://localhost/index.html")));
        assert!(!left_home(&home, &url("about:blank")));
    }

    #[test]
    fn a_new_window_of_this_botdot_stays_and_others_go_to_the_browser() {
        let home = url("https://botdot.example.com/");
        assert_eq!(new_window(&home, &url("https://botdot.example.com/api/files/a.pdf")), Window::OfTheApp);
        assert_eq!(new_window(&home, &url("https://example.com/")), Window::Browser);
        assert_eq!(new_window(&home, &url("mailto:a@example.com")), Window::Browser);
        assert_eq!(new_window(&home, &url("about:blank")), Window::Nothing);
        assert_eq!(new_window(&home, &url("file:///etc/passwd")), Window::Nothing);
    }
}
