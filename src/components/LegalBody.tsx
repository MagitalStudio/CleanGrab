// SPDX-License-Identifier: GPL-3.0-only
import type { LegalDoc } from "../content/legal";
import { formatDate, useT } from "../i18n";

/** The full text of one of the two legal documents (Terms and Conditions, Privacy Policy). */
export default function LegalBody({ doc }: { doc: LegalDoc }) {
  const t = useT();
  return (
    <div className="space-y-5">
      {doc.intro.map((paragraph, index) => (
        <p key={`intro-${index}`} className="text-body text-ink-2">
          {paragraph}
        </p>
      ))}
      {doc.sections.map((section) => (
        <section key={section.heading}>
          <h3 className="mb-1 text-body font-semibold text-ink">{section.heading}</h3>
          {section.paragraphs.map((paragraph, index) => (
            <p key={index} className="mb-2 text-body text-ink-2">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
      {doc.outro?.map((paragraph, index) => (
        <p key={`outro-${index}`} className="text-body italic text-ink-2">
          {paragraph}
        </p>
      ))}
      <p className="text-caption text-ink-3">{t("terms.updated", { date: formatDate(doc.updated) })}</p>
    </div>
  );
}
