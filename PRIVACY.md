CleanGrab — Privacy Policy

Publisher: MagitalStudio Support: support@magitalstudio.com Effective date: September 25, 2026

1. Summary

CleanGrab is designed to work locally on your device. We do not collect, receive, or store any personal data, usage data, or analytics from CleanGrab. There is no account, no sign-in, and no telemetry built into the app. This policy explains exactly what network activity does happen, and why.

2. What CleanGrab Does Not Do
It does not require or create a user account.
It does not include analytics, crash reporting, or usage tracking of any kind.
It does not show ads or share data with advertisers.
It does not send your clipboard contents, download history, saved files, or settings to MagitalStudio or any third party.
It does not sync your data to any cloud service — everything (settings, history, downloaded files) stays on your device.
3. Network Activity That Does Happen

Because CleanGrab needs to reach the internet to check for updates and to download the media you request, some network connections do occur — but they are made directly by your device, not routed through or logged by MagitalStudio:

Update checks: CleanGrab periodically contacts GitHub's public API (api.github.com) to check the latest release of MagitalStudio/CleanGrab. This is a standard web request; like any request to GitHub, your IP address is visible to GitHub as the operator of that service, subject to GitHub's own privacy policy. You can disable automatic checks in Settings.
Update downloads: If you choose to install an update, the installer is downloaded directly from GitHub's release storage and its checksum is verified locally before it runs.
Tool downloads: On first use, CleanGrab downloads yt-dlp and FFmpeg from their official publishers and verifies them against published checksums.
Media downloads: When you save a link, your device connects directly to the website hosting that content (e.g., YouTube, TikTok, or any other site you paste) to fetch it — exactly as your web browser would. That website will see your IP address and the request, subject to its own privacy policy. MagitalStudio has no visibility into, and receives no record of, what you download or from where.
Certificate checks: Connections are verified against your system's trusted certificate store by default. If you explicitly disable certificate verification for downloads, that only affects the direct connection between your device and the content site — it does not create any new connection to MagitalStudio.

None of the above connections pass through, or are logged by, MagitalStudio's own infrastructure — MagitalStudio does not operate a server that CleanGrab talks to. The only party MagitalStudio "hears from" is GitHub's public download statistics (aggregate, anonymous release-asset download counts), which are visible to anyone via GitHub's API.

4. Data Stored On Your Device

CleanGrab stores the following locally, in your operating system's app-data folder — never transmitted anywhere:

Your settings (language, theme, download preferences, etc.)
Your download/job history
Downloaded and converted media files, saved to the location you choose
A record of the last installed update version, used only to avoid re-prompting you for the same update

You can clear this data at any time by deleting the app's settings folder or uninstalling CleanGrab.

5. Children's Privacy

CleanGrab is a general-purpose desktop utility and does not knowingly collect any data from anyone, including children, because it does not collect data at all. That said, because CleanGrab's site list can include adult-content platforms, it is not intended for use by minors; users must meet the minimum age required by their jurisdiction and by any third-party site they access.

6. Quebec Privacy Law (Law 25)

MagitalStudio operates from Quebec, Canada, and this policy is intended to align with Quebec's Act respecting the protection of personal information in the private sector ("Law 25"). Because CleanGrab does not collect personal information, most of Law 25's obligations (consent, data-subject access requests, breach notification, etc.) currently have nothing to apply to. If that changes in a future version of CleanGrab, this policy will be updated accordingly and any new collection will require your consent. For any privacy-related question or request, contact support@magitalstudio.com.

7. Open Source

Because CleanGrab's source code is published under the GNU GPLv3, anyone can inspect exactly how the app handles data, network requests, and file storage. See the source repository and license for details.

8. Changes to This Policy

If MagitalStudio's data practices change — for example, if optional cloud features are introduced in the future — this policy will be updated first, and any new data collection will be clearly disclosed and, where applicable, opt-in.

9. Contact

Questions about this Privacy Policy or CleanGrab's data practices can be sent to support@magitalstudio.com.
