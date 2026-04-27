export const metadata = {
  title: "Privacy Policy — Killzone ICT Scanner",
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 text-sm text-zinc-300 leading-relaxed">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100 mb-1">Privacy Policy</h1>
        <p className="text-zinc-500 text-xs">Last updated: April 27, 2026</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">1. Information We Collect</h2>
        <p>We collect the following information when you use the Service:</p>
        <ul className="list-disc list-inside space-y-1 text-zinc-400">
          <li>
            <strong className="text-zinc-300">Account information</strong> — username,
            Discord ID and username (if you sign in with Discord), display name
          </li>
          <li>
            <strong className="text-zinc-300">Agent connection data</strong> — hostname,
            agent version, connection timestamps, last-seen time
          </li>
          <li>
            <strong className="text-zinc-300">Trading activity</strong> — paper trade
            records, signal delivery logs, trade results reported by the agent software
          </li>
          <li>
            <strong className="text-zinc-300">Audit logs</strong> — connect/disconnect
            events, entitlement changes, and any violations for dispute resolution
          </li>
          <li>
            <strong className="text-zinc-300">Security logs</strong> — login attempts
            (including failures), IP addresses, and timestamps
          </li>
        </ul>
        <p>We do not collect payment card numbers directly. Payment processing, if
        applicable, is handled by a third-party processor (Stripe) under their own
        privacy policy.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">2. How We Use Your Information</h2>
        <p>We use collected information to:</p>
        <ul className="list-disc list-inside space-y-1 text-zinc-400">
          <li>Authenticate you and manage your session</li>
          <li>Deliver trading signals to your agent software per your subscription entitlements</li>
          <li>Track paper trade performance for your review</li>
          <li>Administer your subscription tier and enforce usage limits</li>
          <li>Investigate disputes or policy violations</li>
          <li>Maintain security and prevent unauthorized access</li>
        </ul>
        <p>We do not sell your data to third parties. We do not use your data for
        advertising purposes.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">3. Discord Integration</h2>
        <p>
          If you sign in using Discord OAuth, we receive your Discord user ID, username,
          and avatar URL from Discord. We use this solely to authenticate your account
          and display your identity within the dashboard. We do not post to Discord on
          your behalf or access your Discord messages.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">4. Data Storage</h2>
        <p>
          All data is stored in SQLite databases on a VPS server located in the
          European Union (Hostinger infrastructure). Data is not distributed across
          multiple regions. Backups, if performed, are stored on the same server.
        </p>
        <p>
          Session cookies are stored in your browser. They are HttpOnly (not accessible
          to JavaScript), Secure (HTTPS only), and expire after 30 days.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">5. Data Retention</h2>
        <p>
          Account and trading data is retained for as long as your account is active.
          Audit logs are retained for a minimum of 90 days for dispute resolution.
          If you request account deletion, your personal identifiers will be removed
          within 30 days; aggregated or anonymized trading statistics may be retained.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">6. Your Rights</h2>
        <p>You may request:</p>
        <ul className="list-disc list-inside space-y-1 text-zinc-400">
          <li>Access to the data we hold about you</li>
          <li>Correction of inaccurate data</li>
          <li>Deletion of your account and associated personal data</li>
          <li>Export of your trading history in JSON format</li>
        </ul>
        <p>
          To exercise these rights, contact the platform administrator via Discord or
          the dashboard contact form. We will respond within 30 days.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">7. Cookies</h2>
        <p>
          We use a single session cookie (<code className="text-zinc-400 font-mono text-xs">kz_session</code>)
          to maintain your authenticated session. We do not use tracking cookies,
          analytics cookies, or third-party advertising cookies.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">8. Third-Party Services</h2>
        <ul className="list-disc list-inside space-y-1 text-zinc-400">
          <li>
            <strong className="text-zinc-300">Discord</strong> — OAuth login. Governed
            by Discord&apos;s Privacy Policy.
          </li>
          <li>
            <strong className="text-zinc-300">Telegram</strong> — Administrative alerts
            sent to the platform operator only. No user data is sent to Telegram.
          </li>
          <li>
            <strong className="text-zinc-300">GitHub</strong> — Agent release downloads.
            No user data is shared with GitHub.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. The &ldquo;Last
          updated&rdquo; date at the top reflects the most recent revision. Continued
          use of the Service after changes are posted constitutes acceptance.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">10. Contact</h2>
        <p>
          Privacy questions or data requests may be sent to the platform administrator
          via the Discord server or dashboard contact form.
        </p>
      </section>

      <div className="border-t border-zinc-800 pt-4">
        <p className="text-[11px] text-zinc-600">
          For educational purposes only. Not financial advice. Trading futures involves
          substantial risk of loss and may not be suitable for all investors. Past
          performance is not indicative of future results.
        </p>
      </div>
    </div>
  );
}
