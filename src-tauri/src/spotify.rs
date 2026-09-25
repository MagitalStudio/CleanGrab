// SPDX-License-Identifier: GPL-3.0-only
//! Reading a Spotify track's title, artists and length.
//!
//! Spotify streams are protected, so CleanGrab never downloads from Spotify.
//! It reads what the track *is* here, then finds the same recording on a public
//! site (see media.rs). Spotify's normal page is a bare web-player shell for
//! browsers, so the details come from the page it publishes for embeds, with
//! the social-preview version of the track page as a fallback.

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use std::time::Duration;

const BROWSER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
/// Link-preview crawlers get the page with its title and Open Graph tags filled in.
const PREVIEW_AGENT: &str = "Twitterbot/1.0";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

static TRACK_ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"/track/([A-Za-z0-9]{10,})").unwrap());
static NEXT_DATA_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?s)<script id="__NEXT_DATA__" type="application/json">(.*?)</script>"#).unwrap());
static TITLE_TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<title>(.*?)</title>").unwrap());
static PAGE_TITLE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(.+?)\s+-\s+(?:song|Song)(?:\s+and\s+lyrics)?\s+by\s+(.+?)\s+\|\s+Spotify$").unwrap()
});

#[derive(Debug, Clone, PartialEq)]
pub struct Track {
    pub title: String,
    pub artists: Vec<String>,
    /// Length of the recording, in seconds, when Spotify says.
    pub duration_secs: Option<f64>,
}

impl Track {
    /// "The Weeknd, Ariana Grande"
    pub fn artist_line(&self) -> String {
        self.artists.join(", ")
    }

    /// "The Weeknd – Blinding Lights", as shown in the download list.
    pub fn label(&self) -> String {
        format!("{} – {}", self.artist_line(), self.title)
    }
}

fn track_id(url: &str) -> Option<String> {
    TRACK_ID_RE.captures(url).map(|found| found[1].to_string())
}

fn fetch(url: &str, agent: &str, allow_untrusted: bool) -> Result<String, String> {
    crate::certs::agent(allow_untrusted)
        .get(url)
        .set("User-Agent", agent)
        .set("Accept-Language", "en-US,en;q=0.9")
        .timeout(REQUEST_TIMEOUT)
        .call()
        .map_err(|error| {
            crate::certs::explain(&crate::certs::describe(&error))
                .unwrap_or_else(|| "Could not reach Spotify".to_string())
        })?
        .into_string()
        .map_err(|_| "Could not read the Spotify page".to_string())
}

/// Reads the track details out of the embed page's data block.
fn parse_embed(html: &str) -> Option<Track> {
    let data: Value = serde_json::from_str(NEXT_DATA_RE.captures(html)?.get(1)?.as_str()).ok()?;
    let state = data.pointer("/props/pageProps/state/data")?;
    // The track sits under `entity` on current pages and directly under `data` on older ones.
    let entity = state.get("entity").unwrap_or(state);

    let title = entity.get("name").and_then(Value::as_str)?.trim().to_string();
    let artists: Vec<String> = entity
        .get("artists")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(|artist| artist.get("name").and_then(Value::as_str))
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect();
    if title.is_empty() || artists.is_empty() {
        return None;
    }

    let duration_secs = entity
        .get("duration")
        .and_then(Value::as_f64)
        .filter(|ms| *ms > 0.0)
        .map(|ms| ms / 1000.0);

    Some(Track { title, artists, duration_secs })
}

fn decode_entities(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn meta_content(html: &str, property: &str) -> Option<String> {
    let pattern = format!(
        r#"(?i)<meta[^>]+(?:property|name)="{}"[^>]+content="([^"]*)""#,
        regex::escape(property)
    );
    let found = Regex::new(&pattern).ok()?.captures(html)?[1].to_string();
    Some(decode_entities(&found))
}

/// Reads the social-preview version of a track page.
fn parse_page(html: &str) -> Option<Track> {
    // "Blinding Lights - song and lyrics by The Weeknd | Spotify"
    let from_title = TITLE_TAG_RE
        .captures(html)
        .map(|found| decode_entities(found[1].trim()))
        .and_then(|text| {
            PAGE_TITLE_RE
                .captures(&text)
                .map(|parts| (parts[1].to_string(), parts[2].to_string()))
        });

    // og:title is the track name, og:description is "Artist · Album · Song · 2020".
    let from_meta = meta_content(html, "og:title").zip(
        meta_content(html, "og:description")
            .and_then(|text| text.split('·').next().map(|artist| artist.trim().to_string())),
    );

    let (title, artist) = from_title.or(from_meta)?;
    let artists: Vec<String> = artist
        .split(',')
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect();
    if title.trim().is_empty() || artists.is_empty() {
        return None;
    }

    let duration_secs = meta_content(html, "music:duration")
        .and_then(|seconds| seconds.trim().parse::<f64>().ok())
        .filter(|seconds| *seconds > 0.0);

    Some(Track { title: title.trim().to_string(), artists, duration_secs })
}

/// Finds out what a Spotify track link points to. `allow_untrusted` is the
/// person's permission to go ahead even if Spotify's certificate can't be trusted.
pub fn lookup(url: &str, allow_untrusted: bool) -> Result<Track, String> {
    let id = track_id(url).ok_or("This doesn't look like a Spotify track link")?;

    let embed = fetch(&format!("https://open.spotify.com/embed/track/{id}"), BROWSER_AGENT, allow_untrusted)
        .ok()
        .and_then(|html| parse_embed(&html));
    if let Some(track) = embed {
        return Ok(track);
    }

    let page = fetch(&format!("https://open.spotify.com/track/{id}"), PREVIEW_AGENT, allow_untrusted)?;
    parse_page(&page).ok_or_else(|| "Could not read this Spotify track".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const EMBED_PAGE: &str = r#"<html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"state":{"data":{"entity":{"name":"Blinding Lights","artists":[{"name":"The Weeknd"}],"duration":200040}}}}}}</script></body></html>"#;

    const PREVIEW_PAGE: &str = r#"<html><head><title>Blinding Lights - song and lyrics by The Weeknd | Spotify</title>
        <meta property="og:title" content="Blinding Lights"/>
        <meta property="og:description" content="The Weeknd · After Hours · Song · 2020"/>
        <meta name="music:duration" content="200"/></head></html>"#;

    #[test]
    fn finds_the_track_id_in_share_links() {
        assert_eq!(
            track_id("https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b?si=abc").as_deref(),
            Some("0VjIjW4GlUZAMYd2vXMi3b")
        );
        assert_eq!(
            track_id("https://open.spotify.com/intl-fr/track/0VjIjW4GlUZAMYd2vXMi3b").as_deref(),
            Some("0VjIjW4GlUZAMYd2vXMi3b")
        );
        assert_eq!(track_id("https://open.spotify.com/album/0VjIjW4GlUZAMYd2vXMi3b"), None);
    }

    #[test]
    fn reads_title_artists_and_length_from_the_embed_page() {
        let track = parse_embed(EMBED_PAGE).unwrap();
        assert_eq!(track.title, "Blinding Lights");
        assert_eq!(track.artists, vec!["The Weeknd".to_string()]);
        assert_eq!(track.duration_secs, Some(200.04));
        assert_eq!(track.label(), "The Weeknd – Blinding Lights");
    }

    #[test]
    fn lists_every_artist() {
        let page = EMBED_PAGE.replace(
            r#"[{"name":"The Weeknd"}]"#,
            r#"[{"name":"The Weeknd"},{"name":"Ariana Grande"}]"#,
        );
        assert_eq!(parse_embed(&page).unwrap().artist_line(), "The Weeknd, Ariana Grande");
    }

    #[test]
    fn an_embed_page_without_a_track_is_rejected() {
        assert!(parse_embed("<html>Spotify – Web Player</html>").is_none());
        assert!(parse_embed(r#"<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>"#).is_none());
    }

    #[test]
    fn reads_the_social_preview_page() {
        let track = parse_page(PREVIEW_PAGE).unwrap();
        assert_eq!(track.title, "Blinding Lights");
        assert_eq!(track.artists, vec!["The Weeknd".to_string()]);
        assert_eq!(track.duration_secs, Some(200.0));
    }

    #[test]
    fn falls_back_to_open_graph_tags_when_the_title_is_localised() {
        let page = r#"<title>Blinding Lights - chanson par The Weeknd | Spotify</title>
            <meta property="og:title" content="Blinding Lights"/>
            <meta property="og:description" content="The Weeknd · After Hours · Chanson · 2020"/>"#;
        let track = parse_page(page).unwrap();
        assert_eq!(track.title, "Blinding Lights");
        assert_eq!(track.artists, vec!["The Weeknd".to_string()]);
        assert_eq!(track.duration_secs, None);
    }

    #[test]
    fn the_bare_web_player_page_is_not_a_track() {
        assert!(parse_page("<html><title>Spotify – Web Player</title></html>").is_none());
    }

    /// Hits the real Spotify. Run with `cargo test -- --ignored` to check that
    /// the site still publishes what this module reads.
    #[test]
    #[ignore = "needs network access"]
    fn reads_a_real_track() {
        let track = lookup("https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b", false).unwrap();
        assert_eq!(track.title, "Blinding Lights");
        assert_eq!(track.artist_line(), "The Weeknd");
        assert!(track.duration_secs.is_some_and(|s| (s - 200.0).abs() < 2.0));
    }
}
