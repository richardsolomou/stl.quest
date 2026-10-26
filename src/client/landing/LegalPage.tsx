import { Brand } from '@/client/components/Brand'
import { ISSUES_URL } from './site'

const effectiveDate = '29 July 2026'

type Section = {
  heading: string
  paragraphs: string[]
  items?: string[]
}

const policies: Record<'privacy' | 'terms', { title: string; introduction: string; sections: Section[] }> = {
  privacy: {
    title: 'Privacy Policy',
    introduction:
      'This policy explains what information STL Quest collects when you use the hosted service or visit the website at stl.quest, why it is collected, and the choices available to you. Self-hosted installations are operated by their respective administrators and are not covered by this policy.',
    sections: [
      {
        heading: 'Information we collect',
        paragraphs: [
          'We collect information you provide to use the hosted service, including your name, email address, profile image, authentication details, workspace membership and invitations, printer details, print requests, notes, source links, and production status. If you use included hosted storage, STL Quest stores your uploaded models and generated previews and thumbnails. If you connect storage you manage, the files remain with that provider and STL Quest stores the configuration and encrypted credentials needed to access them.',
        ],
        items: [
          'Authentication and security information, including sessions, IP addresses, browser details, linked sign-in methods, and two-factor authentication settings.',
          'Subscription information, including your plan, subscription status, billing period, and identifiers used to link your account with Stripe. Stripe handles payment details, Checkout, invoices, and the billing portal.',
          'Technical and usage information, including pages viewed, interactions, device and browser details, screen size, performance data, logs, and errors.',
          'Application product events use a random internal user ID and do not include model files, request names or notes, filenames, email addresses, user names, storage credentials, or other workspace content. Error reports may include messages, stack traces, source paths, page URLs, and limited operation context.',
          'Session replays and heatmaps. Form inputs are masked; requester names, email addresses, and profile images are excluded from application recordings. Website analytics are configured without persistent person profiles.',
          'Information you send when requesting support or otherwise contacting us.',
        ],
      },
      {
        heading: 'How we use information',
        paragraphs: [
          'We use information to provide, secure, maintain, and improve STL Quest; operate connected features; understand how the website and hosted service are used; diagnose errors; prevent abuse; and respond to support requests. We do not sell personal information.',
        ],
      },
      {
        heading: 'Service providers and disclosure',
        paragraphs: [
          'We share information with providers only as needed to operate features you use. These may include infrastructure providers, PostHog for analytics and error monitoring, Stripe for paid subscriptions, Google or Discord for social sign-in, email delivery providers, and a storage provider you connect such as Dropbox, Google Drive, Microsoft OneDrive, Box, WebDAV, or an S3-compatible service. Those providers process information under their own terms and privacy policies. We may also disclose information when required by law, to protect rights and safety, or as part of a business transfer.',
        ],
      },
      {
        heading: 'Retention and security',
        paragraphs: [
          'We retain information while your account or workspace is active and as needed to provide the service, meet legal obligations, resolve disputes, and enforce agreements. Authentication sessions expire after 30 days. Deleting a workspace permanently deletes its STL Quest records and files in included hosted storage. Files in storage you manage may remain with that provider until you remove them. We use reasonable technical and organisational safeguards, including encryption of stored OAuth credentials, but no system can guarantee absolute security.',
        ],
      },
      {
        heading: 'Your choices and rights',
        paragraphs: [
          'You can update your profile, change or unlink sign-in methods, disconnect storage providers, delete eligible workspaces, cancel a paid plan, and stop using the service. Application telemetry can be disabled for an entire installation by its super admin. Depending on where you live, you may have rights to access, correct, delete, restrict, or export personal information, or object to certain processing. To make a request, use the contact details below.',
        ],
      },
      {
        heading: 'Cookies and local storage',
        paragraphs: [
          'STL Quest uses cookies and similar browser storage for authentication, security, preferences, and analytics. You can limit them through your browser, but authentication and other service features may stop working correctly.',
        ],
      },
      {
        heading: 'Children',
        paragraphs: [
          'STL Quest is not directed to children under 13, and we do not knowingly collect personal information from children under 13.',
        ],
      },
      {
        heading: 'Changes to this policy',
        paragraphs: [
          'We may update this policy from time to time. The effective date above shows when it was last revised. Material changes will be communicated through the website or hosted service when appropriate.',
        ],
      },
    ],
  },
  terms: {
    title: 'Terms of Service',
    introduction:
      'These terms govern your use of the hosted STL Quest service and the website at stl.quest. By using them, you agree to these terms. If you do not agree, do not use the service. The open-source software is separately licensed under AGPL-3.0.',
    sections: [
      {
        heading: 'Using STL Quest',
        paragraphs: [
          'You may use the service only if you can legally enter into this agreement. You are responsible for your account, keeping credentials secure, activity in your workspaces, and the accuracy and legality of content you submit.',
        ],
      },
      {
        heading: 'Acceptable use',
        paragraphs: ['You must not misuse the service. In particular, you must not:'],
        items: [
          'Break the law or infringe another person’s rights.',
          'Upload, link to, or process malicious, deceptive, or unlawful content.',
          'Interfere with the service, bypass security or usage limits, or access it through unauthorised means.',
          'Use the service to harm, threaten, harass, or exploit others.',
        ],
      },
      {
        heading: 'Your content and connected services',
        paragraphs: [
          'You retain ownership of content you submit. You give STL Quest a limited permission to host, copy, process, generate previews from, and display that content only as needed to operate the service. You are responsible for ensuring you have the rights needed to use your content and any connected storage service. Files in included hosted storage are stored by STL Quest; files in storage you connect remain with that provider.',
        ],
      },
      {
        heading: 'Plans and billing',
        paragraphs: [
          'The hosted service may offer free and paid plans with different storage allowances or other limits. Stripe Managed Payments acts as merchant of record for paid subscriptions and provides Checkout, invoices, payment support, and the billing portal. Prices and billing periods are shown before purchase. You can cancel through the billing portal; paid allowances continue until the end of the current billing period.',
        ],
      },
      {
        heading: 'Storage and deletion',
        paragraphs: [
          'You are responsible for keeping copies of content you cannot afford to lose. Storage limits include original models, generated assets, incomplete uploads, and recoverable trash. If an account exceeds its allowance, uploads may be blocked until usage falls or the plan changes. Deleting a workspace permanently deletes its STL Quest data and files in included hosted storage. Files in storage you manage may need to be removed from that provider separately.',
        ],
      },
      {
        heading: 'Third-party services',
        paragraphs: [
          'Features that connect to Stripe, social sign-in providers, email delivery, or external storage are also governed by those providers’ terms. STL Quest is not responsible for third-party services or for changes, outages, or data handling by those providers.',
        ],
      },
      {
        heading: 'Availability and changes',
        paragraphs: [
          'The hosted service is provided without a guaranteed uptime or support level. We may change, suspend, or discontinue features and may impose reasonable limits to protect the service. We will try to provide notice of material changes when practical.',
        ],
      },
      {
        heading: 'Suspension and termination',
        paragraphs: [
          'You may stop using the service at any time. We may suspend or terminate access if you violate these terms, create risk or legal exposure, or if operating the service is no longer practical. Provisions that by their nature should survive termination will continue to apply.',
        ],
      },
      {
        heading: 'Disclaimers',
        paragraphs: [
          'To the fullest extent permitted by law, the service is provided “as is” and “as available”, without warranties of any kind. STL Quest does not warrant that the service will be uninterrupted, error-free, or suitable for a particular purpose. Nothing in these terms excludes warranties or rights that cannot legally be excluded.',
        ],
      },
      {
        heading: 'Limitation of liability',
        paragraphs: [
          'To the fullest extent permitted by law, STL Quest will not be liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, data, goodwill, or business opportunities arising from use of the service. Nothing in these terms limits liability where doing so would be unlawful.',
        ],
      },
      {
        heading: 'Changes to these terms',
        paragraphs: [
          'We may update these terms from time to time. The effective date above shows when they were last revised. Continued use after revised terms take effect means you accept them.',
        ],
      },
    ],
  },
}

export function LegalPage({ policy }: { policy: 'privacy' | 'terms' }) {
  const content = policies[policy]

  return (
    <>
      <a className="fixed top-2 left-2 z-50 -translate-y-16 bg-card px-3 py-2 focus:translate-y-0" href="#main">
        Skip to content
      </a>
      <header className="mx-auto flex h-16 w-[min(760px,calc(100%-48px))] items-center justify-between border-b">
        <a href="/home" aria-label="STL Quest home">
          <Brand />
        </a>
        <a className="text-sm text-muted-foreground hover:text-foreground" href="/home">
          Back to home
        </a>
      </header>
      <main id="main" className="mx-auto w-[min(760px,calc(100%-48px))] py-12 min-[621px]:py-16">
        <p className="mb-3 font-mono text-xs text-muted-foreground">Effective {effectiveDate}</p>
        <h1 className="font-heading text-5xl font-medium tracking-tight min-[621px]:text-6xl">{content.title}</h1>
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{content.introduction}</p>
        <div className="mt-12 space-y-10">
          {content.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="font-heading text-2xl font-medium">{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p className="mt-3 leading-relaxed text-muted-foreground" key={paragraph}>
                  {paragraph}
                </p>
              ))}
              {section.items && (
                <ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed text-muted-foreground">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <section>
            <h2 className="font-heading text-2xl font-medium">Contact</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              Questions or requests can be submitted through the{' '}
              <a
                className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                href={ISSUES_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                STL Quest issue tracker
              </a>
              . Do not include personal or other sensitive information in a public issue; ask for a private way to get in touch.
            </p>
          </section>
        </div>
      </main>
      <footer className="mx-auto flex w-[min(760px,calc(100%-48px))] flex-wrap gap-x-6 gap-y-3 border-t py-6 font-mono text-xs text-muted-foreground">
        <span>© {new Date().getFullYear()} STL Quest</span>
        <a className="hover:text-foreground" href="/terms">
          Terms
        </a>
        <a className="hover:text-foreground" href="/privacy">
          Privacy
        </a>
      </footer>
    </>
  )
}
