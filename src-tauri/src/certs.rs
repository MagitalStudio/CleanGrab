// SPDX-License-Identifier: GPL-3.0-only
//! Certificate problems.
//!
//! CleanGrab checks that a site is who it says it is. Only when the person has
//! knowingly allowed otherwise in Settings does a download go ahead anyway, and
//! never the setup of yt-dlp and FFmpeg, which are run afterwards. When the check
//! fails, that is the answer worth showing: which of the three things went wrong,
//! and what the person can do about it, instead of a wall of TLS jargon.
//!
//! The text of these errors comes from yt-dlp (Python's `ssl` and curl, which
//! word the same problem differently) and from our own downloads (rustls), so
//! this module recognises all of them.

/// What is wrong with a certificate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Problem {
    /// Signed by someone this computer does not trust: an antivirus or a network
    /// that scans secure connections, or a self-signed site.
    Untrusted,
    /// Past its end date, or the computer's clock is wrong.
    Expired,
    /// Issued for another website.
    WrongSite,
}

const UNTRUSTED_TITLE: &str = "Security certificate not trusted";
const EXPIRED_TITLE: &str = "Security certificate expired";
const WRONG_SITE_TITLE: &str = "Security certificate is for another site";

/// Phrases that say a certificate check failed, whichever library reported it.
const CERTIFICATE_MARKERS: &[&str] = &[
    "certificate_verify_failed",
    "certificate verify failed",
    "certificateverifyerror",
    "invalid peer certificate",
    "unable to get local issuer",
    "unable to get issuer",
    "self-signed",
    "self signed",
    "certificate has expired",
    "certificate is not yet valid",
    "hostname mismatch",
    "certificate is not valid for",
    "no alternative certificate subject name",
    "ssl certificate",
    "unknownissuer",
    "notvalidforname",
    "notvalidyet",
    "certificate expired",
    "curl: (60)",
    "curl: (51)",
];

impl Problem {
    /// Reads a Problem out of an error message, or `None` when the message is
    /// about something else (a private video, no network...).
    pub fn classify(error: &str) -> Option<Problem> {
        let text = error.to_lowercase();
        if !CERTIFICATE_MARKERS.iter().any(|marker| text.contains(marker)) {
            return None;
        }

        let wrong_site = ["hostname mismatch", "not valid for", "notvalidforname", "no alternative certificate subject name", "(51)"];
        let expired = ["expired", "not yet valid", "notvalidyet"];
        Some(if wrong_site.iter().any(|marker| text.contains(marker)) {
            Problem::WrongSite
        } else if expired.iter().any(|marker| text.contains(marker)) {
            Problem::Expired
        } else {
            Problem::Untrusted
        })
    }

    /// Recognises one of our own messages, to tell the interface what kind of
    /// failure it is looking at.
    pub fn from_message(message: &str) -> Option<Problem> {
        [Problem::Untrusted, Problem::Expired, Problem::WrongSite]
            .into_iter()
            .find(|problem| message.starts_with(problem.title()))
    }

    fn title(self) -> &'static str {
        match self {
            Problem::Untrusted => UNTRUSTED_TITLE,
            Problem::Expired => EXPIRED_TITLE,
            Problem::WrongSite => WRONG_SITE_TITLE,
        }
    }

    /// The name the interface uses to pick the right help.
    pub fn kind(self) -> &'static str {
        match self {
            Problem::Untrusted => "certificate-untrusted",
            Problem::Expired => "certificate-expired",
            Problem::WrongSite => "certificate-site",
        }
    }

    /// A short title, a line break, then one sentence saying what happened.
    pub fn message(self) -> String {
        let detail = match self {
            Problem::Untrusted => {
                "The site's certificate isn't one this computer trusts, so CleanGrab stopped. Usually something sits between you and the site: an antivirus that scans secure connections, or a school, work or public Wi-Fi network."
            }
            Problem::Expired => {
                "The site's certificate has expired, or the date and time on this computer are wrong. Check that your clock is right, then try again."
            }
            Problem::WrongSite => {
                "The connection was answered with a certificate made for a different website. That happens when something is intercepting it. CleanGrab stopped to keep your downloads safe."
            }
        };
        format!("{}\n{detail}", self.title())
    }
}

/// Our explanation of `error` when it is a certificate problem.
pub fn explain(error: &str) -> Option<String> {
    Problem::classify(error).map(Problem::message)
}

/// The kind of problem in one of our messages, for the interface. `None` for
/// anything else.
pub fn kind_of_message(message: &str) -> Option<&'static str> {
    Problem::from_message(message).map(Problem::kind)
}

/// An error and everything that caused it, as one line of text: `ureq` keeps
/// the certificate details in the cause, not in its own message.
pub fn describe(error: &(dyn std::error::Error + 'static)) -> String {
    let mut text = error.to_string();
    let mut cause = error.source();
    while let Some(inner) = cause {
        text.push_str(": ");
        text.push_str(&inner.to_string());
        cause = inner.source();
    }
    text
}

/// An HTTP agent for lookups that may go ahead without trusting the site's
/// certificate. It is only ever asked for when the person has knowingly allowed
/// that in Settings, and never for downloading yt-dlp or FFmpeg, which are run.
/// Without that permission it is the normal agent, which checks everything.
pub fn agent(allow_untrusted: bool) -> ureq::Agent {
    if !allow_untrusted {
        return ureq::agent();
    }

    use ureq::rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
    use ureq::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
    use ureq::rustls::{crypto, ClientConfig, DigitallySignedStruct, SignatureScheme};

    /// Accepts any certificate. Signatures are still checked, so the handshake
    /// itself stays well-formed; only "who signed it" is no longer asked.
    #[derive(Debug)]
    struct AcceptAnyCertificate(std::sync::Arc<crypto::CryptoProvider>);

    impl ServerCertVerifier for AcceptAnyCertificate {
        fn verify_server_cert(
            &self,
            _end_entity: &CertificateDer<'_>,
            _intermediates: &[CertificateDer<'_>],
            _server_name: &ServerName<'_>,
            _ocsp_response: &[u8],
            _now: UnixTime,
        ) -> Result<ServerCertVerified, ureq::rustls::Error> {
            Ok(ServerCertVerified::assertion())
        }

        fn verify_tls12_signature(
            &self,
            message: &[u8],
            cert: &CertificateDer<'_>,
            dss: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, ureq::rustls::Error> {
            crypto::verify_tls12_signature(message, cert, dss, &self.0.signature_verification_algorithms)
        }

        fn verify_tls13_signature(
            &self,
            message: &[u8],
            cert: &CertificateDer<'_>,
            dss: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, ureq::rustls::Error> {
            crypto::verify_tls13_signature(message, cert, dss, &self.0.signature_verification_algorithms)
        }

        fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
            self.0.signature_verification_algorithms.supported_schemes()
        }
    }

    let provider = std::sync::Arc::new(crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map(|builder| {
            builder
                .dangerous()
                .with_custom_certificate_verifier(std::sync::Arc::new(AcceptAnyCertificate(provider)))
                .with_no_client_auth()
        });
    match config {
        Ok(config) => ureq::AgentBuilder::new().tls_config(std::sync::Arc::new(config)).build(),
        Err(_) => ureq::agent(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // What yt-dlp printed for badssl.com's test sites, word for word.
    const PYTHON_EXPIRED: &str = "ERROR: [generic] expired.badssl: Unable to download webpage: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: certificate has expired (_ssl.c:1007) (caused by CertificateVerifyError('[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: certificate has expired (_ssl.c:1007)'))";
    const PYTHON_SELF_SIGNED: &str = "ERROR: [generic] self-signed.badssl: Unable to download webpage: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1007)";
    const PYTHON_WRONG_HOST: &str = "ERROR: [generic] wrong.host.badssl: Unable to download webpage: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: Hostname mismatch, certificate is not valid for 'wrong.host.badssl.com'. (_ssl.c:1007)";
    // What TikTok's curl-based downloader said behind an antivirus.
    const CURL_UNTRUSTED: &str = "ERROR: [TikTok] 7669788069335223585: Unable to download webpage: Failed to perform, curl: (60) SSL certificate OpenSSL verify result: unable to get local issuer certificate (20). (caused by CertificateVerifyError('Failed to perform'))";

    #[test]
    fn tells_the_three_problems_apart() {
        assert_eq!(Problem::classify(PYTHON_EXPIRED), Some(Problem::Expired));
        assert_eq!(Problem::classify(PYTHON_SELF_SIGNED), Some(Problem::Untrusted));
        assert_eq!(Problem::classify(PYTHON_WRONG_HOST), Some(Problem::WrongSite));
        assert_eq!(Problem::classify(CURL_UNTRUSTED), Some(Problem::Untrusted));
    }

    #[test]
    fn understands_curl_and_rustls_wording() {
        let curl_expired = "curl: (60) SSL certificate OpenSSL verify result: certificate has expired (10)";
        let curl_host = "curl: (60) SSL: no alternative certificate subject name matches target host name 'example.com'";
        assert_eq!(Problem::classify(curl_expired), Some(Problem::Expired));
        assert_eq!(Problem::classify(curl_host), Some(Problem::WrongSite));

        assert_eq!(Problem::classify("invalid peer certificate: UnknownIssuer"), Some(Problem::Untrusted));
        assert_eq!(Problem::classify("invalid peer certificate: Expired"), Some(Problem::Expired));
        assert_eq!(Problem::classify("invalid peer certificate: NotValidForName"), Some(Problem::WrongSite));
        assert_eq!(Problem::classify("invalid peer certificate: NotValidYet"), Some(Problem::Expired));

        // What our own downloader reported for badssl.com, word for word.
        let expired = "https://expired.badssl.com/: Connection Failed: tls connection init failed: invalid peer certificate: certificate expired: verification time 1789858154 (UNIX), but certificate is not valid after 1428883199 (360974955 seconds ago)";
        let wrong_host = "https://wrong.host.badssl.com/: Connection Failed: tls connection init failed: invalid peer certificate: certificate not valid for name \"wrong.host.badssl.com\"; certificate is only valid for DnsName(\"*.badssl.com\")";
        assert_eq!(Problem::classify(expired), Some(Problem::Expired));
        assert_eq!(Problem::classify(wrong_host), Some(Problem::WrongSite));
    }

    #[test]
    fn other_failures_are_not_certificate_problems() {
        for text in [
            "ERROR: [youtube] abc: Video unavailable. This video is private",
            "ERROR: unable to download video data: HTTP Error 403: Forbidden",
            "Could not download yt-dlp: Connection Failed: dns error",
            "ERROR: This link has expired",
            "The read operation timed out",
            "",
        ] {
            assert_eq!(Problem::classify(text), None, "{text}");
        }
    }

    #[test]
    fn every_message_is_recognised_again_and_never_shows_jargon() {
        for problem in [Problem::Untrusted, Problem::Expired, Problem::WrongSite] {
            let message = problem.message();
            assert_eq!(Problem::from_message(&message), Some(problem));
            assert_eq!(kind_of_message(&message), Some(problem.kind()));

            let (title, detail) = message.split_once('\n').expect("a title and a sentence");
            assert!(!title.is_empty() && !detail.is_empty());
            for jargon in ["CERTIFICATE_VERIFY_FAILED", "_ssl.c", "curl", "X509", "OpenSSL"] {
                assert!(!message.contains(jargon), "{message}");
            }
        }
        assert_eq!(kind_of_message("Video unavailable"), None);
    }

    #[test]
    fn a_message_never_offers_a_way_around_the_check() {
        for problem in [Problem::Untrusted, Problem::Expired, Problem::WrongSite] {
            let message = problem.message().to_lowercase();
            assert!(!message.contains("ignore") && !message.contains("skip the check"), "{message}");
        }
    }

    /// Asks badssl.com, whose whole purpose is to serve broken certificates, and
    /// checks that what our own downloader reports is recognised. Run with
    /// `cargo test -- --ignored certificates_that_are_really_broken`.
    #[test]
    #[ignore = "needs network access"]
    fn certificates_that_are_really_broken_are_recognised() {
        for (host, expected) in [
            ("expired.badssl.com", Problem::Expired),
            ("wrong.host.badssl.com", Problem::WrongSite),
            ("self-signed.badssl.com", Problem::Untrusted),
            ("untrusted-root.badssl.com", Problem::Untrusted),
        ] {
            let error = ureq::get(&format!("https://{host}/")).call().expect_err("a broken certificate must be refused");
            let text = describe(&error);
            eprintln!("{host}: {text}");
            assert_eq!(Problem::classify(&text), Some(expected), "{host}: {text}");
        }
    }

    /// The permission really is the only difference: with it a broken certificate
    /// is let through, without it the very same request is refused.
    #[test]
    #[ignore = "needs network access"]
    fn allowing_untrusted_certificates_is_the_only_way_through() {
        for host in ["expired.badssl.com", "self-signed.badssl.com", "wrong.host.badssl.com"] {
            let url = format!("https://{host}/");
            assert!(agent(false).get(&url).call().is_err(), "{host} must be refused by default");
            let response = agent(true).get(&url).call().unwrap_or_else(|e| panic!("{host} with permission: {e}"));
            assert_eq!(response.status(), 200, "{host}");
        }
    }

    #[test]
    fn describe_joins_an_error_with_its_causes() {
        #[derive(Debug)]
        struct Inner;
        impl std::fmt::Display for Inner {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "invalid peer certificate: UnknownIssuer")
            }
        }
        impl std::error::Error for Inner {}

        #[derive(Debug)]
        struct Outer(Inner);
        impl std::fmt::Display for Outer {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "Connection Failed")
            }
        }
        impl std::error::Error for Outer {
            fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
                Some(&self.0)
            }
        }

        let text = describe(&Outer(Inner));
        assert_eq!(text, "Connection Failed: invalid peer certificate: UnknownIssuer");
        assert_eq!(Problem::classify(&text), Some(Problem::Untrusted));
    }
}
