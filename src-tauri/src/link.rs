// SPDX-License-Identifier: GPL-3.0-only
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use url::{Host, Url};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedLink {
    /// The link with tracking parameters removed. This is what gets downloaded.
    pub url: String,
    pub platform: String,
    pub removed_trackers: usize,
}

static PATTERNS: Lazy<Vec<(&'static str, Regex)>> = Lazy::new(|| {
    vec![
        (
            "YouTube",
            Regex::new(
                r"https?://(?:www\.|m\.|music\.)?(?:youtube\.com/(?:watch\?[^\s]*v=|shorts/)|youtu\.be/)[\w\-]+[^\s]*",
            )
            .unwrap(),
        ),
        (
            "TikTok",
            Regex::new(r"https?://(?:[\w\-]+\.)?tiktok\.com/[^\s]+").unwrap(),
        ),
        (
            "Instagram",
            Regex::new(r"https?://(?:www\.)?instagram\.com/(?:reel|reels|p|tv)/[^\s]+").unwrap(),
        ),
        (
            "Spotify",
            Regex::new(r"https?://open\.spotify\.com/(?:intl-[a-z]{2}/)?track/[^\s]+").unwrap(),
        ),
    ]
});

const TRACKING_KEYS: &[&str] = &[
    "si",
    "igsh",
    "igshid",
    "fbclid",
    "gclid",
    "feature",
    "pp",
    "ab_channel",
    "is_from_webapp",
    "sender_device",
    "sender_web_id",
    "checksum",
    "tt_from",
    "u_code",
    "_r",
    "_d",
    "_t",
    "context",
    "nd",
    "dlsi",
];

const TRACKING_PREFIXES: &[&str] = &["utm_", "share_"];

/// What every site's links can lose without changing where they lead. The longer list above is for
/// the sites CleanGrab knows: on any other site a short name such as `pp` or `nd` may mean something.
const UNIVERSAL_TRACKERS: &[&str] = &["fbclid", "gclid", "igshid", "igsh"];

fn is_tracker(key: &str, all: bool) -> bool {
    if all {
        TRACKING_KEYS.contains(&key) || TRACKING_PREFIXES.iter().any(|p| key.starts_with(p))
    } else {
        UNIVERSAL_TRACKERS.contains(&key) || key.starts_with("utm_")
    }
}

/// Video sites CleanGrab offers a link for as soon as it is copied, besides YouTube, TikTok, Instagram
/// and Spotify (which get more care): the name shown, and the domains (subdomains included).
const VIDEO_SITES: &[(&str, &[&str])] = &[
    ("Vimeo", &["vimeo.com"]),
    ("Dailymotion", &["dailymotion.com", "dai.ly"]),
    ("X", &["x.com", "twitter.com"]),
    ("Facebook", &["facebook.com", "fb.watch"]),
    ("Reddit", &["reddit.com", "v.redd.it"]),
    ("Twitch", &["twitch.tv"]),
    ("SoundCloud", &["soundcloud.com"]),
    ("Bilibili", &["bilibili.com", "b23.tv"]),
    ("Streamable", &["streamable.com"]),
    ("Pornhub", &["pornhub.com"]),
    ("XVideos", &["xvideos.com"]),
    ("XHamster", &["xhamster.com"]),
    ("RedTube", &["redtube.com"]),
    ("YouPorn", &["youporn.com"]),
];

/// Names that only exist on a local network or on the computer itself.
const LOCAL_SUFFIXES: &[&str] = &[".local", ".localhost", ".internal", ".lan", ".home", ".intranet", ".corp", ".arpa"];

const MAX_LINK_CHARS: usize = 2048;

static WEB_LINK: Lazy<Regex> = Lazy::new(|| Regex::new(r#"https?://[^\s<>"']+"#).unwrap());

/// Strips tracking parameters and returns the cleaned link plus how many
/// parameters were removed.
fn clean(raw: &str, all_trackers: bool) -> (String, usize) {
    let trimmed = raw.trim_end_matches(|c: char| ".,;)>\"'".contains(c));
    let Ok(mut url) = Url::parse(trimmed) else {
        return (trimmed.to_string(), 0);
    };

    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let kept: Vec<&(String, String)> = pairs.iter().filter(|(k, _)| !is_tracker(k, all_trackers)).collect();
    let removed = pairs.len() - kept.len();

    if removed > 0 {
        if kept.is_empty() {
            url.set_query(None);
        } else {
            url.query_pairs_mut()
                .clear()
                .extend_pairs(kept.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        }
    }

    (url.to_string(), removed)
}

/// `domain` or one of its subdomains.
fn host_is(host: &str, domain: &str) -> bool {
    host == domain || host.strip_suffix(domain).is_some_and(|rest| rest.ends_with('.'))
}

/// The name of a video site CleanGrab knows, for a host.
fn video_site_name(host: &str) -> Option<&'static str> {
    VIDEO_SITES.iter().find(|(_, domains)| domains.iter().any(|domain| host_is(host, domain))).map(|(name, _)| *name)
}

/// The first web link in `text` that leads to a site on the internet: http or https, a real domain
/// name (never an IP address, "localhost" or a name from a local network), no login inside it and no
/// unusual port. Returns the link without its tracking parameters, how many were removed, and the host.
fn first_web_link(text: &str, all_trackers: bool) -> Option<(String, usize, String)> {
    let raw = WEB_LINK.find(text.trim())?.as_str();
    let (cleaned, removed) = clean(raw, all_trackers);
    if cleaned.len() > MAX_LINK_CHARS {
        return None;
    }
    let url = Url::parse(&cleaned).ok()?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return None;
    }
    let Some(Host::Domain(domain)) = url.host() else {
        return None;
    };
    let host = domain.trim_end_matches('.').to_ascii_lowercase();
    if host == "localhost" || !host.contains('.') || LOCAL_SUFFIXES.iter().any(|suffix| host.ends_with(suffix)) {
        return None;
    }
    Some((cleaned, removed, host))
}

/// One of the four platforms that get special care (YouTube, TikTok, Instagram, Spotify).
fn platform_link(text: &str) -> Option<DetectedLink> {
    let trimmed = text.trim();
    for (platform, pattern) in PATTERNS.iter() {
        if let Some(found) = pattern.find(trimmed) {
            let (url, removed_trackers) = clean(found.as_str(), true);
            return Some(DetectedLink {
                url,
                platform: platform.to_string(),
                removed_trackers,
            });
        }
    }
    None
}

/// A link to something on one of the other video sites CleanGrab knows (not just its home page).
fn video_site_link(text: &str) -> Option<DetectedLink> {
    let (url, removed_trackers, host) = first_web_link(text, false)?;
    let platform = video_site_name(&host)?;
    if Url::parse(&url).ok()?.path().len() <= 1 {
        return None;
    }
    Some(DetectedLink { url, platform: platform.to_string(), removed_trackers })
}

/// A link to any website: the site's name is shown as the platform. yt-dlp then tries to find a video
/// on the page, and says so when there is none.
fn any_site_link(text: &str) -> Option<DetectedLink> {
    let (url, removed_trackers, host) = first_web_link(text, false)?;
    // Spotify is saved for tracks only (see `PATTERNS`): its other pages hold nothing to save.
    if host_is(&host, "spotify.com") {
        return None;
    }
    let platform = video_site_name(&host).map_or_else(|| host.strip_prefix("www.").unwrap_or(&host).to_string(), str::to_string);
    Some(DetectedLink { url, platform, removed_trackers })
}

/// What the clipboard watcher offers to save by default: a link on YouTube, TikTok, Instagram or
/// Spotify, or on one of the popular video sites in `VIDEO_SITES`.
pub fn detect_known(text: &str) -> Option<DetectedLink> {
    platform_link(text).or_else(|| video_site_link(text))
}

/// The first link in `text` that can be saved: one of the known sites, or any other website.
pub fn detect(text: &str) -> Option<DetectedLink> {
    detect_known(text).or_else(|| any_site_link(text))
}

#[tauri::command]
pub fn parse_link(text: String) -> Option<DetectedLink> {
    detect(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_youtube_tracking_but_keeps_the_video() {
        let link = detect("https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123&t=42s").unwrap();
        assert_eq!(link.platform, "YouTube");
        assert_eq!(link.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s");
        assert_eq!(link.removed_trackers, 1);
    }

    #[test]
    fn drops_the_query_when_only_trackers_remain() {
        let link = detect("copy this https://youtu.be/dQw4w9WgXcQ?si=xyz").unwrap();
        assert_eq!(link.url, "https://youtu.be/dQw4w9WgXcQ");
        assert_eq!(link.removed_trackers, 1);
    }

    #[test]
    fn recognises_short_tiktok_hosts() {
        let link = detect("https://vt.tiktok.com/ZS8abc/?utm_source=copy_link").unwrap();
        assert_eq!(link.platform, "TikTok");
        assert_eq!(link.removed_trackers, 1);
    }

    #[test]
    fn spotify_pages_other_than_tracks_are_not_links_to_save() {
        assert!(detect("https://open.spotify.com/album/123").is_none());
        assert!(detect_known("https://open.spotify.com/album/123").is_none());
    }

    #[test]
    fn popular_video_sites_are_offered_as_soon_as_they_are_copied() {
        let link = detect_known("https://www.pornhub.com/view_video.php?viewkey=ph123abc").unwrap();
        assert_eq!(link.platform, "Pornhub");
        assert_eq!(link.url, "https://www.pornhub.com/view_video.php?viewkey=ph123abc");
        assert_eq!(detect_known("https://x.com/someone/status/1234567890?s=20&t=abc").unwrap().platform, "X");
        assert_eq!(detect_known("https://vimeo.com/76979871").unwrap().platform, "Vimeo");
        assert_eq!(detect_known("https://fr.xhamster.com/videos/some-title-1234").unwrap().platform, "XHamster");
        // The home page of such a site is not a video.
        assert!(detect_known("https://www.pornhub.com/").is_none());
        assert!(detect_known("https://vimeo.com").is_none());
        // A site that only ends the same way is not that site.
        assert!(detect_known("https://notvimeo.com/123456").is_none());
    }

    #[test]
    fn any_other_website_can_be_pasted_but_is_not_offered_from_the_clipboard() {
        assert!(detect_known("https://videos.example.org/watch/abc").is_none());
        let link = detect("look at https://www.videos.example.org/watch/abc?fbclid=zzz&t=5").unwrap();
        assert_eq!(link.platform, "videos.example.org");
        assert_eq!(link.url, "https://www.videos.example.org/watch/abc?t=5");
        assert_eq!(link.removed_trackers, 1);
        // A short parameter name means something on a site CleanGrab does not know: it is kept.
        assert_eq!(detect("https://videos.example.org/w?pp=3&nd=1").unwrap().url, "https://videos.example.org/w?pp=3&nd=1");
        // A known site keeps its name whichever way the link is given.
        assert_eq!(detect("https://www.pornhub.com/").unwrap().platform, "Pornhub");
        // Links to other pages of the four platforms are still just links.
        assert_eq!(detect("https://www.youtube.com/@someone").unwrap().platform, "youtube.com");
    }

    #[test]
    fn only_links_to_the_internet_are_accepted() {
        for text in [
            "http://localhost:8000/video.mp4",
            "http://localhost/video.mp4",
            "http://192.168.1.5/video.mp4",
            "http://127.0.0.1/video.mp4",
            "http://[::1]/video.mp4",
            "https://intranet/video",
            "https://nas.local/video.mp4",
            "https://printer.lan/x",
            "https://user:secret@example.com/video",
            "https://example.com:8443/video",
            "file:///C:/Users/me/video.mp4",
            "ftp://example.com/video.mp4",
            "javascript:alert(1)",
            "ytsearch5:cats",
            "example.com/watch",
            "just some words",
            "",
        ] {
            assert!(detect(text).is_none(), "{text}");
        }
        let too_long = format!("https://example.com/{}", "a".repeat(MAX_LINK_CHARS));
        assert!(detect(&too_long).is_none());
    }
}
