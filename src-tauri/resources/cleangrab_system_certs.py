# SPDX-License-Identifier: GPL-3.0-only
"""CleanGrab: let yt-dlp trust the operating system's certificate store.

yt-dlp ships with its own list of trusted certificate authorities and ignores
the one Windows keeps. Antivirus programs that scan HTTPS (Avast, Kaspersky,
ESET...) and company proxies re-sign websites with a certificate they add to
the Windows store, so yt-dlp rejects every site with CERTIFICATE_VERIFY_FAILED
while browsers work fine.

yt-dlp has two ways of talking to a site, and each keeps its own list:
  * Python's own TLS, used by most sites (YouTube...);
  * curl_cffi, used for sites that check the browser's fingerprint (TikTok...).
This plugin adds the system's certificates to both, which is what a browser
does. Verification stays on. It is installed by CleanGrab next to yt-dlp, and
if anything goes wrong it does nothing.
"""

import os
import ssl
import sys
import tempfile

# "Server authentication" purpose, as it appears in the Windows store.
_SERVER_AUTH = "1.3.6.1.5.5.7.3.1"


def _system_certificates():
    """The store's server-authentication certificates as DER bytes, skipping
    any that Python cannot read."""
    if sys.platform != "win32" or not hasattr(ssl, "enum_certificates"):
        return
    checker = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    for store in ("CA", "ROOT"):
        try:
            certificates = ssl.enum_certificates(store)
        except OSError:
            continue
        for certificate, encoding, trust in certificates:
            if encoding != "x509_asn":
                continue
            if trust is not True and _SERVER_AUTH not in trust:
                continue
            try:
                checker.load_verify_locations(cadata=certificate)
            except ssl.SSLError:
                continue
            yield certificate


def _add_system_certificates(context):
    if sys.platform == "win32" and hasattr(ssl, "enum_certificates"):
        for certificate in _system_certificates():
            try:
                context.load_verify_locations(cadata=certificate)
            except ssl.SSLError:
                continue
    else:
        context.set_default_verify_paths()


def _install_python_tls():
    from yt_dlp.networking import _helper

    original = getattr(_helper, "make_ssl_context", None)
    if original is None or getattr(original, "_cleangrab", False):
        return

    def make_ssl_context(*args, **kwargs):
        context = original(*args, **kwargs)
        try:
            if context.verify_mode != ssl.CERT_NONE:
                _add_system_certificates(context)
        except Exception:
            pass
        return context

    make_ssl_context._cleangrab = True

    # Request handlers imported the function by name, so replace it everywhere.
    for module in list(sys.modules.values()):
        name = getattr(module, "__name__", "")
        if name.startswith("yt_dlp") and getattr(module, "make_ssl_context", None) is original:
            module.make_ssl_context = make_ssl_context


def _bundle_path():
    """A PEM file holding curl_cffi's usual certificates plus the system's,
    rewritten only when its content changes."""
    import certifi

    with open(certifi.where(), "rb") as handle:
        pem = handle.read()
    extra = "".join(ssl.DER_cert_to_PEM_cert(certificate) for certificate in _system_certificates())
    content = pem.rstrip(b"\n") + b"\n" + extra.encode("ascii")

    path = os.path.join(tempfile.gettempdir(), "cleangrab-ca-bundle.pem")
    try:
        with open(path, "rb") as handle:
            if handle.read() == content:
                return path
    except OSError:
        pass

    # Write beside it and swap in, so a download running at the same time never
    # reads half a file.
    scratch = f"{path}.{os.getpid()}"
    with open(scratch, "wb") as handle:
        handle.write(content)
    os.replace(scratch, path)
    return path


def _install_curl_cffi():
    if sys.platform != "win32" or not hasattr(ssl, "enum_certificates"):
        return  # elsewhere curl_cffi already follows the system's default paths

    import curl_cffi.curl as curl

    if getattr(curl, "_cleangrab", False):
        return
    curl.DEFAULT_CACERT = _bundle_path()
    curl._cleangrab = True

    aio = sys.modules.get("curl_cffi.aio")
    if aio is not None and hasattr(aio, "DEFAULT_CACERT"):
        aio.DEFAULT_CACERT = curl.DEFAULT_CACERT


for _step in (_install_python_tls, _install_curl_cffi):
    try:
        _step()
    except Exception:
        # Never get in the way of yt-dlp itself.
        pass
