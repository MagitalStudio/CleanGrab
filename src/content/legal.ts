// SPDX-License-Identifier: GPL-3.0-only
export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDoc {
  /** ISO date this document was last revised. */
  updated: string;
  intro: string[];
  sections: LegalSection[];
  outro?: string[];
}

// These two documents (see politiques/ for the originals) are legal texts, kept in their source
// language rather than run through the interface's translations like everything else: translating
// a legal text can change what it means.

export const TERMS_AND_CONDITIONS: LegalDoc = {
  updated: "2026-09-25",
  intro: ["Publisher: MagitalStudio", "Support: support@magitalstudio.com", "Effective date: September 25, 2026"],
  sections: [
    {
      heading: "1. What CleanGrab Is",
      paragraphs: [
        "CleanGrab is a free, open-source desktop application for Windows (with macOS support) that watches your clipboard for media links and lets you save audio/video locally using the bundled yt-dlp and FFmpeg tools. All downloading and conversion happens on your own computer. CleanGrab does not host, stream, or store any media on its own servers, does not require an account, and does not show ads.",
      ],
    },
    {
      heading: "2. Open Source License (GNU GPLv3)",
      paragraphs: [
        "CleanGrab's source code is licensed under the GNU General Public License, version 3 (GPLv3). A copy of the license is included with the software and is also available at https://www.gnu.org/licenses/gpl-3.0.html.",
        "The GPLv3 governs your rights to use, study, modify, and redistribute CleanGrab's source code. These Terms and Conditions are separate from, and do not restrict, any rights the GPLv3 grants you. If anything in these Terms conflicts with a right the GPLv3 grants you over the source code itself, the GPLv3 controls with respect to that right. These Terms instead cover your use of the built application, your conduct, and the boundaries of what MagitalStudio is responsible for.",
      ],
    },
    {
      heading: "3. Your Responsibility for What You Download",
      paragraphs: [
        "CleanGrab is a general-purpose tool: it fetches whatever link you give it. It does not select, endorse, or moderate content, and it does not verify that you have the right to download any particular file.",
        "You are solely responsible for:",
        "• Only downloading content you own, have permission to download, or are otherwise legally entitled to save (for example, under an applicable copyright exception in your jurisdiction).",
        "• Complying with the terms of service of any website you download from. Many sites, including major video platforms, restrict or prohibit downloading their content — using CleanGrab against such terms is between you and that website, not MagitalStudio.",
        "• Complying with all laws applicable to you, including copyright, privacy, and, where relevant, age-verification or content laws in your jurisdiction (CleanGrab's site list includes general-audience and adult-content platforms; you must be of legal age in your jurisdiction to access adult content, and any such access is entirely your own action).",
        "MagitalStudio does not review, and has no visibility into, what individual users download, since all processing is local to your device.",
      ],
    },
    {
      heading: "4. No Warranty",
      paragraphs: [
        'As stated in the GPLv3 license: CleanGrab is provided "AS IS," WITHOUT WARRANTY OF ANY KIND, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement. Use of CleanGrab is at your own risk.',
        "In particular:",
        "• Third-party sites can change at any time, which may break downloading, cause errors, or (rarely) produce unexpected results from yt-dlp/FFmpeg.",
        "• CleanGrab relies on the source website's certificate and content; MagitalStudio does not guarantee the accuracy, safety, or legality of any content available on third-party sites.",
      ],
    },
    {
      heading: "5. Limitation of Liability",
      paragraphs: [
        "To the maximum extent permitted by law, MagitalStudio and its contributors will not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of data, files, or profits, arising from your use or inability to use CleanGrab — including damages arising from downloaded content, converted files, or interrupted downloads — even if advised of the possibility of such damages. This limitation applies in addition to, and does not replace, the warranty and liability disclaimers already contained in the GPLv3 license.",
      ],
    },
    {
      heading: "6. Automatic Updates",
      paragraphs: [
        'CleanGrab checks a public GitHub repository (MagitalStudio/CleanGrab) for newer releases — automatically about 30 seconds after startup and then roughly every 24 hours while running, and any time you use "Check now." You can turn automatic checks off in Settings; a manual check can still be run at any time.',
        "When an update is available, CleanGrab can download and install it for you. Every downloaded installer is checked against the SHA-256 checksum GitHub records for that release before it is run; a mismatch causes the update to be rejected. Trust in the update mechanism ultimately rests on the security of MagitalStudio's GitHub account — CleanGrab does not currently use an independent, offline-held signing key to verify updates, though this may be added in the future.",
      ],
    },
    {
      heading: "7. Bundled Third-Party Tools",
      paragraphs: [
        "CleanGrab downloads and uses yt-dlp and FFmpeg, two independent open-source tools, to perform media detection and conversion. These tools are verified against their publishers' published checksums before installation. They are governed by their own respective open-source licenses, separate from CleanGrab's GPLv3 license.",
      ],
    },
    {
      heading: "8. Certificate Verification",
      paragraphs: [
        "CleanGrab verifies website certificates by default. You may choose to disable certificate verification for media downloads only (never for installing or updating yt-dlp/FFmpeg), after explicitly confirming you understand the risk. Doing so may expose you to insecure or spoofed connections; this is your choice and your risk.",
      ],
    },
    {
      heading: "9. Governing Law",
      paragraphs: [
        "These Terms are governed by the laws applicable in the Province of Quebec and the federal laws of Canada applicable therein, without regard to conflict-of-law principles.",
      ],
    },
    {
      heading: "10. Changes to These Terms",
      paragraphs: [
        "MagitalStudio may update these Terms from time to time. If a change is significant, the app's Terms version will be updated, and you will be asked to review and accept the current Terms the next time you open CleanGrab.",
      ],
    },
    {
      heading: "11. Contact",
      paragraphs: ["Questions about these Terms can be sent to support@magitalstudio.com."],
    },
  ],
  outro: [
    "This document governs your use of the CleanGrab application. It does not modify, limit, or replace the GNU GPLv3 license under which CleanGrab's source code is distributed.",
  ],
};

export const PRIVACY_POLICY: LegalDoc = {
  updated: "2026-09-25",
  intro: ["Publisher: MagitalStudio", "Support: support@magitalstudio.com", "Effective date: September 25, 2026"],
  sections: [
    {
      heading: "1. Summary",
      paragraphs: [
        "CleanGrab is designed to work locally on your device. We do not collect, receive, or store any personal data, usage data, or analytics from CleanGrab. There is no account, no sign-in, and no telemetry built into the app. This policy explains exactly what network activity does happen, and why.",
      ],
    },
    {
      heading: "2. What CleanGrab Does Not Do",
      paragraphs: [
        "• It does not require or create a user account.",
        "• It does not include analytics, crash reporting, or usage tracking of any kind.",
        "• It does not show ads or share data with advertisers.",
        "• It does not send your clipboard contents, download history, saved files, or settings to MagitalStudio or any third party.",
        "• It does not sync your data to any cloud service — everything (settings, history, downloaded files) stays on your device.",
      ],
    },
    {
      heading: "3. Network Activity That Does Happen",
      paragraphs: [
        "Because CleanGrab needs to reach the internet to check for updates and to download the media you request, some network connections do occur — but they are made directly by your device, not routed through or logged by MagitalStudio:",
        "• Update checks: CleanGrab periodically contacts GitHub's public API (api.github.com) to check the latest release of MagitalStudio/CleanGrab. This is a standard web request; like any request to GitHub, your IP address is visible to GitHub as the operator of that service, subject to GitHub's own privacy policy (https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement). You can disable automatic checks in Settings.",
        "• Update downloads: If you choose to install an update, the installer is downloaded directly from GitHub's release storage and its checksum is verified locally before it runs.",
        "• Tool downloads: On first use, CleanGrab downloads yt-dlp and FFmpeg from their official publishers and verifies them against published checksums.",
        "• Media downloads: When you save a link, your device connects directly to the website hosting that content (e.g., YouTube, TikTok, or any other site you paste) to fetch it — exactly as your web browser would. That website will see your IP address and the request, subject to its own privacy policy. MagitalStudio has no visibility into, and receives no record of, what you download or from where.",
        "• Certificate checks: Connections are verified against your system's trusted certificate store by default. If you explicitly disable certificate verification for downloads, that only affects the direct connection between your device and the content site — it does not create any new connection to MagitalStudio.",
        "None of the above connections pass through, or are logged by, MagitalStudio's own infrastructure — MagitalStudio does not operate a server that CleanGrab talks to. The only party MagitalStudio \"hears from\" is GitHub's public download statistics (aggregate, anonymous release-asset download counts), which are visible to anyone via GitHub's API.",
      ],
    },
    {
      heading: "4. Data Stored On Your Device",
      paragraphs: [
        "CleanGrab stores the following locally, in your operating system's app-data folder — never transmitted anywhere:",
        "• Your settings (language, theme, download preferences, etc.)",
        "• Your download/job history",
        "• Downloaded and converted media files, saved to the location you choose",
        "• A record of the last installed update version, used only to avoid re-prompting you for the same update",
        "You can clear this data at any time by deleting the app's settings folder or uninstalling CleanGrab.",
      ],
    },
    {
      heading: "5. Children's Privacy",
      paragraphs: [
        "CleanGrab is a general-purpose desktop utility and does not knowingly collect any data from anyone, including children, because it does not collect data at all. That said, because CleanGrab's site list can include adult-content platforms, it is not intended for use by minors; users must meet the minimum age required by their jurisdiction and by any third-party site they access.",
      ],
    },
    {
      heading: "6. Quebec Privacy Law (Law 25)",
      paragraphs: [
        'MagitalStudio operates from Quebec, Canada, and this policy is intended to align with Quebec\'s Act respecting the protection of personal information in the private sector ("Law 25"). Because CleanGrab does not collect personal information, most of Law 25\'s obligations (consent, data-subject access requests, breach notification, etc.) currently have nothing to apply to. If that changes in a future version of CleanGrab, this policy will be updated accordingly and any new collection will require your consent. For any privacy-related question or request, contact support@magitalstudio.com.',
      ],
    },
    {
      heading: "7. Open Source",
      paragraphs: [
        "Because CleanGrab's source code is published under the GNU GPLv3, anyone can inspect exactly how the app handles data, network requests, and file storage. See the source repository and license for details.",
      ],
    },
    {
      heading: "8. Changes to This Policy",
      paragraphs: [
        "If MagitalStudio's data practices change — for example, if optional cloud features are introduced in the future — this policy will be updated first, and any new data collection will be clearly disclosed and, where applicable, opt-in.",
      ],
    },
    {
      heading: "9. Contact",
      paragraphs: ["Questions about this Privacy Policy or CleanGrab's data practices can be sent to support@magitalstudio.com."],
    },
  ],
};
