import NextAuth from 'next-auth'
import Providers from 'next-auth/providers'
import { PrismaLegacyAdapter } from '../../../lib/prisma-adapter'
import prisma from '../../../api/models'
import nodemailer from 'nodemailer'
import { getSession } from 'next-auth/client'

export default (req, res) => NextAuth(req, res, {
  callbacks: {
    /**
     * @param  {object}  token     Decrypted JSON Web Token
     * @param  {object}  user      User object      (only available on sign in)
     * @param  {object}  account   Provider account (only available on sign in)
     * @param  {object}  profile   Provider profile (only available on sign in)
     * @param  {boolean} isNewUser True if new user (only available on sign in)
     * @return {object}            JSON Web Token that will be saved
     */
    async jwt (token, user, account, profile, isNewUser) {
      // Add additional session params
      if (user?.id) {
        token.id = Number(user.id)
        // HACK next-auth needs this to do account linking with jwts
        // see: https://github.com/nextauthjs/next-auth/issues/625
        token.user = { id: Number(user.id) }
      }

      if (isNewUser) {
        // if referrer exists, set on user
        if (req.cookies.sn_referrer && user?.id) {
          const referrer = await prisma.user.findUnique({ where: { name: req.cookies.sn_referrer } })
          if (referrer) {
            await prisma.user.update({ where: { id: user.id }, data: { referrerId: referrer.id } })
          }
        }

        // sign them up for the newsletter
        if (profile.email) {
          fetch(process.env.LIST_MONK_URL + '/api/subscribers', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Basic ' + Buffer.from(process.env.LIST_MONK_AUTH).toString('base64')
            },
            body: JSON.stringify({
              email: profile.email,
              name: 'blank',
              lists: [2],
              status: 'enabled',
              preconfirm_subscriptions: true
            })
          }).then(async r => console.log(await r.json())).catch(console.log)
        }
      }

      return token
    },
    async session (session, token) {
      // we need to add additional session params here
      session.user.id = Number(token.id)
      return session
    }
  },
  providers: [
    Providers.Credentials({
      id: 'lightning',
      // The name to display on the sign in form (e.g. 'Sign in with...')
      name: 'Lightning',
      // The credentials is used to generate a suitable form on the sign in page.
      // You can specify whatever fields you are expecting to be submitted.
      // e.g. domain, username, password, 2FA token, etc.
      credentials: {
        pubkey: { label: 'publickey', type: 'text' },
        k1: { label: 'k1', type: 'text' }
      },
      async authorize (credentials, req) {
        const { k1, pubkey } = credentials
        try {
          const lnauth = await prisma.lnAuth.findUnique({ where: { k1 } })
          await prisma.lnAuth.delete({ where: { k1 } })
          if (lnauth.pubkey === pubkey) {
            let user = await prisma.user.findUnique({ where: { pubkey } })
            const session = await getSession({ req })
            if (!user) {
              // if we are logged in, update rather than create
              if (session?.user) {
                user = await prisma.user.update({ where: { id: session.user.id }, data: { pubkey } })
              } else {
                user = await prisma.user.create({ data: { name: pubkey.slice(0, 10), pubkey } })
              }
            } else if (session && session.user?.id !== user.id) {
              throw new Error('account not linked')
            }

            return user
          }
        } catch (error) {
          console.log(error)
        }

        return null
      }
    }),
    Providers.Credentials({
      id: 'slashtags',
      // The name to display on the sign in form (e.g. 'Sign in with...')
      name: 'Slashtags',
      // The credentials is used to generate a suitable form on the sign in page.
      // You can specify whatever fields you are expecting to be submitted.
      // e.g. domain, username, password, 2FA token, etc.
      credentials: {
        pubkey: { label: 'publickey', type: 'text' },
        k1: { label: 'k1', type: 'text' }
      },
      async authorize (credentials, req) {
        const { k1, pubkey } = credentials
        try {
          const lnauth = await prisma.lnAuth.findUnique({ where: { k1 } })
          await prisma.lnAuth.delete({ where: { k1 } })
          if (lnauth.pubkey === pubkey) {
            let user = await prisma.user.findUnique({ where: { slashtagId: pubkey } })
            const session = await getSession({ req })
            if (!user) {
              // if we are logged in, update rather than create
              if (session?.user) {
                user = await prisma.user.update({ where: { id: session.user.id }, data: { slashtagId: pubkey } })
              } else {
                user = await prisma.user.create({ data: { name: pubkey.slice(0, 10), slashtagId: pubkey } })
              }
            } else if (session && session.user?.id !== user.id) {
              throw new Error('account not linked')
            }

            return user
          }
        } catch (error) {
          console.log(error)
        }

        return null
      }
    }),
    Providers.GitHub({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
      authorization: 'https://github.com/login/oauth/authorize',
      scope: '', // read-only acces to public information
      profile: profile => {
        return {
          ...profile,
          name: profile.login
        }
      }
    }),
    Providers.Twitter({
      clientId: process.env.TWITTER_ID,
      clientSecret: process.env.TWITTER_SECRET,
      profile: profile => {
        return {
          ...profile,
          name: profile.screen_name
        }
      }
    }),
    Providers.Email({
      server: process.env.LOGIN_EMAIL_SERVER,
      from: process.env.LOGIN_EMAIL_FROM,
      sendVerificationRequest,
      profile: profile => {
        return profile
      }
    })
  ],
  adapter: PrismaLegacyAdapter({ prisma }),
  secret: process.env.NEXTAUTH_SECRET,
  session: { jwt: true },
  jwt: {
    signingKey: process.env.JWT_SIGNING_PRIVATE_KEY
  },
  pages: {
    signIn: '/login',
    verifyRequest: '/email'
  }
})

async function sendVerificationRequest ({
  identifier: email,
  url,
  token,
  baseUrl,
  provider
}) {
  const user = await prisma.user.findUnique({ where: { email } })

  return new Promise((resolve, reject) => {
    const { server, from } = provider
    // Strip protocol from URL and use domain as site name
    const site = baseUrl.replace(/^https?:\/\//, '')

    nodemailer.createTransport(server).sendMail(
      {
        to: email,
        from,
        subject: `login to ${site}`,
        text: text({ url, site, email }),
        html: user ? html({ url, site, email }) : newUserHtml({ url, site, email })
      },
      (error) => {
        if (error) {
          return reject(new Error('SEND_VERIFICATION_EMAIL_ERROR', error))
        }
        return resolve()
      }
    )
  })
}

// Email HTML body
const html = ({ url, site, email }) => {
  // Insert invisible space into domains and email address to prevent both the
  // email address and the domain from being turned into a hyperlink by email
  // clients like Outlook and Apple mail, as this is confusing because it seems
  // like they are supposed to click on their email address to sign in.
  const escapedEmail = `${email.replace(/\./g, '&#8203;.')}`
  const escapedSite = `${site.replace(/\./g, '&#8203;.')}`

  // Some simple styling options
  const backgroundColor = '#f5f5f5'
  const textColor = '#212529'
  const mainBackgroundColor = '#ffffff'
  const buttonBackgroundColor = '#FADA5E'
  const buttonTextColor = '#212529'

  // Uses tables for layout and inline CSS due to email client limitations
  return `
<body style="background: ${backgroundColor};">
  <table width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding: 10px 0px 20px 0px; font-size: 22px; font-family: Helvetica, Arial, sans-serif; color: ${textColor};">
        <strong>${escapedSite}</strong>
      </td>
    </tr>
  </table>
  <table width="100%" border="0" cellspacing="20" cellpadding="0" style="background: ${mainBackgroundColor}; max-width: 600px; margin: auto; border-radius: 10px;">
    <tr>
      <td align="center" style="padding: 10px 0px 0px 0px; font-size: 18px; font-family: Helvetica, Arial, sans-serif; color: ${textColor};">
        login as <strong>${escapedEmail}</strong>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center" style="border-radius: 5px;" bgcolor="${buttonBackgroundColor}"><a href="${url}" target="_blank" style="font-size: 18px; font-family: Helvetica, Arial, sans-serif; color: ${buttonTextColor}; text-decoration: none; text-decoration: none;border-radius: 5px; padding: 10px 20px; border: 1px solid ${buttonBackgroundColor}; display: inline-block; font-weight: bold;">login</a></td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 0px 0px 10px 0px; font-size: 16px; line-height: 22px; font-family: Helvetica, Arial, sans-serif; color: ${textColor};">
        Or copy and paste this link: <a href="#" style="text-decoration:none; color:${textColor}">${url}</a>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 0px 0px 10px 0px; font-size: 10px; line-height: 22px; font-family: Helvetica, Arial, sans-serif; color: ${textColor};">
        If you did not request this email you can safely ignore it.
      </td>
    </tr>
  </table>
</body>
`
}

// Email text body –fallback for email clients that don't render HTML
const text = ({ url, site }) => `Sign in to ${site}\n${url}\n\n`

const newUserHtml = ({ url, site, email }) => {
  const escapedEmail = `${email.replace(/\./g, '&#8203;.')}`

  const replaceCb = (path) => {
    const urlObj = new URL(url)
    urlObj.searchParams.set('callbackUrl', path)
    return urlObj.href
  }

  const dailyUrl = replaceCb('/daily')
  const guideUrl = replaceCb('/guide')
  const faqUrl = replaceCb('/faq')
  const topUrl = replaceCb('/top/users/forever')
  const postUrl = replaceCb('/post')

  // Some simple styling options
  const backgroundColor = '#f5f5f5'
  const textColor = '#212529'
  const mainBackgroundColor = '#ffffff'
  const buttonBackgroundColor = '#FADA5E'

  return `
<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">

<head>
  <title>
  </title>
  <!--[if !mso]><!-->
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--<![endif]-->
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style type="text/css">
    #outlook a {
      padding: 0;
    }

    body {
      margin: 0;
      padding: 0;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }

    table,
    td {
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }

    img {
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
      -ms-interpolation-mode: bicubic;
    }

    p {
      display: block;
      margin: 13px 0;
    }
  </style>
  <!--[if mso]>
        <noscript>
        <xml>
        <o:OfficeDocumentSettings>
          <o:AllowPNG/>
          <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
        </xml>
        </noscript>
        <![endif]-->
  <!--[if lte mso 11]>
        <style type="text/css">
          .mj-outlook-group-fix { width:100% !important; }
        </style>
        <![endif]-->
  <style type="text/css">
    @media only screen and (min-width:480px) {
      .mj-column-per-100 {
        width: 100% !important;
        max-width: 100%;
      }
    }
  </style>
  <style media="screen and (min-width:480px)">
    .moz-text-html .mj-column-per-100 {
      width: 100% !important;
      max-width: 100%;
    }
  </style>
  <style type="text/css">
  </style>
</head>

<body style="word-spacing:normal;background-color:${backgroundColor};">
  <div style="background-color:${backgroundColor};">
    <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" style="width:600px;" width="600" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    <div style="margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">
        <tbody>
          <tr>
            <td style="direction:ltr;font-size:0px;padding:20px 0;text-align:center;">
              <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
              <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
                  <tbody>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:Helvetica, Arial, sans-serif;font-size:22px;line-height:1;text-align:center;color:#000000;"><b>Welcome to Stacker News!</b></div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!--[if mso | IE]></td></tr></table><![endif]-->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" style="width:600px;" width="600" bgcolor="${mainBackgroundColor}" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    <div style="background:${mainBackgroundColor};background-color:${mainBackgroundColor};margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:${mainBackgroundColor};background-color:${mainBackgroundColor};width:100%;">
        <tbody>
          <tr>
            <td style="direction:ltr;font-size:0px;padding:20px 0;text-align:center;">
              <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
              <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
                  <tbody>
                    <tr>
                      <td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:Helvetica, Arial, sans-serif;font-size:16px;line-height:22px;text-align:left;color:#000000;">If you know how Stacker News works, click the login button below.</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:Helvetica, Arial, sans-serif;font-size:16px;line-height:22px;text-align:left;color:#000000;">If you want to learn how Stacker News works, keep reading.</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!--[if mso | IE]></td></tr></table><![endif]-->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" style="width:600px;" width="600" bgcolor="${backgroundColor}" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    <div style="background:${backgroundColor};background-color:${backgroundColor};margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:${backgroundColor};background-color:${backgroundColor};width:100%;">
        <tbody>
          <tr>
            <td style="direction:ltr;font-size:0px;padding:20px 0;text-align:center;">
              <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
              <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
                  <tbody>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:Helvetica, Arial, sans-serif;font-size:18px;line-height:1;text-align:center;color:#000000;">login as <b>${escapedEmail}</b></div>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" vertical-align="middle" style="font-size:0px;padding:10px 25px;padding-top:20px;padding-bottom:30px;word-break:break-word;">
                        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;">
                          <tr>
                            <td align="center" bgcolor="${buttonBackgroundColor}" role="presentation" style="border:none;border-radius:5px;cursor:auto;mso-padding-alt:15px 40px;background:${buttonBackgroundColor};" valign="middle">
                              <a href="${url}" style="display:inline-block;background:${buttonBackgroundColor};color:${textColor};font-family:Helvetica, Arial, sans-serif;font-size:22px;font-weight:normal;line-height:120%;margin:0;text-decoration:none;text-transform:none;padding:15px 40px;mso-padding-alt:0px;border-radius:5px;" target="_blank">
                                <mj-text align="center" font-family="Helvetica, Arial, sans-serif" font-size="20px"><b font-family="Helvetica, Arial, sans-serif">login</b></mj-text>
                              </a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:Helvetica, Arial, sans-serif;font-size:14px;line-height:24px;text-align:center;color:#000000;">Or copy and paste this link: <a href="#" style="text-decoration:none; color:#787878">${url}</a></div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!--[if mso | IE]></td></tr></table><![endif]-->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" style="width:600px;" width="600" bgcolor="${mainBackgroundColor}" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    <div style="background:${mainBackgroundColor};background-color:${mainBackgroundColor};margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:${mainBackgroundColor};background-color:${mainBackgroundColor};width:100%;">
        <tbody>
          <tr>
            <td style="direction:ltr;font-size:0px;padding:20px 0;text-align:center;">
              <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
              <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
                  <tbody>
                    <tr>
                      <td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:Helvetica, Arial, sans-serif;font-size:14px;line-height:20px;text-align:left;color:#000000;">Stacker News is like Reddit or Hacker News, but it <b>pays you Bitcoin</b>. Instead of giving posts or comments “upvotes,” Stacker News users (aka stackers) send you small amounts of Bitcoin called sats.</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:Helvetica, Arial, sans-serif;font-size:14px;line-height:20px;text-align:left;color:#000000;">In fact, <a href="${topUrl}"><b>some stackers</b></a> have already stacked <b>millions of sats</b> just for posting and starting thoughtful conversations.</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:Helvetica, Arial, sans-serif;font-size:14px;line-height:20px;text-align:left;color:#000000;">To start earning sats, <a href="${postUrl}"><b><i>click here to make your first post</i></b></a>. You can share links, discussion questions, polls, or even bounties with other stackers. <a href="${guideUrl}">This guide</a> offers some useful tips and best practices for sharing content on Stacker News.</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:Helvetica, Arial, sans-serif;font-size:14px;line-height:20px;text-align:left;color:#000000;">If you’re not sure what to share, <a href="${dailyUrl}"><b><i>click here to introduce yourself to the community</i></b></a> with a comment on the daily discussion thread.</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:Helvetica, Arial, sans-serif;font-size:14px;line-height:20px;text-align:left;color:#000000;">If you still have questions, <a href="${faqUrl}"><b><i>click here to learn more about Stacker News</i></b></a> by reading our FAQ.</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:Helvetica, Arial, sans-serif;font-size:14px;line-height:20px;text-align:left;color:#000000;">If anything isn’t clear, comment on the FAQ post and we’ll answer your question.</div>
                      </td>
                    </tr>
                    <tr>
                      <td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
                        <div style="font-family:Helvetica, Arial, sans-serif;font-size:14px;line-height:20px;text-align:left;color:#000000;">Zap,<br /> Stacker News</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!--[if mso | IE]></td></tr></table><![endif]-->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" style="width:600px;" width="600" bgcolor="${mainBackgroundColor}" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    <div style="background:${mainBackgroundColor};background-color:${mainBackgroundColor};margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:${mainBackgroundColor};background-color:${mainBackgroundColor};width:100%;">
        <tbody>
          <tr>
            <td style="direction:ltr;font-size:0px;padding:0px 0px 20px 0px;text-align:center;">
              <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
              <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
                  <tbody>
                    <tr>
                      <td align="center" style="font-size:0px;padding:0px 25px 0px 25px;word-break:break-word;">
                        <div style="font-family:Arial, sans-serif;font-size:14px;line-height:28px;text-align:center;color:#55575d;">P.S. Stacker News loves you!</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!--[if mso | IE]></td></tr></table><![endif]-->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" style="width:600px;" width="600" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    <div style="margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">
        <tbody>
          <tr>
            <td style="direction:ltr;font-size:0px;padding:20px 0px 20px 0px;text-align:center;">
              <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:600px;" ><![endif]-->
              <div class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%">
                  <tbody>
                    <tr>
                      <td align="center" style="font-size:0px;padding:0px 20px;word-break:break-word;">
                        <div style="font-family:Arial, sans-serif;font-size:11px;line-height:22px;text-align:center;color:#55575d;">If you did not request this email you can safely ignore it.</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!--[if mso | IE]></td></tr></table><![endif]-->
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!--[if mso | IE]></td></tr></table><![endif]-->
  </div>
</body>

</html>
`
}
