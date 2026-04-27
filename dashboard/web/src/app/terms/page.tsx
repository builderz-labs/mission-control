export const metadata = {
  title: "Terms of Service — Killzone ICT Scanner",
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 text-sm text-zinc-300 leading-relaxed">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100 mb-1">Terms of Service</h1>
        <p className="text-zinc-500 text-xs">Last updated: April 27, 2026</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">1. Educational Purpose Only</h2>
        <p>
          Killzone ICT Scanner (&ldquo;the Service&rdquo;) is provided solely for
          educational and informational purposes. Nothing on this platform constitutes
          financial advice, investment advice, trading advice, or any other professional
          financial guidance. All signals, analyses, and outputs are for educational
          study of ICT (Inner Circle Trader) methodology.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">2. Risk Disclosure</h2>
        <p>
          Trading futures contracts involves substantial risk of loss and is not
          appropriate for all investors. You may lose more than your initial investment.
          Past performance — including any paper trade results shown on this platform —
          is not indicative of future results. You should only trade with capital you
          can afford to lose.
        </p>
        <p>
          The Service does not manage accounts, place orders on your behalf, or have
          access to your brokerage accounts unless you have explicitly configured and
          authorized the agent software to do so. You are solely responsible for all
          trading decisions and their consequences.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">3. No Financial Advisor Relationship</h2>
        <p>
          Use of this Service does not create an advisor-client, broker-dealer, or any
          other financial relationship. We are not registered as investment advisors,
          broker-dealers, or commodity trading advisors with the SEC, FINRA, NFA, or
          any other regulatory body.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">4. Subscription and Access</h2>
        <p>
          Access to the Service is granted via invitation or subscription. Your
          subscription tier determines the signals and features available to you.
          Subscriptions are non-transferable. We reserve the right to revoke access
          at any time for violations of these terms or for any other reason at our
          sole discretion.
        </p>
        <p>
          Subscription fees, if applicable, are charged in advance. Refunds are not
          provided for partial billing periods.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">5. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul className="list-disc list-inside space-y-1 text-zinc-400">
          <li>Share your account credentials or agent pairing tokens with others</li>
          <li>Attempt to reverse-engineer, scrape, or automate access to the platform beyond the provided agent software</li>
          <li>Use the Service in any way that violates applicable laws or regulations</li>
          <li>Represent our signals or outputs as licensed financial advice to third parties</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">6. Disclaimer of Warranties</h2>
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
          warranties of any kind, express or implied, including but not limited to
          merchantability, fitness for a particular purpose, or non-infringement.
          We do not warrant that the Service will be uninterrupted, error-free, or
          free of harmful components.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">7. Limitation of Liability</h2>
        <p>
          To the fullest extent permitted by law, we shall not be liable for any
          indirect, incidental, special, consequential, or punitive damages, including
          but not limited to trading losses, lost profits, or loss of data, arising
          from your use of or inability to use the Service. Our total liability shall
          not exceed the amount you paid for the Service in the three months preceding
          the claim.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">8. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the State of Alabama, United States,
          without regard to conflict of law principles. Any disputes shall be resolved
          in the courts of Madison County, Alabama.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">9. Changes to These Terms</h2>
        <p>
          We may update these Terms at any time. Continued use of the Service after
          changes are posted constitutes acceptance of the revised Terms. The
          &ldquo;Last updated&rdquo; date at the top of this page reflects the most
          recent revision.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">10. Contact</h2>
        <p>
          Questions about these Terms may be directed to the platform administrator
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
