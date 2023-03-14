process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://9c471046a6b549168c6799a86506ef3b@errors.cozycloud.cc/52'

const {
  BaseKonnector,
  requestFactory,
  scrape,
  saveBills,
  log,
  errors,
  cozyClient,
  solveCaptcha
} = require('cozy-konnector-libs')
const request = requestFactory({
  cheerio: true,
  // debug: true,
  jar: true
})
const models = cozyClient.new.models
const { Qualification } = models.document
const moment = require('moment')
moment.locale('fr')

const baseUrl = 'https://www.bipandgo.com'
const billsUrl = baseUrl + '/mon_compte/factures'

module.exports = new BaseKonnector(start)

async function start(fields) {
  await login(fields)
  const bills = await getBillsList()
  await saveBills(bills, fields, {
    identifiers: ['bipandgo'],
    contentType: 'application/pdf',
    sourceAccount: this.accountId,
    sourceAccountIdentifier: fields.login,
    fileIdAttributes: ['vendorRef']
  })
}

async function parsePage($) {
  log('info', 'Scraping and filter bills')
  let bills = scrape(
    $,
    {
      vendorRef: {
        sel: 'td:nth-child(1)'
      },

      billDate: {
        sel: 'td:nth-child(2)',
        parse: str => moment(str, 'L')
      },
      date: {
        sel: 'td:nth-child(2)',
        parse: str => moment(str, 'L').toDate()
      },
      amount: {
        sel: 'td:nth-child(4)',
        parse: str => parseFloat(str.replace(',', '.'))
      },
      amountString: {
        sel: 'td:nth-child(4)',
        parse: str => `${str}`
      },
      fileurl: {
        sel: 'td:nth-child(4) a',
        attr: 'href',
        parse: href => `${billsUrl}/${href}`
      }
    },
    'tbody.badges-block__table-body tr'
  )
  bills = await filter(bills)
  return bills.map(bill => {
    const filename =
      `${bill['billDate'].format('YYYY-MM-DD')}` +
      `_${bill['amountString']}_${bill['vendorRef']}.pdf`
    delete bill.billDate
    delete bill.amountString
    return {
      ...bill,
      vendor: 'bipandgo',
      currency: '€',
      filename: filename,
      fileAttributes: {
        metadata: {
          contentAuthor: 'bipandgo.com',
          issueDate: new Date(),
          datetime: new Date(bill.date),
          datetimeLabel: `issueDate`,
          carbonCopy: true,
          qualification: Qualification.getByLabel('transport_invoice')
        }
      }
    }
  })
}

async function filter(bills) {
  // We remove old bills that don't have a link to a pdf
  let billsNew = []
  for (let i = 0; i < bills.length; i += 1) {
    if (bills[i].fileurl === `${billsUrl}/undefined`) {
      log('debug', 'Discard an old bill without pdf')
    } else {
      billsNew.push(bills[i])
    }
  }
  return billsNew
}

async function getPage(listStartNumber, pageNumber) {
  log('info', `Fetching page ${pageNumber}`)
  const $ = await request(
    `${billsUrl}/?invoice_listbox_list_start=${listStartNumber}`
  )
  if ($('a[rel="next"]').length > 0) {
    log('debug', `Page ${pageNumber} found`)
    return { page: $, status: true }
  } else {
    log('info', `Next page link not found, expecting no more page`)
    return { page: $, status: false }
  }
}

async function getBillsList() {
  let bills = []
  let again = true
  let listStartNumber = 0
  let pageNumber = 1
  while (again) {
    const pageAndStatus = await getPage(listStartNumber, pageNumber)
    again = pageAndStatus.status
    const partBill = await parsePage(pageAndStatus.page)
    bills = bills.concat(partBill)
    // On each page, there is 15 bills available so the startNumber in the url is implemented by 15 each lap.
    listStartNumber = listStartNumber + 15
    pageNumber = pageNumber + 1
  }
  return bills
}

async function login(fields) {
  log('info', 'Logging...')
  const loginPage = await request(`${baseUrl}/login_form`)
  const loginValues = await parseLoginPage(loginPage)
  const gRecaptcha = await solveCaptcha({
    websiteKey: '6Lc1dyMUAAAAAASglHuUf-6pMMFKMgCt8ASs9ck1',
    websiteURL: 'https://www.bipandgo.com/login_form'
  })
  await request('https://www.bipandgo.com/volatile_cache_context/', {
    method: 'POST',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/110.0',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin'
    },
    form: {
      'g-recaptcha-response': gRecaptcha,
      username: fields.login,
      password: fields.password,
      login_retry_url: loginValues[0].fieldLoginRetryUrl,
      came_from: loginValues[0].fieldCameFrom,
      __enable_authorisation_extractor: '1',
      'logged_in_once:method': 'Go'
    }
  })
  // Make a check, because resp to signin is identical(except SERVERID cookie)
  await request(billsUrl).catch(err => {
    if (err.statusCode === 401) throw new Error(errors.LOGIN_FAILED)
    else throw err
  })
}

async function parseLoginPage($) {
  let loginValue = scrape(
    $,
    {
      fieldLoginRetryUrl: {
        sel: 'input[name="field_login_retry_url"]',
        attr: 'value'
      },

      fieldCameFrom: {
        sel: 'input[name="field_came_from"]',
        attr: 'value'
      }
    },
    '.auxiliary'
  )
  return loginValue
}
